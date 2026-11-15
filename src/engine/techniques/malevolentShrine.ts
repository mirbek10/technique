/**
 * MALEVOLENT SHRINE (Sukuna): simplified two-hand seal (index + middle up on both hands, palms close,
 * mirrored, level) held 1.5 s. The shrine rises behind the user; cuts sweep the screen for 8 s.
 * Both palms open for 1 s ends it early. With DOMAIN_COMBOS, Dismantle can be used while it is active.
 */
import { GESTURE_CFG as CFG } from '../config';
import { clamp, easeOutCubic, hexToRgb } from '../math';
import { BaseTechnique, PRIORITY, findCand, lastHand, type TechniqueContext, type TechniqueMeta } from './base';

export type ShrineState = 'SHRINE_IDLE' | 'SHRINE_GESTURE' | 'SHRINE_CHARGING' | 'SHRINE_SUMMONING' | 'SHRINE_ACTIVE' | 'SHRINE_ENDING';

const RED = hexToRgb('#ff1f33');
const BLOOD: [number, number, number] = [120, 0, 10];
const DEBRIS: [number, number, number] = [30, 8, 8];

export class MalevolentShrineTechnique extends BaseTechnique<ShrineState> {
  readonly meta: TechniqueMeta = {
    id: 'malevolentShrine',
    name: 'Malevolent Shrine',
    character: 'sukuna',
    priority: PRIORITY.TWO_HAND,
    triggers: ['shrine_seal'],
    color: '#ff1f33',
    hint: '🙏 обе руки: указательный + средний, ладони рядом, 1,5 с · 🖐🖐 1 с — выход',
  };

  private hands: number[] = [0, 1];
  private sealSince = 0;
  private sealLast = 0;
  private openSince: number | null = null;
  private nextSlash = 0;
  private envAge = 0;
  private cx = 0;
  private cy = 0;
  intensity = 0;
  slashes = 0;
  private now = 0;

  constructor() {
    super('SHRINE_IDLE');
  }

  critical(): boolean {
    return this.state === 'SHRINE_SUMMONING' || this.state === 'SHRINE_ACTIVE' || this.state === 'SHRINE_ENDING';
  }

  override progress(t: number): number {
    if (this.state === 'SHRINE_GESTURE' || this.state === 'SHRINE_CHARGING') return Math.min(1, (t - this.sealSince) / (CFG.SHRINE.HOLD * this.hs));
    if (this.state === 'SHRINE_ACTIVE') return 1 - Math.min(1, this.age(t) / CFG.SHRINE.ACTIVE);
    return this.state === 'SHRINE_IDLE' ? 0 : 1;
  }

  activeLeft(t: number): number {
    return this.state === 'SHRINE_ACTIVE' ? Math.max(0, CFG.SHRINE.ACTIVE - this.age(t)) : 0;
  }

  override extra(): string {
    return this.state === 'SHRINE_ACTIVE' ? `DOMAIN ACTIVE · ${this.activeLeft(this.now).toFixed(1)} с` : '';
  }

  override cancel(t: number): void {
    this.intensity = 0;
    this.go('SHRINE_IDLE', t);
  }

