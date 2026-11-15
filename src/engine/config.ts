/**
 * Every gesture threshold of the new techniques lives here.
 * Units: distances in palm widths, speeds in palm widths per second, times in seconds.
 * "_IN" / "_OUT" pairs are hysteresis: a stricter value to enter a state, a looser one to stay in it.
 *
 * The values were tuned on synthetic landmark sequences (see src/engine/__tests__) and are meant to be
 * adjusted on real hands: the debug panel exposes global hold/motion multipliers, and anything here can be
 * changed at runtime through `GESTURE_CFG` (e.g. from the browser console: `__gojo.cfg.DISMANTLE.SPEED_IN = 8`).
 */
export const GESTURE_CFG = {
  /** global */
  MIN_CONFIDENCE_IN: 0.55,
  MIN_CONFIDENCE_OUT: 0.38,
  /** keep a pose through short tracking dropouts / misclassified frames */
  POSE_GRACE: 0.18,
  /** hands missing this long → tracked effects fade and pending gestures cancel */
  LOST_GRACE: 0.5,

  RESOLVER: {
    /** a candidate must be the winner this long before a technique is granted */
    STABLE: 0.06,
    /** …longer when two techniques of the same priority match the same pose */
    AMBIGUOUS_STABLE: 0.3,
    /** …and longer still to interrupt an engaged, non-critical technique */
    PREEMPT_STABLE: 0.16,
    /** winner may vanish this long without resetting its stability timer */
    DROPOUT: 0.12,
    /** confidence gap under which two same-priority candidates count as ambiguous */
    AMBIGUITY_GAP: 0.15,
  },

  /** finger curl from joint angles: 0 = straight, 1 = fully bent */
  CURL: {
    BENT_IN: 0.5,
    BENT_OUT: 0.4,
  },

  VOID: {
    /** lateral order of index/middle tips relative to their knuckles; negative = crossed */
    CROSS_IN: -0.06,
    CROSS_OUT: 0.0,
    /** fallback: tips together + wrist roll */
    TIPS_CLOSE: 0.24,
    ROLL_MIN: 0.38, // ≈22°
    HOLD: 1.2,
    PREPARE: 1.0,
    EXPAND: 1.0,
    MIN_ACTIVE: 1.6,
    OPEN_HOLD: 0.8,
    COLLAPSE: 1.3,
    COOLDOWN: 1.5,
    /** domain survives this long without any hand before collapsing */
    NO_HAND_COLLAPSE: 6,
  },

  SHRINE: {
    PALM_DIST_MAX: 2.1,
    PALM_DIST_IN: 1.5,
    HEIGHT_DIFF_MAX: 0.9,
    /** pointing directions must mirror each other (cos of the mirrored angle) */
    SYMMETRY_MIN: 0.55,
    STABLE_GESTURE: 0.2,
    HOLD: 1.5,
    SUMMON: 1.7,
    ACTIVE: 8,
    ENDING: 1.3,
    OPEN_HOLD: 1.0,
    COOLDOWN: 2,
    SLASH_INTERVAL: 0.34,
  },

  DISMANTLE: {
    POSE_ARM: 0.1,
    /** fingertip speed to start a stroke / end it */
    SPEED_IN: 10,
    SPEED_OUT: 4.5,
    MIN_FRAMES: 2,
    MIN_LENGTH: 1.4,
    MAX_STROKE: 0.32,
    COOLDOWN: 0.28,
    TRIPLE_WINDOW: 1.4,
  },

  BLACK_FLASH: {
    FIST_HOLD: 0.3,
    /** forward punch: palm scale growth per second */
    SCALE_RATE_IN: 2.4,
    /** sideways punch: palm speed */
    SPEED_IN: 9,
    ACCEL_IN: 45,
    REARM_SPEED: 3.5,
    MIN_FRAMES: 2,
    IMPACT: 0.32,
    RECOVERY: 0.38,
    COMBO_WINDOW: 3,
    POSE_GRACE: 0.22,
  },

  BLOOD: {
    PALM_DIST_MAX: 2.4,
    PARALLEL_MIN: 0.72,
    POSE_HOLD: 0.8,
    COMPRESS: 1.5,
    /** palm distance growth that releases the shot */
    SEPARATE_RATE: 3.2,
    SEPARATE_RATIO: 1.45,
    MIN_CHARGE_SHOT: 0.12,
    FIRING: 0.55,
    COOLDOWN: 0.8,
  },

  SHADOWS: {
    DOGS_DIST_MAX: 2.0,
    DOGS_HOLD: 0.9,
    NUE_THUMB_GAP: 0.75,
    NUE_SPREAD_MIN: 0.42, // rad between index and pinky directions
    NUE_HOLD: 1.0,
    TOAD_GAP_MIN: 0.7,
    TOAD_GAP_MAX: 3.2,
    TOAD_HOLD: 1.0,
    PORTAL: 0.6,
    SUMMON: 0.55,
    DISAPPEAR: 0.7,
    COOLDOWN: 2,
    /** time the shikigami stays and the moment (since it appeared) it attacks */
    DOGS_ACTIVE: 2.4,
    DOGS_ATTACK: 1.05,
    NUE_ACTIVE: 2.6,
    NUE_STRIKE: 1.25,
    TOAD_ACTIVE: 2.2,
    TOAD_TONGUE: 0.55,
  },
};

export type GestureConfig = typeof GESTURE_CFG;
