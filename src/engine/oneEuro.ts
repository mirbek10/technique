/**
 * One Euro Filter: adaptive low-pass. Heavy smoothing when the hand is still,
 * near-zero lag when it moves fast. Ideal for landmark jitter.
 */
class LowPass {
  private y = 0;
  private init = false;
  filter(x: number, alpha: number): number {
    if (!this.init) {
      this.init = true;
      this.y = x;
      return x;
    }
    this.y = alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
  get value(): number {
    return this.y;
  }
  reset(): void {
    this.init = false;
  }
}

export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT = -1;
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;

  constructor(minCutoff = 1.4, beta = 0.012, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, t: number): number {
    if (this.lastT < 0) {
      this.lastT = t;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const dt = Math.max(1e-3, t - this.lastT);
    this.lastT = t;
    const deriv = (value - this.x.value) / dt;
    const ed = this.dx.filter(deriv, OneEuroFilter.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(ed);
    return this.x.filter(value, OneEuroFilter.alpha(cutoff, dt));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastT = -1;
  }
}
