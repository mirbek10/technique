/**
 * Gesture Classifier: turns processed hands into a list of candidate gestures with a confidence.
 * Several candidates can be present at once — the resolver picks the one that may act.
 */
import { GESTURE_CFG as CFG } from './config';
import type { HandInfo, TrackFrame } from './hands';
import { dist } from './math';

export type GestureId =
  | 'blue'
  | 'blueRed'
  | 'slash_pose'
  | 'fist'
  | 'open_palm'
  | 'open_both'
  | 'void_sign'
  | 'shrine_seal'
  | 'dogs_sign'
  | 'nue_sign'
  | 'toad_sign'
  | 'blood_pose';

export interface GestureCandidate {
  id: GestureId;
  confidence: number;
  /** slot ids of the hands that form the gesture */
  hands: number[];
  detail?: string;
}

/** 0 at `a`, 1 at `b` (works for decreasing ranges too). */
export const ramp = (x: number, a: number, b: number): number => {
  const u = (x - a) / (b - a);
  return u < 0 ? 0 : u > 1 ? 1 : u;
};
const blend = (fs: number[]): number => {
  let mn = 1;
  let sum = 0;
  for (const f of fs) {
    if (f < mn) mn = f;
    sum += f;
  }
  return mn * 0.6 + (sum / fs.length) * 0.4;
};

const isSlashPose = (h: HandInfo) => h.fingers.index && h.fingers.middle && !h.fingers.ring && !h.fingers.pinky;
const isPointPose = (h: HandInfo) => h.fingers.index && !h.fingers.middle && !h.fingers.ring && !h.fingers.pinky;
const isOpen = (h: HandInfo) => h.gesture === 'open' || (h.fingers.index && h.fingers.middle && h.fingers.ring && h.fingers.pinky);
const curlScore = (bent: number[], straight: number[]): number => {
  const fs: number[] = [];
  for (const c of bent) fs.push(ramp(c, 0.25, 0.55));
  for (const c of straight) fs.push(ramp(c, 0.6, 0.3));
  return blend(fs);
};

interface VoidTrack {
  baseSince: number | null;
  baseLast: number;
  roll0: number;
}

export class GestureClassifier {
  private active = new Set<string>();
  private voidTrack: [VoidTrack, VoidTrack] = [
    { baseSince: null, baseLast: -Infinity, roll0: 0 },
    { baseSince: null, baseLast: -Infinity, roll0: 0 },
  ];
  last: GestureCandidate[] = [];

  reset(): void {
    this.active.clear();
    this.last = [];
  }

  /** Hysteresis on confidence: entering needs MIN_CONFIDENCE_IN, staying only MIN_CONFIDENCE_OUT. */
  private push(out: GestureCandidate[], next: Set<string>, c: GestureCandidate): void {
    const key = `${c.id}:${c.hands.join(',')}`;
    const need = this.active.has(key) ? CFG.MIN_CONFIDENCE_OUT : CFG.MIN_CONFIDENCE_IN;
    if (c.confidence >= need) {
      out.push(c);
      next.add(key);
    }
  }

  classify(f: TrackFrame): GestureCandidate[] {
    const out: GestureCandidate[] = [];
    const next = new Set<string>();
    const t = f.t;

    const p = f.primary;
    if (p) {
      if (p.gesture === 'blue') this.push(out, next, { id: 'blue', confidence: 1, hands: [p.slot] });
      if (p.gesture === 'blueRed') this.push(out, next, { id: 'blueRed', confidence: 1, hands: [p.slot] });
    }

    for (const h of f.hands) {
      const c = h.curl;
      if (isSlashPose(h))
        this.push(out, next, { id: 'slash_pose', confidence: curlScore([c.ring, c.pinky], [c.index, c.middle]), hands: [h.slot] });
      if (!h.fingers.index && !h.fingers.middle && !h.fingers.ring && !h.fingers.pinky) {
        const avg = (c.index + c.middle + c.ring + c.pinky) / 4;
        this.push(out, next, { id: 'fist', confidence: ramp(avg, 0.3, 0.55), hands: [h.slot] });
      }
      if (isOpen(h)) this.push(out, next, { id: 'open_palm', confidence: curlScore([], [c.index, c.middle, c.ring, c.pinky]), hands: [h.slot] });
      this.voidSign(out, next, h, t);
    }

    if (f.hands.length === 2) this.twoHands(out, next, f.hands[0], f.hands[1]);

    this.active = next;
    this.last = out;
    return out;
  }

