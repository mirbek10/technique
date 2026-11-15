/**
 * PIERCING BLOOD (Choso): both index fingers out, parallel, hands together → compress blood →
 * pull the hands apart sharply to shoot. Releasing before 100% fires a weaker beam.
 */
import { GESTURE_CFG as CFG } from '../config';
import { hexToRgb, norm } from '../math';
import type { Vec2 } from '../types';
import { BaseTechnique, PRIORITY, findCand, lastHand, type TechniqueContext, type TechniqueMeta } from './base';

export type BloodState = 'BLOOD_IDLE' | 'BLOOD_POSE_DETECTED' | 'BLOOD_COMPRESSING' | 'BLOOD_READY' | 'BLOOD_FIRING' | 'BLOOD_COOLDOWN';

const BLOOD = hexToRgb('#e0102a');

export class PiercingBloodTechnique extends BaseTechnique<BloodState> {
  readonly meta: TechniqueMeta = {
    id: 'piercingBlood',
    name: 'Piercing Blood',
    character: 'choso',
    priority: PRIORITY.TWO_HAND,
    triggers: ['blood_pose'],
    color: '#e0102a',
    hint: '☝️☝️ указательные вместе 0,8 с → резко развести руки',
  };

  private a = 0;
  private b = 1;
  private poseLast = 0;
  private poseSince = 0;
  charge = 0;
  private baseDist = 1;
  private prevD = 0;
  private prevT = 0;
  private rate = 0;
  private aim: Vec2 = { x: 1, y: 0 };
  private origin: Vec2 = { x: 0, y: 0 };
  private vis = 0;
  lastPower = 0;
  shots = 0;

  constructor() {
    super('BLOOD_IDLE');
  }

  critical(): boolean {
    return this.state === 'BLOOD_COMPRESSING' || this.state === 'BLOOD_READY' || this.state === 'BLOOD_FIRING';
  }

  override progress(t: number): number {
    if (this.state === 'BLOOD_POSE_DETECTED') return Math.min(1, (t - this.poseSince) / (CFG.BLOOD.POSE_HOLD * this.hs)) * 0.25;
    return this.charge;
  }

  override extra(): string {
    return this.state === 'BLOOD_COMPRESSING' || this.state === 'BLOOD_READY' ? `BLOOD COMPRESSION ${Math.round(this.charge * 100)}%` : '';
  }

