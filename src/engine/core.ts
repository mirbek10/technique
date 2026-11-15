/**
 * The gesture → ability pipeline, free of DOM/canvas so it runs in unit tests:
 *   MediaPipe result → HandProcessor (smoothing, geometry, velocity) → GestureClassifier (candidates)
 *   → GestureResolver (one winner per character/state/priority) → technique state machines → Fx/Sfx calls.
 */
import type { MachineEvent } from './abilityMachine';
import { CHARACTER_BY_ID } from './characters';
import type { Fx, Sfx } from './fx/api';
import { GestureClassifier, type GestureCandidate, type GestureId } from './gestureClassifier';
import { GestureResolver, type Resolution, type RosterRules } from './gestureResolver';
import { HandProcessor, type Detection, type TrackFrame, type VideoMapLike } from './hands';
import { BaseTechnique, PRIORITY, type Technique, type TechniqueContext } from './techniques/base';
import { BlackFlashTechnique } from './techniques/blackFlash';
import { DismantleTechnique } from './techniques/dismantle';
import { LimitlessTechnique } from './techniques/limitless';
import { MalevolentShrineTechnique } from './techniques/malevolentShrine';
import { PiercingBloodTechnique } from './techniques/piercingBlood';
import { TenShadowsTechnique } from './techniques/tenShadows';
import { UnlimitedVoidTechnique } from './techniques/unlimitedVoid';
import { DEFAULT_SETTINGS, type Cinematic, type Settings, type TechniqueId } from './types';

export interface CoreDeps {
  fx: Fx;
  sfx: Sfx;
  onLimitless?: (e: MachineEvent) => void;
  onCinematic?: (c: Omit<Cinematic, 'key'>) => void;
}

/** In ALL TECHNIQUES mode complex signs need a longer confirmation hold, so that poses of different characters do not collide. */
const ALL_MODE_CONFIRM = 1.25;

export class TechniqueCore implements RosterRules {
  readonly hands = new HandProcessor();
  readonly classifier = new GestureClassifier();
  readonly resolver = new GestureResolver();
  readonly limitless: LimitlessTechnique;
  readonly voidT = new UnlimitedVoidTechnique();
  readonly shrine = new MalevolentShrineTechnique();
  readonly dismantle = new DismantleTechnique();
  readonly blackFlash = new BlackFlashTechnique();
  readonly shadows = new TenShadowsTechnique();
  readonly blood = new PiercingBloodTechnique();
  readonly techs: Technique[];
  readonly byId: Record<TechniqueId, Technique>;

  settings: Settings = { ...DEFAULT_SETTINGS };
  private strict: Settings = { ...DEFAULT_SETTINGS };
  cands: GestureCandidate[] = [];
  resolution: Resolution = this.resolver.last;
  track: TrackFrame = this.hands.frame;
  private ctx: TechniqueContext;

  constructor(deps: CoreDeps) {
    this.limitless = new LimitlessTechnique((e) => deps.onLimitless?.(e));
    // update order: domains first (they lock), then the rest
    this.techs = [this.voidT, this.shrine, this.shadows, this.blood, this.limitless, this.blackFlash, this.dismantle];
    this.byId = Object.fromEntries(this.techs.map((x) => [x.meta.id, x])) as Record<TechniqueId, Technique>;
    this.ctx = {
      t: 0,
      dt: 0,
      fresh: false,
      track: this.track,
      cands: [],
      granted: null,
      settings: this.settings,
      fx: deps.fx,
      sfx: deps.sfx,
      cine: (c) => deps.onCinematic?.(c),
      W: 1280,
      H: 720,
    };
    this.setSettings(this.settings, 0);
  }

  setSettings(s: Settings, t: number): void {
    const switched = s.character !== this.settings.character || s.allPoseMode !== this.settings.allPoseMode;
    this.settings = { ...s };
    this.strict = { ...s, holdScale: s.holdScale * ALL_MODE_CONFIRM };
    if (switched) this.cancelAll(t, 'смена персонажа');
  }

  /** Cancel every technique and transient state (camera and tracking keep running). */
  cancelAll(t: number, reason: string): void {
    for (const x of this.techs) if (x.engaged()) x.cancel(t, reason);
    this.resolver.reset();
  }

  rosterReason(tech: Technique): string | null {
    const c = this.settings.character;
    if (c === 'all') {
      if (tech.meta.id === 'dismantle' && this.settings.allPoseMode === 'limitless') return 'в ALL ✌️ занят Blue/Red — выберите Dismantle в настройках';
      return null;
    }
    return CHARACTER_BY_ID[c].techniques.includes(tech.meta.id) ? null : `не техника персонажа ${CHARACTER_BY_ID[c].short}`;
  }

  triggersOf(tech: Technique): GestureId[] {
    if (this.settings.character === 'all' && this.settings.allPoseMode === 'dismantle' && tech.meta.id === 'limitless') return ['blue'];
    return tech.meta.triggers;
  }

  /** Debug/test button: play a technique's effect without its gesture (other techniques are cancelled). */
  demo(id: TechniqueId, t: number, W: number, H: number): void {
    const x = this.byId[id];
    if (!x.demo) return;
    for (const o of this.techs) if (o !== x && o.engaged()) o.cancel(t, 'тест');
    if (x.engaged()) x.cancel(t, 'тест');
    const ctx = this.ctx;
    ctx.t = t;
    ctx.W = W;
    ctx.H = H;
    ctx.granted = null;
    ctx.settings = this.settings;
    x.demo(ctx);
  }

  /** The technique that currently owns the input (critical first). */
  active(): Technique | null {
    let best: Technique | null = null;
    for (const x of this.techs) if (x.engaged() && (!best || (x.critical() && !best.critical()))) best = x;
    return best;
  }

  /**
   * @param det  MediaPipe output for a new camera frame, `null` for a frame without hands,
   *             `undefined` when no new camera frame arrived this tick (timers/animations still run).
   */
  step(det: Detection | null | undefined, t: number, dt: number, map: VideoMapLike, W: number, H: number): void {
    const fresh = det !== undefined;
    let grant: Resolution['grant'] = null;
    if (fresh) {
      this.track = this.hands.process(det, t, map, W);
      this.cands = this.classifier.classify(this.track);
      this.resolution = this.resolver.resolve(this.cands, this.techs, this, this.settings, t);
      grant = this.resolution.grant;
      if (grant && this.resolution.preempt) this.byId[this.resolution.preempt].cancel(t, `прервано: ${grant.tech}`);
    }
    const ctx = this.ctx;
    ctx.t = t;
    ctx.dt = dt;
    ctx.fresh = fresh;
    ctx.track = this.track;
    ctx.cands = this.cands;
    ctx.W = W;
    ctx.H = H;
    const all = this.settings.character === 'all';
    for (const x of this.techs) {
      ctx.granted = grant && grant.tech === x.meta.id ? grant.cand : null;
      ctx.settings = all && x.meta.priority <= PRIORITY.DOMAIN ? this.strict : this.settings;
      if (x instanceof BaseTechnique) x.hs = ctx.settings.holdScale;
      x.update(ctx);
    }
  }
}