  /**
   * Unlimited Void: index & middle up, ring & pinky bent, and either
   *  (a) the fingers are truly crossed (tip order swapped along the knuckle line), or
   *  (b) fallback for 2D ambiguity: tips together + the wrist rolled since the pose began.
   * (b) is what keeps it apart from Hollow Purple, which is "tips together without rotation".
   */
  private voidSign(out: GestureCandidate[], next: Set<string>, h: HandInfo, t: number): void {
    const c = h.curl;
    const vt = this.voidTrack[h.slot];
    const upright = (h.fingers.index || c.index < 0.45) && (h.fingers.middle || c.middle < 0.45);
    const base = upright && !h.fingers.ring && !h.fingers.pinky;
    const tipsClose = h.tipGap < CFG.VOID.TIPS_CLOSE;
    if (base && (tipsClose || h.crossed < CFG.VOID.CROSS_OUT)) {
      if (vt.baseSince === null || t - vt.baseLast > 0.25) {
        vt.baseSince = t;
        vt.roll0 = h.roll;
      }
      vt.baseLast = t;
    } else if (t - vt.baseLast > 0.25) vt.baseSince = null;
    if (!base) return;

    const key = `void_sign:${h.slot}`;
    const wasCrossed = this.active.has(key);
    const crossLimit = wasCrossed ? CFG.VOID.CROSS_OUT : CFG.VOID.CROSS_IN;
    const bent = curlScore([c.ring, c.pinky], []);
    if (h.crossReliability > 0.5 && h.crossed < crossLimit) {
      const depth = ramp(h.crossed, CFG.VOID.CROSS_OUT, CFG.VOID.CROSS_IN - 0.08);
      this.push(out, next, { id: 'void_sign', confidence: blend([bent, Math.max(depth, wasCrossed ? 0.6 : 0), h.crossReliability]), hands: [h.slot], detail: 'crossed' });
      return;
    }
    if (tipsClose && vt.baseSince !== null) {
      let d = h.roll - vt.roll0;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const rot = ramp(Math.abs(d), CFG.VOID.ROLL_MIN * 0.6, CFG.VOID.ROLL_MIN);
      if (rot > 0 || wasCrossed) {
        // once confirmed by rotation the user may settle the wrist; keep it while tips stay together
        const conf = blend([bent, wasCrossed ? Math.max(rot, 0.7) : rot, ramp(h.tipGap, CFG.VOID.TIPS_CLOSE, CFG.VOID.TIPS_CLOSE * 0.6)]);
        this.push(out, next, { id: 'void_sign', confidence: conf, hands: [h.slot], detail: 'rotated' });
      }
    }
  }

