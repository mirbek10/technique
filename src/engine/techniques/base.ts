import type { Cinematic, Settings, TechniqueId, CharacterId } from '../types';
import type { TrackFrame, HandInfo } from '../hands';
import type { GestureCandidate, GestureId } from '../gestureClassifier';
import type { Fx, Sfx } from '../fx/api';

/** Resolver priority classes (lower wins): complex two-hand signs → domains → charged → single attacks. */
export const PRIORITY = { TWO_HAND: 0, DOMAIN: 1, CHARGE: 2, SINGLE: 3 } as const;
export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

export interface TechniqueMeta {
  id: TechniqueId;
  name: string;
  character: Exclude<CharacterId, 'all'>;
  priority: Priority;
  /** gestures that can start this technique from idle */
  triggers: GestureId[];
  color: string;
  hint: string;
}

export interface TechniqueContext {
  t: number;
  dt: number;
  /** a new camera frame was processed this tick (motion data is fresh) */
  fresh: boolean;
  track: TrackFrame;
  cands: GestureCandidate[];
  /** set only on the tick the resolver allows this technique to start */
  granted: GestureCandidate | null;
  settings: Settings;
  fx: Fx;
  sfx: Sfx;
  cine: (c: Omit<Cinematic, 'key'>) => void;
  W: number;
  H: number;
}

export interface Technique {
  readonly meta: TechniqueMeta;
  readonly state: string;
  /** not idle: owns the input until it finishes */
  engaged(): boolean;
  /** activated: cannot be interrupted by a higher-priority gesture */
  critical(): boolean;
  progress(t: number): number;
  cooldownLeft(t: number): number;
  extra(): string;
  update(ctx: TechniqueContext): void;
  cancel(t: number, reason: string): void;
  /** debug/test button: play the technique's effect without the gesture */
  demo?(ctx: TechniqueContext): void;
}

export function findCand(ctx: TechniqueContext, id: GestureId, slot?: number): GestureCandidate | undefined {
  for (const c of ctx.cands) if (c.id === id && (slot === undefined || c.hands.includes(slot))) return c;
  return undefined;
}

export function hand(ctx: TechniqueContext, slot: number): HandInfo | null {
  const h = ctx.track.slots[slot as 0 | 1];
  return h && h.present ? h : null;
}

/** Last-known hand data even if the hand vanished a moment ago (for grace periods). */
export function lastHand(ctx: TechniqueContext, slot: number): HandInfo {
  return ctx.track.slots[slot as 0 | 1];
}

export abstract class BaseTechnique<S extends string> implements Technique {
  abstract readonly meta: TechniqueMeta;
  state: S;
  since = 0;
  cooldownUntil = 0;
  /** effective hold-time multiplier (set by the core every tick) — for progress bars */
  hs = 1;
  /** recent transitions — used by the debugger and the unit tests */
  readonly history: S[] = [];
  protected readonly idle: S;

  constructor(idle: S) {
    this.state = idle;
    this.idle = idle;
  }

  /** after finishing, the trigger gesture must be released once before it can start again (no loops) */
  protected latched = false;

  protected latch(): void {
    this.latched = true;
  }

  /** The granted candidate, unless the previous activation's gesture is still being held. */
  protected accept(ctx: TechniqueContext): GestureCandidate | null {
    if (this.latched) {
      if (ctx.fresh && !ctx.cands.some((c) => this.meta.triggers.includes(c.id))) this.latched = false;
      return null;
    }
    return ctx.granted;
  }

  protected go(s: S, t: number): void {
    if (s === this.state) return;
    this.state = s;
    this.since = t;
    this.history.push(s);
    if (this.history.length > 40) this.history.shift();
  }

  protected age(t: number): number {
    return t - this.since;
  }

  engaged(): boolean {
    return this.state !== this.idle;
  }

  abstract critical(): boolean;

  progress(_t: number): number {
    return 0;
  }

  cooldownLeft(t: number): number {
    return Math.max(0, this.cooldownUntil - t);
  }

  extra(): string {
    return '';
  }

  abstract update(ctx: TechniqueContext): void;

  cancel(t: number, _reason: string): void {
    this.go(this.idle, t);
  }
}
