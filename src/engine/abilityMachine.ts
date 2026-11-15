import type { AbilityState, OrbKind, Vec2 } from './types';
import type { Gesture } from './gestures';
import { len, norm } from './math';

/** All thresholds in one place. Distances are in palm units, speeds in palm-units per second. */
export const TH = {
  SEPARATED: 0.32, // tip gap needed to spawn the RED orb
  MERGE_ENTER: 0.22, // tips this close start merging
  MERGE_EXIT: 0.3, // merging decays when tips move further than this
  SPREAD: 0.36, // spreading fingers after merge → PURPLE_READY
  SWIPE: 7.5, // whole-hand speed that counts as a throw
  FLICK: 7, // single-finger speed relative to the palm
  FLICK_PALM_MAX: 4, // palm must be fairly still for a finger flick
  ARM_TIME: 0.35, // orb must exist this long before it can fire
  RELEASE_TIME: 0.3, // gesture lost this long → orb released
  LOST_GRACE: 0.35, // hand missing this long → orbs start fading
  LOST_RESET: 1.4, // hand missing this long → abilities reset
  MERGE_TIME: 0.9,
  CHARGE_TIME: 2.6,
  ORB_CHARGE_TIME: 2.0,
  FIRING_TIME: 0.22,
} as const;

export interface HandFrame {
  t: number;
  gesture: Gesture;
  tipGap: number;
  indexAnchor: Vec2;
  middleAnchor: Vec2;
  palm: Vec2;
  palmPx: number;
  pointDir: Vec2;
  /** palm velocity, palm-units/s */
  palmVel: Vec2;
  /** fingertip velocity relative to the palm, palm-units/s */
  indexRelVel: Vec2;
  middleRelVel: Vec2;
}

export type FireMethod = 'swipe' | 'flick' | 'unfold';

export type MachineEvent =
  | { type: 'fire'; kind: OrbKind; dir: Vec2; power: number; method: FireMethod }
  | { type: 'mergeStart' }
  | { type: 'merged' }
  | { type: 'dissipate' }
  | { type: 'state'; state: AbilityState };

const ORB_STATES: AbilityState[] = ['BLUE_ACTIVE', 'BLUE_RED_ACTIVE', 'MERGING', 'PURPLE_CHARGING', 'PURPLE_READY'];

export class AbilityMachine {
  state: AbilityState = 'IDLE';
  stateSince = 0;
  blueCharge = 0;
  redCharge = 0;
  mergeProgress = 0;
  purpleCharge = 0;
  lastFrame: HandFrame | null = null;

  private emit: (e: MachineEvent) => void;
  private handPresent = false;
  private lastHandT = -Infinity;
  private cooldownDur = 0.5;

  private curG: Gesture = 'none';
  private orbPoseStart = 0;
  private orbPoseLast = -Infinity;
  private wasOrbPose = false;
  private releaseSince: number | null = null;
  private poseLostSince: number | null = null;
  private regripSince: number | null = null;
  private swipeFrames = 0;
  private flickI = 0;
  private flickM = 0;

  constructor(emit: (e: MachineEvent) => void) {
    this.emit = emit;
  }

  get energy(): number {
    switch (this.state) {
      case 'BLUE_ACTIVE':
        return this.blueCharge;
      case 'BLUE_RED_ACTIVE':
        return (this.blueCharge + this.redCharge) / 2;
      case 'MERGING':
        return this.mergeProgress;
      case 'PURPLE_CHARGING':
      case 'PURPLE_READY':
        return this.purpleCharge;
      default:
        return 0;
    }
  }

  private go(s: AbilityState, t: number): void {
    if (s === this.state) return;
    this.state = s;
    this.stateSince = t;
    this.regripSince = null;
    this.emit({ type: 'state', state: s });
  }

  onNoHand(): void {
    this.handPresent = false;
    this.swipeFrames = 0;
    this.flickI = 0;
    this.flickM = 0;
  }

