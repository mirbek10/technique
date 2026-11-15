import { describe, expect, it } from 'vitest';
import { HandProcessor, computeCurl } from '../hands';
import { GestureClassifier, type GestureId } from '../gestureClassifier';
import { BLOOD, detection, makeHand, MAP, NUE, POSE, VW, type HandSpec } from './synth';

function run(hands: HandSpec[], frames = 6) {
  const hp = new HandProcessor();
  const gc = new GestureClassifier();
  let f = hp.process(detection(hands), 0, MAP, VW);
  let c = gc.classify(f);
  for (let i = 1; i < frames; i++) {
    f = hp.process(detection(hands), i / 30, MAP, VW);
    c = gc.classify(f);
  }
  return { f, ids: c.map((x) => x.id), cands: c };
}
const has = (ids: GestureId[], id: GestureId) => ids.includes(id);

describe('finger state detection (joint angles)', () => {
  it('curl is low for straight fingers and high for a fist, regardless of hand roll', () => {
    for (const roll of [0, 0.8, -1.4, Math.PI]) {
      const open = computeCurl(makeHand({ cx: 600, cy: 400, roll, ...POSE.open }).map((p) => ({ x: p.x * 1280, y: p.y * 720, z: p.z * 1280 })));
      const fist = computeCurl(makeHand({ cx: 600, cy: 400, roll, ...POSE.fist }).map((p) => ({ x: p.x * 1280, y: p.y * 720, z: p.z * 1280 })));
      expect(open.index).toBeLessThan(0.2);
      expect(open.pinky).toBeLessThan(0.2);
      expect(fist.index).toBeGreaterThan(0.8);
      expect(fist.ring).toBeGreaterThan(0.8);
    }
  });

  it('upside-down hand: bent fingers are still bent (not just "tip below knuckle")', () => {
    const { f } = run([{ cx: 600, cy: 400, roll: Math.PI, ...POSE.two }]);
    expect(f.hands[0].fingers).toMatchObject({ index: true, middle: true, ring: false, pinky: false });
  });

  it('crossed fingers are told apart from fingers that merely touch', () => {
    const crossed = run([{ cx: 600, cy: 400, ...POSE.two, cross: true }]).f.hands[0];
    const together = run([{ cx: 600, cy: 400, ...POSE.two, tipsTogether: true }]).f.hands[0];
    expect(crossed.crossed).toBeLessThan(-0.1);
    expect(together.crossed).toBeGreaterThan(0);
    expect(together.tipGap).toBeLessThan(0.24);
  });

  it('jitter of ±3 px does not make finger states flicker', () => {
    const hp = new HandProcessor();
    const gestures = new Set<string>();
    for (let i = 0; i < 90; i++) {
      const f = hp.process(detection([{ cx: 600, cy: 400, ...POSE.two, noise: 3 }]), i / 30, MAP, VW);
      if (i > 5) gestures.add(f.hands[0].gesture);
    }
    expect([...gestures]).toEqual(['blueRed']);
  });

  it('two hands keep their slots when MediaPipe swaps the output order', () => {
    const hp = new HandProcessor();
    const a: HandSpec = { cx: 300, cy: 400, ...POSE.open, left: true };
    const b: HandSpec = { cx: 950, cy: 400, ...POSE.fist };
    hp.process(detection([a, b]), 0, MAP, VW);
    const before = hp.frame.hands.map((h) => [h.slot, Math.round(h.palm.x)]);
    hp.process(detection([b, a]), 1 / 30, MAP, VW);
    const after = hp.frame.hands.map((h) => [h.slot, Math.round(h.palm.x)]);
    expect(after).toEqual(before);
  });

  it('handedness: MediaPipe label is swapped because the input frame is not mirrored', () => {
    const { f } = run([{ cx: 300, cy: 400, ...POSE.open, left: true }, { cx: 950, cy: 400, ...POSE.open }]);
    expect(f.hands.map((h) => h.side).sort()).toEqual(['L', 'R']);
  });

  it('punching toward the camera shows up as a positive scale rate', () => {
    const hp = new HandProcessor();
    for (let i = 0; i < 10; i++) hp.process(detection([{ cx: 600, cy: 400, size: 150 * Math.pow(1.09, i), ...POSE.fist }]), i / 30, MAP, VW);
    expect(hp.frame.hands[0].scaleRate).toBeGreaterThan(2);
  });
});

