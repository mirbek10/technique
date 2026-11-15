/**
 * BLACK FLASH (Yuji): hold a fist ≥ 300 ms, then punch.
 * A punch is either a forward thrust (the palm grows quickly in the image — the only robust depth cue a
 * single RGB camera gives) or a sharp sideways strike (high horizontal speed + acceleration).
 * World landmarks are hand-centred in MediaPipe, so they help the joint angles, not the punch depth.
 * Clenching a fist without fast motion never fires; one punch fires once (the fist must slow down to re-arm).
 */
import { GESTURE_CFG as CFG } from '../config';
import { hexToRgb } from '../math';
import { BaseTechnique, PRIORITY, findCand, lastHand, type TechniqueContext, type TechniqueMeta } from './base';

export type BlackFlashState = 'FLASH_IDLE' | 'FIST_DETECTED' | 'FLASH_CHARGING' | 'PUNCH_DETECTED' | 'FLASH_IMPACT' | 'FLASH_RECOVERY';

const RED = hexToRgb('#ff1e2d');
const BLACK: [number, number, number] = [10, 0, 6];

export class BlackFlashTechnique extends BaseTechnique<BlackFlashState> {
  readonly meta: TechniqueMeta = {
    id: 'blackFlash',
    name: 'Black Flash',
    character: 'yuji',
    priority: PRIORITY.CHARGE,
    triggers: ['fist'],
    color: '#ff1e2d',
    hint: '✊ кулак 0,3 с → резкий удар вперёд/вбок',
  };

  private slot = 0;
  private fistLast = 0;
  private fistSince = 0;
  private hitFrames = 0;
  private charge = 0;
  private lastHit = -Infinity;
  private ix = 0;
  private iy = 0;
  private aura = 0;
  combo = 0;
  hits = 0;
  lastMethod = '';

  constructor() {
    super('FLASH_IDLE');
  }

  critical(): boolean {
    return this.state === 'PUNCH_DETECTED' || this.state === 'FLASH_IMPACT';
  }

  override progress(t: number): number {
    if (this.state === 'FIST_DETECTED') return Math.min(1, (t - this.fistSince) / (CFG.BLACK_FLASH.FIST_HOLD * this.hs));
    return this.charge;
  }

  override extra(): string {
    return this.combo > 0 ? `комбо ×${this.combo}` : '';
  }

