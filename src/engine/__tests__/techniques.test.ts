import { describe, expect, it } from 'vitest';
import { BLOOD, NUE, POSE, Sim, type HandSpec } from './synth';

const TWO: HandSpec = { cx: 640, cy: 400, ...POSE.two };
const SEAL: HandSpec[] = [
  { cx: 560, cy: 400, ...POSE.two, left: true },
  { cx: 760, cy: 400, ...POSE.two },
];
const DOGS: HandSpec[] = [
  { cx: 560, cy: 400, ...POSE.dogs, left: true },
  { cx: 760, cy: 400, ...POSE.dogs },
];

describe('Blue / Red / Hollow Purple (unchanged behaviour)', () => {
  it('index → BLUE, two fingers → BLUE+RED, tips together → MERGING → PURPLE_CHARGING', () => {
    const s = new Sim({ character: 'gojo' });
    s.hold([{ cx: 640, cy: 400, ...POSE.point }], 0.4);
    expect(s.state('limitless')).toBe('BLUE_ACTIVE');
    s.hold([TWO], 0.4);
    expect(s.state('limitless')).toBe('BLUE_RED_ACTIVE');
    s.hold([{ ...TWO, tipsTogether: true }], 0.3);
    expect(s.state('limitless')).toBe('MERGING');
    s.hold([{ ...TWO, tipsTogether: true }], 1.0);
    expect(s.state('limitless')).toBe('PURPLE_CHARGING');
  });

  it('a fast swipe fires the orbs', () => {
    const s = new Sim({ character: 'gojo' });
    s.hold([TWO], 0.6);
    s.move([{ ...TWO, cx: 300 }], [{ ...TWO, cx: 1000 }], 0.12);
    s.hold([{ ...TWO, cx: 1000 }], 0.07);
    expect(s.core.limitless.machine.state === 'FIRING' || s.core.limitless.machine.state === 'COOLDOWN').toBe(true);
  });

  it('Hollow Purple does not trigger Unlimited Void (tips together without wrist rotation)', () => {
    const s = new Sim({ character: 'gojo' });
    s.hold([TWO], 0.4);
    s.hold([{ ...TWO, tipsTogether: true }], 2.5);
    expect(s.state('limitless')).toMatch(/PURPLE/);
    expect(s.core.voidT.history).toEqual([]);
  });
});

describe('Unlimited Void', () => {
  it('crossed fingers held 1.2 s expand the domain; open palm 0.8 s collapses it', () => {
    const s = new Sim({ character: 'gojo' });
    s.hold([{ ...TWO, cross: true }], 1.0);
    expect(s.state('unlimitedVoid')).toBe('VOID_GESTURE_DETECTED');
    expect(s.state('limitless')).toBe('IDLE'); // the higher-priority domain won the pose
    s.hold([{ ...TWO, cross: true }], 0.4);
    expect(s.state('unlimitedVoid')).toBe('VOID_PREPARING');
    s.hold([{ ...TWO, cross: true }], 2.1);
    expect(s.state('unlimitedVoid')).toBe('VOID_ACTIVE');
    expect(s.cines).toContain('UNLIMITED VOID');
    // other attacks are blocked while the domain is active
    s.hold([{ cx: 640, cy: 400, ...POSE.point }], 1);
    expect(s.state('limitless')).toBe('IDLE');
    s.hold([{ cx: 640, cy: 400, ...POSE.open }], 0.5);
    expect(s.state('unlimitedVoid')).toBe('VOID_ACTIVE');
    s.hold([{ cx: 640, cy: 400, ...POSE.open }], 0.5);
    expect(s.state('unlimitedVoid')).toBe('VOID_COLLAPSING');
    s.hold([{ cx: 640, cy: 400, ...POSE.open }], 1.5);
    expect(s.state('unlimitedVoid')).toBe('VOID_IDLE');
  });

  it('fallback: tips together + wrist roll interrupts a Blue orb that is not yet Purple', () => {
    const s = new Sim({ character: 'gojo' });
    s.hold([{ ...TWO, tipsTogether: true }], 0.3);
    expect(s.state('limitless')).not.toBe('IDLE');
    s.move([{ ...TWO, tipsTogether: true }], [{ ...TWO, tipsTogether: true, roll: 0.6 }], 0.3);
    s.hold([{ ...TWO, tipsTogether: true, roll: 0.6 }], 0.4);
    expect(s.state('unlimitedVoid')).toBe('VOID_GESTURE_DETECTED');
    expect(s.state('limitless')).toBe('IDLE');
  });

  it('short tracking dropouts do not cancel the hold; a long loss does', () => {
    const s = new Sim({ character: 'gojo' });
    s.hold([{ ...TWO, cross: true }], 0.5);
    s.hold(null, 0.1); // 3 frames without hands
    s.hold([{ ...TWO, cross: true }], 0.9);
    expect(s.state('unlimitedVoid')).toBe('VOID_PREPARING');

    const s2 = new Sim({ character: 'gojo' });
    s2.hold([{ ...TWO, cross: true }], 0.5);
    s2.hold(null, 0.7);
    expect(s2.state('unlimitedVoid')).toBe('VOID_IDLE');
  });

  it('domain survives brief hand loss and collapses after a long one', () => {
    const s = new Sim({ character: 'gojo' });
    s.hold([{ ...TWO, cross: true }], 3.6);
    expect(s.state('unlimitedVoid')).toBe('VOID_ACTIVE');
    s.hold(null, 2);
    expect(s.state('unlimitedVoid')).toBe('VOID_ACTIVE');
    s.hold(null, 5);
    expect(s.state('unlimitedVoid')).toMatch(/COLLAPSING|IDLE/);
  });
});

