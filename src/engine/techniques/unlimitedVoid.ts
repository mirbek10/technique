/**
 * UNLIMITED VOID (Gojo): crossed index & middle (ring & pinky bent) held 1.2 s.
 * Fallback when crossing cannot be seen in 2D: tips together + a wrist roll (see gestureClassifier).
 * Ends when an open palm is held 0.8 s.
 */
import { GESTURE_CFG as CFG } from '../config';
import { clamp, easeInOut, hexToRgb } from '../math';
import { BaseTechnique, PRIORITY, findCand, lastHand, type TechniqueContext, type TechniqueMeta } from './base';

export type VoidState = 'VOID_IDLE' | 'VOID_GESTURE_DETECTED' | 'VOID_PREPARING' | 'VOID_EXPANDING' | 'VOID_ACTIVE' | 'VOID_COLLAPSING';

const PURPLE = hexToRgb('#a46bff');
const WHITE: [number, number, number] = [255, 255, 255];

export class UnlimitedVoidTechnique extends BaseTechnique<VoidState> {
  readonly meta: TechniqueMeta = {
    id: 'unlimitedVoid',
    name: 'Unlimited Void',
    character: 'gojo',
    priority: PRIORITY.DOMAIN,
    triggers: ['void_sign'],
    color: '#a46bff',
    hint: '🤞 скрестить указательный и средний, 1,2 с (или свести + повернуть кисть) · 🖐 0,8 с — выход',
  };

  private slot = 0;
  private signSince = 0;
  private signLast = 0;
  private openSince: number | null = null;
  private cx = 0;
  private cy = 0;
  private envAge = 0;
  private demoUntil = 0;
  intensity = 0;
  method = '';

  constructor() {
    super('VOID_IDLE');
  }

  critical(): boolean {
    return this.state !== 'VOID_IDLE' && this.state !== 'VOID_GESTURE_DETECTED';
  }

  override progress(t: number): number {
    switch (this.state) {
      case 'VOID_GESTURE_DETECTED':
        return Math.min(1, (t - this.signSince) / (CFG.VOID.HOLD * this.hs));
      case 'VOID_ACTIVE':
        return this.openSince === null ? 1 : 1 - Math.min(1, (t - this.openSince) / (CFG.VOID.OPEN_HOLD * this.hs));
      case 'VOID_IDLE':
        return 0;
      default:
        return 1;
    }
  }

  override extra(): string {
    if (this.state === 'VOID_ACTIVE') return 'DOMAIN ACTIVE · 🖐 ладонь 0,8 с — выход';
    return this.method;
  }

  override cancel(t: number): void {
    this.intensity = 0;
    this.openSince = null;
    this.go('VOID_IDLE', t);
  }

