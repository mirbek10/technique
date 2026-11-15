/**
 * Render smoke test: every technique's effects are driven through the real EffectManager with a mock
 * Canvas 2D context for many seconds. Catches runtime errors in drawing code and unbounded pools.
 * (Visual quality itself can only be judged in a browser.)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { TechniqueId } from '../types';
import { POSE, MAP, VW, VH, detection, type HandSpec } from './synth';

const calls = new Map<string, number>();

function mockCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    getTransform: () => ({ a: 1, d: 1 }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  return new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...args: unknown[]) => {
        calls.set(k, (calls.get(k) ?? 0) + 1);
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`non-finite argument to ${k}: ${args.join(',')}`);
      };
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => mockCtx() }) };
  g.Path2D = class {
    moveTo() {}
    lineTo() {}
    ellipse() {}
    arc() {}
    closePath() {}
    quadraticCurveTo() {}
  };
});

describe('effect engine (mock canvas)', () => {
  it('renders every technique for a long time without errors or unbounded growth', async () => {
    const { EffectManager } = await import('../fx/effectManager');
    const { TechniqueCore } = await import('../core');
    const { NOOP_SFX } = await import('../fx/api');
    const fx = new EffectManager();
    fx.W = VW;
    fx.H = VH;
    const core = new TechniqueCore({ fx, sfx: NOOP_SFX });
    core.setSettings({ ...core.settings, character: 'all' }, 0);
    const ctx = mockCtx();
    const video = { readyState: 4, videoWidth: VW, videoHeight: VH } as HTMLVideoElement;
    const view = { video, ...MAP, W: VW };
    const ids: TechniqueId[] = ['dismantle', 'blackFlash', 'piercingBlood', 'tenShadows', 'tenShadows', 'tenShadows', 'unlimitedVoid', 'malevolentShrine'];
    const hand: HandSpec = { cx: 640, cy: 400, ...POSE.open };
    let t = 0;
    const dt = 1 / 60;
    for (const id of ids) {
      core.demo(id, t, VW, VH);
      for (let i = 0; i < 60 * 12; i++) {
        t += dt;
        const det = i % 2 === 0 ? (i < 60 * 9 ? detection([{ ...hand, ...POSE.point }]) : detection([hand])) : undefined;
        core.step(det, t, dt, MAP, VW, VH);
        fx.renderBackground(ctx, dt, t, view, core.track.slots.map((h) => ({ pts: h.pts, palmPx: h.palmPx, alpha: 1 })));
        fx.renderTint(ctx);
        fx.renderForeground(ctx, dt * fx.timeScale(dt), view);
        fx.endFrame();
        expect(fx.particleCount).toBeLessThanOrEqual(3300);
      }
    }
    // pools drained after the effects finished
    for (let i = 0; i < 120; i++) {
      t += dt;
      core.step(null, t, dt, MAP, VW, VH);
      fx.renderForeground(ctx, dt, view);
      fx.endFrame();
    }
    expect(fx.particleCount).toBe(0);
    expect(calls.get('drawImage') ?? 0).toBeGreaterThan(1000);
    expect(calls.get('stroke') ?? 0).toBeGreaterThan(1000);
    for (const tech of core.techs) if (tech.meta.id !== 'limitless') expect(tech.engaged()).toBe(false);
  });

  it('the segmentation mask path of the person layer runs', async () => {
    const { PersonLayer } = await import('../fx/personLayer');
    const p = new PersonLayer();
    const data = new Float32Array(256 * 144).map((_, i) => (i % 7) / 7);
    p.setMask(data, 256, 144, 1);
    expect(p.hasSegmentation(1.2)).toBe(true);
    const video = { readyState: 4 } as HTMLVideoElement;
    p.draw(mockCtx(), { video, ...MAP, W: VW }, VW, VH, [], 1.2, 1);
    expect(p.hasSegmentation(3)).toBe(false);
  });
});
