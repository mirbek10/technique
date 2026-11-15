/**
 * Finger-state classification from 21 MediaPipe landmarks.
 * Uses 3D joint angles + reach relative to the wrist/palm (rotation tolerant),
 * not just Y coordinates. Hysteresis prevents flicker near the thresholds.
 */
export interface P3 {
  x: number;
  y: number;
  z: number;
}

export type Gesture = 'none' | 'blue' | 'blueRed' | 'open' | 'fist' | 'other';

export interface FingerStates {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

export interface HandAnalysis {
  fingers: FingerStates;
  /** palm size in source (video) pixels, used for normalisation */
  palmSize: number;
  /** distance between index & middle fingertips, normalised by palm size */
  tipGap: number;
  gesture: Gesture;
}

const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: P3, b: P3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len3 = (a: P3): number => Math.sqrt(dot(a, a));
const dist3 = (a: P3, b: P3): number => len3(sub(a, b));
const cosBetween = (a: P3, b: P3): number => {
  const l = len3(a) * len3(b);
  return l < 1e-6 ? 1 : dot(a, b) / l;
};

const FINGERS = {
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
} as const;
type FingerKey = keyof typeof FINGERS;

const NO_FINGERS: FingerStates = { thumb: false, index: false, middle: false, ring: false, pinky: false };

export class HandAnalyzer {
  private prev: FingerStates = { ...NO_FINGERS };

  analyze(p: P3[]): HandAnalysis {
    const palm = Math.max(dist3(p[0], p[9]), dist3(p[5], p[17]) * 1.5, 1e-3);

    const finger = (key: FingerKey): boolean => {
      const [m, pi, d, t] = FINGERS[key];
      const s1 = cosBetween(sub(p[pi], p[m]), sub(p[d], p[pi]));
      const s2 = cosBetween(sub(p[d], p[pi]), sub(p[t], p[d]));
      const straight = (s1 + s2) / 2; // 1 = perfectly straight
      const reach = dist3(p[0], p[t]) / Math.max(dist3(p[0], p[pi]), 1e-3);
      const tipFromMcp = dist3(p[m], p[t]) / palm;
      return this.prev[key]
        ? straight > 0.45 && reach > 1.06 && tipFromMcp > 0.42
        : straight > 0.65 && reach > 1.16 && tipFromMcp > 0.52;
    };

    // Thumb counts as extended only when it clearly sticks out away from the palm.
    const thumbSpread = dist3(p[4], p[9]) / palm;
    const thumbFromIndex = dist3(p[4], p[5]) / palm;
    const thumbStraight = cosBetween(sub(p[3], p[2]), sub(p[4], p[3]));
    const thumb = this.prev.thumb
      ? thumbSpread > 0.72 && thumbFromIndex > 0.5 && thumbStraight > 0.5
      : thumbSpread > 0.88 && thumbFromIndex > 0.62 && thumbStraight > 0.72;

    const fingers: FingerStates = {
      thumb,
      index: finger('index'),
      middle: finger('middle'),
      ring: finger('ring'),
      pinky: finger('pinky'),
    };
    this.prev = fingers;

    const { index, middle, ring, pinky } = fingers;
    const count = [index, middle, ring, pinky].filter(Boolean).length;
    let gesture: Gesture;
    if (index && middle && ring && (pinky || thumb)) gesture = 'open';
    else if (index && !middle && !ring && !pinky && !thumb) gesture = 'blue';
    else if (index && middle && !ring && !pinky) gesture = 'blueRed';
    else if (count === 0) gesture = 'fist';
    else gesture = 'other';

    return { fingers, palmSize: palm, tipGap: dist3(p[8], p[12]) / palm, gesture };
  }

  reset(): void {
    this.prev = { ...NO_FINGERS };
  }
}

/** A gesture must persist for a short confirmation time before it becomes stable. */
export class GestureDebouncer {
  stable: Gesture = 'none';
  private cand: Gesture = 'none';
  private since = 0;

  update(g: Gesture, t: number): Gesture {
    if (g !== this.cand) {
      this.cand = g;
      this.since = t;
    }
    const need = g === 'open' ? 0.06 : 0.09;
    if (this.cand !== this.stable && t - this.since >= need) this.stable = this.cand;
    return this.stable;
  }
}

export const GESTURE_LABEL: Record<Gesture, string> = {
  none: '—',
  blue: '☝️ указательный',
  blueRed: '✌️ два пальца',
  open: '🖐 ладонь',
  fist: '✊ кулак',
  other: '· · ·',
};
