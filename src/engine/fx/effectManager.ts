/**
 * The Effect Engine for the new techniques. One instance, rendered from the single engine loop
 * (no per-ability render loops). Implements the `Fx` contract the techniques call.
 *
 * Passes per frame:  background (domain world + person layer) → tint → [original Blue/Red/Purple renderer]
 *                    → foreground (dark pass, then additive light pass) → screen flashes.
 */
import type { Profile, Vec2 } from '../types';
import { TAU, hexToRgb, rgba, type RGB } from '../math';
import type { BeamOpts, BurstOpts, DomainCmd, Fx, OrbCmd, ShikigamiCmd, SlashOpts } from './api';
import { ParticlePool } from './particles';
import {
  Cracks,
  ElectricArc,
  EnergyBeam,
  Pool,
  Shockwave,
  SlashTrail,
  drawHandAura,
  drawOrbDark,
  drawOrbLight,
  drawPortalDark,
  drawPortalLight,
  type VideoView,
} from './primitives';
import { glow, puff, WHITE } from './sprites';
import { ShrineEnvironment, VoidEnvironment } from './domains';
import { renderShikigami } from './shikigami';
import { PersonLayer, type MaskHand } from './personLayer';

const ORB_COLOR: Record<OrbCmd['style'], RGB> = { blood: hexToRgb('#e0102a'), blackflash: hexToRgb('#ff1e2d') };

interface AuraCmd {
  pts: Vec2[];
  palmPx: number;
  color: RGB;
  intensity: number;
}
interface PortalCmd {
  x: number;
  y: number;
  r: number;
  open: number;
  color: RGB;
}

export class EffectManager implements Fx {
  /** 0..1 camera-shake energy (combined with the original renderer's) */
  trauma = 0;
  /** particle budget / detail multiplier */
  q = 1;
  profile: Profile = 'high';
  readonly person = new PersonLayer();

  private light = new ParticlePool(2400);
  private dark = new ParticlePool(900);
  private shocks = new Pool(() => new Shockwave());
  private slashes = new Pool(() => new SlashTrail());
  private beams = new Pool(() => new EnergyBeam());
  private arcs = new Pool(() => new ElectricArc());
  private cracksP = new Pool(() => new Cracks());

  private orbs: OrbCmd[] = [];
  private auras: AuraCmd[] = [];
  private portals: PortalCmd[] = [];
  private tints: { c: RGB; a: number }[] = [];
  private domains: DomainCmd[] = [];
  private shik: ShikigamiCmd[] = [];

  private voidEnv = new VoidEnvironment();
  private shrineEnv = new ShrineEnvironment();

  private flashC: RGB = WHITE;
  private flashA = 0;
  private flashDecay = 3;
  private darkA = 0;
  private darkDecay = 3;
  private slowLeft = 0;
  private slowScale = 1;
  private t = 0;
  W = 1280;
  H = 720;

  /* ---------------------------------------------------------------- Fx: one-shots */

