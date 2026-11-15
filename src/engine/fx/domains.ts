/**
 * DomainEnvironment: full-screen worlds drawn behind the user (the person layer is composited on top).
 *  - VoidEnvironment: infinite star tunnel, nebulae, galaxies, spatial rings, slowly rotating structures.
 *  - ShrineEnvironment: blood-red sky, dark clouds and a volumetric shrine rendered as a small
 *    software-3D model (perspective projection, back-face culling, painter's sort, flat shading).
 *    On the LOW profile the shrine is rendered once into a cached 2.5D layer.
 */
import type { Profile } from '../types';
import { TAU, clamp, easeOutCubic, rgba, type RGB } from '../math';
import type { DomainCmd } from './api';
import { glow, puff, spr, R1, R2, R3, R4, WHITE } from './sprites';
import { ringWarp, type VideoView } from './primitives';

/* =================================================================== VOID */

function makeNebula(seed: number, a: RGB, b: RGB): HTMLCanvasElement {
  const size = 384;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 60; i++) {
    const k = (seed * 97 + i * 13) % 1024;
    const ang = R1[k] * TAU;
    const rad = Math.pow(R2[k], 0.7) * size * 0.32;
    const x = size / 2 + Math.cos(ang) * rad;
    const y = size / 2 + Math.sin(ang) * rad * 0.7;
    const r = size * (0.08 + R3[k] * 0.18);
    const c = R4[k] < 0.5 ? a : b;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rgba(c, 0.12));
    grd.addColorStop(1, rgba(c, 0));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return cv;
}

function makeGalaxy(arms: number, c: RGB): HTMLCanvasElement {
  const size = 320;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  g.globalCompositeOperation = 'lighter';
  const h = size / 2;
  const dot = glow(c, true, 32);
  const white = glow(WHITE, true, 32);
  for (let i = 0; i < 900; i++) {
    const k = i % 1024;
    const arm = i % arms;
    const r = Math.pow(R1[k], 0.6) * h * 0.95;
    const ang = (arm / arms) * TAU + r * 0.035 + (R2[k] - 0.5) * 0.5;
    const x = h + Math.cos(ang) * r;
    const y = h + Math.sin(ang) * r * 0.45;
    const s = 1 + R3[k] * 3 * (1 - r / h);
    g.globalAlpha = 0.25 + 0.6 * (1 - r / h);
    g.drawImage(R4[k] < 0.2 ? white : dot, x - s, y - s, s * 2, s * 2);
  }
  g.globalAlpha = 1;
  const core = g.createRadialGradient(h, h, 0, h, h, h * 0.3);
  core.addColorStop(0, 'rgba(255,255,255,0.9)');
  core.addColorStop(0.3, rgba(c, 0.5));
  core.addColorStop(1, rgba(c, 0));
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);
  return cv;
}

const ICOSA = (() => {
  const p = (1 + Math.sqrt(5)) / 2;
  const v: [number, number, number][] = [
    [-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0],
    [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p],
    [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1],
  ];
  const e: [number, number][] = [];
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++) {
      const d = Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2]);
      if (Math.abs(d - 2) < 0.01) e.push([i, j]);
    }
  return { v, e };
})();

export class VoidEnvironment {
  private stars: Float32Array;
  private nebulae: HTMLCanvasElement[] | null = null;
  private galaxies: HTMLCanvasElement[] | null = null;
  private N = 700;

  constructor() {
    this.stars = new Float32Array(this.N * 3);
    for (let i = 0; i < this.N; i++) this.respawn(i, Math.random());
  }

  private respawn(i: number, z: number): void {
    this.stars[i * 3] = (Math.random() * 2 - 1) * 1.6;
    this.stars[i * 3 + 1] = (Math.random() * 2 - 1) * 1.0;
    this.stars[i * 3 + 2] = z;
  }

  private lazy(): void {
    if (this.nebulae) return;
    this.nebulae = [makeNebula(1, [80, 60, 255], [180, 40, 255]), makeNebula(7, [40, 140, 255], [120, 60, 255]), makeNebula(13, [200, 60, 220], [60, 90, 255])];
    this.galaxies = [makeGalaxy(2, [150, 120, 255]), makeGalaxy(3, [90, 170, 255])];
  }

