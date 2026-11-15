import type { HandLandmarker } from '@mediapipe/tasks-vision';
import type {
  Cinematic,
  DebugInfo,
  Delegate,
  HudStats,
  OrbKind,
  Profile,
  Quality,
  Settings,
  TechniqueHud,
  TechniqueId,
  TrackingStatus,
  Vec2,
} from './types';
import { DEFAULT_SETTINGS } from './types';
import { TH, type MachineEvent } from './abilityMachine';
import { EffectsRenderer, type OrbView, type VideoMap } from './effects';
import { AudioEngine } from './audio';
import { add, clamp, easeInOut, lerpV, scale } from './math';
import { TechniqueCore } from './core';
import { CHARACTER_BY_ID } from './characters';
import { EffectManager } from './fx/effectManager';
import type { VideoView } from './fx/primitives';
import type { MaskHand } from './fx/personLayer';
import { GESTURE_NAMES } from './gestureClassifier';
import { GESTURE_CFG } from './config';
import type { Detection } from './hands';
import { PersonSegmenter } from './segmenter';

export interface EngineDeps {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  label: HTMLElement;
  landmarker: HandLandmarker;
  delegate: Delegate;
  audio: AudioEngine;
  onStats: (s: HudStats) => void;
  onCinematic?: (c: Cinematic) => void;
}

interface OrbState {
  x: number;
  y: number;
  vis: number;
}

/**
 * Orchestrates one frame: camera → MediaPipe (one landmarker, two hands) → TechniqueCore
 * (smoothing, classifier, resolver, technique state machines) → effects → HUD.
 * A single requestAnimationFrame loop renders every effect. Runs outside React; React only gets throttled stats.
 */
export class GojoEngine {
  private d: EngineDeps;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;

  private core: TechniqueCore;
  private fx = new EffectsRenderer();
  private nfx = new EffectManager();
  private settings: Settings = { ...DEFAULT_SETTINGS };

  private lastVideoTime = -1;
  private lastTs = 0;
  private lastT = 0;
  private lastPrimarySeen = -Infinity;
  private everSeen = false;
  private skeletonAlpha = [0, 0];
  private cineKey = 0;

  private segmenter: PersonSegmenter | null = null;
  private segState: 'off' | 'loading' | 'ready' | 'failed' = 'off';
  private segTick = 0;

  private W = 0;
  private H = 0;
  private dpr = 1;
  private map: VideoMap = { s: 1, dx: 0, dy: 0, vw: 640, vh: 480 };

  private blue: OrbState = { x: 0, y: 0, vis: 0 };
  private red: OrbState = { x: 0, y: 0, vis: 0 };
  private purple: OrbState = { x: 0, y: 0, vis: 0 };
  private palmPx = 120;

  private shots = 0;
  private quality: Quality = 'auto';
  private particleScale = 1;
  private showSkeleton = true;
  private fpsT = 0;
  private camCount = 0;
  private renderCount = 0;
  private camFps = 0;
  private renderFps = 0;
  private statsT = 0;
  private shaking = false;

