/**
 * TEN SHADOWS (Megumi): two-hand signs summon a shikigami through a shadow portal.
 *   Divine Dogs  — index + pinky up on both hands, hands together (0.9 s)
 *   Nue          — both palms open, thumbs joined, fingers spread like wings (1.0 s)
 *   Toad         — index + middle bent on both hands, hands near but apart (1.0 s)
 * Only one shikigami at a time; 2 s cooldown after it leaves.
 */
import { GESTURE_CFG as CFG } from '../config';
import type { GestureId } from '../gestureClassifier';
import type { ShikigamiKind } from '../fx/api';
import { hexToRgb, norm } from '../math';
import type { Vec2 } from '../types';
import { BaseTechnique, PRIORITY, findCand, lastHand, type TechniqueContext, type TechniqueMeta } from './base';

export type ShadowState =
  | 'SHADOW_IDLE'
  | 'SHADOW_SIGN_DETECTED'
  | 'SHADOW_PORTAL_OPENING'
  | 'SHIKIGAMI_SUMMONING'
  | 'SHIKIGAMI_ACTIVE'
  | 'SHIKIGAMI_DISAPPEARING';

const SIGN_OF: Record<ShikigamiKind, GestureId> = { dogs: 'dogs_sign', nue: 'nue_sign', toad: 'toad_sign' };
const KIND_OF: Partial<Record<GestureId, ShikigamiKind>> = { dogs_sign: 'dogs', nue_sign: 'nue', toad_sign: 'toad' };
const NAME: Record<ShikigamiKind, string> = { dogs: 'DIVINE DOGS', nue: 'NUE', toad: 'TOAD' };
const PORTAL_COLOR: Record<ShikigamiKind, [number, number, number]> = {
  dogs: hexToRgb('#6d5cff'),
  nue: hexToRgb('#7fb4ff'),
  toad: hexToRgb('#3dd68c'),
};
const SHADOW: [number, number, number] = [8, 6, 16];

export class TenShadowsTechnique extends BaseTechnique<ShadowState> {
  readonly meta: TechniqueMeta = {
    id: 'tenShadows',
    name: 'Ten Shadows',
    character: 'megumi',
    priority: PRIORITY.TWO_HAND,
    triggers: ['dogs_sign', 'nue_sign', 'toad_sign'],
    color: '#7b6cff',
    hint: '🤘🤘 псы · 🕊 нуэ (большие пальцы вместе) · 🐸 жаба',
  };

  kind: ShikigamiKind = 'dogs';
  private hands: number[] = [0, 1];
  private signSince = 0;
  private signLast = 0;
  private px = 0;
  private py = 0;
  private size = 100;
  private facing: 1 | -1 = 1;
  private aim: Vec2 = { x: 1, y: 0 };
  private tx = 0;
  private ty = 0;
  private summonT = 0;
  private attacked = false;
  summons: ShikigamiKind[] = [];

  constructor() {
    super('SHADOW_IDLE');
  }

  critical(): boolean {
    return this.state !== 'SHADOW_IDLE' && this.state !== 'SHADOW_SIGN_DETECTED';
  }

  private hold(): number {
    const S = CFG.SHADOWS;
    return this.kind === 'dogs' ? S.DOGS_HOLD : this.kind === 'nue' ? S.NUE_HOLD : S.TOAD_HOLD;
  }

  private active(): number {
    const S = CFG.SHADOWS;
    return this.kind === 'dogs' ? S.DOGS_ACTIVE : this.kind === 'nue' ? S.NUE_ACTIVE : S.TOAD_ACTIVE;
  }

  override progress(t: number): number {
    if (this.state === 'SHADOW_SIGN_DETECTED') return Math.min(1, (t - this.signSince) / (this.hold() * this.hs));
    return this.state === 'SHADOW_IDLE' ? 0 : 1;
  }

  override extra(): string {
    return this.state === 'SHADOW_IDLE' ? '' : NAME[this.kind];
  }