  onFrame(f: HandFrame): void {
    const t = f.t;
    this.lastFrame = f;
    this.handPresent = true;
    this.lastHandT = t;

    const g = f.gesture;
    const changed = g !== this.curG;
    this.curG = g;

    // --- pose bookkeeping (for the "unfold" fire gesture & release timers)
    const orbPose = g === 'blue' || g === 'blueRed';
    if (orbPose) {
      if (!this.wasOrbPose) this.orbPoseStart = t;
      this.orbPoseLast = t;
    }
    this.wasOrbPose = orbPose;
    const unfold =
      changed && g === 'open' && t - this.orbPoseLast < 0.3 && this.orbPoseLast - this.orbPoseStart > 0.25;

    if (orbPose) this.releaseSince = null;
    else if (this.releaseSince === null) this.releaseSince = t;
    const releasedFor = this.releaseSince === null ? 0 : t - this.releaseSince;

    const purplePose = g !== 'fist' && g !== 'none';
    if (purplePose) this.poseLostSince = null;
    else if (this.poseLostSince === null) this.poseLostSince = t;
    const poseLostFor = this.poseLostSince === null ? 0 : t - this.poseLostSince;

    // --- motion analysis: must exceed threshold on ≥2 consecutive frames (spike-proof)
    const palmSpeed = len(f.palmVel);
    this.swipeFrames = palmSpeed > TH.SWIPE ? this.swipeFrames + 1 : 0;
    const swipe = this.swipeFrames >= 2;
    const swipeDir = norm(f.palmVel);

    const relI = len(f.indexRelVel);
    const relM = len(f.middleRelVel);
    const calm = palmSpeed < TH.FLICK_PALM_MAX;
    this.flickI = calm && relI > TH.FLICK && relI > relM * 1.6 ? this.flickI + 1 : 0;
    this.flickM = calm && relM > TH.FLICK && relM > relI * 1.6 ? this.flickM + 1 : 0;
    const flickIndex = this.flickI >= 2;
    const flickMiddle = this.flickM >= 2;

    const armed = t - this.stateSince > TH.ARM_TIME;

    switch (this.state) {
      case 'IDLE':
        if (orbPose) {
          this.blueCharge = 0;
          this.go('BLUE_ACTIVE', t);
        }
        break;

      case 'BLUE_ACTIVE':
        if (armed && swipe) this.fire(['blue'], swipeDir, 'swipe', t);
        else if (armed && flickIndex) this.fire(['blue'], norm(f.indexRelVel), 'flick', t);
        else if (unfold) this.fire(['blue'], f.pointDir, 'unfold', t);
        else if (g === 'blueRed' && f.tipGap > TH.SEPARATED) {
          this.redCharge = 0;
          this.go('BLUE_RED_ACTIVE', t);
        } else if (releasedFor > TH.RELEASE_TIME) this.go('IDLE', t);
        break;

      case 'BLUE_RED_ACTIVE':
        if (armed && swipe) this.fire(['blue', 'red'], swipeDir, 'swipe', t);
        else if (armed && flickMiddle) this.fire(['red'], norm(f.middleRelVel), 'flick', t);
        else if (armed && flickIndex) this.fire(['blue'], norm(f.indexRelVel), 'flick', t);
        else if (unfold) this.fire(['blue', 'red'], f.pointDir, 'unfold', t);
        else if (g === 'blueRed' && f.tipGap < TH.MERGE_ENTER) {
          this.mergeProgress = 0;
          this.go('MERGING', t);
          this.emit({ type: 'mergeStart' });
        } else if (g === 'blue') this.go('BLUE_ACTIVE', t);
        else if (releasedFor > TH.RELEASE_TIME) this.go('IDLE', t);
        break;

      case 'MERGING':
        // progress itself is time-based (see update)
        if (poseLostFor > 0.4) this.dissipate(t);
        break;

      case 'PURPLE_CHARGING':
        if (f.tipGap > TH.SPREAD) this.go('PURPLE_READY', t);
        else if (poseLostFor > 1.0) this.dissipate(t);
        break;

      case 'PURPLE_READY': {
        const readyArmed = t - this.stateSince > 0.2;
        if (readyArmed && swipe) {
          this.fire(['purple'], swipeDir, 'swipe', t);
          break;
        }
        if (changed && g === 'open') {
          this.fire(['purple'], f.pointDir, 'unfold', t);
          break;
        }
        if (f.tipGap < TH.MERGE_ENTER) {
          if (this.regripSince === null) this.regripSince = t;
          else if (t - this.regripSince > 0.15) {
            this.go('PURPLE_CHARGING', t);
            break;
          }
        } else this.regripSince = null;
        if (poseLostFor > 1.5) this.dissipate(t);
        break;
      }

      case 'FIRING':
      case 'COOLDOWN':
        break;
    }
  }

