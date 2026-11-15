/**
 * Synthetic MediaPipe-like hands for tests: a kinematic hand model with per-finger curl,
 * in-plane roll, scale, crossing, jitter. Output is normalised [0..1] like MediaPipe landmarks.
 */
import { TechniqueCore } from '../core';
import { NOOP_FX, NOOP_SFX, type Fx } from '../fx/api';
import type { Detection, P3 } from '../hands';
import type { Settings, TechniqueId } from '../types';
import { DEFAULT_SETTINGS } from '../types';

export const VW = 1280;
export const VH = 720;
export const MAP = { s: 1, dx: 0, dy: 0, vw: VW, vh: VH };

export interface HandSpec {
  /** palm centre in camera pixels (NOT mirrored) */
  cx: number;
  cy: number;
  /** wrist → middle knuckle length, px */
  size?: number;
  roll?: number;
  /** a left hand (mirrors the model) */
  left?: boolean;
  /** curl per finger 0 (straight) … 1 (fist) */
  thumb?: number;
  index?: number;
  middle?: number;
  ring?: number;
  pinky?: number;
  /** fan multiplier for finger spread */
  spread?: number;
  cross?: boolean;
  tipsTogether?: boolean;
  /** extra yaw-ish tilt of the pointing direction (rad), applied to all fingers */
  aim?: number;
  noise?: number;
}

type V3 = [number, number, number];

const KNUCKLE: Record<'index' | 'middle' | 'ring' | 'pinky', V3> = {
  index: [-0.36, -0.94, 0],
  middle: [-0.11, -1.0, 0],
  ring: [0.13, -0.95, 0],
  pinky: [0.34, -0.84, 0],
};
const SEG: Record<'index' | 'middle' | 'ring' | 'pinky', [number, number, number]> = {
  index: [0.45, 0.27, 0.22],
  middle: [0.5, 0.3, 0.24],
  ring: [0.46, 0.28, 0.22],
  pinky: [0.36, 0.22, 0.2],
};
const FAN = { index: -0.13, middle: -0.03, ring: 0.07, pinky: 0.17 };

function chain(base: V3, fan: number, segs: number[], curl: number, bends: number[]): V3[] {
  // direction in local frame: up (-y), rotated by fan around z, bending toward the camera (-z)
  let pitch = 0;
  const pts: V3[] = [];
  let p = base;
  for (let i = 0; i < segs.length; i++) {
    pitch += bends[i] * curl;
    const dx = Math.sin(fan) * Math.cos(pitch);
    const dy = -Math.cos(fan) * Math.cos(pitch);
    const dz = -Math.sin(pitch);
    p = [p[0] + dx * segs[i], p[1] + dy * segs[i], p[2] + dz * segs[i]];
    pts.push(p);
  }
  return pts;
}

let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());

export function makeHand(s: HandSpec): P3[] {
  const size = s.size ?? 150;
  const spread = s.spread ?? 1;
  const L: V3[] = new Array(21);
  L[0] = [0, 0, 0];
  const thumbCurl = s.thumb ?? 0;
  // thumb: out to the side when straight, folded across the palm when curled
  const tc = thumbCurl;
  L[1] = [-0.25, -0.22, -0.02];
  L[2] = [-0.45 + 0.2 * tc, -0.42, -0.05 - 0.1 * tc];
  L[3] = [-0.6 + 0.45 * tc, -0.6 + 0.05 * tc, -0.08 - 0.15 * tc];
  L[4] = [-0.72 + 0.75 * tc, -0.78 + 0.18 * tc, -0.1 - 0.2 * tc];

  const fingers = ['index', 'middle', 'ring', 'pinky'] as const;
  const curls = { index: s.index ?? 0, middle: s.middle ?? 0, ring: s.ring ?? 0, pinky: s.pinky ?? 0 };
  fingers.forEach((f, k) => {
    let fan = FAN[f] * spread + (s.aim ?? 0);
    if (s.cross && f === 'index') fan = 0.36 + (s.aim ?? 0);
    if (s.cross && f === 'middle') fan = -0.16 + (s.aim ?? 0);
    if (s.tipsTogether && f === 'index') fan = 0.1 + (s.aim ?? 0);
    if (s.tipsTogether && f === 'middle') fan = -0.04 + (s.aim ?? 0);
    const base = KNUCKLE[f];
    const pts = chain(base, fan, SEG[f], curls[f], [1.5, 1.75, 1.1]);
    const i0 = 5 + k * 4;
    L[i0] = base;
    L[i0 + 1] = pts[0];
    L[i0 + 2] = pts[1];
    L[i0 + 3] = pts[2];
  });

  const mirror = s.left ? -1 : 1;
  const roll = s.roll ?? 0;
  const c = Math.cos(roll);
  const sn = Math.sin(roll);
  const px = L.map(([x, y, z]) => {
    const xm = x * mirror;
    return [(xm * c - y * sn) * size, (xm * sn + y * c) * size, z * size] as V3;
  });
  // move palm centre (0,5,9,13,17) to (cx, cy)
  const ids = [0, 5, 9, 13, 17];
  const mx = ids.reduce((a, i) => a + px[i][0], 0) / 5;
  const my = ids.reduce((a, i) => a + px[i][1], 0) / 5;
  const n = s.noise ?? 0;
  return px.map(([x, y, z]) => ({
    x: (x - mx + s.cx + gauss() * n) / VW,
    y: (y - my + s.cy + gauss() * n) / VH,
    z: z / VW,
  }));
}