  update(ctx: TechniqueContext): void {
    const { t, fx, sfx, W, H } = ctx;
    const S = CFG.SHADOWS;

    if (this.state === 'SHADOW_IDLE') {
      const g = this.accept(ctx);
      const k = g ? KIND_OF[g.id] : undefined;
      if (!g || !k) return;
      this.kind = k;
      this.hands = g.hands;
      this.signSince = t;
      this.signLast = t;
      this.go('SHADOW_SIGN_DETECTED', t);
    }

    const ha = lastHand(ctx, this.hands[0]);
    const hb = lastHand(ctx, this.hands[1] ?? this.hands[0]);
    if (findCand(ctx, SIGN_OF[this.kind])) this.signLast = t;
    const signOk = t - this.signLast < CFG.POSE_GRACE;
    const lost = t - Math.max(ha.lastSeen, hb.lastSeen) > CFG.LOST_GRACE;
    const palm = (ha.palmPx + hb.palmPx) / 2;
    const cx = (ha.palm.x + hb.palm.x) / 2;
    const cy = (ha.palm.y + hb.palm.y) / 2;

    // toad tongue follows the direction the palms move
    if (this.state !== 'SHIKIGAMI_DISAPPEARING' && ctx.fresh && (ha.present || hb.present)) {
      const vx = (ha.palmVel.x + hb.palmVel.x) / 2;
      const vy = (ha.palmVel.y + hb.palmVel.y) / 2;
      if (Math.hypot(vx, vy) > 1.5) this.aim = norm({ x: vx, y: vy }, this.aim);
    }

    const portalOpen =
      this.state === 'SHADOW_PORTAL_OPENING'
        ? this.age(t) / S.PORTAL
        : this.state === 'SHIKIGAMI_SUMMONING' || this.state === 'SHIKIGAMI_ACTIVE'
          ? 1
          : this.state === 'SHIKIGAMI_DISAPPEARING'
            ? 1 - this.age(t) / S.DISAPPEAR
            : 0;
    if (portalOpen > 0) fx.portal(this.px, this.py, this.size * 1.1, Math.min(1, portalOpen), PORTAL_COLOR[this.kind]);
    if (this.state === 'SHIKIGAMI_SUMMONING' || this.state === 'SHIKIGAMI_ACTIVE' || this.state === 'SHIKIGAMI_DISAPPEARING') {
      const age = t - this.summonT;
      const life = S.SUMMON + this.active() + S.DISAPPEAR;
      const alpha = this.state === 'SHIKIGAMI_DISAPPEARING' ? Math.max(0, 1 - this.age(t) / S.DISAPPEAR) : Math.min(1, age / S.SUMMON);
      fx.shikigami({ kind: this.kind, age, alpha, x: this.px, y: this.py, size: this.size, facing: this.facing, dir: this.aim, tx: this.tx, ty: this.ty, life });
    }

    switch (this.state) {
      case 'SHADOW_SIGN_DETECTED':
        if (!signOk || lost) return this.go('SHADOW_IDLE', t);
        if (ctx.fresh && Math.random() < 0.5) fx.burst(cx, cy, SHADOW, 3, palm * 0.8, { dark: true, life: 0.6, size: palm * 0.12 });
        if (t - this.signSince >= this.hold() * ctx.settings.holdScale) {
          this.size = Math.max(palm * 1.4, Math.min(W, H) * 0.16);
          this.px = cx;
          this.py = this.kind === 'nue' ? cy - palm * 2 : cy + palm * 1.7;
          this.py = Math.max(this.size * 0.6, Math.min(H - this.size * 0.3, this.py));
          this.facing = this.px < W / 2 ? 1 : -1;
          if (Math.hypot(this.aim.x, this.aim.y) < 0.5 || this.kind !== 'toad') this.aim = norm({ x: this.facing, y: -0.25 });
          sfx.play('portal');
          fx.burst(this.px, this.py, SHADOW, 50, this.size * 2, { dark: true, life: 0.9, size: this.size * 0.1 });
          this.go('SHADOW_PORTAL_OPENING', t);
        }
        break;

      case 'SHADOW_PORTAL_OPENING':
        if (this.age(t) >= S.PORTAL) {
          this.summonT = t;
          this.attacked = false;
          this.computeTarget(W, H);
          sfx.play('summon');
          if (this.kind === 'dogs') sfx.play('howl');
          if (this.kind === 'toad') sfx.play('croak');
          fx.burst(this.px, this.py, SHADOW, 70, this.size * 3, { dark: true, life: 1, size: this.size * 0.12, dir: { x: 0, y: -1 }, spread: 1.2 });
          fx.shockwave(this.px, this.py, this.size * 0.3, this.size * 2.2, 0.5, PORTAL_COLOR[this.kind], 6);
          ctx.cine({ pre: 'TEN SHADOWS', title: NAME[this.kind], color: '#9d8cff', duration: 1.6, big: true });
          this.summons.push(this.kind);
          this.go('SHIKIGAMI_SUMMONING', t);
        }
        break;

      case 'SHIKIGAMI_SUMMONING':
        if (this.age(t) >= S.SUMMON) this.go('SHIKIGAMI_ACTIVE', t);
        break;

      case 'SHIKIGAMI_ACTIVE': {
        const age = t - this.summonT;
        const at = this.kind === 'dogs' ? S.DOGS_ATTACK : this.kind === 'nue' ? S.NUE_STRIKE : S.TOAD_TONGUE + 0.25;
        if (!this.attacked && age >= at) {
          this.attacked = true;
          this.attack(ctx);
        }
        if (this.age(t) >= this.active()) {
          fx.burst(this.px, this.py - this.size * 0.3, SHADOW, 60, this.size * 1.5, { dark: true, life: 1.1, size: this.size * 0.12 });
          this.go('SHIKIGAMI_DISAPPEARING', t);
        }
        break;
      }

      case 'SHIKIGAMI_DISAPPEARING':
        if (this.age(t) >= S.DISAPPEAR) {
          this.cooldownUntil = t + S.COOLDOWN;
          this.latch();
          this.go('SHADOW_IDLE', t);
        }
        break;
      default:
        break;
    }
  }

