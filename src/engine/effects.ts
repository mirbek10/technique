import { COLORS, type OrbKind, type Vec2 } from './types';
import { TAU, clamp, dist, easeOutCubic, hexToRgb, rgba, type RGB } from './math';

/* ------------------------------------------------------------------ sprites */

const RGB_OF: Record<OrbKind, RGB> = {
  blue: hexToRgb(COLORS.blue),
  red: hexToRgb(COLORS.red),
  purple: hexToRgb(COLORS.purple),
};
const WHITE: RGB = [255, 255, 255];

type Sprite = HTMLCanvasElement;

/** Pre-rendered radial glow; drawing a sprite is far cheaper than shadowBlur. */
function makeGlow(c: RGB, core: boolean, size = 128): Sprite {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const h = size / 2;
  const grd = g.createRadialGradient(h, h, 0, h, h, h);
  if (core) {
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, rgba(c, 1));
    grd.addColorStop(0.45, rgba(c, 0.35));
    grd.addColorStop(1, rgba(c, 0));
  } else {
    grd.addColorStop(0, rgba(c, 0.85));
    grd.addColorStop(0.35, rgba(c, 0.3));
    grd.addColorStop(1, rgba(c, 0));
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return cv;
}

interface Sprites {
  core: Record<OrbKind, Sprite>;
  soft: Record<OrbKind, Sprite>;
  white: Sprite;
}

function buildSprites(): Sprites {
  return {
    core: { blue: makeGlow(RGB_OF.blue, true), red: makeGlow(RGB_OF.red, true), purple: makeGlow(RGB_OF.purple, true) },
    soft: { blue: makeGlow(RGB_OF.blue, false), red: makeGlow(RGB_OF.red, false), purple: makeGlow(RGB_OF.purple, false) },
    white: makeGlow(WHITE, true, 64),
  };
}

/* ------------------------------------------------------------- random tables */

const N_RAND = 512;
const R1 = Float32Array.from({ length: N_RAND }, Math.random);
const R2 = Float32Array.from({ length: N_RAND }, Math.random);
const R3 = Float32Array.from({ length: N_RAND }, Math.random);
const R4 = Float32Array.from({ length: N_RAND }, Math.random);

/* --------------------------------------------------------------- entities */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  sprite: Sprite;
  drag: number;
}

interface Projectile {
  kind: OrbKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  power: number;
  trail: { x: number; y: number; r: number }[];
}

interface Shock {
  x: number;
  y: number;
  r0: number;
  r1: number;
  age: number;
  dur: number;
  color: RGB;
  width: number;
  delay: number;
}

export interface OrbView {
  x: number;
  y: number;
  r: number;
  vis: number;
  charge: number;
}

export interface VideoMap {
  s: number;
  dx: number;
  dy: number;
  vw: number;
  vh: number;
}

export interface RenderInput {
  t: number;
  dt: number;
  W: number;
  H: number;
  video: HTMLVideoElement;
  map: VideoMap;
  lens: boolean;
  blue: OrbView;
  red: OrbView;
  purple: OrbView;
  merge: number;
  skeleton: Vec2[] | null;
  skeletonAlpha: number;
  /** second hand (two-hand techniques) */
  skeleton2?: Vec2[] | null;
  skeleton2Alpha?: number;
  /** false when a background layer was already drawn this frame */
  clear?: boolean;
}

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const TIPS = new Set([4, 8, 12, 16, 20]);

/* ---------------------------------------------------------------- renderer */

export class EffectsRenderer {
  /** 0..1 camera-shake energy; the engine turns it into a CSS transform */
  trauma = 0;
  /** particle budget multiplier (auto-quality lowers it) */
  q = 1;

  private sp: Sprites = buildSprites();
  private particles: Particle[] = [];
  private projectiles: Projectile[] = [];
  private shocks: Shock[] = [];
  private flash = { c: WHITE as RGB, a: 0, decay: 3 };
  private W = 1;
  private H = 1;

  get particleCount(): number {
    return this.particles.length;
  }

  addTrauma(a: number): void {
    this.trauma = Math.min(1, this.trauma + a);
  }

  private addFlash(c: RGB, a: number, decay: number): void {
    if (a >= this.flash.a) this.flash = { c, a, decay };
  }