  update(ctx: TechniqueContext): void {
    const { t, dt, fx, sfx } = ctx;
    const B = CFG.BLOOD;
    const orbOn = this.state === 'BLOOD_COMPRESSING' || this.state === 'BLOOD_READY';
    this.vis += ((orbOn ? 1 : 0) - this.vis) * Math.min(1, dt * (orbOn ? 8 : 5));
    sfx.layer('blood', orbOn ? 0.3 + 0.7 * this.charge : 0);

    if (this.state === 'BLOOD_IDLE') {
      const g = this.accept(ctx);
      if (!g) return;
      [this.a, this.b] = g.hands;
      this.poseSince = t;
      this.poseLast = t;
      this.charge = 0;
      this.go('BLOOD_POSE_DETECTED', t);
    }

    const ha = lastHand(ctx, this.a);
    const hb = lastHand(ctx, this.b);
    const both = ha.present && hb.present;
    if (findCand(ctx, 'blood_pose')) {
      this.poseLast = t;
      this.aim = norm({ x: ha.indexDir.x + hb.indexDir.x, y: ha.indexDir.y + hb.indexDir.y }, this.aim);
      this.origin = { x: (ha.pts[8].x + hb.pts[8].x) / 2, y: (ha.pts[8].y + hb.pts[8].y) / 2 };
    }
    const poseOk = t - this.poseLast < CFG.POSE_GRACE;
    const palm = (ha.palmPx + hb.palmPx) / 2;

    // separation speed of the hands, palm widths per second
    let dN = this.prevD;
    if (ctx.fresh && both) {
      dN = Math.hypot(ha.palm.x - hb.palm.x, ha.palm.y - hb.palm.y) / Math.max(palm, 1);
      const ddt = t - this.prevT;
      if (ddt > 1e-3 && ddt < 0.2) this.rate = this.rate * 0.4 + ((dN - this.prevD) / ddt) * 0.6;
      else this.rate = 0;
      this.prevD = dN;
      this.prevT = t;
    }
    const separating = this.rate > B.SEPARATE_RATE * ctx.settings.motionScale && dN > this.baseDist * B.SEPARATE_RATIO;
    const lost = t - Math.max(ha.lastSeen, hb.lastSeen) > CFG.LOST_GRACE;

    if (orbOn || this.vis > 0.02) {
      const r = palm * (0.55 - 0.3 * this.charge);
      fx.orb({ style: 'blood', x: this.origin.x, y: this.origin.y, r, vis: this.vis, charge: this.charge });
    }

    switch (this.state) {
      case 'BLOOD_POSE_DETECTED':
        if (!poseOk || lost) return this.go('BLOOD_IDLE', t);
        if (t - this.poseSince >= B.POSE_HOLD * ctx.settings.holdScale) {
          this.baseDist = Math.max(this.prevD, 0.5);
          this.rate = 0;
          sfx.play('bloodCharge');
          this.go('BLOOD_COMPRESSING', t);
        }
        break;

      case 'BLOOD_COMPRESSING':
        if (separating) return this.fire(ctx, palm);
        if (lost || (!poseOk && dN < this.baseDist * 1.2)) return this.fizzle(ctx, palm);
        if (poseOk) this.charge = Math.min(1, this.charge + dt / B.COMPRESS);
        if (this.charge >= 1) {
          fx.flash(BLOOD, 0.12, 3);
          this.go('BLOOD_READY', t);
        }
        break;

      case 'BLOOD_READY':
        if (separating) return this.fire(ctx, palm);
        if (lost || (t - this.poseLast > 1.0 && dN < this.baseDist * 1.2)) return this.fizzle(ctx, palm);
        break;

      case 'BLOOD_FIRING':
        if (this.age(t) > B.FIRING) this.go('BLOOD_COOLDOWN', t);
        break;

      case 'BLOOD_COOLDOWN':
        if (this.age(t) > B.COOLDOWN) {
          this.latch();
          this.go('BLOOD_IDLE', t);
        }
        break;
      default:
        break;
    }
  }

  demo(ctx: TechniqueContext): void {
    this.origin = { x: ctx.W * 0.3, y: ctx.H * 0.55 };
    this.aim = norm({ x: 1, y: -0.15 });
    this.charge = 1;
    this.fire(ctx, 120);
  }

  private fizzle(ctx: TechniqueContext, palm: number): void {
    ctx.fx.burst(this.origin.x, this.origin.y, BLOOD, 30, palm * 2, { life: 0.5 });
    this.charge = 0;
    this.go('BLOOD_IDLE', ctx.t);
  }

  private fire(ctx: TechniqueContext, palm: number): void {
    const { fx, sfx, t } = ctx;
    if (this.charge < CFG.BLOOD.MIN_CHARGE_SHOT) return this.fizzle(ctx, palm);
    const power = this.charge >= 1 ? 1 : 0.25 + 0.6 * this.charge;
    this.lastPower = power;
    this.shots++;
    const { x, y } = this.origin;
    fx.beam(x, y, this.aim, { color: BLOOD, width: palm * (0.05 + 0.1 * power), dur: 0.5, power });
    fx.flash([255, 70, 80], 0.15 + 0.25 * power, 3);
    fx.shockwave(x, y, palm * 0.2, palm * (1.5 + 2.5 * power), 0.4, BLOOD, 8);
    fx.burst(x, y, BLOOD, Math.round(40 + 60 * power), palm * 5, { dir: this.aim, spread: 0.6, white: 0.3 });
    fx.shake(0.3 + 0.45 * power);
    sfx.play('beam', power);
    ctx.cine({ title: 'PIERCING BLOOD', sub: power < 1 ? `сжатие ${Math.round(this.charge * 100)}%` : undefined, color: '#e0102a', duration: 0.9, big: power >= 1 });
    this.charge = 0;
    this.go('BLOOD_FIRING', t);
  }
}
