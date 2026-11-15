/**
 * Two-hand landmark processing: slot assignment, One-Euro smoothing, joint-angle curl,
 * palm centre/size/roll/normal, finger crossing and velocities/acceleration.
 * Works on plain {x,y,z} arrays so it can be unit-tested without MediaPipe or a DOM.
 */
import type { Vec2 } from './types';
import { OneEuroFilter } from './oneEuro';
import { GestureDebouncer, HandAnalyzer, type FingerStates, type Gesture, type P3 } from './gestures';
import { VelocityTracker } from './velocity';
import { add, len, lerpV, norm, scale, sub } from './math';

export type { P3 };
export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export type Curl = Record<FingerName, number>;

export interface Detection {
  landmarks: P3[][];
  world?: P3[][];
  handedness?: { categoryName: string; score: number }[][];
}

export interface VideoMapLike {
  s: number;
  dx: number;
  dy: number;
  vw: number;
  vh: number;
}

export interface HandInfo {
  slot: 0 | 1;
  present: boolean;
  /** the user's real hand (MediaPipe labels assume a mirrored image, ours is not) */
  side: 'L' | 'R' | '?';
  score: number;
  since: number;
  lastSeen: number;
  /** smoothed landmarks in screen px (mirrored, object-fit: cover) */
  pts: Vec2[];
  fingers: FingerStates;
  curl: Curl;
  /** stable gesture of the original Blue/Red classifier */
  gesture: Gesture;
  rawGesture: Gesture;
  /** index-middle tip distance, palm units */
  tipGap: number;
  /** palm centre from landmarks 0,5,9,13,17 (screen px) */
  palm: Vec2;
  /** palm size in screen px, smoothed */
  palmPx: number;
  /** angle of the knuckle line 5→17 in screen space, rad */
  roll: number;
  /** lateral tip order of index vs middle; < 0 means the fingers are crossed */
  crossed: number;
  /** reliability of `crossed` (knuckle line not foreshortened) 0..1 */
  crossReliability: number;
  pointDir: Vec2;
  indexDir: Vec2;
  middleDir: Vec2;
  pinkyDir: Vec2;
  /** palm normal in screen-aligned axes (x mirrored), from world landmarks when available */
  normal: P3 | null;
  /** palm velocity, palm units/s */
  palmVel: Vec2;
  palmSpeed: number;
  /** palm acceleration magnitude, palm units/s² */
  palmAccel: number;
  /** d(ln palmSize)/dt — positive when the hand approaches the camera */
  scaleRate: number;
  /** midpoint of index & middle tips, absolute velocity in palm units/s */
  tipVel: Vec2;
  indexRelVel: Vec2;
  middleRelVel: Vec2;
  indexAnchor: Vec2;
  middleAnchor: Vec2;
  /** true on the first frame after the hand (re)appeared */
  reacquired: boolean;
}

export interface TrackFrame {
  t: number;
  /** visible hands this frame, ordered by slot */
  hands: HandInfo[];
  slots: [HandInfo, HandInfo];
  primary: HandInfo | null;
  /** last time any hand was visible */
  lastSeen: number;
}

const PALM_IDS = [0, 5, 9, 13, 17];
const FINGER_JOINTS: Record<Exclude<FingerName, 'thumb'>, [number, number, number, number]> = {
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

const sub3 = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot3 = (a: P3, b: P3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len3 = (a: P3): number => Math.sqrt(dot3(a, a));
const cross3 = (a: P3, b: P3): P3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const angle3 = (a: P3, b: P3): number => {
  const l = len3(a) * len3(b);
  if (l < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot3(a, b) / l)));
};