  private emit(x: number, y: number, vx: number, vy: number, life: number, size: number, sprite: Sprite, drag = 2): void {
    if (this.particles.length >= Math.round(1600 * this.q)) return;
    this.particles.push({ x, y, vx, vy, life, max: life, size, sprite, drag });
  }

  private burst(x: number, y: number, kind: OrbKind, n: number, speed: number): void {
    const count = Math.round(n * this.q);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.25 + Math.random());
      this.emit(
        x, y, Math.cos(a) * s, Math.sin(a) * s,
        0.5 + Math.random() * 0.9, 2 + Math.random() * 5,
        Math.random() < 0.3 ? this.sp.white : this.sp.core[kind], 2.4,
      );
    }
  }

  /* ---------------------------------------------------------- public events */

  fire(kind: OrbKind, x: number, y: number, dir: Vec2, power: number, r: number): void {
    const base = Math.max(this.W, this.H);
    const purple = kind === 'purple';
    const speed = (purple ? base * 1.15 : kind === 'red' ? base * 1.75 : base * 1.5) * (0.85 + 0.3 * power);
    this.projectiles.push({ kind, x, y, vx: dir.x * speed, vy: dir.y * speed, r: r * (0.8 + 0.4 * power), age: 0, power, trail: [] });
    const c = RGB_OF[kind];
    if (purple) {
      this.addFlash([235, 200, 255], 0.85, 1.3);
      this.addTrauma(1);
      this.shocks.push({ x, y, r0: r, r1: base * 0.75, age: 0, dur: 0.95, color: c, width: 26, delay: 0 });
      this.shocks.push({ x, y, r0: r * 0.5, r1: base * 0.45, age: 0, dur: 0.8, color: [255, 220, 255], width: 10, delay: 0.12 });
      this.burst(x, y, 'purple', 160, base * 0.5);
    } else {
      this.addFlash(c, 0.22, 3.5);
      this.addTrauma(0.38);
      this.shocks.push({ x, y, r0: r * 0.6, r1: r * 6, age: 0, dur: 0.45, color: c, width: 8, delay: 0 });
      this.burst(x, y, kind, 45, base * 0.3);
    }
  }

  merged(x: number, y: number, r: number): void {
    const base = Math.max(this.W, this.H);
    this.addFlash(WHITE, 0.8, 2);
    this.addTrauma(0.6);
    this.shocks.push({ x, y, r0: r, r1: base * 0.4, age: 0, dur: 0.7, color: RGB_OF.purple, width: 16, delay: 0 });
    this.burst(x, y, 'purple', 130, base * 0.35);
  }

  dissipate(o: OrbView, kind: OrbKind): void {
    if (o.vis < 0.1) return;
    this.burst(o.x, o.y, kind, kind === 'purple' ? 80 : 30, o.r * 4);
    this.shocks.push({ x: o.x, y: o.y, r0: o.r, r1: o.r * 3, age: 0, dur: 0.4, color: RGB_OF[kind], width: 4, delay: 0 });
  }

  /* --------------------------------------------------------------- render */

  render(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
    const { W, H, t, dt } = inp;
    this.W = W;
    this.H = H;
    if (inp.clear !== false) ctx.clearRect(0, 0, W, H);

    // 1) gravitational lens distortion of the real video around each orb
    if (inp.lens && inp.video.readyState >= 2) {
      if (inp.blue.vis > 0.05) this.lens(ctx, inp, inp.blue, 2.0, 1.22, t * 2.2, RGB_OF.blue);
      if (inp.red.vis > 0.05) this.lens(ctx, inp, inp.red, 1.9, 1.16, -t * 2.6, RGB_OF.red);
      if (inp.purple.vis > 0.05) this.lens(ctx, inp, inp.purple, 2.5, 1.32 + 0.12 * inp.purple.charge, t * 1.4, RGB_OF.purple);
    }

    // 2) hand skeleton
    if (inp.skeleton && inp.skeletonAlpha > 0.01) this.drawSkeleton(ctx, inp.skeleton, inp.skeletonAlpha);
    if (inp.skeleton2 && (inp.skeleton2Alpha ?? 0) > 0.01) this.drawSkeleton(ctx, inp.skeleton2, inp.skeleton2Alpha ?? 0);

    // 3) additive light
    ctx.globalCompositeOperation = 'lighter';
    const speedMul = 1 + inp.merge * 3;
    if (inp.merge > 0.01 && inp.blue.vis > 0.05 && inp.red.vis > 0.05) this.drawMergeLink(ctx, inp);
    if (inp.blue.vis > 0.01) this.drawBlue(ctx, inp.blue, t, speedMul);
    if (inp.red.vis > 0.01) this.drawRed(ctx, inp.red, t, speedMul);
    if (inp.purple.vis > 0.01) this.drawPurple(ctx, inp.purple, t);
    this.updateParticles(ctx, dt);
    this.updateProjectiles(ctx, dt, t);
    this.updateShocks(ctx, dt);

    // 4) screen flash
    if (this.flash.a > 0.005) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(this.flash.c, this.flash.a);
      ctx.fillRect(0, 0, W, H);
      this.flash.a = Math.max(0, this.flash.a - dt * this.flash.decay);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
  }

  private spr(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, r: number, a: number): void {
    if (a <= 0.003 || r <= 0.2) return;
    ctx.globalAlpha = a > 1 ? 1 : a;
    ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  }

  /** Draw the mirrored, cover-fitted video zoomed+rotated inside a circle: real space warping. */
  private lens(ctx: CanvasRenderingContext2D, inp: RenderInput, o: OrbView, rMul: number, zoom: number, rot: number, tint: RGB): void {
    const { s, dx, dy, vw, vh } = inp.map;
    const R = o.r * rMul * (0.8 + 0.4 * o.charge);
    const layers: [number, number, number][] = [
      [R, 1 + (zoom - 1) * 0.45 * o.vis, Math.sin(rot) * 0.06],
      [R * 0.62, 1 + (zoom - 1) * o.vis, Math.sin(rot) * 0.22 + rot * 0.02],
    ];
    for (const [r, z, a] of layers) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(o.x, o.y, r, 0, TAU);
      ctx.clip();
      ctx.translate(o.x, o.y);
      ctx.rotate(a);
      ctx.scale(z, z);
      ctx.translate(-o.x, -o.y);
      ctx.translate(inp.W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(inp.video, dx, dy, vw * s, vh * s);
      ctx.restore();
    }
    // soften the seam & tint the warped region
    const g = ctx.createRadialGradient(o.x, o.y, R * 0.3, o.x, o.y, R);
    g.addColorStop(0, rgba(tint, 0.1 * o.vis));
    g.addColorStop(0.55, rgba([0, 0, 0], 0.12 * o.vis));
    g.addColorStop(0.85, rgba(tint, 0.14 * o.vis));
    g.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(o.x, o.y, R, 0, TAU);
    ctx.fill();
  }

  private drawSkeleton(ctx: CanvasRenderingContext2D, p: Vec2[], a: number): void {
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(190,225,255,${0.45 * a})`;
    ctx.beginPath();
    for (const [i, j] of HAND_CONNECTIONS) {
      ctx.moveTo(p[i].x, p[i].y);
      ctx.lineTo(p[j].x, p[j].y);
    }
    ctx.stroke();
    for (let i = 0; i < 21; i++) {
      const tip = TIPS.has(i);
      ctx.fillStyle = tip ? `rgba(255,255,255,${0.9 * a})` : `rgba(140,200,255,${0.7 * a})`;
      ctx.beginPath();
      ctx.arc(p[i].x, p[i].y, tip ? 3.5 : 2.4, 0, TAU);
      ctx.fill();
    }
  }

  private bolt(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, disp: number, c: RGB, w: number, a: number): void {
    let pts: number[] = [x1, y1, x2, y2];
    let d = disp;
    for (let it = 0; it < 4; it++) {
      const next: number[] = [pts[0], pts[1]];
      for (let i = 0; i < pts.length - 2; i += 2) {
        const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
        const nx = -(by - ay), ny = bx - ax;
        const l = Math.hypot(nx, ny) || 1;
        const off = (Math.random() * 2 - 1) * d;
        next.push((ax + bx) / 2 + (nx / l) * off, (ay + by) / 2 + (ny / l) * off, bx, by);
      }
      pts = next;
      d *= 0.55;
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.strokeStyle = rgba(c, 0.35 * a);
    ctx.lineWidth = w * 4;
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,245,255,${0.9 * a})`;
    ctx.lineWidth = w;
    ctx.stroke();
  }

  private drawBlue(ctx: CanvasRenderingContext2D, o: OrbView, t: number, speedMul: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(t * (5 + o.charge * 7));
    const R = o.r * (0.8 + 0.4 * o.charge) * (1 + 0.07 * pulse);
    const v = o.vis;
    this.spr(ctx, this.sp.soft.blue, o.x, o.y, R * 4.2, 0.32 * v * (0.8 + 0.2 * pulse));

    // curved-space arcs
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.6;
    for (let k = 0; k < 3; k++) {
      const a0 = t * (2 + k) * speedMul * (k % 2 ? -1 : 1) + k * 2.1;
      ctx.strokeStyle = rgba(RGB_OF.blue, 0.55 * v);
      ctx.beginPath();
      ctx.arc(o.x, o.y, R * (1.45 + k * 0.38), a0, a0 + Math.PI * 0.85);
      ctx.stroke();
    }

    // particles spiralling inward (attraction)
    const n = Math.round(56 * this.q);
    for (let i = 0; i < n; i++) {
      const cyc = (t * 0.55 * speedMul * (0.6 + R2[i]) + R1[i]) % 1;
      const rad = R * (2.8 - cyc * 2.1);
      const ang = R1[i] * TAU + cyc * TAU * 1.3;
      const a = Math.sin(cyc * Math.PI) * v;
      this.spr(ctx, i % 4 ? this.sp.core.blue : this.sp.white, o.x + Math.cos(ang) * rad, o.y + Math.sin(ang) * rad, 2.5 + R3[i] * 4, a);
    }
    if (Math.random() < 0.4 * this.q) {
      const a = Math.random() * TAU;
      const d = R * 3;
      this.emit(o.x + Math.cos(a) * d, o.y + Math.sin(a) * d, -Math.cos(a) * d * 2, -Math.sin(a) * d * 2, 0.45, 3, this.sp.core.blue, 1);
    }

    this.spr(ctx, this.sp.core.blue, o.x, o.y, R * 1.8, v);
    this.spr(ctx, this.sp.white, o.x, o.y, R * 0.75 * (0.9 + 0.2 * pulse), v * 0.95);
  }

  private drawRed(ctx: CanvasRenderingContext2D, o: OrbView, t: number, speedMul: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(t * (7 + o.charge * 8) + 1);
    const R = o.r * (0.85 + 0.4 * o.charge) * (1 + 0.09 * pulse);
    const v = o.vis;
    this.spr(ctx, this.sp.soft.red, o.x, o.y, R * 4.6, 0.45 * v * (0.8 + 0.2 * pulse));

    // electric discharges
    const bolts = this.q > 0.5 ? 3 : 1;
    for (let i = 0; i < bolts; i++) {
      if (Math.random() > 0.65) continue;
      const a = Math.random() * TAU;
      const e = R * (1.6 + Math.random() * 1.4);
      this.bolt(ctx, o.x + Math.cos(a) * R * 0.5, o.y + Math.sin(a) * R * 0.5, o.x + Math.cos(a) * e, o.y + Math.sin(a) * e, R * 0.4, RGB_OF.red, 1.4, v);
    }

    // orbiting particles, flung outward
    const n = Math.round(48 * this.q);
    for (let i = 0; i < n; i++) {
      const j = i + 100;
      const cyc = (t * 0.7 * speedMul * (0.6 + R2[j]) + R1[j]) % 1;
      const rad = R * (0.9 + cyc * 2.2);
      const ang = R1[j] * TAU - t * 3 * speedMul * (0.5 + R3[j]);
      this.spr(ctx, i % 3 ? this.sp.core.red : this.sp.white, o.x + Math.cos(ang) * rad, o.y + Math.sin(ang) * rad, 2.5 + R4[j] * 4, (1 - cyc) * v);
    }
    if (Math.random() < 0.6 * this.q) {
      const a = Math.random() * TAU;
      const s = R * (4 + Math.random() * 6);
      this.emit(o.x, o.y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + Math.random() * 0.3, 2.5, Math.random() < 0.5 ? this.sp.white : this.sp.core.red, 3);
    }

    this.spr(ctx, this.sp.core.red, o.x, o.y, R * 2.0, v);
    this.spr(ctx, this.sp.white, o.x, o.y, R * 0.85 * (0.9 + 0.25 * pulse), v);
  }

  private drawMergeLink(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
    const b = inp.blue, r = inp.red, p = inp.merge;
    const mx = (b.x + r.x) / 2, my = (b.y + r.y) / 2;
    const d = dist(b, r);
    this.spr(ctx, this.sp.soft.purple, mx, my, (d * 0.6 + b.r * 2.5) * (0.5 + p), 0.25 + p * 0.55);
    const count = 1 + Math.floor(p * 3 * Math.max(0.5, this.q));
    for (let i = 0; i < count; i++) this.bolt(ctx, b.x, b.y, r.x, r.y, d * 0.28 + b.r * 0.4, RGB_OF.purple, 1.3 + p, 0.5 + p * 0.5);
    this.trauma = Math.max(this.trauma, p * 0.32);
  }

  private drawPurple(ctx: CanvasRenderingContext2D, o: OrbView, t: number): void {
    const c = o.charge;
    const v = o.vis;
    const pulse = 0.5 + 0.5 * Math.sin(t * (3 + c * 10));
    const R = o.r * (1 + 0.07 * pulse * (0.5 + c));
    const glow = 0.6 + 0.4 * c;

    this.spr(ctx, this.sp.soft.purple, o.x, o.y, R * 5.2, (0.3 * glow + 0.12 * pulse) * v);

    // energy rings (tilted ellipses fake 3D)
    ctx.globalAlpha = 1;
    for (let k = 0; k < 3; k++) {
      const rx = R * (1.5 + k * 0.32);
      const ry = rx * (0.2 + 0.12 * k);
      const rot = t * (0.55 + 0.25 * k) * (k % 2 ? -1 : 1) + k * 1.1;
      ctx.beginPath();
      ctx.ellipse(o.x, o.y, rx, ry, rot, 0, TAU);
      ctx.strokeStyle = rgba(RGB_OF.purple, 0.6 * v);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = `rgba(240,215,255,${0.55 * v})`;
      ctx.lineWidth = 1;
      ctx.stroke();
      const cr = Math.cos(rot), sr = Math.sin(rot);
      for (let j = 0; j < 5; j++) {
        const a = t * (2.2 + k) + (j * TAU) / 5;
        const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
        this.spr(ctx, this.sp.white, o.x + ex * cr - ey * sr, o.y + ex * sr + ey * cr, 5, v);
      }
    }

    // hundreds of particles on tilted 3D orbits
    const n = Math.round(320 * this.q);
    for (let i = 0; i < n; i++) {
      const inc = R4[i] * Math.PI;
      const node = R3[i] * TAU;
      const a = R1[i] * TAU + t * (0.7 + R2[i] * 1.8) * (1 + c);
      const rad = R * (1.2 + R2[(i * 7) % N_RAND] * 1.7);
      const lx = Math.cos(a) * rad;
      const ly = Math.sin(a) * rad * Math.cos(inc);
      const depth = Math.sin(a) * Math.sin(inc);
      const px = o.x + lx * Math.cos(node) - ly * Math.sin(node);
      const py = o.y + lx * Math.sin(node) + ly * Math.cos(node);
      this.spr(ctx, i % 3 ? this.sp.core.purple : this.sp.white, px, py, 1.8 + (depth + 1) * 1.8, (0.35 + 0.35 * (depth + 1)) * v);
    }

    // lightning
    const bolts = Math.round((this.q > 0.5 ? 4 : 2) * (0.4 + c));
    for (let i = 0; i < bolts; i++) {
      if (Math.random() > 0.7) continue;
      const a = Math.random() * TAU;
      const e = R * (1.8 + Math.random() * 1.8);
      this.bolt(ctx, o.x + Math.cos(a) * R * 0.6, o.y + Math.sin(a) * R * 0.6, o.x + Math.cos(a) * e, o.y + Math.sin(a) * e, R * 0.45, RGB_OF.purple, 1.6, v);
    }

    // core with blue/red remnants swirling inside
    this.spr(ctx, this.sp.core.purple, o.x, o.y, R * 2.2, v);
    const ra = t * 6;
    this.spr(ctx, this.sp.core.blue, o.x + Math.cos(ra) * R * 0.42, o.y + Math.sin(ra) * R * 0.42, R * 0.9, 0.45 * v);
    this.spr(ctx, this.sp.core.red, o.x - Math.cos(ra) * R * 0.42, o.y - Math.sin(ra) * R * 0.42, R * 0.9, 0.45 * v);
    this.spr(ctx, this.sp.white, o.x, o.y, R * 0.95 * (0.9 + 0.25 * pulse) * (0.8 + 0.3 * c), v);
  }

  private updateParticles(ctx: CanvasRenderingContext2D, dt: number): void {
    const ps = this.particles;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const f = p.life / p.max;
      this.spr(ctx, p.sprite, p.x, p.y, p.size * (0.4 + 0.6 * f), f);
      ps[w++] = p;
    }
    ps.length = w;
  }

  private updateProjectiles(ctx: CanvasRenderingContext2D, dt: number, t: number): void {
    const out: Projectile[] = [];
    for (const p of this.projectiles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const purple = p.kind === 'purple';
      p.r *= 1 + dt * (purple ? 0.9 : 0.5); // grows: reads as flying toward the viewer
      p.trail.push({ x: p.x, y: p.y, r: p.r });
      if (p.trail.length > (purple ? 28 : 18)) p.trail.shift();

      const m = p.r * 3;
      const inside = p.x > -m && p.x < this.W + m && p.y > -m && p.y < this.H + m;
      if (!inside || p.age > 3) {
        if (purple) this.shocks.push({ x: clamp(p.x, 0, this.W), y: clamp(p.y, 0, this.H), r0: p.r, r1: p.r * 4, age: 0, dur: 0.6, color: RGB_OF.purple, width: 12, delay: 0 });
        continue;
      }
      out.push(p);

      const soft = this.sp.soft[p.kind];
      const core = this.sp.core[p.kind];
      // volumetric trail
      const L = p.trail.length;
      for (let i = 0; i < L; i++) {
        const f = (i + 1) / L;
        const tp = p.trail[i];
        this.spr(ctx, soft, tp.x, tp.y, tp.r * (purple ? 2.6 : 1.8) * (0.35 + 0.65 * f), Math.pow(f, 1.6) * (purple ? 0.5 : 0.6));
      }
      // embers
      const emb = Math.round((purple ? 6 : 2) * this.q);
      for (let i = 0; i < emb; i++) {
        const a = Math.random() * TAU;
        const s = p.r * (1 + Math.random() * 3);
        this.emit(p.x, p.y, Math.cos(a) * s - p.vx * 0.05, Math.sin(a) * s - p.vy * 0.05, 0.4 + Math.random() * 0.6, 2 + Math.random() * 3, Math.random() < 0.3 ? this.sp.white : core, 1.6);
      }
      // motion blur: glow stretched along velocity
      const ang = Math.atan2(p.vy, p.vx);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(core, -p.r * 4.2, -p.r * 1.2, p.r * 5.4, p.r * 2.4);
      ctx.restore();
      if (purple) {
        ctx.globalAlpha = 1;
        for (let k = 0; k < 2; k++) {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.r * (1.6 + k * 0.4), p.r * (0.35 + k * 0.15), t * (3 + k) * (k ? -1 : 1), 0, TAU);
          ctx.strokeStyle = `rgba(235,200,255,0.7)`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (Math.random() < 0.7) {
          const a = Math.random() * TAU;
          this.bolt(ctx, p.x, p.y, p.x + Math.cos(a) * p.r * 2.4, p.y + Math.sin(a) * p.r * 2.4, p.r * 0.5, RGB_OF.purple, 1.8, 1);
        }
        this.spr(ctx, soft, p.x, p.y, p.r * 4, 0.6);
      }
      this.spr(ctx, core, p.x, p.y, p.r * 1.9, 1);
      this.spr(ctx, this.sp.white, p.x, p.y, p.r * 0.85, 1);
    }
    this.projectiles = out;
  }

  private updateShocks(ctx: CanvasRenderingContext2D, dt: number): void {
    const out: Shock[] = [];
    for (const s of this.shocks) {
      if (s.delay > 0) {
        s.delay -= dt;
        out.push(s);
        continue;
      }
      s.age += dt;
      const u = s.age / s.dur;
      if (u >= 1) continue;
      out.push(s);
      const r = s.r0 + (s.r1 - s.r0) * easeOutCubic(u);
      const a = 1 - u;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.strokeStyle = rgba(s.color, 0.55 * a);
      ctx.lineWidth = s.width * a + 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 0.92, 0, TAU);
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * a})`;
      ctx.lineWidth = Math.max(1, s.width * 0.25 * a);
      ctx.stroke();
    }
    this.shocks = out;
  }
}