export function detection(hands: HandSpec[]): Detection {
  return {
    landmarks: hands.map(makeHand),
    // MediaPipe labels assume a mirrored image: the user's left hand is reported as "Right"
    handedness: hands.map((h) => [{ categoryName: h.left ? 'Right' : 'Left', score: 0.95 }]),
  };
}

/** Pose presets (curl values). */
export const POSE = {
  open: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  fist: { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 },
  point: { thumb: 1, index: 0, middle: 1, ring: 1, pinky: 1 },
  two: { thumb: 1, index: 0, middle: 0, ring: 1, pinky: 1 },
  dogs: { thumb: 1, index: 0, middle: 1, ring: 1, pinky: 0 },
  toad: { thumb: 0.3, index: 1, middle: 1, ring: 0, pinky: 0 },
} satisfies Record<string, Partial<HandSpec>>;

/** Two-hand sign fixtures. */
export const NUE: HandSpec[] = [
  { cx: 535, cy: 400, ...POSE.open, left: true, roll: 0.45, spread: 2.2 },
  { cx: 745, cy: 400, ...POSE.open, roll: -0.45, spread: 2.2 },
];
export const BLOOD: HandSpec[] = [
  { cx: 560, cy: 420, ...POSE.point, left: true, roll: -1.4 },
  { cx: 620, cy: 380, ...POSE.point, roll: -1.4 },
];

export class Sim {
  core: TechniqueCore;
  t = 0;
  readonly dt = 1 / 30;
  cines: string[] = [];

  constructor(settings: Partial<Settings> = {}, fx: Fx = NOOP_FX) {
    this.core = new TechniqueCore({ fx, sfx: NOOP_SFX, onCinematic: (c) => this.cines.push(c.title) });
    this.core.setSettings({ ...DEFAULT_SETTINGS, ...settings }, 0);
  }

  /** One camera frame (null = no hands detected, undefined = no new camera frame). */
  frame(hands: HandSpec[] | null | undefined): void {
    this.t += this.dt;
    const det = hands === undefined ? undefined : hands === null || hands.length === 0 ? null : detection(hands);
    this.core.step(det, this.t, this.dt, MAP, VW, VH);
  }

  /** Hold a static pose for `sec` seconds. */
  hold(hands: HandSpec[] | null, sec: number): void {
    const n = Math.round(sec / this.dt);
    for (let i = 0; i < n; i++) this.frame(hands);
  }

  /** Move hands linearly from a to b over `sec` (same pose; spec fields cx/cy/size interpolated). */
  move(a: HandSpec[], b: HandSpec[], sec: number): void {
    const n = Math.max(1, Math.round(sec / this.dt));
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      this.frame(
        a.map((h, k) => ({
          ...h,
          cx: h.cx + (b[k].cx - h.cx) * u,
          cy: h.cy + (b[k].cy - h.cy) * u,
          size: (h.size ?? 150) + ((b[k].size ?? 150) - (h.size ?? 150)) * u,
          roll: (h.roll ?? 0) + ((b[k].roll ?? 0) - (h.roll ?? 0)) * u,
        })),
      );
    }
  }

  state(id: TechniqueId): string {
    return this.core.byId[id].state;
  }
}
