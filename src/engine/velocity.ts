import type { Vec2 } from './types';

/** Recent position samples; velocity is measured across a time window (several frames). */
export class VelocityTracker {
  private ts: number[] = [];
  private xs: number[] = [];
  private ys: number[] = [];

  push(t: number, x: number, y: number): void {
    this.ts.push(t);
    this.xs.push(x);
    this.ys.push(y);
    if (this.ts.length > 16) {
      this.ts.shift();
      this.xs.shift();
      this.ys.shift();
    }
  }

  reset(): void {
    this.ts = [];
    this.xs = [];
    this.ys = [];
  }

  /** px/s over the last `window` seconds */
  velocity(window = 0.1): Vec2 {
    const n = this.ts.length;
    if (n < 2) return { x: 0, y: 0 };
    const tN = this.ts[n - 1];
    let i = n - 2;
    while (i > 0 && tN - this.ts[i] < window) i--;
    const dt = tN - this.ts[i];
    if (dt < 1e-3) return { x: 0, y: 0 };
    return { x: (this.xs[n - 1] - this.xs[i]) / dt, y: (this.ys[n - 1] - this.ys[i]) / dt };
  }
}
