/**
 * Visual primitives shared by every technique. Retained primitives are pooled objects with
 * `update`→`alive`, and each draws in two passes: `dark` (normal blending: shadows, rifts, distortion)
 * and `light` (additive glow). Immediate primitives are plain draw functions.
 */
import type { Vec2 } from '../types';
import { TAU, clamp, easeOutCubic, rgba, type RGB } from '../math';
import { drawBolt, glow, puff, spr, R1, R2, R3, WHITE } from './sprites';
import type { OrbCmd } from './api';

/* -------------------------------------------------------------- utilities */

export class Pool<T> {
  readonly items: T[] = [];
  private free: T[] = [];
  private make: () => T;
  constructor(make: () => T) {
    this.make = make;
  }
  get(): T {
    const o = this.free.pop() ?? this.make();
    this.items.push(o);
    return o;
  }
  /** keep items for which `keep` returns true, recycle the rest */
  sweep(keep: (o: T) => boolean): void {
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      const o = this.items[i];
      if (keep(o)) this.items[w++] = o;
      else this.free.push(o);
    }
    this.items.length = w;
  }
  clear(): void {
    for (const o of this.items) this.free.push(o);
    this.items.length = 0;
  }
}

export interface VideoView {
  video: HTMLVideoElement;
  /** cover mapping of the video onto the screen */
  s: number;
  dx: number;
  dy: number;
  vw: number;
  vh: number;
  W: number;
}

/** Draw the mirrored camera image exactly where the <video> element shows it. */
export function drawVideo(ctx: CanvasRenderingContext2D, v: VideoView, offX = 0, offY = 0): void {
  if (v.video.readyState < 2) return;
  ctx.save();
  ctx.translate(v.W + offX, offY);
  ctx.scale(-1, 1);
  ctx.drawImage(v.video, v.dx, v.dy, v.vw * v.s, v.vh * v.s);
  ctx.restore();
}

/**
 * ScreenDistortion (strip): the camera image inside a thin band along a line is shifted sideways —
 * reads as space being torn along a cut or bent around a beam.
 */
export function distortStrip(ctx: CanvasRenderingContext2D, v: VideoView, x1: number, y1: number, x2: number, y2: number, halfW: number, shift: number): void {
  if (halfW < 0.5 || Math.abs(shift) < 0.3 || v.video.readyState < 2) return;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1 + nx * halfW, y1 + ny * halfW);
  ctx.lineTo(x2 + nx * halfW, y2 + ny * halfW);
  ctx.lineTo(x2 - nx * halfW, y2 - ny * halfW);
  ctx.lineTo(x1 - nx * halfW, y1 - ny * halfW);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = 1;
  drawVideo(ctx, v, nx * shift + (dx / l) * shift * 0.4, ny * shift + (dy / l) * shift * 0.4);
  ctx.restore();
}

/** ScreenDistortion (rings): nested circles of the camera image, each zoomed & rotated a bit more. */
export function ringWarp(ctx: CanvasRenderingContext2D, v: VideoView, cx: number, cy: number, R: number, amount: number, t: number, rings = 4): void {
  if (amount < 0.03 || v.video.readyState < 2) return;
  for (let k = 0; k < rings; k++) {
    const r = R * (1 - k / rings);
    const z = 1 + amount * 0.06 * (k + 1);
    const rot = amount * 0.05 * (k + 1) * Math.sin(t * 2 + k);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(z, z);
    ctx.translate(-cx, -cy);
    drawVideo(ctx, v);
    ctx.restore();
  }
}

/* ---------------------------------------------------------- Shockwave */

export class Shockwave {
  x = 0;
  y = 0;
  r0 = 0;
  r1 = 0;
  age = 0;
  dur = 1;
  delay = 0;
  width = 4;
  color: RGB = WHITE;
  dark = false;

  set(x: number, y: number, r0: number, r1: number, dur: number, color: RGB, width: number, delay: number): this {
    this.x = x;
    this.y = y;
    this.r0 = r0;
    this.r1 = r1;
    this.dur = dur;
    this.color = color;
    this.width = width;
    this.delay = delay;
    this.age = 0;
    this.dark = color[0] + color[1] + color[2] < 90;
    return this;
  }

  update(dt: number): boolean {
    if (this.delay > 0) {
      this.delay -= dt;
      return true;
    }
    this.age += dt;
    return this.age < this.dur;
  }

