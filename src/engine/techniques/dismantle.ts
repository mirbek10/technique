/**
 * DISMANTLE (Sukuna): index + middle up, the rest bent, then a fast stroke through the air.
 * The cut follows the real fingertip trajectory (start → end of the fast segment).
 * One stroke = one cut: after firing the fingers must slow down before the next stroke can arm.
 */
import { GESTURE_CFG as CFG } from '../config';
import { hexToRgb } from '../math';
import { BaseTechnique, PRIORITY, findCand, lastHand, type TechniqueContext, type TechniqueMeta } from './base';

export type DismantleState = 'SLASH_IDLE' | 'SLASH_READY' | 'SLASH_TRACKING' | 'SLASH_DETECTED' | 'SLASH_FIRING' | 'SLASH_COOLDOWN';

const WHITE_RED = hexToRgb('#ff3048');

export class DismantleTechnique extends BaseTechnique<DismantleState> {
  readonly meta: TechniqueMeta = {
    id: 'dismantle',
    name: 'Dismantle',
    character: 'sukuna',
    priority: PRIORITY.SINGLE,
    triggers: ['slash_pose'],
    color: '#ff2a3d',
    hint: '✌️ два пальца → резкий взмах',
  };

  private slot = 0;
  private rearm = false;
  private poseLast = 0;
  private fastFrames = 0;
  /** recent fingertip positions (screen px) for the stroke start */
  private hx: number[] = [];
  private hy: number[] = [];
  private ht: number[] = [];
  private sx = 0;
  private sy = 0;
  private ex = 0;
  private ey = 0;
  private peak = 0;
  private strokeT = 0;
  private fires: number[] = [];
  private lastFire = -Infinity;
  combo = 0;
  slashes = 0;
  lastReject = '';

  constructor() {
    super('SLASH_IDLE');
  }

  critical(): boolean {
    return this.state === 'SLASH_DETECTED' || this.state === 'SLASH_FIRING';
  }

  override extra(): string {
    return this.combo > 1 ? `серия ×${this.combo}` : this.lastReject;
  }

  private pushTip(t: number, x: number, y: number): void {
    this.ht.push(t);
    this.hx.push(x);
    this.hy.push(y);
    if (this.ht.length > 12) {
      this.ht.shift();
      this.hx.shift();
      this.hy.shift();
    }
  }

  update(ctx: TechniqueContext): void {
    const { t } = ctx;
    if (this.combo > 0 && t - this.lastFire > CFG.DISMANTLE.TRIPLE_WINDOW) {
      this.fires = [];
      this.combo = 0;
    }
    if (this.state === 'SLASH_IDLE') {
      if (!ctx.granted) return;
      this.slot = ctx.granted.hands[0];
      this.poseLast = t;
      this.fastFrames = 0;
      this.rearm = false;
      this.ht.length = this.hx.length = this.hy.length = 0;
      this.go('SLASH_READY', t);
    }

    const h = lastHand(ctx, this.slot);
    if (t - h.lastSeen > CFG.LOST_GRACE) {
      this.go('SLASH_IDLE', t);
      return;
    }
    if (findCand(ctx, 'slash_pose', this.slot)) this.poseLast = t;
    const poseOk = t - this.poseLast < CFG.POSE_GRACE;
    const speedIn = CFG.DISMANTLE.SPEED_IN * ctx.settings.motionScale;
    const speedOut = CFG.DISMANTLE.SPEED_OUT * ctx.settings.motionScale;

    let speed = 0;
    if (ctx.fresh && h.present) {
      const x = (h.pts[8].x + h.pts[12].x) / 2;
      const y = (h.pts[8].y + h.pts[12].y) / 2;
      this.pushTip(t, x, y);
      speed = Math.hypot(h.tipVel.x, h.tipVel.y);
    }

    switch (this.state) {
      case 'SLASH_READY':
        if (!poseOk) return this.go('SLASH_IDLE', t);
        // armed only once the pose is held and the hand is calm (no firing from the motion that formed the pose)
        // after a cut the pose is already established: only the slow-down is required
        if ((this.rearm || this.age(t) > CFG.DISMANTLE.POSE_ARM * ctx.settings.holdScale) && ctx.fresh && speed < speedOut) this.go('SLASH_TRACKING', t);
        break;

      case 'SLASH_TRACKING':
        if (!poseOk) return this.go('SLASH_IDLE', t);
        if (!ctx.fresh) break;
        this.fastFrames = speed > speedIn ? this.fastFrames + 1 : 0;
        if (this.fastFrames >= CFG.DISMANTLE.MIN_FRAMES) {
          // stroke starts where the fingers were just before they accelerated
          let i = this.ht.length - 1;
          while (i > 0 && t - this.ht[i] < 0.09) i--;
          this.sx = this.hx[i];
          this.sy = this.hy[i];
          this.peak = speed;
          this.strokeT = t;
          this.go('SLASH_DETECTED', t);
        }
        break;

      case 'SLASH_DETECTED': {
        if (ctx.fresh && h.present) {
          this.ex = this.hx[this.hx.length - 1];
          this.ey = this.hy[this.hy.length - 1];
          this.peak = Math.max(this.peak, speed);
        }
        const ended = (ctx.fresh && speed < speedOut) || t - this.strokeT > CFG.DISMANTLE.MAX_STROKE || !h.present;
        if (!ended) break;
        const lenPalm = Math.hypot(this.ex - this.sx, this.ey - this.sy) / Math.max(h.palmPx, 1);
        if (lenPalm >= CFG.DISMANTLE.MIN_LENGTH) {
          this.fire(ctx, h.palmPx);
          this.go('SLASH_FIRING', t);
        } else {
          this.lastReject = `короткий взмах ${lenPalm.toFixed(1)} < ${CFG.DISMANTLE.MIN_LENGTH}`;
          this.fastFrames = 0;
          this.go('SLASH_READY', t);
        }
        break;
      }

      case 'SLASH_FIRING':
        if (this.age(t) > 0.06) {
          this.go('SLASH_COOLDOWN', t);
        }
        break;

      case 'SLASH_COOLDOWN':
        // measured from the cut itself: 200–350 ms between separate cuts
        if (t - this.lastFire > CFG.DISMANTLE.COOLDOWN) {
          // back to READY: it re-arms only after the hand slows down
          this.fastFrames = 0;
          this.rearm = true;
          this.go(poseOk ? 'SLASH_READY' : 'SLASH_IDLE', t);
        }
        break;
      default:
        break;
    }
  }