  private twoHands(out: GestureCandidate[], next: Set<string>, a: HandInfo, b: HandInfo): void {
    const palm = (a.palmPx + b.palmPx) / 2;
    const d = dist(a.palm, b.palm) / palm;
    const hands = [a.slot, b.slot];
    const ca = a.curl;
    const cb = b.curl;

    if (isOpen(a) && isOpen(b)) this.push(out, next, { id: 'open_both', confidence: 1, hands });

    // Malevolent Shrine — simplified seal: both hands index+middle up, the rest bent, palms close and mirrored
    if (isSlashPose(a) && isSlashPose(b)) {
      const S = CFG.SHRINE;
      const near = ramp(d, S.PALM_DIST_MAX, S.PALM_DIST_IN);
      const level = ramp(Math.abs(a.palm.y - b.palm.y) / palm, S.HEIGHT_DIFF_MAX, S.HEIGHT_DIFF_MAX * 0.4);
      // mirror b's direction across the vertical axis, then compare
      const sym = a.pointDir.x * -b.pointDir.x + a.pointDir.y * b.pointDir.y;
      const symmetry = ramp(sym, S.SYMMETRY_MIN - 0.25, S.SYMMETRY_MIN + 0.15);
      const fs = [near, level, symmetry, curlScore([ca.ring, ca.pinky, cb.ring, cb.pinky], [])];
      // palms facing each other: normals roughly along the line between the hands (soft bonus, sign-free)
      if (a.normal && b.normal) fs.push(0.5 + 0.5 * ramp(Math.min(Math.abs(a.normal.x), Math.abs(b.normal.x)), 0.15, 0.6));
      this.push(out, next, { id: 'shrine_seal', confidence: blend(fs), hands });
    }

    // Divine Dogs: index + pinky up, middle + ring bent, hands together
    const dogs = (h: HandInfo) => h.fingers.index && h.fingers.pinky && !h.fingers.middle && !h.fingers.ring;
    if (dogs(a) && dogs(b)) {
      const conf = blend([ramp(d, CFG.SHADOWS.DOGS_DIST_MAX, CFG.SHADOWS.DOGS_DIST_MAX * 0.6), curlScore([ca.middle, ca.ring, cb.middle, cb.ring], [ca.index, ca.pinky, cb.index, cb.pinky])]);
      this.push(out, next, { id: 'dogs_sign', confidence: conf, hands });
    }

    // Nue: both palms open, thumbs joined, fingers spread like wings
    if (isOpen(a) && isOpen(b)) {
      const thumbs = dist(a.pts[4], b.pts[4]) / palm;
      const spread = (h: HandInfo) => Math.acos(Math.max(-1, Math.min(1, h.indexDir.x * h.pinkyDir.x + h.indexDir.y * h.pinkyDir.y)));
      const conf = blend([
        ramp(thumbs, CFG.SHADOWS.NUE_THUMB_GAP, CFG.SHADOWS.NUE_THUMB_GAP * 0.5),
        ramp(Math.min(spread(a), spread(b)), CFG.SHADOWS.NUE_SPREAD_MIN * 0.7, CFG.SHADOWS.NUE_SPREAD_MIN),
      ]);
      this.push(out, next, { id: 'nue_sign', confidence: conf, hands });
    }

    // Toad: index + middle bent on both hands (ring/pinky up so it is not a fist), hands near but apart
    const toad = (h: HandInfo) => !h.fingers.index && !h.fingers.middle && (h.fingers.ring || h.fingers.pinky);
    if (toad(a) && toad(b)) {
      const T = CFG.SHADOWS;
      const gap = Math.min(ramp(d, T.TOAD_GAP_MIN * 0.8, T.TOAD_GAP_MIN), ramp(d, T.TOAD_GAP_MAX, T.TOAD_GAP_MAX * 0.85));
      this.push(out, next, { id: 'toad_sign', confidence: blend([gap, curlScore([ca.index, ca.middle, cb.index, cb.middle], [])]), hands });
    }

    // Piercing Blood: both index fingers out and parallel, hands together
    if (isPointPose(a) && isPointPose(b)) {
      const B = CFG.BLOOD;
      const par = a.indexDir.x * b.indexDir.x + a.indexDir.y * b.indexDir.y;
      const conf = blend([
        ramp(d, B.PALM_DIST_MAX, B.PALM_DIST_MAX * 0.6),
        ramp(par, B.PARALLEL_MIN - 0.15, B.PARALLEL_MIN + 0.1),
        curlScore([ca.middle, ca.ring, cb.middle, cb.ring], [ca.index, cb.index]),
      ]);
      this.push(out, next, { id: 'blood_pose', confidence: conf, hands });
    }
  }
}

export const GESTURE_NAMES: Record<GestureId, string> = {
  blue: '☝️ указательный',
  blueRed: '✌️ два пальца',
  slash_pose: '✌️ поза разреза',
  fist: '✊ кулак',
  open_palm: '🖐 ладонь',
  open_both: '🖐🖐 обе ладони',
  void_sign: '🤞 печать пустоты',
  shrine_seal: '🙏 печать святыни',
  dogs_sign: '🤘🤘 псы',
  nue_sign: '🕊 нуэ',
  toad_sign: '🐸 жаба',
  blood_pose: '☝️☝️ кровь',
};