describe('Dismantle', () => {
  it('slow hand movement never cuts', () => {
    const s = new Sim({ character: 'sukuna' });
    s.hold([{ ...TWO, cx: 300 }], 0.4);
    s.move([{ ...TWO, cx: 300 }], [{ ...TWO, cx: 1000 }], 1.6);
    s.move([{ ...TWO, cx: 1000, cy: 400 }], [{ ...TWO, cx: 500, cy: 200 }], 1.2);
    expect(s.core.dismantle.slashes).toBe(0);
  });

  it('a fast stroke cuts once along the real trajectory', () => {
    const s = new Sim({ character: 'sukuna' });
    s.hold([{ ...TWO, cx: 300 }], 0.4);
    s.move([{ ...TWO, cx: 300 }], [{ ...TWO, cx: 1000 }], 0.13);
    s.hold([{ ...TWO, cx: 1000 }], 0.5);
    expect(s.core.dismantle.slashes).toBe(1);
  });

  it('one long movement = one cut (no repeated shots)', () => {
    const s = new Sim({ character: 'sukuna' });
    s.hold([{ ...TWO, cx: 150 }], 0.4);
    s.move([{ ...TWO, cx: 150 }], [{ ...TWO, cx: 1150 }], 0.4);
    s.hold([{ ...TWO, cx: 1150 }], 0.5);
    expect(s.core.dismantle.slashes).toBe(1);
  });

  it('three quick strokes → TRIPLE DISMANTLE', () => {
    const s = new Sim({ character: 'sukuna' });
    s.hold([{ ...TWO, cx: 300 }], 0.4);
    const a = { ...TWO, cx: 300, cy: 300 };
    const b = { ...TWO, cx: 1000, cy: 500 };
    s.move([a], [b], 0.13);
    s.hold([b], 0.4);
    s.move([b], [a], 0.13);
    s.hold([a], 0.4);
    s.move([a], [b], 0.13);
    s.hold([b], 0.2);
    expect(s.core.dismantle.slashes).toBe(3);
    expect(s.cines).toContain('TRIPLE DISMANTLE');
  });

  it('is not available to Gojo (no conflict with Red)', () => {
    const s = new Sim({ character: 'gojo' });
    s.hold([{ ...TWO, cx: 300 }], 0.4);
    s.move([{ ...TWO, cx: 300 }], [{ ...TWO, cx: 1000 }], 0.13);
    expect(s.core.dismantle.slashes).toBe(0);
    expect(s.core.resolver.last.rejected.join(' ')).not.toContain('Dismantle: cooldown');
  });

  it('ALL mode: two-finger pose goes to Blue/Red unless Dismantle is explicitly selected', () => {
    const s = new Sim({ character: 'all' });
    s.hold([{ ...TWO, cx: 300 }], 0.4);
    s.move([{ ...TWO, cx: 300 }], [{ ...TWO, cx: 1000 }], 0.13);
    expect(s.core.dismantle.slashes).toBe(0);
    const s2 = new Sim({ character: 'all', allPoseMode: 'dismantle' });
    s2.hold([{ ...TWO, cx: 300 }], 0.4);
    s2.move([{ ...TWO, cx: 300 }], [{ ...TWO, cx: 1000 }], 0.13);
    s2.hold([{ ...TWO, cx: 1000 }], 0.3);
    expect(s2.core.dismantle.slashes).toBe(1);
  });
});

