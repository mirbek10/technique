/**
 * Gesture Resolver: from all candidate gestures picks at most ONE technique that may start this tick.
 *
 * Rules
 *  - only techniques of the selected character (or all, in ALL TECHNIQUES mode) are considered;
 *  - an engaged technique owns the input; others are rejected unless
 *      · it is a predefined combo (Dismantle during an active Malevolent Shrine with DOMAIN_COMBOS), or
 *      · the owner has not activated yet (non-critical) and the newcomer has a higher priority class
 *        (e.g. a two-hand sign interrupts a Blue orb raised a moment earlier) — needs a longer stable time;
 *  - priority classes: two-hand signs → domains → charged → single attacks; then confidence;
 *  - temporal filtering: the winner must stay the winner for STABLE seconds (short dropouts tolerated);
 *  - ambiguity: two different techniques of the same class with similar confidence → longer confirmation hold.
 */
import { GESTURE_CFG as CFG } from './config';
import type { GestureCandidate, GestureId } from './gestureClassifier';
import type { Technique } from './techniques/base';
import type { Settings, TechniqueId } from './types';

export interface Resolution {
  grant: { tech: TechniqueId; cand: GestureCandidate } | null;
  /** engaged technique that must be cancelled before the grant */
  preempt: TechniqueId | null;
  owner: TechniqueId[];
  winner: string;
  holdMs: number;
  rejected: string[];
}

export interface RosterRules {
  /** null when the technique may be used in the current mode, otherwise the reason it may not */
  rosterReason(tech: Technique): string | null;
  /** gestures this technique may start from in the current mode */
  triggersOf(tech: Technique): GestureId[];
}

interface Option {
  tech: Technique;
  cand: GestureCandidate;
  preempt: Technique | null;
}

export function isCombo(owner: Technique, tech: Technique, settings: Settings): boolean {
  return settings.domainCombos && owner.meta.id === 'malevolentShrine' && owner.state === 'SHRINE_ACTIVE' && tech.meta.id === 'dismantle';
}

export class GestureResolver {
  private winKey: string | null = null;
  private winSince = 0;
  private winLast = -Infinity;
  last: Resolution = { grant: null, preempt: null, owner: [], winner: '—', holdMs: 0, rejected: [] };

  reset(): void {
    this.winKey = null;
  }

  resolve(cands: GestureCandidate[], techs: Technique[], rules: RosterRules, settings: Settings, t: number, frameDt = 1 / 30): Resolution {
    // on a slow camera consecutive frames are further apart than DROPOUT: the gap must cover at least ~one missed frame
    const dropout = Math.max(CFG.RESOLVER.DROPOUT, frameDt * 1.6);
    const owners = techs.filter((x) => x.engaged());
    const rejected: string[] = [];
    const options: Option[] = [];

    for (const cand of cands) {
      for (const tech of techs) {
        if (!rules.triggersOf(tech).includes(cand.id)) continue;
        const name = tech.meta.name;
        const roster = rules.rosterReason(tech);
        if (roster) {
          if (tech.meta.triggers.includes(cand.id)) rejected.push(`${cand.id} → ${name}: ${roster}`);
          continue;
        }
        if (tech.engaged()) continue; // already consuming this gesture
        const cd = tech.cooldownLeft(t);
        if (cd > 0) {
          rejected.push(`${cand.id} → ${name}: cooldown ${cd.toFixed(1)}s`);
          continue;
        }
        let preempt: Technique | null = null;
        let blocked: string | null = null;
        for (const o of owners) {
          if (isCombo(o, tech, settings)) continue;
          if (!o.critical() && tech.meta.priority < o.meta.priority) {
            preempt = o;
            continue;
          }
          blocked = `заблокировано: ${o.meta.name} (${o.state})`;
        }
        if (blocked) {
          rejected.push(`${cand.id} → ${name}: ${blocked}`);
          continue;
        }
        options.push({ tech, cand, preempt });
      }
    }

    options.sort((a, b) => a.tech.meta.priority - b.tech.meta.priority || b.cand.confidence - a.cand.confidence);
    const top = options[0];
    for (let i = 1; i < options.length; i++) {
      const o = options[i];
      rejected.push(`${o.cand.id} → ${o.tech.meta.name}: ниже по приоритету, чем ${top.tech.meta.name}`);
    }

    let grant: Resolution['grant'] = null;
    let preempt: TechniqueId | null = null;
    let holdMs = 0;
    let winner = '—';
    if (top) {
      const key = `${top.tech.meta.id}:${top.cand.id}`;
      if (key !== this.winKey || t - this.winLast > dropout) {
        this.winKey = key;
        this.winSince = t;
      }
      this.winLast = t;
      const rival = options.find(
        (o) =>
          o.tech !== top.tech &&
          o.tech.meta.priority === top.tech.meta.priority &&
          top.cand.confidence - o.cand.confidence < CFG.RESOLVER.AMBIGUITY_GAP,
      );
      let need = CFG.RESOLVER.STABLE;
      if (rival) need = Math.max(need, CFG.RESOLVER.AMBIGUOUS_STABLE);
      if (top.preempt) need = Math.max(need, CFG.RESOLVER.PREEMPT_STABLE);
      const held = t - this.winSince;
      holdMs = held * 1000;
      winner = `${top.cand.id} → ${top.tech.meta.name} (${Math.round(top.cand.confidence * 100)}%)${rival ? ' · неоднозначно, нужна выдержка' : ''}`;
      if (held >= need) {
        grant = { tech: top.tech.meta.id, cand: top.cand };
        preempt = top.preempt ? top.preempt.meta.id : null;
        this.winKey = null;
      }
    } else if (t - this.winLast > dropout) this.winKey = null;

    this.last = { grant, preempt, owner: owners.map((o) => o.meta.id), winner, holdMs, rejected };
    return this.last;
  }
}