  constructor(deps: EngineDeps) {
    this.d = deps;
    const ctx = deps.canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) throw new Error('Canvas 2D недоступен');
    this.ctx = ctx;
    this.core = new TechniqueCore({
      fx: this.nfx,
      sfx: deps.audio,
      onLimitless: (e) => this.onEvent(e),
      onCinematic: (c) => deps.onCinematic?.({ ...c, key: ++this.cineKey }),
    });
    // handy for tuning thresholds live from the browser console
    (window as unknown as { __gojo: unknown }).__gojo = { cfg: GESTURE_CFG, core: this.core };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now() / 1000;
    this.fpsT = this.lastT;
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    try {
      this.d.landmarker.close();
    } catch {
      /* already closed */
    }
    this.segmenter?.close();
    this.segmenter = null;
    this.nfx.clear();
    const stream = this.d.video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    this.d.video.srcObject = null;
    this.d.audio.dispose();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    if (q === 'high') this.particleScale = 1;
    else if (q === 'medium') this.particleScale = 0.6;
    else if (q === 'low') this.particleScale = 0.35;
    this.W = 0; // force canvas resize (dpr may change)
  }

  setMuted(m: boolean): void {
    this.d.audio.setMuted(m);
  }

  setSkeleton(show: boolean): void {
    this.showSkeleton = show;
  }

  /** Character / mode / debug settings. Switching character keeps the camera & tracking running. */
  setSettings(s: Settings): void {
    const t = performance.now() / 1000;
    const switched = s.character !== this.settings.character;
    this.settings = { ...s };
    this.core.setSettings(s, t);
    if (switched) {
      this.nfx.clear();
      for (const k of ['void', 'shrine', 'blood', 'fist'] as const) this.d.audio.layer(k, 0);
    }
  }

  /** Test button: play a technique's effect without the gesture. */
  demo(id: TechniqueId): void {
    this.core.demo(id, performance.now() / 1000, this.W, this.H);
  }

  private profile(): Profile {
    if (this.quality !== 'auto') return this.quality;
    return this.particleScale >= 0.75 ? 'high' : this.particleScale >= 0.45 ? 'medium' : 'low';
  }

  /* ----------------------------------------------------------------- loop */

  private loop = (nowMs: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = nowMs / 1000;
    const dt = clamp(t - this.lastT, 0.0001, 0.05);
    this.lastT = t;
    this.resize();
    const fdt = dt * this.nfx.timeScale(dt); // Black Flash slow motion affects effects only

    const v = this.d.video;
    let det: Detection | null | undefined;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      const ts = Math.max(this.lastTs + 1, nowMs);
      this.lastTs = ts;
      try {
        const res = this.d.landmarker.detectForVideo(v, ts);
        this.camCount++;
        det = res.landmarks && res.landmarks.length > 0 ? { landmarks: res.landmarks, world: res.worldLandmarks, handedness: res.handedness } : null;
      } catch (e) {
        console.warn('[engine] detect failed', e);
      }
    }

    this.core.step(det, t, dt, this.map, this.W, this.H);
    const track = this.core.track;
    if (track.hands.length > 0) this.everSeen = true;
    if (track.primary) this.lastPrimarySeen = t;
    if (det !== undefined) this.segment(this.lastTs);

    this.updateOrbs(t, dt);
    this.draw(t, fdt);
    this.nfx.endFrame();
    this.applyShake();
    this.updateLabel();
    const m = this.core.limitless.machine;
    this.d.audio.update(this.blue.vis, this.red.vis, this.purple.vis, m.purpleCharge, m.state === 'MERGING' ? m.mergeProgress : 0);
    this.renderCount++;
    this.tickStats(t);
  };

  /** Person segmentation only while a domain is visible, and not on the LOW profile. */
  private segment(tsMs: number): void {
    const want = this.nfx.domainIntensity() > 0.01 && this.profile() !== 'low';
    if (!want) return;
    if (this.segState === 'off') {
      this.segState = 'loading';
      PersonSegmenter.create()
        .then((s) => {
          if (!this.running) return s.close();
          this.segmenter = s;
          this.segState = 'ready';
        })
        .catch((e) => {
          console.warn('[engine] person segmentation unavailable, using hand mask', e);
          this.segState = 'failed';
        });
      return;
    }
    if (this.segState !== 'ready' || !this.segmenter) return;
    // medium profile: every second camera frame
    if (this.profile() === 'medium' && this.segTick++ % 2) return;
    try {
      const t = performance.now() / 1000;
      this.segmenter.segment(this.d.video, tsMs, (data, w, h) => this.nfx.person.setMask(data, w, h, t));
    } catch (e) {
      console.warn('[engine] segmentation failed', e);
      this.segState = 'failed';
    }
  }

  private resize(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dev = window.devicePixelRatio || 1;
    const q = this.quality;
    const dpr = q === 'high' ? Math.min(dev, 2) : q === 'low' ? 1 : Math.min(dev, 1.5);
    if (W !== this.W || H !== this.H || dpr !== this.dpr) {
      this.W = W;
      this.H = H;
      this.dpr = dpr;
      this.d.canvas.width = Math.round(W * dpr);
      this.d.canvas.height = Math.round(H * dpr);
    }
    const vw = this.d.video.videoWidth || 640;
    const vh = this.d.video.videoHeight || 480;
    const s = Math.max(W / vw, H / vh);
    this.map = { s, dx: (W - vw * s) / 2, dy: (H - vh * s) / 2, vw, vh };
    this.nfx.W = W;
    this.nfx.H = H;
  }

  /* --------------------------------------------------------------- orbs */

  private approach(o: OrbState, target: Vec2, visTarget: number, dt: number): void {
    if (o.vis < 0.02 && visTarget > 0) {
      o.x = target.x;
      o.y = target.y;
    } else {
      const k = 1 - Math.exp(-dt * 26);
      o.x += (target.x - o.x) * k;
      o.y += (target.y - o.y) * k;
    }
    const rate = visTarget > o.vis ? 5 : 3.5;
    o.vis += clamp(visTarget - o.vis, -rate * dt, rate * dt);
  }

  private updateOrbs(t: number, dt: number): void {
    const m = this.core.limitless.machine;
    const f = m.lastFrame;
    if (f) {
      this.palmPx = f.palmPx;
      const st = m.state;
      const lost = t - this.lastPrimarySeen;
      const presence = lost < TH.LOST_GRACE ? 1 : Math.max(0.35, 1 - (lost - TH.LOST_GRACE));

      let bT = f.indexAnchor;
      let rT = f.middleAnchor;
      const mid = add(lerpV(bT, rT, 0.5), scale(f.pointDir, this.palmPx * 0.12));
      const mp = easeInOut(m.mergeProgress);
      if (st === 'MERGING') {
        bT = lerpV(bT, mid, mp * 0.92);
        rT = lerpV(rT, mid, mp * 0.92);
      }
      const blueOn = st === 'BLUE_ACTIVE' || st === 'BLUE_RED_ACTIVE' || st === 'MERGING';
      const redOn = st === 'BLUE_RED_ACTIVE' || st === 'MERGING';
      const purpleOn = st === 'PURPLE_CHARGING' || st === 'PURPLE_READY';
      const mergeFade = st === 'MERGING' ? 1 - mp * 0.3 : 1;

      this.approach(this.blue, bT, blueOn ? presence * mergeFade : 0, dt);
      this.approach(this.red, rT, redOn ? presence * mergeFade : 0, dt);
      this.approach(this.purple, mid, purpleOn ? presence : 0, dt);
    }

    const slots = this.core.track.slots;
    for (let i = 0; i < 2; i++) {
      const h = slots[i];
      const seen = h.lastSeen > -Infinity;
      const target = this.showSkeleton && seen ? (h.present ? 1 : t - h.lastSeen < GESTURE_CFG.LOST_GRACE ? 0.25 : 0) : 0;
      this.skeletonAlpha[i] += (target - this.skeletonAlpha[i]) * (1 - Math.exp(-dt * 8));
    }
  }

  private orbView(kind: OrbKind): OrbView {
    const m = this.core.limitless.machine;
    if (kind === 'blue') return { ...this.blue, r: this.palmPx * 0.24, charge: m.blueCharge };
    if (kind === 'red') return { ...this.red, r: this.palmPx * 0.26, charge: m.redCharge };
    return { ...this.purple, r: this.palmPx * (0.4 + 0.25 * m.purpleCharge), charge: m.purpleCharge };
  }

  private draw(t: number, dt: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const profile = this.profile();
    this.fx.q = this.particleScale;
    this.nfx.q = this.particleScale;
    this.nfx.profile = profile;

    const view: VideoView = { video: this.d.video, ...this.map, W: this.W };
    const slots = this.core.track.slots;
    const maskHands: MaskHand[] = slots
      .filter((h) => h.lastSeen > -Infinity)
      .map((h) => ({ pts: h.pts, palmPx: h.palmPx, alpha: h.present ? 1 : clamp(1 - (t - h.lastSeen) / GESTURE_CFG.LOST_GRACE) }));

    // 1) domain worlds + the user cut back on top of them
    this.nfx.renderBackground(ctx, dt, t, view, maskHands);
    this.nfx.renderTint(ctx);

    // 2) the original Blue/Red/Purple renderer (orbs, lensing, skeleton, projectiles)
    const primarySlot = this.core.track.primary?.slot ?? (slots[0].lastSeen >= slots[1].lastSeen ? 0 : 1);
    const other = primarySlot === 0 ? 1 : 0;
    this.fx.render(ctx, {
      t,
      dt,
      W: this.W,
      H: this.H,
      video: this.d.video,
      map: this.map,
      lens: profile !== 'low' && this.particleScale > 0.5,
      blue: this.orbView('blue'),
      red: this.orbView('red'),
      purple: this.orbView('purple'),
      merge: this.core.limitless.machine.state === 'MERGING' ? this.core.limitless.machine.mergeProgress : 0,
      skeleton: slots[primarySlot].lastSeen > -Infinity ? slots[primarySlot].pts : null,
      skeletonAlpha: this.skeletonAlpha[primarySlot],
      skeleton2: slots[other].lastSeen > -Infinity ? slots[other].pts : null,
      skeleton2Alpha: this.skeletonAlpha[other],
      clear: false,
    });

    // 3) the new techniques' effects
    this.nfx.renderForeground(ctx, dt, profile === 'low' ? null : view);
  }

  private onEvent(e: MachineEvent): void {
    switch (e.type) {
      case 'fire': {
        const o = this.orbView(e.kind);
        this.fx.fire(e.kind, o.x, o.y, e.dir, e.power, o.r);
        this[e.kind].vis = 0;
        this.shots++;
        this.d.audio.fire(e.kind, e.power);
        break;
      }
      case 'mergeStart':
        this.d.audio.mergeStart();
        break;
      case 'merged': {
        const x = (this.blue.x + this.red.x) / 2;
        const y = (this.blue.y + this.red.y) / 2;
        this.purple.x = x;
        this.purple.y = y;
        this.purple.vis = 0.7;
        this.fx.merged(x, y, this.palmPx * 0.4);
        this.d.audio.merge();
        break;
      }
      case 'dissipate':
        (['blue', 'red', 'purple'] as const).forEach((k) => this.fx.dissipate(this.orbView(k), k));
        break;
      case 'state':
        break;
    }
  }

  /* ------------------------------------------------------- cinematic / UI */

  private applyShake(): void {
    const tr = Math.min(1, Math.max(this.fx.trauma, this.nfx.trauma));
    const s = tr * tr;
    const st = this.d.stage.style;
    if (s < 0.002) {
      if (this.shaking) {
        st.transform = '';
        this.shaking = false;
      }
      return;
    }
    this.shaking = true;
    const r = () => Math.random() * 2 - 1;
    st.transform = `translate3d(${r() * s * 24}px, ${r() * s * 24}px, 0) rotate(${r() * s * 0.8}deg) scale(${1 + s * 0.03})`;
  }

  private updateLabel(): void {
    const el = this.d.label;
    const p = this.orbView('purple');
    if (p.vis < 0.03) {
      if (el.style.opacity !== '0') el.style.opacity = '0';
      return;
    }
    el.style.opacity = String(clamp(p.vis));
    el.style.transform = `translate3d(${p.x}px, ${p.y - p.r * 2.2 - 24}px, 0) translate(-50%, -100%)`;
  }

  private techniqueHud(t: number): TechniqueHud[] {
    const ids = CHARACTER_BY_ID[this.settings.character].techniques;
    return ids.map((id) => {
      const x = this.core.byId[id];
      return { id, state: x.state, engaged: x.engaged(), progress: clamp(x.progress(t)), cooldown: x.cooldownLeft(t), extra: x.extra() };
    });
  }

  private debugInfo(): DebugInfo {
    const r = this.core.resolution;
    const uniq = [...new Set(r.rejected)];
    return {
      hands: this.core.track.hands.map((h) => ({
        slot: h.slot,
        side: h.side,
        fingers: (['thumb', 'index', 'middle', 'ring', 'pinky'] as const).map((f) => (h.fingers[f] ? '▮' : '▯')).join(''),
        curl: (['thumb', 'index', 'middle', 'ring', 'pinky'] as const).map((f) => Math.round(h.curl[f] * 9)).join(''),
        gesture: h.gesture,
        crossed: h.crossed,
        roll: h.roll,
        speed: h.palmSpeed,
        scaleRate: h.scaleRate,
      })),
      candidates: this.core.cands.map((c) => `${GESTURE_NAMES[c.id]} ${Math.round(c.confidence * 100)}%${c.detail ? ` (${c.detail})` : ''}`),
      winner: r.winner,
      holdMs: r.holdMs,
      owner: r.owner.map((id) => `${this.core.byId[id].meta.name}: ${this.core.byId[id].state}`).join(' · ') || '—',
      rejected: uniq.slice(0, 6),
      segmentation:
        this.segState === 'ready'
          ? this.nfx.person.hasSegmentation(performance.now() / 1000)
            ? 'сегментация человека: активна'
            : 'сегментация: готова (вне домена)'
          : this.segState === 'loading'
            ? 'сегментация: загрузка…'
            : this.segState === 'failed'
              ? 'сегментация недоступна → маска рук'
              : 'сегментация: включится в домене',
    };
  }

  private tickStats(t: number): void {
    if (t - this.fpsT >= 1) {
      const el = t - this.fpsT;
      this.camFps = Math.round(this.camCount / el);
      this.renderFps = Math.round(this.renderCount / el);
      this.camCount = 0;
      this.renderCount = 0;
      this.fpsT = t;
      if (this.quality === 'auto') {
        if (this.renderFps < 45) this.particleScale = Math.max(0.3, this.particleScale - 0.15);
        else if (this.renderFps > 56) this.particleScale = Math.min(1, this.particleScale + 0.05);
      }
    }
    if (t - this.statsT < 0.1) return;
    this.statsT = t;
    const track = this.core.track;
    const visible = track.hands.length > 0;
    const tracking: TrackingStatus = visible ? 'tracking' : this.everSeen && t - track.lastSeen < TH.LOST_RESET ? 'lost' : 'searching';
    const active = this.core.active();
    this.d.onStats({
      state: this.core.limitless.machine.state,
      energy: this.core.limitless.machine.energy,
      shots: this.shots,
      cameraFps: this.camFps,
      renderFps: this.renderFps,
      tracking,
      gesture: track.primary ? track.primary.rawGesture : 'none',
      particleScale: this.particleScale,
      delegate: this.d.delegate,
      hands: track.hands.length,
      profile: this.profile(),
      techniques: this.techniqueHud(t),
      active: active ? active.meta.id : null,
      debug: this.settings.debug ? this.debugInfo() : null,
    });
  }
}