  private ring(): [number, number] | null {
    if (this.delay > 0) return null;
    const u = this.age / this.dur;
    return [this.r0 + (this.r1 - this.r0) * easeOutCubic(u), 1 - u];
  }

  drawDark(ctx: CanvasRenderingContext2D): void {
    if (!this.dark) return;
    const r = this.ring();
    if (!r) return;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r[0], 0, TAU);
    ctx.strokeStyle = `rgba(0,0,0,${0.7 * r[1]})`;
    ctx.lineWidth = this.width * r[1] + 1;
    ctx.stroke();
  }

  drawLight(ctx: CanvasRenderingContext2D): void {
    if (this.dark) return;
    const r = this.ring();
    if (!r) return;
    const [rad, a] = r;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y, rad, 0, TAU);
    ctx.strokeStyle = rgba(this.color, 0.55 * a);
    ctx.lineWidth = this.width * a + 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(this.x, this.y, rad * 0.92, 0, TAU);
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * a})`;
    ctx.lineWidth = Math.max(1, this.width * 0.25 * a);
    ctx.stroke();
  }
}

/* ---------------------------------------------------------- SlashTrail */

const SLASH_THIN = 0.07;
const SLASH_MAIN = 0.3;

/** A cut: a thin hairline for ~70 ms, then it bursts into a wide energy slash that tears the image. */
export class SlashTrail {
  x1 = 0;
  y1 = 0;
  x2 = 0;
  y2 = 0;
  w = 6;
  power = 1;
  color: RGB = WHITE;
  delay = 0;
  age = 0;
  distort = false;
  burst = false;

  set(x1: number, y1: number, x2: number, y2: number, color: RGB, w: number, power: number, delay: number, distort: boolean): this {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.color = color;
    this.w = w;
    this.power = power;
    this.delay = delay;
    this.distort = distort;
    this.age = 0;
    this.burst = false;
    return this;
  }

  update(dt: number): boolean {
    this.age += dt;
    return this.age < this.delay + SLASH_THIN + SLASH_MAIN;
  }

  /** 0..1 progress of the main phase, or <0 during the hairline phase */
  phase(): number {
    const a = this.age - this.delay;
    if (a < 0) return -2;
    if (a < SLASH_THIN) return -1 + a / SLASH_THIN;
    return (a - SLASH_THIN) / SLASH_MAIN;
  }

  drawDark(ctx: CanvasRenderingContext2D, v: VideoView | null): void {
    const p = this.phase();
    if (p < 0) return;
    const fade = 1 - p;
    const W = this.w * (1 + this.power) * Math.min(1, p / 0.12 + 0.3);
    if (this.distort && v) distortStrip(ctx, v, this.x1, this.y1, this.x2, this.y2, W * 2.2 * fade, W * 1.6 * fade);
    // the rift: a dark gap in space along the cut
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(this.x1, this.y1);
    ctx.lineTo(this.x2, this.y2);
    ctx.strokeStyle = `rgba(0,0,0,${0.75 * fade})`;
    ctx.lineWidth = W * 0.9 * fade + 0.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  drawLight(ctx: CanvasRenderingContext2D): void {
    const p = this.phase();
    if (p < -1.5) return;
    ctx.globalAlpha = 1;
    if (p < 0) {
      const u = easeOutCubic(p + 1);
      ctx.beginPath();
      ctx.moveTo(this.x1, this.y1);
      ctx.lineTo(this.x1 + (this.x2 - this.x1) * u, this.y1 + (this.y2 - this.y1) * u);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return;
    }
    const fade = 1 - p;
    const W = this.w * (1 + this.power) * Math.min(1, p / 0.12 + 0.3);
    ctx.beginPath();
    ctx.moveTo(this.x1, this.y1);
    ctx.lineTo(this.x2, this.y2);
    ctx.strokeStyle = rgba(this.color, 0.3 * fade);
    ctx.lineWidth = W * 4.5;
    ctx.stroke();
    ctx.strokeStyle = rgba(this.color, 0.7 * fade);
    ctx.lineWidth = W * 1.6;
    ctx.stroke();
    // lens-shaped white core, thickest in the middle of the cut
    const dx = this.x2 - this.x1;
    const dy = this.y2 - this.y1;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    const N = 12;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const h = W * 0.5 * Math.pow(Math.sin(Math.PI * s), 0.7);
      const px = this.x1 + dx * s + nx * h;
      const py = this.y1 + dy * s + ny * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    for (let i = N; i >= 0; i--) {
      const s = i / N;
      const h = W * 0.5 * Math.pow(Math.sin(Math.PI * s), 0.7);
      ctx.lineTo(this.x1 + dx * s - nx * h, this.y1 + dy * s - ny * h);
    }
    ctx.fillStyle = `rgba(255,245,245,${0.95 * fade})`;
    ctx.fill();
  }
}

/* ---------------------------------------------------------- EnergyBeam */

export class EnergyBeam {
  x = 0;
  y = 0;
  dx = 1;
  dy = 0;
  L = 1000;
  w = 4;
  dur = 0.5;
  power = 1;
  age = 0;
  color: RGB = WHITE;

  set(x: number, y: number, dir: Vec2, color: RGB, w: number, dur: number, power: number, W: number, H: number): this {
    this.x = x;
    this.y = y;
    this.dx = dir.x;
    this.dy = dir.y;
    this.color = color;
    this.w = w;
    this.dur = dur;
    this.power = power;
    this.age = 0;
    // distance to the screen edge along the beam
    const tx = dir.x > 1e-3 ? (W - x) / dir.x : dir.x < -1e-3 ? -x / dir.x : Infinity;
    const ty = dir.y > 1e-3 ? (H - y) / dir.y : dir.y < -1e-3 ? -y / dir.y : Infinity;
    this.L = Math.max(50, Math.min(tx, ty)) + 80;
    return this;
  }

  update(dt: number): boolean {
    this.age += dt;
    return this.age < this.dur;
  }

  private geom(): [number, number, number] {
    const head = clamp(this.age / 0.07);
    const fade = this.age < this.dur * 0.45 ? 1 : 1 - (this.age - this.dur * 0.45) / (this.dur * 0.55);
    const w = this.w * (1 + 0.18 * Math.sin(this.age * 90)) * (0.6 + 0.4 * fade);
    return [this.L * easeOutCubic(head), Math.max(0, fade), w];
  }

  drawDark(ctx: CanvasRenderingContext2D, v: VideoView | null): void {
    if (!v) return;
    const [len, fade, w] = this.geom();
    distortStrip(ctx, v, this.x, this.y, this.x + this.dx * len, this.y + this.dy * len, w * 3.2 * fade, w * 1.4 * fade);
  }

  drawLight(ctx: CanvasRenderingContext2D, sp: { core: HTMLCanvasElement; soft: HTMLCanvasElement }): void {
    const [len, fade, w] = this.geom();
    const ex = this.x + this.dx * len;
    const ey = this.y + this.dy * len;
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    for (const [lw, a, white] of [
      [w * 9, 0.14, false],
      [w * 3.5, 0.45, false],
      [w * 1.2, 0.95, false],
      [w * 0.45, 1, true],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = white ? `rgba(255,240,240,${a * fade})` : rgba(this.color, a * fade);
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    spr(ctx, sp.soft, this.x, this.y, w * 10 * (0.5 + fade), 0.7 * fade);
    spr(ctx, sp.core, this.x, this.y, w * 4, fade);
    if (len < this.L * 0.98) spr(ctx, sp.core, ex, ey, w * 5, fade);
  }
}

/* ---------------------------------------------------------- ElectricArc & Cracks */

export class ElectricArc {
  x1 = 0;
  y1 = 0;
  x2 = 0;
  y2 = 0;
  w = 2;
  life = 0.2;
  age = 0;
  color: RGB = WHITE;

  set(x1: number, y1: number, x2: number, y2: number, color: RGB, w: number, life: number): this {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.color = color;
    this.w = w;
    this.life = life;
    this.age = 0;
    return this;
  }

  update(dt: number): boolean {
    this.age += dt;
    return this.age < this.life;
  }

  drawLight(ctx: CanvasRenderingContext2D): void {
    const a = 1 - this.age / this.life;
    const d = Math.hypot(this.x2 - this.x1, this.y2 - this.y1);
    drawBolt(ctx, this.x1, this.y1, this.x2, this.y2, d * 0.18, this.color, this.w, a);
  }
}

/** Energy cracks: jagged fractures that snap outward from an impact and fade. */
export class Cracks {
  x = 0;
  y = 0;
  age = 0;
  color: RGB = WHITE;
  n = 0;
  pts = new Float32Array(16 * 14);

  set(x: number, y: number, r: number, color: RGB, n: number): this {
    this.x = x;
    this.y = y;
    this.color = color;
    this.age = 0;
    this.n = Math.min(16, n);
    for (let b = 0; b < this.n; b++) {
      let a = (b / this.n) * TAU + Math.random() * 0.5;
      const L = r * (0.6 + Math.random() * 0.6);
      let px = x;
      let py = y;
      for (let k = 0; k < 7; k++) {
        this.pts[b * 14 + k * 2] = px;
        this.pts[b * 14 + k * 2 + 1] = py;
        a += (Math.random() - 0.5) * 0.9;
        px += Math.cos(a) * (L / 6);
        py += Math.sin(a) * (L / 6);
      }
    }
    return this;
  }

  update(dt: number): boolean {
    this.age += dt;
    return this.age < 0.9;
  }

  private path(ctx: CanvasRenderingContext2D): number {
    const grow = clamp(this.age / 0.08);
    const segs = Math.max(1, Math.round(6 * grow));
    ctx.beginPath();
    for (let b = 0; b < this.n; b++) {
      ctx.moveTo(this.pts[b * 14], this.pts[b * 14 + 1]);
      for (let k = 1; k <= segs; k++) ctx.lineTo(this.pts[b * 14 + k * 2], this.pts[b * 14 + k * 2 + 1]);
    }
    return this.age < 0.3 ? 1 : 1 - (this.age - 0.3) / 0.6;
  }

  drawDark(ctx: CanvasRenderingContext2D): void {
    const a = this.path(ctx);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = `rgba(0,0,0,${0.85 * a})`;
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  drawLight(ctx: CanvasRenderingContext2D): void {
    const a = this.path(ctx);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(this.color, 0.9 * a);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
}

/* ---------------------------------------------------------- immediate: EnergyOrb */

export function drawOrbDark(ctx: CanvasRenderingContext2D, o: OrbCmd, t: number): void {
  const v = o.vis;
  if (o.style === 'blood') {
    const R = o.r * (1 + 0.08 * Math.sin(t * (6 + o.charge * 14)));
    const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, R * 1.4);
    g.addColorStop(0, `rgba(70,0,8,${0.95 * v})`);
    g.addColorStop(0.6, `rgba(40,0,4,${0.7 * v})`);
    g.addColorStop(1, 'rgba(20,0,2,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(o.x, o.y, R * 1.4, 0, TAU);
    ctx.fill();
  } else {
    // black flash: dark energy swirling around the fist
    const R = o.r;
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const a0 = t * (5 + k * 1.7) * (k % 2 ? -1 : 1) + k * 1.6;
      ctx.beginPath();
      ctx.arc(o.x, o.y, R * (0.85 + k * 0.16), a0, a0 + 1.4 + o.charge);
      ctx.strokeStyle = `rgba(0,0,0,${0.75 * v})`;
      ctx.lineWidth = R * (0.13 - k * 0.02);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
}

export function drawOrbLight(ctx: CanvasRenderingContext2D, o: OrbCmd, t: number, q: number, color: RGB): void {
  const v = o.vis;
  const c = o.charge;
  const core = glow(color, true);
  const soft = glow(color, false);
  if (o.style === 'blood') {
    const pulse = 0.5 + 0.5 * Math.sin(t * (6 + c * 14));
    const R = o.r * (1 + 0.08 * pulse);
    spr(ctx, soft, o.x, o.y, R * (3 + c * 1.5), (0.35 + 0.35 * c) * v);
    // red streams spiralling into the compressed sphere
    const n = Math.round(46 * q);
    for (let i = 0; i < n; i++) {
      const cyc = (t * (0.7 + c) * (0.6 + R2[i]) + R1[i]) % 1;
      const rad = R * (3 - cyc * 2.6);
      const ang = R1[i] * TAU + cyc * TAU * 1.7;
      spr(ctx, i % 5 ? core : glow(WHITE, true, 64), o.x + Math.cos(ang) * rad, o.y + Math.sin(ang) * rad, 2 + R3[i] * 3, Math.sin(cyc * Math.PI) * v);
    }
    ctx.globalAlpha = 1;
    for (let k = 0; k < 3; k++) {
      const a0 = t * (4 + k * 2) * (k % 2 ? -1 : 1);
      ctx.beginPath();
      ctx.arc(o.x, o.y, R * (1.2 + k * 0.25), a0, a0 + 2);
      ctx.strokeStyle = rgba(color, 0.55 * v);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    spr(ctx, core, o.x, o.y, R * 1.7, v);
    spr(ctx, glow(WHITE, true, 64), o.x, o.y, R * (0.3 + 0.6 * c) * (0.9 + 0.2 * pulse), v * (0.4 + 0.6 * c));
  } else {
    const R = o.r;
    spr(ctx, soft, o.x, o.y, R * 2.6, 0.45 * v * (0.6 + 0.4 * c));
    ctx.globalAlpha = 1;
    for (let k = 0; k < 3; k++) {
      const a0 = -t * (6 + k * 2) + k * 2.1;
      ctx.beginPath();
      ctx.arc(o.x, o.y, R * (1.05 + k * 0.18), a0, a0 + 1.1);
      ctx.strokeStyle = rgba(color, 0.7 * v);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const bolts = q > 0.5 ? 2 : 1;
    for (let i = 0; i < bolts; i++) {
      if (Math.random() > 0.35 + 0.4 * c) continue;
      const a = Math.random() * TAU;
      const e = R * (1.3 + Math.random() * 0.9);
      drawBolt(ctx, o.x + Math.cos(a) * R * 0.6, o.y + Math.sin(a) * R * 0.6, o.x + Math.cos(a) * e, o.y + Math.sin(a) * e, R * 0.35, color, 1.3, v);
    }
  }
}

/* ---------------------------------------------------------- immediate: Portal, HandAura */

export function drawPortalDark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, open: number): void {
  const u = easeOutCubic(clamp(open));
  if (u < 0.01) return;
  const rx = r * u;
  const ry = r * 0.34 * u;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 1.25);
  g.addColorStop(0, 'rgba(0,0,0,0.97)');
  g.addColorStop(0.75, 'rgba(4,2,10,0.92)');
  g.addColorStop(1, 'rgba(4,2,10,0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx * 1.25, 0, TAU);
  ctx.fill();
  ctx.restore();
  spr(ctx, puff([6, 4, 14]), x, y - ry, rx * 0.9, 0.5 * u);
}

export function drawPortalLight(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, open: number, color: RGB, t: number): void {
  const u = easeOutCubic(clamp(open));
  if (u < 0.01) return;
  const rx = r * u;
  const ry = r * 0.34 * u;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.strokeStyle = rgba(color, 0.75 * u);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  for (let k = 0; k < 3; k++) {
    const a0 = t * (1.5 + k * 0.8) * (k % 2 ? -1 : 1) + k * 2;
    ctx.beginPath();
    ctx.ellipse(x, y, rx * (0.95 - k * 0.18), ry * (0.95 - k * 0.18), 0, a0, a0 + 2.2);
    ctx.strokeStyle = rgba(color, 0.4 * u);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  const core = glow(color, true, 64);
  for (let i = 0; i < 10; i++) {
    const a = t * 1.3 + (i / 10) * TAU;
    spr(ctx, core, x + Math.cos(a) * rx, y + Math.sin(a) * ry, 4, 0.8 * u);
  }
}

const AURA_CHAINS = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
];

/** Thin energy lines curling along the fingers (Void preparation, Shrine charge). */
export function drawHandAura(ctx: CanvasRenderingContext2D, pts: Vec2[], palmPx: number, color: RGB, intensity: number, t: number): void {
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.3;
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = rgba(color, 0.5 * intensity * (1 - k * 0.2));
    ctx.beginPath();
    for (let c = 0; c < AURA_CHAINS.length; c++) {
      const ch = AURA_CHAINS[c];
      for (let j = 0; j < ch.length; j++) {
        const p = pts[ch[j]];
        const q = pts[ch[Math.min(ch.length - 1, j + 1)]];
        const nx = -(q.y - p.y);
        const ny = q.x - p.x;
        const l = Math.hypot(nx, ny) || 1;
        const off = Math.sin(t * (5 + k) + j * 1.3 + c + k * 2) * palmPx * 0.1 * (k + 1) * intensity;
        const x = p.x + (nx / l) * off;
        const y = p.y + (ny / l) * off;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
  spr(ctx, glow(color, false), pts[9].x, pts[9].y, palmPx * 1.6, 0.35 * intensity);
}