describe('Black Flash', () => {
  const FIST: HandSpec = { cx: 640, cy: 400, size: 150, ...POSE.fist };
  const punch = (s: Sim) => {
    for (let i = 1; i <= 5; i++) s.frame([{ ...FIST, size: 150 * Math.pow(1.13, i) }]);
  };
  const back = (s: Sim) => s.move([{ ...FIST, size: 150 * Math.pow(1.13, 5) }], [FIST], 1.2);

  it('a clenched fist without fast motion never fires', () => {
    const s = new Sim({ character: 'yuji' });
    s.hold([FIST], 3);
    s.move([FIST], [{ ...FIST, cx: 800 }], 1.0);
    expect(s.core.blackFlash.hits).toBe(0);
    expect(s.state('blackFlash')).toBe('FLASH_CHARGING');
  });

  it('a punch right after clenching (< 300 ms) does not fire', () => {
    const s = new Sim({ character: 'yuji' });
    s.hold([FIST], 0.12);
    punch(s);
    expect(s.core.blackFlash.hits).toBe(0);
  });

  it('forward punch after holding the fist fires BLACK FLASH', () => {
    const s = new Sim({ character: 'yuji' });
    s.hold([FIST], 0.5);
    punch(s);
    expect(s.core.blackFlash.hits).toBe(1);
    expect(s.cines).toContain('BLACK FLASH!');
  });

  it('a sideways strike also counts', () => {
    const s = new Sim({ character: 'yuji' });
    s.hold([{ ...FIST, cx: 300 }], 0.5);
    s.move([{ ...FIST, cx: 300 }], [{ ...FIST, cx: 1000 }], 0.12);
    expect(s.core.blackFlash.hits).toBe(1);
  });

  it('combo: second hit within 3 s → DOUBLE, a pause longer than 3 s resets it', () => {
    const s = new Sim({ character: 'yuji' });
    s.hold([FIST], 0.5);
    punch(s);
    back(s);
    s.hold([FIST], 0.3);
    punch(s);
    expect(s.core.blackFlash.hits).toBe(2);
    expect(s.cines).toContain('DOUBLE BLACK FLASH!');
    back(s);
    s.hold([FIST], 3.2);
    punch(s);
    expect(s.cines[s.cines.length - 1]).toBe('BLACK FLASH!');
  });

  it('one punch = one hit even if the hand keeps approaching', () => {
    const s = new Sim({ character: 'yuji' });
    s.hold([FIST], 0.5);
    for (let i = 1; i <= 14; i++) s.frame([{ ...FIST, size: 150 * Math.pow(1.1, i) }]);
    expect(s.core.blackFlash.hits).toBe(1);
  });
});

describe('Piercing Blood', () => {
  it('pose 0.8 s → compression accumulates to 100% over 1.5 s', () => {
    const s = new Sim({ character: 'choso' });
    s.hold(BLOOD, 0.6);
    expect(s.state('piercingBlood')).toBe('BLOOD_POSE_DETECTED');
    s.hold(BLOOD, 0.4);
    expect(s.state('piercingBlood')).toBe('BLOOD_COMPRESSING');
    s.hold(BLOOD, 0.7);
    const mid = s.core.blood.charge;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.75);
    s.hold(BLOOD, 1.0);
    expect(s.state('piercingBlood')).toBe('BLOOD_READY');
    expect(s.core.blood.charge).toBe(1);
  });

  it('pulling the hands apart fires; full charge = full power', () => {
    const s = new Sim({ character: 'choso' });
    s.hold(BLOOD, 2.7);
    s.move(BLOOD, [{ ...BLOOD[0], cx: 150 }, { ...BLOOD[1], cx: 1100 }], 0.15);
    expect(s.core.blood.shots).toBe(1);
    expect(s.core.blood.lastPower).toBe(1);
  });

  it('separating early fires a weaker shot', () => {
    const s = new Sim({ character: 'choso' });
    s.hold(BLOOD, 1.5);
    s.move(BLOOD, [{ ...BLOOD[0], cx: 150 }, { ...BLOOD[1], cx: 1100 }], 0.15);
    expect(s.core.blood.shots).toBe(1);
    expect(s.core.blood.lastPower).toBeLessThan(0.8);
  });

  it('losing the hands for > 500 ms cancels the compression', () => {
    const s = new Sim({ character: 'choso' });
    s.hold(BLOOD, 1.5);
    s.hold(null, 0.7);
    expect(s.state('piercingBlood')).toBe('BLOOD_IDLE');
    expect(s.core.blood.shots).toBe(0);
  });
});