/** Bend of a finger from its joint angles (0 straight … 1 fully curled). Independent of hand rotation. */
export function computeCurl(p: P3[]): Curl {
  const finger = (k: Exclude<FingerName, 'thumb'>): number => {
    const [m, pi, d, t] = FINGER_JOINTS[k];
    const aM = angle3(sub3(p[m], p[0]), sub3(p[pi], p[m]));
    const aP = angle3(sub3(p[pi], p[m]), sub3(p[d], p[pi]));
    const aD = angle3(sub3(p[d], p[pi]), sub3(p[t], p[d]));
    return Math.min(1, (aM * 0.6 + aP + aD * 0.7) / (Math.PI * 1.05));
  };
  const thumb = Math.min(1, (angle3(sub3(p[2], p[1]), sub3(p[3], p[2])) + angle3(sub3(p[3], p[2]), sub3(p[4], p[3]))) / (Math.PI * 0.75));
  return { thumb, index: finger('index'), middle: finger('middle'), ring: finger('ring'), pinky: finger('pinky') };
}

/**
 * Crossing metric: project the index & middle tips onto the knuckle line (index→pinky knuckle).
 * Normally the index tip lies on the index side (positive result). Crossed fingers swap the order.
 * Merely touching fingers stay ≥ 0, which is what separates "crossed" from "close together".
 */
export function computeCross(p: P3[], palm: number): { cross: number; reliability: number } {
  const lx = p[17].x - p[5].x;
  const ly = p[17].y - p[5].y;
  const l = Math.hypot(lx, ly);
  const reliability = Math.max(0, Math.min(1, (l / palm - 0.3) / 0.25));
  if (l < 1e-6) return { cross: 0, reliability: 0 };
  const ux = lx / l;
  const uy = ly / l;
  const lat = (i: number) => (p[i].x - p[5].x) * ux + (p[i].y - p[5].y) * uy;
  return { cross: (lat(12) - lat(8)) / palm, reliability };
}

class HandSlot {
  readonly info: HandInfo;
  filters = Array.from({ length: 42 }, () => new OneEuroFilter(1.4, 0.012, 1));
  analyzer = new HandAnalyzer();
  debouncer = new GestureDebouncer();
  palmVel = new VelocityTracker();
  idxVel = new VelocityTracker();
  midVel = new VelocityTracker();
  tipVel = new VelocityTracker();
  scaleVel = new VelocityTracker();
  private accT: number[] = [];
  private accX: number[] = [];
  private accY: number[] = [];

  constructor(slot: 0 | 1) {
    this.info = {
      slot,
      present: false,
      side: '?',
      score: 0,
      since: 0,
      lastSeen: -Infinity,
      pts: Array.from({ length: 21 }, () => ({ x: 0, y: 0 })),
      fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
      curl: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
      gesture: 'none',
      rawGesture: 'none',
      tipGap: 1,
      palm: { x: 0, y: 0 },
      palmPx: 120,
      roll: 0,
      crossed: 0.3,
      crossReliability: 0,
      pointDir: { x: 0, y: -1 },
      indexDir: { x: 0, y: -1 },
      middleDir: { x: 0, y: -1 },
      pinkyDir: { x: 0, y: -1 },
      normal: null,
      palmVel: { x: 0, y: 0 },
      palmSpeed: 0,
      palmAccel: 0,
      scaleRate: 0,
      tipVel: { x: 0, y: 0 },
      indexRelVel: { x: 0, y: 0 },
      middleRelVel: { x: 0, y: 0 },
      indexAnchor: { x: 0, y: 0 },
      middleAnchor: { x: 0, y: 0 },
      reacquired: false,
    };
  }

  resetMotion(): void {
    this.filters.forEach((f) => f.reset());
    this.palmVel.reset();
    this.idxVel.reset();
    this.midVel.reset();
    this.tipVel.reset();
    this.scaleVel.reset();
    this.accT = [];
    this.accX = [];
    this.accY = [];
  }