  render(ctx: CanvasRenderingContext2D, c: DomainCmd, W: number, H: number, dt: number, profile: Profile, v: VideoView, maxOpacity: number): void {
    this.lazy();
    const I = clamp(c.intensity) * maxOpacity;
    const t = c.age;
    const D = Math.max(W, H);

    // 1) the real room bends before it is replaced
    if (c.distortion > 0.03 && profile !== 'low') ringWarp(ctx, v, c.cx, c.cy, D * 0.7, c.distortion * 1.6, t, profile === 'high' ? 5 : 3);

    // 2) the void spreads from the hand as a growing circle, then fills the screen
    const waveR = c.progress >= 1 ? D * 2 : D * 1.25 * easeOutCubic(c.progress);
    if (waveR < 2 || I < 0.005) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(c.cx, c.cy, waveR, 0, TAU);
    ctx.clip();

    ctx.globalCompositeOperation = 'source-over';
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, D * 0.75);
    bg.addColorStop(0, `rgba(14,6,40,${I})`);
    bg.addColorStop(0.6, `rgba(4,2,16,${I})`);
    bg.addColorStop(1, `rgba(0,0,4,${I})`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';
    const neb = this.nebulae!;
    const nCount = profile === 'low' ? 1 : profile === 'medium' ? 2 : 3;
    for (let i = 0; i < nCount; i++) {
      const a = t * 0.03 * (i % 2 ? -1 : 1) + i * 2.1;
      const s = D * (1.1 + 0.25 * i);
      ctx.save();
      ctx.translate(W / 2 + Math.cos(a * 0.7 + i) * W * 0.15, H / 2 + Math.sin(a * 0.9 + i) * H * 0.12);
      ctx.rotate(a);
      ctx.globalAlpha = 0.55 * I;
      ctx.drawImage(neb[i], -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    if (profile !== 'low') {
      const gal = this.galaxies!;
      for (let i = 0; i < 2; i++) {
        const s = Math.min(W, H) * (0.45 + 0.15 * i);
        ctx.save();
        ctx.translate(W * (0.22 + 0.56 * i), H * (0.3 + 0.35 * i));
        ctx.rotate(t * 0.08 * (i ? -1 : 1) + i);
        ctx.scale(1, 0.75);
        ctx.globalAlpha = 0.7 * I;
        ctx.drawImage(gal[i], -s / 2, -s / 2, s, s);
        ctx.restore();
      }
    }

    // 3) infinite depth: stars streaming toward the viewer
    const n = profile === 'low' ? 220 : profile === 'medium' ? 450 : this.N;
    const speed = 0.12 + 0.5 * (1 - c.progress) + 0.08 * Math.sin(t * 0.4);
    const f = D * 0.5;
    const cx = W / 2;
    const cy = H / 2;
    ctx.globalAlpha = 1;
    for (let i = 0; i < n; i++) {
      let z = this.stars[i * 3 + 2] - dt * speed;
      if (z < 0.03) {
        this.respawn(i, 1);
        z = 1;
      }
      const pz = z + dt * speed * 6;
      this.stars[i * 3 + 2] = z;
      const x = this.stars[i * 3];
      const y = this.stars[i * 3 + 1];
      const sx = cx + (x / z) * f;
      const sy = cy + (y / z) * f;
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      const b = (1 - z) * I;
      ctx.strokeStyle = `rgba(${200 + ((i * 7) % 55)},${210 + ((i * 3) % 45)},255,${b})`;
      ctx.lineWidth = Math.max(0.6, (1 - z) * 2.4);
      ctx.beginPath();
      ctx.moveTo(cx + (x / pz) * f, cy + (y / pz) * f);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }

    // 4) spatial rings receding into the distance
    for (let k = 0; k < 7; k++) {
      const z = ((k / 7 + t * 0.06) % 1) * 0.95 + 0.05;
      const r = (f * 0.35) / z;
      if (r > D * 1.5) continue;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.62, t * 0.05 + k * 0.4, 0, TAU);
      ctx.strokeStyle = `rgba(170,140,255,${0.18 * I * (1 - z)})`;
      ctx.lineWidth = 1 + (1 - z) * 2;
      ctx.stroke();
    }

    // 5) slowly rotating abstract structures
    if (profile !== 'low') {
      for (let s = 0; s < 2; s++) {
        const ox = W * (s ? 0.78 : 0.2);
        const oy = H * (s ? 0.28 : 0.72);
        const size = Math.min(W, H) * (s ? 0.09 : 0.13);
        const ay = t * (0.25 + s * 0.1);
        const ax = t * (0.17 + s * 0.07);
        const ca = Math.cos(ay), sa = Math.sin(ay), cb = Math.cos(ax), sb = Math.sin(ax);
        ctx.beginPath();
        for (const [i, j] of ICOSA.e) {
          for (const [k, first] of [[i, true], [j, false]] as const) {
            const [x, y, z] = ICOSA.v[k];
            const x1 = x * ca + z * sa;
            const z1 = -x * sa + z * ca;
            const y1 = y * cb - z1 * sb;
            const z2 = y * sb + z1 * cb;
            const p = 4 / (4 + z2);
            if (first) ctx.moveTo(ox + x1 * size * p, oy + y1 * size * p);
            else ctx.lineTo(ox + x1 * size * p, oy + y1 * size * p);
          }
        }
        ctx.strokeStyle = `rgba(190,210,255,${0.35 * I})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // 6) drifting light motes
    const motes = profile === 'low' ? 30 : 90;
    const mote = glow([170, 150, 255], true, 32);
    for (let i = 0; i < motes; i++) {
      const x = ((R1[i] + t * 0.01 * (0.5 + R2[i])) % 1) * W;
      const y = ((R2[i] + t * 0.006 * (R3[i] - 0.5)) % 1 + 1) % 1 * H;
      spr(ctx, mote, x, y, 2 + R3[i] * 3, I * (0.4 + 0.6 * Math.sin(t * (1 + R4[i] * 2) + i) ** 2));
    }

    // 7) the expanding wave front
    if (c.progress < 1) {
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, waveR * 0.995, 0, TAU);
      ctx.strokeStyle = `rgba(220,200,255,${0.8 * (1 - c.progress)})`;
      ctx.lineWidth = 10 * (1 - c.progress) + 2;
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}

/* =================================================================== SHRINE */

type V3 = [number, number, number];
interface Face {
  v: V3[];
  color: RGB;
  /** glowing edge (roof rims) */
  rim: boolean;
}

function box(faces: Face[], cx: number, y0: number, cz: number, w: number, h: number, d: number, color: RGB, rim = false): void {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
  const q = (a: V3, b: V3, c: V3, e: V3) => faces.push({ v: [a, b, c, e], color, rim });
  q([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]); // front (z0 faces camera)
  q([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]); // back
  q([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]); // left
  q([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]); // right
  q([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]); // top
}

/** Hip roof with upturned eaves: bottom rectangle (w×d) at y0, ridge (rw×rd) at y1. */
function roof(faces: Face[], y0: number, y1: number, w: number, d: number, rw: number, rd: number, color: RGB): void {
  const lift = 0.35;
  const b: V3[] = [
    [-w / 2, y0 + lift, -d / 2],
    [w / 2, y0 + lift, -d / 2],
    [w / 2, y0 + lift, d / 2],
    [-w / 2, y0 + lift, d / 2],
  ];
  const m: V3[] = [
    [-w * 0.42, y0, -d * 0.42],
    [w * 0.42, y0, -d * 0.42],
    [w * 0.42, y0, d * 0.42],
    [-w * 0.42, y0, d * 0.42],
  ];
  const r: V3[] = [
    [-rw / 2, y1, -rd / 2],
    [rw / 2, y1, -rd / 2],
    [rw / 2, y1, rd / 2],
    [-rw / 2, y1, rd / 2],
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.push({ v: [b[i], b[j], m[j], m[i]], color, rim: true }); // flared eave
    faces.push({ v: [m[i], m[j], r[j], r[i]], color, rim: false }); // slope
  }
  faces.push({ v: [r[0], r[1], r[2], r[3]], color, rim: true });
}

function buildShrine(): Face[] {
  const f: Face[] = [];
  const stone: RGB = [38, 14, 14];
  const wood: RGB = [60, 10, 12];
  const pillar: RGB = [130, 18, 22];
  const dark: RGB = [16, 6, 8];
  const roofC: RGB = [22, 8, 10];
  box(f, 0, 0, 0, 9, 0.5, 5, stone);
  box(f, 0, 0.5, 0, 7.6, 0.45, 4.2, stone);
  for (let i = 0; i < 3; i++) box(f, 0, 0.2 + i * 0.25, -2.6 - i * 0.35, 2.4, 0.3, 0.45, stone);
  for (const x of [-3.1, -1.2, 1.2, 3.1])
    for (const z of [-1.6, 1.6]) box(f, x, 0.95, z, 0.38, 2.6, 0.38, pillar);
  box(f, 0, 0.95, 0.2, 5.4, 2.3, 2.6, dark);
  box(f, 0, 3.4, 0, 6.8, 0.3, 3.6, wood);
  roof(f, 3.7, 5.0, 9.4, 5.6, 3.2, 0.7, roofC);
  box(f, 0, 5.0, 0, 3.2, 1.3, 1.9, dark);
  for (const x of [-1.4, 1.4]) box(f, x, 5.0, -0.95, 0.26, 1.3, 0.26, pillar);
  roof(f, 6.3, 7.5, 6.0, 3.8, 1.6, 0.4, roofC);
  box(f, 0, 7.5, 0, 0.18, 1.0, 0.18, pillar); // finial
  // torii gate in front
  for (const x of [-3.8, 3.8]) box(f, x, 0, -4.6, 0.32, 3.4, 0.32, pillar);
  box(f, 0, 3.0, -4.6, 9.2, 0.28, 0.4, pillar, true);
  box(f, 0, 3.55, -4.6, 10.2, 0.3, 0.5, roofC, true);
  return f;
}

const LIGHT = (() => {
  const v = [-0.45, 0.75, -0.5];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / l) as V3;
})();

interface Proj {
  pts: number[];
  depth: number;
  shade: number;
  face: Face;
}

export class ShrineEnvironment {
  private faces = buildShrine();
  private proj: Proj[] = this.faces.map((face) => ({ pts: new Array(8).fill(0), depth: 0, shade: 1, face }));
  private order: Proj[] = [];
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = '';
  private rot = new Float32Array(12);

  /** Project & draw the shrine. yaw in rad; (ox, oy) = screen position of the base centre; scale px per unit. */
  private drawModel(ctx: CanvasRenderingContext2D, yaw: number, ox: number, oy: number, scale: number, alpha: number, glowA: number): void {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const camZ = -26;
    const f = 26;
    const pitch = 0.12;
    const cp = Math.cos(pitch);
    const spch = Math.sin(pitch);
    const R = this.rot;
    this.order.length = 0;
    for (const p of this.proj) {
      let zsum = 0;
      for (let i = 0; i < 4; i++) {
        const [x, y, z] = p.face.v[i];
        const xr = x * cy + z * sy;
        const zr = -x * sy + z * cy;
        const yr = (y - 3.5) * cp - zr * spch + 3.5;
        const zz = (y - 3.5) * spch + zr * cp;
        R[i * 3] = xr;
        R[i * 3 + 1] = yr;
        R[i * 3 + 2] = zz;
        const k = f / (zz - camZ);
        p.pts[i * 2] = ox + xr * k * scale;
        p.pts[i * 2 + 1] = oy - yr * k * scale;
        zsum += zz;
      }
      // outward normal = −(v1−v0)×(v3−v0) (faces are wound so the cross product points inward)
      const ax = R[3] - R[0], ay = R[4] - R[1], az = R[5] - R[2];
      const bx = R[9] - R[0], by = R[10] - R[1], bz = R[11] - R[2];
      let nx = -(ay * bz - az * by);
      let ny = -(az * bx - ax * bz);
      let nz = -(ax * by - ay * bx);
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      // visible when the normal points toward the camera
      const facing = nx * -R[0] + ny * -R[1] + nz * (camZ - R[2]); // camera at (0, 0, camZ): ground level, looking up
      if (facing <= 0) {
        if (!p.face.rim) continue;
        nx = -nx;
        ny = -ny;
        nz = -nz; // thin roof parts are double-sided
      }
      p.shade = 0.32 + 0.68 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      p.depth = zsum / 4;
      this.order.push(p);
    }
    this.order.sort((a, b) => b.depth - a.depth);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    for (const p of this.order) {
      const c = p.face.color;
      ctx.beginPath();
      ctx.moveTo(p.pts[0], p.pts[1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(p.pts[i * 2], p.pts[i * 2 + 1]);
      ctx.closePath();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${(c[0] * p.shade) | 0},${(c[1] * p.shade) | 0},${(c[2] * p.shade) | 0})`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (glowA > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(255,40,50,${0.55 * glowA})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (const p of this.order) {
        if (!p.face.rim) continue;
        ctx.moveTo(p.pts[0], p.pts[1]);
        ctx.lineTo(p.pts[2], p.pts[3]);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  render(ctx: CanvasRenderingContext2D, c: DomainCmd, W: number, H: number, profile: Profile, v: VideoView, maxOpacity: number): void {
    const I = clamp(c.intensity);
    if (I < 0.005) return;
    const t = c.age;
    const D = Math.max(W, H);
    if (c.distortion > 0.03 && profile !== 'low') ringWarp(ctx, v, c.cx, c.cy, D * 0.6, c.distortion, t, 3);

    // blood sky
    ctx.globalCompositeOperation = 'source-over';
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `rgba(40,0,4,${0.95 * I * maxOpacity})`);
    sky.addColorStop(0.55, `rgba(120,6,14,${0.85 * I * maxOpacity})`);
    sky.addColorStop(1, `rgba(20,0,2,${0.95 * I * maxOpacity})`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // horizon glow
    spr(ctx, glow([255, 30, 40], false), W / 2, H * 0.78, D * 0.55, 0.45 * I);

    // dark clouds drifting at the top
    const cloud = puff([12, 2, 4]);
    const nClouds = profile === 'low' ? 6 : 14;
    for (let i = 0; i < nClouds; i++) {
      const x = (((R1[i] * W * 1.4 + t * (12 + R2[i] * 18)) % (W * 1.4)) - W * 0.2);
      const y = H * (0.02 + R3[i] * 0.3);
      spr(ctx, cloud, x, y, D * (0.12 + R4[i] * 0.12), 0.75 * I);
    }

    // the shrine rises out of the ground behind the user
    const rise = easeOutCubic(clamp(c.progress));
    const scale = H * 0.068;
    const oy = H * 0.97 + (1 - rise) * H * 0.75;
    const alpha = I * Math.min(1, maxOpacity + 0.1);
    if (profile === 'low') {
      const key = `${W}x${H}`;
      if (!this.cache || this.cacheKey !== key) {
        this.cache = document.createElement('canvas');
        this.cache.width = W;
        this.cache.height = H;
        this.drawModel(this.cache.getContext('2d')!, 0.35, W / 2, H * 0.97, scale, 1, 1);
        this.cacheKey = key;
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.cache, 0, oy - H * 0.97);
    } else {
      const yaw = 0.35 + Math.sin(t * 0.18) * 0.22;
      this.drawModel(ctx, yaw, W / 2, oy, scale, alpha, I * (0.6 + 0.4 * Math.sin(t * 3) ** 2));
    }

    // embers rising
    ctx.globalCompositeOperation = 'lighter';
    const ember = glow([255, 60, 40], true, 32);
    const n = profile === 'low' ? 25 : 70;
    for (let i = 0; i < n; i++) {
      const y = H - (((R1[i + 200] + t * (0.05 + R2[i + 200] * 0.08)) % 1) * H * 1.1);
      const x = R3[i + 200] * W + Math.sin(t + i) * 20;
      spr(ctx, ember, x, y, 2 + R4[i + 200] * 3, I * 0.8);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
