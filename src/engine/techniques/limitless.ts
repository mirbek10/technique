/**
 * Blue / Red / Hollow Purple — the original AbilityMachine, unchanged, wrapped as a technique so the
 * resolver can arbitrate it against the new abilities. It is driven by the primary hand only.
 */
import { AbilityMachine, type HandFrame, type MachineEvent } from '../abilityMachine';
import type { AbilityState } from '../types';
import { PRIORITY, type Technique, type TechniqueContext, type TechniqueMeta } from './base';

const CRITICAL: AbilityState[] = ['PURPLE_CHARGING', 'PURPLE_READY', 'FIRING', 'COOLDOWN'];

export class LimitlessTechnique implements Technique {
  readonly meta: TechniqueMeta = {
    id: 'limitless',
    name: 'Blue · Red · Purple',
    character: 'gojo',
    priority: PRIORITY.CHARGE,
    triggers: ['blue', 'blueRed'],
    color: '#0088FF',
    hint: '☝️ Blue · ✌️ Red · свести кончики → Purple',
  };
  readonly machine: AbilityMachine;

  constructor(emit: (e: MachineEvent) => void) {
    this.machine = new AbilityMachine(emit);
  }

  get state(): AbilityState {
    return this.machine.state;
  }

  engaged(): boolean {
    return this.machine.state !== 'IDLE';
  }

  critical(): boolean {
    return CRITICAL.includes(this.machine.state);
  }

  progress(): number {
    return this.machine.energy;
  }

  cooldownLeft(): number {
    return 0;
  }

  extra(): string {
    return '';
  }

  update(ctx: TechniqueContext): void {
    const m = this.machine;
    if (ctx.fresh) {
      const p = ctx.track.primary;
      if (p) {
        // Until the resolver grants it, Limitless must not react to its pose (another technique may own it).
        const listening = this.engaged() || ctx.granted !== null;
        const frame: HandFrame = {
          t: ctx.t,
          gesture: listening ? p.gesture : 'other',
          tipGap: p.tipGap,
          indexAnchor: p.indexAnchor,
          middleAnchor: p.middleAnchor,
          palm: p.palm,
          palmPx: p.palmPx,
          pointDir: p.pointDir,
          palmVel: p.palmVel,
          indexRelVel: p.indexRelVel,
          middleRelVel: p.middleRelVel,
        };
        m.onFrame(frame);
      } else m.onNoHand();
    }
    m.update(ctx.t, ctx.dt);
  }

  cancel(t: number): void {
    this.machine.cancel(t);
  }
}