  demo(ctx: TechniqueContext): void {
    const order: ShikigamiKind[] = ['dogs', 'nue', 'toad'];
    this.kind = order[(order.indexOf(this.kind) + (this.summons.length ? 1 : 0)) % 3];
    this.size = Math.min(ctx.W, ctx.H) * 0.18;
    this.px = ctx.W * 0.35;
    this.py = this.kind === 'nue' ? ctx.H * 0.35 : ctx.H * 0.72;
    this.facing = 1;
    this.aim = norm({ x: 1, y: -0.3 });
    ctx.sfx.play('portal');
    this.go('SHADOW_PORTAL_OPENING', ctx.t);
  }

  private computeTarget(W: number, H: number): void {
    const f = this.facing;
    if (this.kind === 'dogs') {
      this.tx = Math.max(this.size, Math.min(W - this.size, this.px + f * W * 0.34));
      this.ty = Math.min(H - this.size * 0.4, this.py);
    } else if (this.kind === 'nue') {
      this.tx = Math.max(this.size, Math.min(W - this.size, this.px + f * W * 0.3));
      this.ty = Math.min(H * 0.85, this.py + H * 0.4);
    } else {
      const L = Math.min(W, H) * 0.5;
      this.tx = this.px + this.aim.x * L;
      this.ty = this.py - this.size * 0.7 + this.aim.y * L;
    }
  }

  private attack(ctx: TechniqueContext): void {
    const { fx, sfx } = ctx;
    const s = this.size;
    if (this.kind === 'dogs') {
      for (let i = -1; i <= 1; i++) {
        const ox = i * s * 0.18;
        fx.slash(this.tx - s * 0.5 + ox, this.ty - s * 0.6, this.tx + s * 0.3 + ox, this.ty + s * 0.35, { color: hexToRgb('#cfc8ff'), width: s * 0.05, delay: (i + 1) * 0.04 });
      }
      fx.shockwave(this.tx, this.ty, s * 0.2, s * 1.4, 0.4, PORTAL_COLOR.dogs, 6);
      fx.burst(this.tx, this.ty, SHADOW, 40, s * 2, { dark: true, life: 0.7, size: s * 0.08 });
      fx.shake(0.4);
      sfx.play('slash', 0.5);
    } else if (this.kind === 'nue') {
      const yellow = hexToRgb('#cfe6ff');
      fx.bolt(this.tx, this.ty - ctx.H * 0.38, this.tx, this.ty, yellow, 4, 0.35);
      fx.bolt(this.tx, this.ty - ctx.H * 0.38, this.tx + s * 0.3, this.ty, yellow, 2, 0.3);
      fx.flash([200, 225, 255], 0.45, 2.6);
      fx.shockwave(this.tx, this.ty, s * 0.2, s * 2.6, 0.55, yellow, 10);
      fx.burst(this.tx, this.ty, yellow, 70, s * 3, { white: 0.5 });
      fx.shake(0.6);
      sfx.play('thunder');
    } else {
      fx.shockwave(this.tx, this.ty, s * 0.15, s * 1.2, 0.35, PORTAL_COLOR.toad, 6);
      fx.burst(this.tx, this.ty, PORTAL_COLOR.toad, 30, s * 1.5);
      fx.shake(0.3);
    }
  }
}