describe('Ten Shadows', () => {
  it('Divine Dogs: sign 0.9 s → portal → summon → active → disappear; one summon at a time; 2 s cooldown; no loop while holding', () => {
    const s = new Sim({ character: 'megumi' });
    s.hold(DOGS, 1.1);
    expect(s.state('tenShadows')).toBe('SHADOW_PORTAL_OPENING');
    s.hold(DOGS, 1.3);
    expect(s.state('tenShadows')).toBe('SHIKIGAMI_ACTIVE');
    s.hold(NUE, 1.5); // another sign while a shikigami is active is ignored
    expect(s.core.shadows.kind).toBe('dogs');
    s.hold(DOGS, 4); // holding the sign through the end must not re-summon
    expect(s.core.shadows.summons).toEqual(['dogs']);
    s.hold(null, 0.3);
    s.hold(DOGS, 1.1);
    expect(s.state('tenShadows')).toBe('SHADOW_PORTAL_OPENING');
    expect(s.core.shadows.summons).toEqual(['dogs']);
  });

  it('cooldown of 2 s after a summon', () => {
    const s = new Sim({ character: 'megumi' });
    s.hold(DOGS, 1.1);
    s.hold(null, 4.4); // summon plays out without hands
    expect(s.state('tenShadows')).toBe('SHADOW_IDLE');
    expect(s.core.shadows.cooldownLeft(s.t)).toBeGreaterThan(0);
    s.hold(DOGS, 1.0);
    expect(s.state('tenShadows')).toBe('SHADOW_IDLE');
    expect(s.core.resolver.last.rejected.join(' ')).toContain('cooldown');
  });

  it('Nue and Toad signs', () => {
    const s = new Sim({ character: 'megumi' });
    s.hold(NUE, 1.2);
    expect(s.core.shadows.kind).toBe('nue');
    expect(s.state('tenShadows')).toBe('SHADOW_PORTAL_OPENING');
    const s2 = new Sim({ character: 'megumi' });
    s2.hold([{ cx: 480, cy: 400, ...POSE.toad, left: true }, { cx: 800, cy: 400, ...POSE.toad }], 1.2);
    expect(s2.core.shadows.kind).toBe('toad');
  });

  it('needs the two-hand sign (one hand is not enough)', () => {
    const s = new Sim({ character: 'megumi' });
    s.hold([DOGS[1]], 2);
    expect(s.state('tenShadows')).toBe('SHADOW_IDLE');
  });
});