  update(ctx: TechniqueContext): void {
    const { t, dt, fx, sfx } = ctx;
    const B = CFG.BLACK_FLASH;
    if (this.combo > 0 && t - this.lastHit > B.COMBO_WINDOW) this.combo = 0;

    const auraTarget = this.state === 'FLASH_CHARGING' ? 0.45 + 0.55 * this.charge : this.state === 'FIST_DETECTED' ? 0.25 : 0;
    this.aura += (auraTarget - this.aura) * Math.min(1, dt * 10);
    sfx.layer('fist', this.aura);

    if (this.state === 'FLASH_IDLE') {
      if (!ctx.granted) return;
      this.slot = ctx.granted.hands[0];
      this.fistSince = t;
      this.fistLast = t;
      this.charge = 0;
      this.hitFrames = 0;
      this.go('FIST_DETECTED', t);
    }

    const h = lastHand(ctx, this.slot);
    if (t - h.lastSeen > CFG.LOST_GRACE && !this.critical()) {
      this.go('FLASH_IDLE', t);
      return;
    }
    if (findCand(ctx, 'fist', this.slot)) this.fistLast = t;
    const fistOk = t - this.fistLast < B.POSE_GRACE;

    if (this.aura > 0.02 && h.present) fx.orb({ style: 'blackflash', x: h.palm.x, y: h.palm.y, r: h.palmPx * 0.62, vis: this.aura, charge: this.charge });

    const m = ctx.settings.motionScale;
    const forward = h.scaleRate > B.SCALE_RATE_IN * m;
    const sideways = Math.abs(h.palmVel.x) > B.SPEED_IN * m && Math.abs(h.palmVel.x) > Math.abs(h.palmVel.y) * 1.2 && h.palmAccel > B.ACCEL_IN * m;
    const slow = h.palmSpeed < B.REARM_SPEED * m && Math.abs(h.scaleRate) < B.SCALE_RATE_IN * m * 0.4;

    switch (this.state) {
      case 'FIST_DETECTED':
        if (!fistOk) return this.go('FLASH_IDLE', t);
        if (t - this.fistSince >= B.FIST_HOLD * ctx.settings.holdScale && slow) {
          sfx.play('fistCharge');
          this.go('FLASH_CHARGING', t);
        }
        break;

      case 'FLASH_CHARGING':
        if (!fistOk) return this.go('FLASH_IDLE', t);
        this.charge = Math.min(1, this.charge + dt / 1.2);
        if (!ctx.fresh || !h.present) break;
        this.hitFrames = forward || sideways ? this.hitFrames + 1 : 0;
        if (this.hitFrames >= B.MIN_FRAMES) {
          this.lastMethod = forward ? 'вперёд' : 'вбок';
          const lead = forward ? 0 : 0.5;
          this.ix = h.palm.x + h.palmVel.x * h.palmPx * 0.04 * lead;
          this.iy = h.palm.y + h.palmVel.y * h.palmPx * 0.04 * lead;
          this.go('PUNCH_DETECTED', t);
          this.impact(ctx, h.palmPx);
          this.go('FLASH_IMPACT', t);
        }
        break;

      case 'FLASH_IMPACT':
        if (this.age(t) > B.IMPACT) this.go('FLASH_RECOVERY', t);
        break;

      case 'FLASH_RECOVERY':
        // re-arm only after the punch is over, so one movement cannot fire twice
        if (this.age(t) > B.RECOVERY && slow) {
          this.hitFrames = 0;
          this.charge = 0.3;
          if (fistOk) this.go('FLASH_CHARGING', t);
          else this.go('FLASH_IDLE', t);
        } else if (this.age(t) > 2.5) this.go('FLASH_IDLE', t);
        break;
      default:
        break;
    }
  }

  demo(ctx: TechniqueContext): void {
    this.ix = ctx.W / 2;
    this.iy = ctx.H / 2;
    this.charge = 1;
    this.impact(ctx, 120);
  }

  private impact(ctx: TechniqueContext, palmPx: number): void {
    const { t, fx, sfx, W, H } = ctx;
    this.combo = t - this.lastHit <= CFG.BLACK_FLASH.COMBO_WINDOW ? this.combo + 1 : 1;
    this.lastHit = t;
    this.hits++;
    const power = 0.6 + 0.4 * this.charge;
    const x = this.ix;
    const y = this.iy;
    const base = Math.max(W, H);
    fx.darkFlash(0.55, 3.2);
    fx.flash(RED, 0.22, 2.4);
    fx.shockwave(x, y, palmPx * 0.3, base * 0.55, 0.6, RED, 22);
    fx.shockwave(x, y, palmPx * 0.2, base * 0.3, 0.45, BLACK, 30, 0.04);
    fx.cracks(x, y, palmPx * (2.2 + this.combo * 0.4), RED, 9);
    fx.burst(x, y, RED, 90, palmPx * 6, { white: 0.25 });
    fx.burst(x, y, BLACK, 50, palmPx * 4, { dark: true, life: 0.7 });
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = palmPx * (1.6 + Math.random() * 1.8);
      fx.bolt(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r, RED, 2.2, 0.22);
    }
    fx.shake(0.85);
    fx.slowmo(0.3, 0.28);
    sfx.play('blackFlash', power);
    const title = this.combo === 1 ? 'BLACK FLASH!' : this.combo === 2 ? 'DOUBLE BLACK FLASH!' : `BLACK FLASH COMBO ×${this.combo}`;
    ctx.cine({ title, color: '#ff1e2d', duration: 0.9, big: true });
  }
}