  private accel(t: number, v: Vec2): number {
    this.accT.push(t);
    this.accX.push(v.x);
    this.accY.push(v.y);
    if (this.accT.length > 10) {
      this.accT.shift();
      this.accX.shift();
      this.accY.shift();
    }
    const n = this.accT.length;
    let i = n - 2;
    while (i > 0 && t - this.accT[i] < 0.06) i--;
    if (i < 0) return 0;
    const dt = t - this.accT[i];
    if (dt < 1e-3) return 0;
    return Math.hypot(v.x - this.accX[i], v.y - this.accY[i]) / dt;
  }

  update(lms: P3[], world: P3[] | undefined, label: string, score: number, t: number, map: VideoMapLike, W: number): void {
    const h = this.info;
    const reacquired = t - h.lastSeen > 0.25;
    if (reacquired) {
      this.resetMotion();
      h.since = t;
    }
    h.reacquired = reacquired;
    h.present = true;
    h.lastSeen = t;
    // MediaPipe assumes a mirrored (selfie) image; we feed the raw camera frame, so the label is swapped.
    h.side = label === 'Left' ? 'R' : label === 'Right' ? 'L' : '?';
    h.score = score;

    const { s, dx, dy, vw, vh } = map;
    const raw: P3[] = lms.map((l) => ({ x: l.x * vw, y: l.y * vh, z: l.z * vw }));
    const analysis = this.analyzer.analyze(raw);
    h.fingers = analysis.fingers;
    h.rawGesture = analysis.gesture;
    h.gesture = this.debouncer.update(analysis.gesture, t);
    h.tipGap = analysis.tipGap;

    const geo = world && world.length === 21 ? world : raw;
    const c = computeCurl(geo);
    h.curl.thumb = c.thumb;
    h.curl.index = c.index;
    h.curl.middle = c.middle;
    h.curl.ring = c.ring;
    h.curl.pinky = c.pinky;

    const cr = computeCross(raw, analysis.palmSize);
    h.crossed = cr.cross;
    h.crossReliability = cr.reliability;

    if (world && world.length === 21) {
      const n = cross3(sub3(world[5], world[0]), sub3(world[17], world[0]));
      const l = len3(n) || 1;
      h.normal = { x: -n.x / l, y: n.y / l, z: n.z / l };
    } else h.normal = null;

    // screen space: mirrored + cover mapping, then One-Euro smoothing
    const P = h.pts;
    for (let i = 0; i < 21; i++) {
      const sx = W - (dx + lms[i].x * vw * s);
      const sy = dy + lms[i].y * vh * s;
      P[i].x = this.filters[i * 2].filter(sx, t);
      P[i].y = this.filters[i * 2 + 1].filter(sy, t);
    }

    const palmPxRaw = analysis.palmSize * s;
    h.palmPx = reacquired ? palmPxRaw : h.palmPx + (palmPxRaw - h.palmPx) * 0.3;
    let px = 0;
    let py = 0;
    for (const i of PALM_IDS) {
      px += P[i].x;
      py += P[i].y;
    }
    h.palm = { x: px / PALM_IDS.length, y: py / PALM_IDS.length };
    h.roll = Math.atan2(P[17].y - P[5].y, P[17].x - P[5].x);
    const anchor = (tip: number, dip: number): Vec2 => add(P[tip], scale(norm(sub(P[tip], P[dip])), h.palmPx * 0.24));
    h.indexAnchor = anchor(8, 7);
    h.middleAnchor = anchor(12, 11);
    h.pointDir = norm(sub(lerpV(P[8], P[12], 0.5), h.palm));
    h.indexDir = norm(sub(P[8], P[5]));
    h.middleDir = norm(sub(P[12], P[9]));
    h.pinkyDir = norm(sub(P[20], P[17]));

    this.palmVel.push(t, h.palm.x, h.palm.y);
    this.idxVel.push(t, P[8].x, P[8].y);
    this.midVel.push(t, P[12].x, P[12].y);
    this.tipVel.push(t, (P[8].x + P[12].x) / 2, (P[8].y + P[12].y) / 2);
    this.scaleVel.push(t, Math.log(Math.max(palmPxRaw, 1)), 0);
    const pv = this.palmVel.velocity();
    const inv = 1 / Math.max(h.palmPx, 1);
    h.palmVel = scale(pv, inv);
    h.palmSpeed = len(h.palmVel);
    h.palmAccel = this.accel(t, h.palmVel);
    h.scaleRate = this.scaleVel.velocity(0.08).x;
    h.tipVel = scale(this.tipVel.velocity(0.06), inv);
    h.indexRelVel = scale(sub(this.idxVel.velocity(), pv), inv);
    h.middleRelVel = scale(sub(this.midVel.velocity(), pv), inv);
  }