  burst(x: number, y: number, color: RGB, n: number, speed: number, o: BurstOpts = {}): void {
    const count = Math.round(n * this.q);
    const dark = !!o.dark;
    const pool = dark ? this.dark : this.light;
    const sc = dark ? puff(color) : glow(color, true, 64);
    const sw = glow(WHITE, true, 64);
    const base = o.dir ? Math.atan2(o.dir.y, o.dir.x) : 0;
    for (let i = 0; i < count; i++) {
      const a = o.dir ? base + (Math.random() - 0.5) * 2 * (o.spread ?? 0.5) : Math.random() * TAU;
      const s = speed * (0.25 + Math.random());
      const life = (o.life ?? 0.8) * (0.6 + Math.random() * 0.7);
      const size = (o.size ?? (dark ? 10 : 3)) * (0.6 + Math.random() * 0.9);
      pool.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life, size, !dark && Math.random() < (o.white ?? 0.2) ? sw : sc, o.drag ?? 2.2, o.gravity ?? 0);
    }
  }

  shockwave(x: number, y: number, r0: number, r1: number, dur: number, color: RGB, width: number, delay = 0): void {
    this.shocks.get().set(x, y, r0, r1, dur, color, width, delay);
  }

  slash(x1: number, y1: number, x2: number, y2: number, o: SlashOpts): void {
    this.slashes.get().set(x1, y1, x2, y2, o.color, o.width, o.power ?? 1, o.delay ?? 0, o.distort ?? false);
    // red sparks thrown off the cut
    const n = Math.round(22 * this.q);
    const sw = glow(WHITE, true, 64);
    const sc = glow(o.color, true, 64);
    const nx = -(y2 - y1);
    const ny = x2 - x1;
    const l = Math.hypot(nx, ny) || 1;
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const side = Math.random() < 0.5 ? -1 : 1;
      const s = 150 + Math.random() * 450;
      this.light.spawn(x1 + (x2 - x1) * u, y1 + (y2 - y1) * u, (nx / l) * s * side + (Math.random() - 0.5) * 200, (ny / l) * s * side + (Math.random() - 0.5) * 200, 0.25 + Math.random() * 0.35, 2 + Math.random() * 2.5, Math.random() < 0.4 ? sw : sc, 3.5);
    }
  }

  beam(x: number, y: number, dir: Vec2, o: BeamOpts): void {
    const b = this.beams.get().set(x, y, dir, o.color, o.width, o.dur, o.power, this.W, this.H);
    const n = Math.round(40 * this.q * (0.5 + o.power));
    const sc = glow(o.color, true, 64);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * b.L;
      const s = 40 + Math.random() * 120;
      const a = Math.random() * TAU;
      this.light.spawn(x + dir.x * u, y + dir.y * u, Math.cos(a) * s + dir.x * 200, Math.sin(a) * s + dir.y * 200, 0.3 + Math.random() * 0.5, 1.5 + Math.random() * 2.5, sc, 2);
    }
  }

  cracks(x: number, y: number, r: number, color: RGB, n = 8): void {
    this.cracksP.get().set(x, y, r, color, n);
  }

  bolt(x1: number, y1: number, x2: number, y2: number, color: RGB, width: number, life = 0.2): void {
    this.arcs.get().set(x1, y1, x2, y2, color, width, life);
  }

  flash(color: RGB, a: number, decay: number): void {
    if (a >= this.flashA) {
      this.flashC = color;
      this.flashA = a;
      this.flashDecay = decay;
    }
  }

  darkFlash(a: number, decay: number): void {
    if (a >= this.darkA) {
      this.darkA = a;
      this.darkDecay = decay;
    }
  }

  shake(a: number): void {
    this.trauma = Math.min(1, this.trauma + a);
  }

  slowmo(scale: number, dur: number): void {
    this.slowScale = scale;
    this.slowLeft = dur;
  }

  /* ---------------------------------------------------------------- Fx: immediate */

  orb(c: OrbCmd): void {
    this.orbs.push(c);
  }
  handAura(pts: Vec2[], palmPx: number, color: RGB, intensity: number): void {
    this.auras.push({ pts, palmPx, color, intensity });
  }
  portal(x: number, y: number, r: number, open: number, color: RGB): void {
    this.portals.push({ x, y, r, open, color });
  }
  tint(c: RGB, a: number): void {
    if (a > 0.003) this.tints.push({ c, a });
  }
  domain(c: DomainCmd): void {
    this.domains.push(c);
  }
  shikigami(c: ShikigamiCmd): void {
    this.shik.push(c);
  }

  /* ---------------------------------------------------------------- time */

  /** Effect-time multiplier (Black Flash slow motion). Call once per frame with real dt. */
  timeScale(dt: number): number {
    if (this.slowLeft <= 0) return 1;
    this.slowLeft -= dt;
    return this.slowScale;
  }

  /** Strongest domain environment requested this frame (0..1) — drives segmentation & the person layer. */
  domainIntensity(): number {
    let m = 0;
    for (const d of this.domains) m = Math.max(m, d.intensity);
    return m;
  }

  clear(): void {
    this.light.clear();
    this.dark.clear();
    this.shocks.clear();
    this.slashes.clear();
    this.beams.clear();
    this.arcs.clear();
    this.cracksP.clear();
    this.flashA = 0;
    this.darkA = 0;
    this.slowLeft = 0;
    this.endFrame();
  }

  /* ---------------------------------------------------------------- render */

  renderBackground(ctx: CanvasRenderingContext2D, dt: number, t: number, v: VideoView, hands: MaskHand[]): void {
    this.t = t;
    if (this.domains.length === 0) return;
    const seg = this.person.hasSegmentation(t);
    let personA = 0;
    for (const d of this.domains) {
      if (d.kind === 'void') this.voidEnv.render(ctx, d, this.W, this.H, dt, this.profile, v, seg ? 1 : 0.8);
      else this.shrineEnv.render(ctx, d, this.W, this.H, this.profile, v, seg ? 1 : 0.72);
      personA = Math.max(personA, d.intensity);
    }
    this.person.draw(ctx, v, this.W, this.H, hands, t, Math.min(1, personA * 1.5));
  }

  renderTint(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = 'source-over';
    for (const tn of this.tints) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(tn.c, tn.a);
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  renderForeground(ctx: CanvasRenderingContext2D, dt: number, v: VideoView | null): void {
    const t = this.t;
    const W = this.W;
    const H = this.H;
    this.light.budget = this.dark.budget = Math.max(0.25, this.q);
    const alive = (o: { update(dt: number): boolean }) => o.update(dt);
    this.shocks.sweep(alive);
    this.slashes.sweep(alive);
    this.beams.sweep(alive);
    this.arcs.sweep(alive);
    this.cracksP.sweep(alive);

    // dark pass (normal blending)
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.portals) drawPortalDark(ctx, p.x, p.y, p.r, p.open);
    for (const s of this.shik) renderShikigami(ctx, s, W, H, 'dark', t, this.q);
    for (const o of this.orbs) drawOrbDark(ctx, o, t);
    for (const s of this.slashes.items) s.drawDark(ctx, v && this.q > 0.45 ? v : null);
    for (const b of this.beams.items) b.drawDark(ctx, v && this.q > 0.45 ? v : null);
    for (const c of this.cracksP.items) c.drawDark(ctx);
    for (const s of this.shocks.items) s.drawDark(ctx);
    this.dark.updateDraw(ctx, dt);

    // light pass (additive)
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.portals) drawPortalLight(ctx, p.x, p.y, p.r, p.open, p.color, t);
    for (const s of this.shik) renderShikigami(ctx, s, W, H, 'light', t, this.q);
    for (const o of this.orbs) drawOrbLight(ctx, o, t, this.q, ORB_COLOR[o.style]);
    for (const a of this.auras) drawHandAura(ctx, a.pts, a.palmPx, a.color, a.intensity, t);
    for (const s of this.slashes.items) s.drawLight(ctx);
    for (const b of this.beams.items) b.drawLight(ctx, { core: glow(b.color, true), soft: glow(b.color, false) });
    for (const a of this.arcs.items) a.drawLight(ctx);
    for (const c of this.cracksP.items) c.drawLight(ctx);
    this.light.updateDraw(ctx, dt);
    for (const s of this.shocks.items) s.drawLight(ctx);

    // screen flashes
    if (this.darkA > 0.005) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(0,0,0,${this.darkA})`;
      ctx.fillRect(0, 0, W, H);
      this.darkA = Math.max(0, this.darkA - dt * this.darkDecay);
    }
    if (this.flashA > 0.005) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(this.flashC, this.flashA);
      ctx.fillRect(0, 0, W, H);
      this.flashA = Math.max(0, this.flashA - dt * this.flashDecay);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
  }

  /** Drop this frame's immediate commands (techniques re-issue them every frame). */
  endFrame(): void {
    this.orbs.length = 0;
    this.auras.length = 0;
    this.portals.length = 0;
    this.tints.length = 0;
    this.domains.length = 0;
    this.shik.length = 0;
  }

  get particleCount(): number {
    return this.light.n + this.dark.n;
  }
}