describe('gesture classifier', () => {
  it('recognises every sign', () => {
    expect(has(run([{ cx: 600, cy: 400, ...POSE.point }]).ids, 'blue')).toBe(true);
    expect(has(run([{ cx: 600, cy: 400, ...POSE.two }]).ids, 'slash_pose')).toBe(true);
    expect(has(run([{ cx: 600, cy: 400, ...POSE.fist }]).ids, 'fist')).toBe(true);
    expect(has(run([{ cx: 560, cy: 400, ...POSE.two, left: true }, { cx: 760, cy: 400, ...POSE.two }]).ids, 'shrine_seal')).toBe(true);
    expect(has(run([{ cx: 560, cy: 400, ...POSE.dogs, left: true }, { cx: 760, cy: 400, ...POSE.dogs }]).ids, 'dogs_sign')).toBe(true);
    expect(has(run(NUE).ids, 'nue_sign')).toBe(true);
    expect(has(run([{ cx: 480, cy: 400, ...POSE.toad, left: true }, { cx: 800, cy: 400, ...POSE.toad }]).ids, 'toad_sign')).toBe(true);
    expect(has(run(BLOOD).ids, 'blood_pose')).toBe(true);
  });

  it('Unlimited Void: crossed fingers → void_sign; touching without rotation → none (that is Hollow Purple)', () => {
    expect(run([{ cx: 600, cy: 400, ...POSE.two, cross: true }]).cands.find((c) => c.id === 'void_sign')?.detail).toBe('crossed');
    expect(has(run([{ cx: 600, cy: 400, ...POSE.two, tipsTogether: true }], 30).ids, 'void_sign')).toBe(false);
  });

  it('Unlimited Void fallback: touching tips + wrist roll', () => {
    const hp = new HandProcessor();
    const gc = new GestureClassifier();
    let ids: GestureId[] = [];
    for (let i = 0; i < 24; i++) {
      const roll = i < 8 ? 0 : Math.min(0.6, (i - 8) * 0.08);
      ids = gc.classify(hp.process(detection([{ cx: 600, cy: 400, ...POSE.two, tipsTogether: true, roll }]), i / 30, MAP, VW)).map((c) => c.id);
    }
    expect(ids).toContain('void_sign');
  });

  it('Malevolent Shrine: random closeness of hands is not a seal', () => {
    expect(has(run([{ cx: 560, cy: 400, ...POSE.open, left: true }, { cx: 760, cy: 400, ...POSE.open }]).ids, 'shrine_seal')).toBe(false);
    expect(has(run([{ cx: 560, cy: 400, ...POSE.fist, left: true }, { cx: 760, cy: 400, ...POSE.fist }]).ids, 'shrine_seal')).toBe(false);
    // right pose but hands far apart
    expect(has(run([{ cx: 200, cy: 400, ...POSE.two, left: true }, { cx: 1080, cy: 400, ...POSE.two }]).ids, 'shrine_seal')).toBe(false);
    // right pose but one hand far higher than the other
    expect(has(run([{ cx: 560, cy: 250, ...POSE.two, left: true }, { cx: 760, cy: 560, ...POSE.two }]).ids, 'shrine_seal')).toBe(false);
  });

  it('two-hand signs need two hands', () => {
    expect(has(run([{ cx: 600, cy: 400, ...POSE.dogs }]).ids, 'dogs_sign')).toBe(false);
    expect(has(run([{ cx: 600, cy: 400, ...POSE.point }]).ids, 'blood_pose')).toBe(false);
  });

  it('Piercing Blood requires parallel index fingers', () => {
    expect(has(run([{ ...BLOOD[0] }, { ...BLOOD[1], roll: 1.4 }]).ids, 'blood_pose')).toBe(false);
  });
});