  demo(ctx: TechniqueContext): void {
    const a = Math.random() * Math.PI;
    const L = Math.min(ctx.W, ctx.H) * 0.25;
    this.sx = ctx.W / 2 - Math.cos(a) * L;
    this.sy = ctx.H / 2 - Math.sin(a) * L;
    this.ex = ctx.W / 2 + Math.cos(a) * L;
    this.ey = ctx.H / 2 + Math.sin(a) * L;
    this.peak = CFG.DISMANTLE.SPEED_IN * 2;
    this.fire(ctx, 120);
  }

  private fire(ctx: TechniqueContext, palmPx: number): void {
    const { t, fx, sfx } = ctx;
    let dx = this.ex - this.sx;
    let dy = this.ey - this.sy;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    // the cut is longer than the hand stroke: it splits the space the fingers passed through
    const ext = Math.max(l * 0.45, Math.min(ctx.W, ctx.H) * 0.18);
    const x1 = this.sx - dx * ext;
    const y1 = this.sy - dy * ext;
    const x2 = this.ex + dx * ext;
    const y2 = this.ey + dy * ext;
    const power = Math.min(1, this.peak / (CFG.DISMANTLE.SPEED_IN * 2.2));
    fx.slash(x1, y1, x2, y2, { color: WHITE_RED, width: palmPx * (0.1 + 0.08 * power), power, distort: true });
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    fx.shockwave(mx, my, palmPx * 0.2, palmPx * 1.6, 0.35, WHITE_RED, 5);
    fx.shake(0.28 + 0.2 * power);
    sfx.play('slash', power);
    this.slashes++;
    this.lastReject = '';

    this.fires = this.fires.filter((ft) => t - ft < CFG.DISMANTLE.TRIPLE_WINDOW);
    this.fires.push(t);
    this.lastFire = t;
    this.combo = this.fires.length;
    if (this.fires.length >= 3) {
      // TRIPLE DISMANTLE: two more cuts crossing the third one
      const L = Math.hypot(x2 - x1, y2 - y1) / 2;
      for (const a of [Math.PI / 3, -Math.PI / 3]) {
        const c = Math.cos(a);
        const s = Math.sin(a);
        const ux = dx * c - dy * s;
        const uy = dx * s + dy * c;
        fx.slash(mx - ux * L, my - uy * L, mx + ux * L, my + uy * L, { color: WHITE_RED, width: palmPx * 0.2, power: 1, delay: a > 0 ? 0.06 : 0.12, distort: true });
      }
      fx.flash([255, 60, 70], 0.35, 2.5);
      fx.shake(0.75);
      fx.shockwave(mx, my, palmPx * 0.4, Math.max(ctx.W, ctx.H) * 0.5, 0.7, WHITE_RED, 14, 0.1);
      sfx.play('tripleSlash', 1);
      ctx.cine({ title: 'TRIPLE DISMANTLE', color: '#ff2a3d', duration: 1.1, big: true });
      this.fires = [];
    } else ctx.cine({ title: 'DISMANTLE', color: '#ff2a3d', duration: 0.55 });
  }
}
