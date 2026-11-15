import { rgba, type RGB } from '../math';

export type Sprite = HTMLCanvasElement;

const cache = new Map<string, Sprite>();

/** Pre-rendered radial glow (cached per colour): drawing a sprite is far cheaper than shadowBlur. */
export function glow(c: RGB, core: boolean, size = 128): Sprite {
  const key = `g${c.join(',')}${core ? 'c' : 's'}${size}`;
  let cv = cache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
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
  cache.set(key, cv);
  return cv;
}

/** Soft opaque-centre puff for smoke / shadow particles (normal blending). */
export function puff(c: RGB, size = 64): Sprite {
  const key = `p${c.join(',')}${size}`;
  let cv = cache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const h = size / 2;
  const grd = g.createRadialGradient(h, h, 0, h, h, h);
  grd.addColorStop(0, rgba(c, 0.9));
  grd.addColorStop(0.5, rgba(c, 0.45));
  grd.addColorStop(1, rgba(c, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  cache.set(key, cv);
  return cv;
}

export const WHITE: RGB = [255, 255, 255];

export function spr(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, r: number, a: number): void {
  if (a <= 0.003 || r <= 0.2) return;
  ctx.globalAlpha = a > 1 ? 1 : a;
  ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
}

/** Random tables for procedural (allocation-free) particle fields. */
export const N_RAND = 1024;
export const R1 = Float32Array.from({ length: N_RAND }, Math.random);
export const R2 = Float32Array.from({ length: N_RAND }, Math.random);
export const R3 = Float32Array.from({ length: N_RAND }, Math.random);
export const R4 = Float32Array.from({ length: N_RAND }, Math.random);

/** Jagged lightning polyline (midpoint displacement) into a reusable buffer; returns point count. */
export function boltPoints(out: Float32Array, x1: number, y1: number, x2: number, y2: number, disp: number, levels = 4): number {
  out[0] = x1;
  out[1] = y1;
  out[2] = x2;
  out[3] = y2;
  let n = 2;
  let d = disp;
  for (let it = 0; it < levels; it++) {
    // expand in place from the end so we never overwrite unread points
    const m = n * 2 - 1;
    if (m * 2 > out.length) break;
    for (let i = n - 1; i >= 0; i--) {
      out[i * 4] = out[i * 2];
      out[i * 4 + 1] = out[i * 2 + 1];
    }
    for (let i = 0; i < n - 1; i++) {
      const ax = out[i * 4];
      const ay = out[i * 4 + 1];
      const bx = out[i * 4 + 4];
      const by = out[i * 4 + 5];
      const nx = -(by - ay);
      const ny = bx - ax;
      const l = Math.hypot(nx, ny) || 1;
      const off = (Math.random() * 2 - 1) * d;
      out[i * 4 + 2] = (ax + bx) / 2 + (nx / l) * off;
      out[i * 4 + 3] = (ay + by) / 2 + (ny / l) * off;
    }
    n = m;
    d *= 0.55;
  }
  return n;
}

const BOLT_BUF = new Float32Array(160);

export function drawBolt(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, disp: number, c: RGB, w: number, a: number, dark = false): void {
  const n = boltPoints(BOLT_BUF, x1, y1, x2, y2, disp);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(BOLT_BUF[0], BOLT_BUF[1]);
  for (let i = 1; i < n; i++) ctx.lineTo(BOLT_BUF[i * 2], BOLT_BUF[i * 2 + 1]);
  ctx.strokeStyle = rgba(c, 0.35 * a);
  ctx.lineWidth = w * 4;
  ctx.stroke();
  ctx.strokeStyle = dark ? `rgba(0,0,0,${0.9 * a})` : `rgba(255,245,255,${0.9 * a})`;
  ctx.lineWidth = w;
  ctx.stroke();
}