  miss(): void {
    this.info.present = false;
    this.info.reacquired = false;
  }
}

export class HandProcessor {
  private slots: [HandSlot, HandSlot] = [new HandSlot(0), new HandSlot(1)];
  private primarySlot: 0 | 1 | null = null;
  private lastSeen = -Infinity;
  readonly frame: TrackFrame;

  constructor() {
    this.frame = { t: 0, hands: [], slots: [this.slots[0].info, this.slots[1].info], primary: null, lastSeen: -Infinity };
  }

  /** Assign detections to slots by proximity to where each slot's hand was, then handedness. */
  private assign(det: Detection, t: number, map: VideoMapLike, W: number): number[] {
    const n = Math.min(2, det.landmarks.length);
    const wrist = (i: number): Vec2 => {
      const l = det.landmarks[i][9];
      return { x: W - (map.dx + l.x * map.vw * map.s), y: map.dy + l.y * map.vh * map.s };
    };
    const label = (i: number) => det.handedness?.[i]?.[0]?.categoryName ?? '';
    const cost = (i: number, slot: 0 | 1): number => {
      const s = this.slots[slot].info;
      const fresh = t - s.lastSeen < 0.6;
      const natural = (label(i) === 'Left' ? 1 : 0) === slot; // label → preferred slot when nothing else is known
      if (!fresh) return 1e5 + (natural ? 0 : 1);
      const p = wrist(i);
      return Math.hypot(p.x - s.palm.x, p.y - s.palm.y) + (natural ? 0 : 5);
    };
    if (n === 1) return [cost(0, 0) <= cost(0, 1) ? 0 : 1];
    const a = cost(0, 0) + cost(1, 1);
    const b = cost(0, 1) + cost(1, 0);
    return a <= b ? [0, 1] : [1, 0];
  }

  process(det: Detection | null, t: number, map: VideoMapLike, W: number): TrackFrame {
    const f = this.frame;
    f.t = t;
    const seen = [false, false];
    if (det && det.landmarks.length > 0) {
      const slotsOf = this.assign(det, t, map, W);
      for (let i = 0; i < slotsOf.length; i++) {
        const cat = det.handedness?.[i]?.[0];
        this.slots[slotsOf[i]].update(det.landmarks[i], det.world?.[i], cat?.categoryName ?? '', cat?.score ?? 1, t, map, W);
        seen[slotsOf[i]] = true;
      }
      this.lastSeen = t;
    }
    if (!seen[0]) this.slots[0].miss();
    if (!seen[1]) this.slots[1].miss();

    f.hands = this.slots.map((s) => s.info).filter((h) => h.present);
    // the primary hand drives Blue/Red/Purple; it stays the same hand while it is visible
    if (this.primarySlot === null || !this.slots[this.primarySlot].info.present) {
      const cand = f.hands.slice().sort((a, b) => a.since - b.since)[0];
      this.primarySlot = cand ? cand.slot : this.primarySlot;
    }
    f.primary = this.primarySlot !== null && this.slots[this.primarySlot].info.present ? this.slots[this.primarySlot].info : null;
    f.lastSeen = this.lastSeen;
    return f;
  }
}