describe('Malevolent Shrine', () => {
  it('random closeness of the hands does not summon', () => {
    const s = new Sim({ character: 'sukuna' });
    s.hold([{ ...SEAL[0], ...POSE.open }, { ...SEAL[1], ...POSE.open }], 3);
    s.hold([{ ...SEAL[0], ...POSE.fist }, { ...SEAL[1], ...POSE.fist }], 3);
    expect(s.core.shrine.history).toEqual([]);
  });

  it('a seal released before 1.5 s does not summon', () => {
    const s = new Sim({ character: 'sukuna' });
    s.hold(SEAL, 1.0);
    s.hold(null, 1);
    expect(s.state('malevolentShrine')).toBe('SHRINE_IDLE');
    expect(s.core.shrine.history).not.toContain('SHRINE_SUMMONING');
  });

  it('seal 1.5 s → summon → 8 s active → ends; both palms open end it early', () => {
    const s = new Sim({ character: 'sukuna' });
    s.hold(SEAL, 1.8);
    expect(s.state('malevolentShrine')).toBe('SHRINE_SUMMONING');
    s.hold(null, 2);
    expect(s.state('malevolentShrine')).toBe('SHRINE_ACTIVE');
    expect(s.core.shrine.slashes).toBeGreaterThan(0);
    s.hold([{ ...SEAL[0], ...POSE.open }, { ...SEAL[1], ...POSE.open }], 1.2);
    expect(s.state('malevolentShrine')).toBe('SHRINE_ENDING');
  });

  it('runs for 8 s on its own', () => {
    const s = new Sim({ character: 'sukuna' });
    s.hold(SEAL, 1.8);
    s.hold(null, 1.8 + 8.1);
    expect(s.state('malevolentShrine')).toMatch(/ENDING|IDLE/);
  });

  it('the seal interrupts a Dismantle pose raised a moment earlier (two-hand sign has priority)', () => {
    const s = new Sim({ character: 'sukuna' });
    s.hold([SEAL[1]], 0.4);
    expect(s.state('dismantle')).not.toBe('SLASH_IDLE');
    s.hold(SEAL, 2.0);
    expect(s.state('malevolentShrine')).toMatch(/SUMMONING|CHARGING/);
  });

  it('Dismantle during the domain only with DOMAIN_COMBOS', () => {
    for (const domainCombos of [false, true]) {
      const s = new Sim({ character: 'sukuna', domainCombos });
      s.hold(SEAL, 1.8);
      s.hold(null, 2);
      s.hold([{ ...TWO, cx: 300 }], 0.4);
      s.move([{ ...TWO, cx: 300 }], [{ ...TWO, cx: 1000 }], 0.13);
      s.hold([{ ...TWO, cx: 1000 }], 0.3);
      expect(s.core.dismantle.slashes).toBe(domainCombos ? 1 : 0);
    }
  });
});

describe('resolver & characters', () => {
  it('single-character mode rejects other characters’ gestures with a reason', () => {
    const s = new Sim({ character: 'gojo' });
    s.hold([{ cx: 640, cy: 400, ...POSE.fist }], 1);
    expect(s.state('blackFlash')).toBe('FLASH_IDLE');
    expect(s.core.resolver.last.rejected.join(' ')).toContain('Black Flash: не техника персонажа');
  });

  it('switching character cancels the previous techniques without resetting tracking', () => {
    const s = new Sim({ character: 'gojo' });
    s.hold([{ cx: 640, cy: 400, ...POSE.point }], 0.5);
    expect(s.state('limitless')).toBe('BLUE_ACTIVE');
    const handSince = s.core.track.hands[0].since;
    s.core.setSettings({ ...s.core.settings, character: 'yuji' }, s.t);
    expect(s.state('limitless')).toBe('IDLE');
    s.hold([{ cx: 640, cy: 400, ...POSE.point }], 0.3);
    expect(s.core.track.hands[0].since).toBe(handSince);
    expect(s.state('limitless')).toBe('IDLE');
  });

  it('ALL mode: two-hand sign wins over a single-hand pose', () => {
    const s = new Sim({ character: 'all' });
    s.hold(BLOOD, 0.5);
    expect(s.state('piercingBlood')).toBe('BLOOD_POSE_DETECTED');
    expect(s.state('limitless')).toBe('IDLE');
  });

  it('ALL mode needs a longer confirmation for complex signs', () => {
    const solo = new Sim({ character: 'megumi' });
    const all = new Sim({ character: 'all' });
    solo.hold(DOGS, 1.1);
    all.hold(DOGS, 1.1);
    expect(solo.state('tenShadows')).toBe('SHADOW_PORTAL_OPENING');
    expect(all.state('tenShadows')).toBe('SHADOW_SIGN_DETECTED');
    all.hold(DOGS, 0.3);
    expect(all.state('tenShadows')).toBe('SHADOW_PORTAL_OPENING');
  });

  it('no hands at all for a long time leaves everything idle (no stuck states)', () => {
    const s = new Sim({ character: 'all' });
    s.hold([{ cx: 640, cy: 400, ...POSE.fist }], 0.6);
    s.hold(null, 2);
    for (const t of s.core.techs) if (t.meta.id !== 'limitless') expect(t.engaged()).toBe(false);
    s.hold(null, 1);
    expect(s.state('limitless')).toBe('IDLE');
  });
});