  update(ctx: TechniqueContext): void {
    const { t, dt, fx, sfx } = ctx;
    const V = CFG.VOID;
    if (this.state !== 'VOID_IDLE') this.envAge += dt;

    if (this.state === 'VOID_IDLE') {
      sfx.layer('void', 0);
      const g = this.accept(ctx);
      if (!g) return;
      this.slot = g.hands[0];
      this.method = g.detail === 'crossed' ? 'скрещённые пальцы' : 'сведённые пальцы + поворот';
      this.signSince = t;
      this.signLast = t;
      this.go('VOID_GESTURE_DETECTED', t);
    }

    const h = lastHand(ctx, this.slot);
    const anyHand = ctx.track.hands.length > 0;
    if (h.present) {
      this.cx = h.palm.x;
      this.cy = h.palm.y;
    }

    switch (this.state) {
      case 'VOID_GESTURE_DETECTED': {
        if (findCand(ctx, 'void_sign', this.slot)) this.signLast = t;
        if (t - this.signLast > CFG.POSE_GRACE || t - h.lastSeen > CFG.LOST_GRACE) return this.go('VOID_IDLE', t);
        const p = this.progress(t);
        if (h.present) fx.handAura(h.pts, h.palmPx, PURPLE, 0.25 + 0.35 * p);
        if (t - this.signSince >= V.HOLD * ctx.settings.holdScale) {
          this.envAge = 0;
          sfx.play('domain');
          ctx.cine({ title: 'DOMAIN EXPANSION', color: '#c9a6ff', duration: 2.1, big: true });
          this.go('VOID_PREPARING', t);
        }
        break;
      }

      case 'VOID_PREPARING': {
        const u = clamp(this.age(t) / V.PREPARE);
        if (h.present) fx.handAura(h.pts, h.palmPx, PURPLE, 0.6 + 0.4 * u);
        fx.tint([4, 0, 14], 0.4 * u);
        if (ctx.fresh && Math.random() < 0.8) {
          const a = Math.random() * Math.PI * 2;
          const r = h.palmPx * (1.2 + Math.random() * 1.5);
          fx.burst(this.cx + Math.cos(a) * r, this.cy + Math.sin(a) * r, PURPLE, 2, h.palmPx * 0.4, { life: 0.8, size: 3 });
        }
        if (u >= 1) {
          sfx.play('voidExpand');
          fx.shockwave(this.cx, this.cy, h.palmPx * 0.5, Math.max(ctx.W, ctx.H) * 1.2, V.EXPAND, PURPLE, 30);
          fx.shockwave(this.cx, this.cy, h.palmPx * 0.3, Math.max(ctx.W, ctx.H) * 0.9, V.EXPAND * 0.9, WHITE, 12, 0.08);
          fx.shake(0.7);
          this.go('VOID_EXPANDING', t);
        }
        break;
      }

      case 'VOID_EXPANDING': {
        const u = clamp(this.age(t) / V.EXPAND);
        if (this.age(t) > 0.12 && this.age(t) - ctx.dt <= 0.12) fx.flash(WHITE, 0.95, 2.2);
        this.intensity = easeInOut(u);
        fx.tint([4, 0, 14], 0.4 * (1 - u));
        fx.domain({ kind: 'void', intensity: this.intensity, age: this.envAge, progress: u, cx: this.cx, cy: this.cy, distortion: Math.sin(u * Math.PI) });
        if (u >= 1) {
          this.openSince = null;
          ctx.cine({ pre: 'DOMAIN EXPANSION', title: 'UNLIMITED VOID', color: '#b98cff', duration: 3.6, big: true });
          this.go('VOID_ACTIVE', t);
        }
        break;
      }

      case 'VOID_ACTIVE': {
        this.intensity = 1;
        fx.domain({ kind: 'void', intensity: 1, age: this.envAge, progress: 1, cx: this.cx, cy: this.cy, distortion: 0 });
        const open = findCand(ctx, 'open_palm');
        if (open) {
          if (this.openSince === null) this.openSince = t;
          // MIN_ACTIVE only stops an instant exit right after the expansion
          if (t - this.openSince >= V.OPEN_HOLD * ctx.settings.holdScale && this.age(t) > V.MIN_ACTIVE) this.collapse(ctx);
        } else this.openSince = null;
        if (!anyHand && t - ctx.track.lastSeen > V.NO_HAND_COLLAPSE && t > this.demoUntil) this.collapse(ctx);
        if (t > this.demoUntil && this.demoUntil > 0 && !anyHand) this.collapse(ctx);
        break;
      }

      case 'VOID_COLLAPSING': {
        const u = clamp(this.age(t) / V.COLLAPSE);
        this.intensity = 1 - easeInOut(u);
        fx.domain({ kind: 'void', intensity: this.intensity, age: this.envAge, progress: 1, cx: this.cx, cy: this.cy, distortion: Math.sin(u * Math.PI) * 0.6 });
        if (u >= 1) {
          this.intensity = 0;
          this.cooldownUntil = t + V.COOLDOWN;
          this.latch();
          this.go('VOID_IDLE', t);
        }
        break;
      }
      default:
        break;
    }
    sfx.layer('void', this.intensity);
  }

  demo(ctx: TechniqueContext): void {
    this.slot = ctx.track.primary?.slot ?? 0;
    this.cx = ctx.W / 2;
    this.cy = ctx.H / 2;
    this.envAge = 0;
    this.method = 'тест';
    this.demoUntil = ctx.t + 9;
    ctx.sfx.play('domain');
    ctx.cine({ title: 'DOMAIN EXPANSION', color: '#c9a6ff', duration: 2.1, big: true });
    this.go('VOID_PREPARING', ctx.t);
  }

  private collapse(ctx: TechniqueContext): void {
    this.demoUntil = 0;
    ctx.sfx.play('collapse');
    ctx.fx.flash([200, 180, 255], 0.35, 1.5);
    this.go('VOID_COLLAPSING', ctx.t);
  }
}