  update(t: number, dt: number): void {
    const lost = t - this.lastHandT;
    const fresh = this.handPresent || lost < TH.LOST_GRACE;

    if (!this.handPresent && lost > TH.LOST_RESET && ORB_STATES.includes(this.state)) {
      this.dissipate(t);
      return;
    }

    const f = this.lastFrame;
    switch (this.state) {
      case 'BLUE_ACTIVE':
        if (fresh) this.blueCharge = Math.min(1, this.blueCharge + dt / TH.ORB_CHARGE_TIME);
        break;
      case 'BLUE_RED_ACTIVE':
        if (fresh) {
          this.blueCharge = Math.min(1, this.blueCharge + dt / TH.ORB_CHARGE_TIME);
          this.redCharge = Math.min(1, this.redCharge + dt / TH.ORB_CHARGE_TIME);
        }
        break;
      case 'MERGING': {
        const touching = fresh && f !== null && f.tipGap < TH.MERGE_EXIT && f.gesture !== 'fist' && f.gesture !== 'none';
        this.mergeProgress += touching ? dt / TH.MERGE_TIME : -dt * 1.5;
        if (this.mergeProgress >= 1) {
          this.mergeProgress = 1;
          this.purpleCharge = 0.15;
          this.go('PURPLE_CHARGING', t);
          this.emit({ type: 'merged' });
        } else if (this.mergeProgress <= 0) {
          this.mergeProgress = 0;
          this.go('BLUE_RED_ACTIVE', t);
        }
        break;
      }
      case 'PURPLE_CHARGING':
        if (fresh) this.purpleCharge = Math.min(1, this.purpleCharge + dt / TH.CHARGE_TIME);
        break;
      case 'FIRING':
        if (t - this.stateSince > TH.FIRING_TIME) this.go('COOLDOWN', t);
        break;
      case 'COOLDOWN':
        if (t - this.stateSince > this.cooldownDur) this.go('IDLE', t);
        break;
      default:
        break;
    }
  }

  /** External interruption (character switch, a higher-priority technique): orbs dissipate. */
  cancel(t: number): void {
    if (this.state === 'IDLE') return;
    this.dissipate(t);
  }

  private fire(kinds: OrbKind[], dir: Vec2, method: FireMethod, t: number): void {
    const d = norm(dir);
    for (const kind of kinds) {
      const power =
        kind === 'blue'
          ? 0.35 + 0.65 * this.blueCharge
          : kind === 'red'
            ? 0.35 + 0.65 * this.redCharge
            : 0.4 + 0.6 * this.purpleCharge;
      this.emit({ type: 'fire', kind, dir: d, power, method });
    }
    this.cooldownDur = kinds.includes('purple') ? 1.0 : 0.45;
    this.resetCharges();
    this.go('FIRING', t);
  }

  private dissipate(t: number): void {
    this.emit({ type: 'dissipate' });
    this.resetCharges();
    this.go('IDLE', t);
  }

  private resetCharges(): void {
    this.blueCharge = 0;
    this.redCharge = 0;
    this.mergeProgress = 0;
    this.purpleCharge = 0;
    this.swipeFrames = 0;
    this.flickI = 0;
    this.flickM = 0;
  }
}