  update(ctx: TechniqueContext): void {
    const { t, dt, fx, sfx, W, H } = ctx;
    const S = CFG.SHRINE;
    this.now = t;
    if (this.state !== 'SHRINE_IDLE') this.envAge += dt;

    if (this.state === 'SHRINE_IDLE') {
      sfx.layer('shrine', 0);
      const g = this.accept(ctx);
      if (!g) return;
      this.hands = g.hands;
      this.sealSince = t;
      this.sealLast = t;
      this.go('SHRINE_GESTURE', t);
    }

    const ha = lastHand(ctx, this.hands[0]);
    const hb = lastHand(ctx, this.hands[1] ?? this.hands[0]);
    if (ha.present && hb.present) {
      this.cx = (ha.palm.x + hb.palm.x) / 2;
      this.cy = (ha.palm.y + hb.palm.y) / 2;
    }
    if (findCand(ctx, 'shrine_seal')) this.sealLast = t;
    const sealOk = t - this.sealLast < CFG.POSE_GRACE;
    const lost = t - Math.max(ha.lastSeen, hb.lastSeen) > CFG.LOST_GRACE;
    const hold = S.HOLD * ctx.settings.holdScale;

    switch (this.state) {
      case 'SHRINE_GESTURE':
        if (!sealOk || lost) return this.go('SHRINE_IDLE', t);
        if (this.age(t) >= S.STABLE_GESTURE) this.go('SHRINE_CHARGING', t);
        break;

      case 'SHRINE_CHARGING': {
        if (!sealOk || lost) return this.go('SHRINE_IDLE', t);
        const u = clamp((t - this.sealSince) / hold);
        fx.tint(BLOOD, 0.18 * u);
        if (ha.present) fx.handAura(ha.pts, ha.palmPx, RED, 0.3 + 0.6 * u);
        if (hb.present) fx.handAura(hb.pts, hb.palmPx, RED, 0.3 + 0.6 * u);
        if (u >= 1) {
          this.envAge = 0;
          this.intensity = 0;
          sfx.play('shrineSummon');
          fx.shockwave(this.cx, this.cy, ha.palmPx * 0.5, Math.max(W, H), 1.0, RED, 28);
          fx.shake(0.6);
          ctx.cine({ pre: 'DOMAIN EXPANSION', title: 'MALEVOLENT SHRINE', color: '#ff1f33', duration: 3.2, big: true });
          this.go('SHRINE_SUMMONING', t);
        }
        break;
      }

      case 'SHRINE_SUMMONING': {
        const u = clamp(this.age(t) / S.SUMMON);
        this.intensity = easeOutCubic(u);
        fx.domain({ kind: 'shrine', intensity: this.intensity, age: this.envAge, progress: u, cx: this.cx, cy: this.cy, distortion: Math.sin(u * Math.PI) * 0.5 });
        if (u >= 1) {
          this.openSince = null;
          this.nextSlash = t + 0.2;
          this.go('SHRINE_ACTIVE', t);
        }
        break;
      }

      case 'SHRINE_ACTIVE': {
        this.intensity = 1;
        fx.domain({ kind: 'shrine', intensity: 1, age: this.envAge, progress: 1, cx: this.cx, cy: this.cy, distortion: 0 });
        if (t >= this.nextSlash) {
          this.nextSlash = t + S.SLASH_INTERVAL * (0.6 + Math.random() * 0.8);
          this.ambientSlash(ctx);
        }
        if (ctx.fresh && Math.random() < 0.35) fx.burst(Math.random() * W, -10, DEBRIS, 2, 60, { dark: true, gravity: 500, life: 1.6, size: 5, dir: { x: 0, y: 1 }, spread: 0.4 });
        const open = findCand(ctx, 'open_both');
        if (open) {
          if (this.openSince === null) this.openSince = t;
          if (t - this.openSince >= S.OPEN_HOLD * ctx.settings.holdScale) this.end(ctx);
        } else this.openSince = null;
        if (this.state === 'SHRINE_ACTIVE' && this.age(t) >= S.ACTIVE) this.end(ctx);
        break;
      }

      case 'SHRINE_ENDING': {
        const u = clamp(this.age(t) / S.ENDING);
        this.intensity = 1 - u;
        fx.domain({ kind: 'shrine', intensity: this.intensity, age: this.envAge, progress: 1, cx: this.cx, cy: this.cy, distortion: 0 });
        if (u >= 1) {
          this.intensity = 0;
          this.cooldownUntil = t + S.COOLDOWN;
          this.latch();
          this.go('SHRINE_IDLE', t);
        }
        break;
      }
      default:
        break;
    }
    sfx.layer('shrine', this.intensity);
  }

  demo(ctx: TechniqueContext): void {
    this.cx = ctx.W / 2;
    this.cy = ctx.H / 2;
    this.envAge = 0;
    ctx.sfx.play('shrineSummon');
    ctx.fx.shockwave(this.cx, this.cy, 40, Math.max(ctx.W, ctx.H), 1.0, RED, 28);
    ctx.cine({ pre: 'DOMAIN EXPANSION', title: 'MALEVOLENT SHRINE', color: '#ff1f33', duration: 3.2, big: true });
    this.go('SHRINE_SUMMONING', ctx.t);
  }

  private end(ctx: TechniqueContext): void {
    ctx.sfx.play('collapse');
    this.go('SHRINE_ENDING', ctx.t);
  }

  /** Random cuts across the domain: environment destruction. */
  private ambientSlash(ctx: TechniqueContext): void {
    const { fx, W, H } = ctx;
    const a = Math.random() * Math.PI;
    const cx = W * (0.15 + Math.random() * 0.7);
    const cy = H * (0.15 + Math.random() * 0.7);
    const L = Math.max(W, H) * (0.25 + Math.random() * 0.35);
    const dx = Math.cos(a) * L;
    const dy = Math.sin(a) * L;
    const power = 0.5 + Math.random() * 0.5;
    fx.slash(cx - dx, cy - dy, cx + dx, cy + dy, { color: RED, width: 4 + power * 8, power, distort: true });
    if (Math.random() < 0.4) fx.shockwave(cx, cy, 10, 120 + power * 160, 0.4, RED, 6);
    fx.burst(cx, cy, RED, 14, 260, { white: 0.3, life: 0.5 });
    fx.shake(0.18 + power * 0.18);
    ctx.sfx.play('slash', power * 0.6);
    this.slashes++;
  }
}
