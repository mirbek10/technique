/**
 * Object-pooled particle system: struct-of-arrays in typed arrays, fixed capacity, swap-remove.
 * Nothing is allocated per frame or per particle.
 */
import type { Sprite } from './sprites';

export class ParticlePool {
  readonly cap: number;
  n = 0;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private size: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private sid: Uint16Array;
  private sprites: Sprite[] = [];
  private ids = new Map<Sprite, number>();
  /** budget multiplier from the graphics profile */
  budget = 1;

  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.sid = new Uint16Array(cap);
  }

  private spriteId(s: Sprite): number {
    let id = this.ids.get(s);
    if (id === undefined) {
      id = this.sprites.length;
      this.sprites.push(s);
      this.ids.set(s, id);
    }
    return id;
  }

  spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, sprite: Sprite, drag = 2, grav = 0): void {
    if (this.n >= Math.floor(this.cap * this.budget)) return;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.sid[i] = this.spriteId(sprite);
  }

  clear(): void {
    this.n = 0;
  }

  updateDraw(ctx: CanvasRenderingContext2D, dt: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        this.x[i] = this.x[j];
        this.y[i] = this.y[j];
        this.vx[i] = this.vx[j];
        this.vy[i] = this.vy[j];
        this.life[i] = this.life[j];
        this.max[i] = this.max[j];
        this.size[i] = this.size[j];
        this.drag[i] = this.drag[j];
        this.grav[i] = this.grav[j];
        this.sid[i] = this.sid[j];
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= k;
      this.vy[i] = this.vy[i] * k + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      const f = this.life[i] / this.max[i];
      const r = this.size[i] * (0.4 + 0.6 * f);
      ctx.globalAlpha = f;
      ctx.drawImage(this.sprites[this.sid[i]], this.x[i] - r, this.y[i] - r, r * 2, r * 2);
      i++;
    }
  }
}
