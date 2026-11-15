/**
 * SummonEffect: stylised 2D shikigami drawn procedurally (no external models/sprites needed).
 * Each one follows a scripted path from its portal and attacks at the time the technique fires the hit.
 * Drawn in two passes: `dark` (silhouette fills) and `light` (rim glow, eyes, lightning).
 */
import { GESTURE_CFG as CFG } from '../config';
import { TAU, clamp, easeInOut, easeOutCubic, lerp, rgba, type RGB } from '../math';
import type { ShikigamiCmd } from './api';
import { drawBolt, glow, spr } from './sprites';

type Pass = 'dark' | 'light';

/* ------------------------------------------------------------------ wolves */

function wolfPath(s: number, ph: number, lunge: number): Path2D {
  const p = new Path2D();
  // body + chest
  p.ellipse(0, -0.02 * s, 0.42 * s, 0.16 * s, -0.05 - lunge * 0.15, 0, TAU);
  p.ellipse(0.24 * s, -0.05 * s, 0.19 * s, 0.18 * s, 0, 0, TAU);
  // head + snout
  const hx = 0.55 * s;
  const hy = -0.22 * s + lunge * 0.06 * s;
  p.ellipse(hx, hy, 0.15 * s, 0.11 * s, -0.2, 0, TAU);
  p.moveTo(hx + 0.05 * s, hy - 0.07 * s);
  p.lineTo(hx + 0.3 * s, hy + 0.02 * s);
  p.lineTo(hx + 0.06 * s, hy + 0.09 * s);
  p.closePath();
  // ears
  for (const ex of [-0.04, 0.05]) {
    p.moveTo(hx + ex * s - 0.04 * s, hy - 0.07 * s);
    p.lineTo(hx + ex * s - 0.02 * s, hy - 0.27 * s);
    p.lineTo(hx + ex * s + 0.05 * s, hy - 0.08 * s);
    p.closePath();
  }
  // tail
  p.moveTo(-0.38 * s, -0.08 * s);
  p.quadraticCurveTo(-0.62 * s, -0.12 * s - Math.sin(ph) * 0.05 * s, -0.78 * s, -0.3 * s);
  p.quadraticCurveTo(-0.6 * s, -0.04 * s, -0.36 * s, 0.02 * s);
  p.closePath();
  // legs (two segments each, gallop cycle)
  const legs: [number, number][] = [
    [0.28, 0],
    [0.2, Math.PI * 0.5],
    [-0.28, Math.PI],
    [-0.36, Math.PI * 1.5],
  ];
  for (const [lx, off] of legs) {
    const a = Math.sin(ph + off) * (0.7 + lunge * 0.4) + (lx > 0 ? -lunge * 0.9 : lunge * 0.7);
    const kx = lx * s + Math.sin(a) * 0.2 * s;
    const ky = 0.08 * s + Math.cos(a) * 0.2 * s;
    const fx = kx + Math.sin(a * 1.4 + 0.3) * 0.2 * s;
    const fy = ky + Math.cos(a * 1.4 + 0.3) * 0.18 * s;
    const w = 0.045 * s;
    p.moveTo(lx * s - w, 0.02 * s);
    p.lineTo(kx - w * 0.8, ky);
    p.lineTo(fx - w * 0.6, fy);
    p.lineTo(fx + w * 0.9, fy + w * 0.3);
    p.lineTo(kx + w * 0.8, ky);
    p.lineTo(lx * s + w, 0.02 * s);
    p.closePath();
  }
  return p;
}

function drawWolf(ctx: CanvasRenderingContext2D, pass: Pass, x: number, y: number, s: number, facing: number, ph: number, lunge: number, alpha: number, white: boolean, t: number): void {
  if (alpha < 0.01) return;
  const path = wolfPath(s, ph, lunge);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  if (pass === 'dark') {
    ctx.globalAlpha = alpha * 0.95;
    ctx.fillStyle = white ? '#dfe3ff' : '#07060d';
    ctx.fill(path);
    ctx.strokeStyle = white ? 'rgba(120,130,200,0.8)' : 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke(path);
  } else {
    const rim: RGB = white ? [150, 180, 255] : [150, 90, 255];
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(rim, 0.45 * alpha);
    ctx.lineWidth = s * 0.05;
    ctx.stroke(path);
    ctx.strokeStyle = rgba(rim, 0.8 * alpha);
    ctx.lineWidth = 1.5;
    ctx.stroke(path);
    // glowing eye
    const ex = 0.6 * s;
    const ey = -0.25 * s + lunge * 0.06 * s;
    spr(ctx, glow(white ? [120, 200, 255] : [220, 60, 255], true, 64), ex, ey, s * 0.07 * (1 + 0.2 * Math.sin(t * 9)), alpha);
  }
  ctx.restore();
}

function renderDogs(ctx: CanvasRenderingContext2D, c: ShikigamiCmd, W: number, pass: Pass, t: number): void {
  const S = CFG.SHADOWS;
  const s = c.size * 1.1;
  const f = c.facing;
  for (let k = 0; k < 2; k++) {
    const a = c.age - k * 0.14;
    if (a < 0) continue;
    const lane = k ? s * 0.22 : -s * 0.05;
    let x = c.x;
    let y = c.y + lane;
    let sc = 1;
    let lunge = 0;
    if (a < S.SUMMON) {
      const u = a / S.SUMMON;
      y += s * 0.5 * (1 - easeOutCubic(u));
      sc = 0.4 + 0.6 * u;
    } else if (a < S.DOGS_ATTACK - 0.1) {
      const u = (a - S.SUMMON) / (S.DOGS_ATTACK - 0.1 - S.SUMMON);
      x = lerp(c.x, c.tx - f * s * (0.8 + k * 0.5), easeInOut(u));
    } else if (a < S.DOGS_ATTACK + 0.35) {
      const u = (a - (S.DOGS_ATTACK - 0.1)) / 0.45;
      x = lerp(c.tx - f * s * (0.8 + k * 0.5), c.tx + f * s * (0.1 - k * 0.3), u);
      y -= Math.sin(Math.PI * u) * s * 0.45;
      lunge = Math.sin(Math.PI * u);
    } else {
      const u = a - (S.DOGS_ATTACK + 0.35);
      x = c.tx + f * s * (0.1 - k * 0.3) + f * u * W * 0.6;
    }
    drawWolf(ctx, pass, x, y, s * sc, f, a * 15 + k, lunge, c.alpha, k === 0, t);
  }
}

/* -------------------------------------------------------------------- nue */

function nuePos(c: ShikigamiCmd, a: number, W: number, H: number): [number, number] {
  const S = CFG.SHADOWS;
  const sx = c.tx;
  const sy = c.ty - H * 0.38;
  const rise: [number, number] = [c.x, c.y - c.size * 0.9];
  if (a < S.SUMMON) {
    const u = easeOutCubic(a / S.SUMMON);
    return [c.x, c.y - c.size * 0.9 * u];
  }
  if (a < S.NUE_STRIKE) {
    const u = easeInOut((a - S.SUMMON) / (S.NUE_STRIKE - S.SUMMON));
    const mx = (rise[0] + sx) / 2;
    const my = Math.min(rise[1], sy) - c.size * 1.2;
    const x = (1 - u) * (1 - u) * rise[0] + 2 * (1 - u) * u * mx + u * u * sx;
    const y = (1 - u) * (1 - u) * rise[1] + 2 * (1 - u) * u * my + u * u * sy;
    return [x, y];
  }
  const u = (a - S.NUE_STRIKE) / Math.max(0.1, c.life - S.NUE_STRIKE);
  return [sx + c.facing * W * 0.9 * u * u, sy - H * 0.35 * u];
}

function nuePath(s: number, flap: number): Path2D {
  const p = new Path2D();
  p.ellipse(0, 0, 0.36 * s, 0.13 * s, 0, 0, TAU); // body
  p.arc(0.4 * s, -0.07 * s, 0.11 * s, 0, TAU); // head
  p.moveTo(0.48 * s, -0.11 * s);
  p.lineTo(0.68 * s, -0.03 * s);
  p.lineTo(0.48 * s, -0.01 * s);
  p.closePath(); // beak
  for (let i = 0; i < 3; i++) {
    p.moveTo((0.34 - i * 0.05) * s, -0.15 * s);
    p.lineTo((0.26 - i * 0.07) * s, (-0.36 + i * 0.05) * s);
    p.lineTo((0.3 - i * 0.05) * s, -0.13 * s);
    p.closePath(); // crest
  }
  // tail fan
  p.moveTo(-0.3 * s, -0.04 * s);
  p.lineTo(-0.78 * s, -0.16 * s);
  p.lineTo(-0.7 * s, 0.02 * s);
  p.lineTo(-0.8 * s, 0.14 * s);
  p.lineTo(-0.3 * s, 0.05 * s);
  p.closePath();
  // wings: far (up) and near (down), with feather jags along the trailing edge
  for (const side of [-1, 1]) {
    const span = 1.15 * s * (side < 0 ? Math.cos(flap) : Math.cos(flap + 0.4) * 0.85);
    const sx = 0.05 * s;
    const sy = side * 0.04 * s;
    p.moveTo(sx + 0.12 * s, sy);
    p.quadraticCurveTo(sx + 0.25 * s, sy + side * span * 0.55, sx - 0.05 * s, sy + side * span);
    for (let j = 1; j <= 5; j++) {
      const u = j / 5;
      p.lineTo(sx - 0.05 * s - u * 0.34 * s, sy + side * span * (1 - u * 0.75) - side * 0.02 * s);
      p.lineTo(sx - 0.02 * s - u * 0.34 * s, sy + side * span * (1 - u * 0.75) - side * 0.12 * s * (1 - u * 0.5));
    }
    p.lineTo(sx - 0.25 * s, sy);
    p.closePath();
  }
  return p;
}

function renderNue(ctx: CanvasRenderingContext2D, c: ShikigamiCmd, W: number, H: number, pass: Pass, _t: number, q: number): void {
  const a = c.age;
  const s = c.size * 1.3;
  const [x, y] = nuePos(c, a, W, H);
  const sc = a < CFG.SHADOWS.SUMMON ? 0.4 + 0.6 * (a / CFG.SHADOWS.SUMMON) : 1;
  const path = nuePath(s * sc, a * 9);
  const blue: RGB = [120, 180, 255];
  if (pass === 'light') {
    // electric trail: bolts between earlier points of the flight path
    const n = q > 0.5 ? 7 : 4;
    let [px, py] = nuePos(c, Math.max(0, a - 0.05), W, H);
    for (let k = 2; k <= n; k++) {
      const [qx, qy] = nuePos(c, Math.max(0, a - k * 0.05), W, H);
      if (Math.hypot(qx - px, qy - py) > 2) drawBolt(ctx, px, py, qx, qy, s * 0.15, blue, 1.4, c.alpha * (1 - k / (n + 1)));
      px = qx;
      py = qy;
    }
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(c.facing, 1);
  if (pass === 'dark') {
    ctx.globalAlpha = c.alpha * 0.95;
    ctx.fillStyle = '#0a0b1f';
    ctx.fill(path);
  } else {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba(blue, 0.45 * c.alpha);
    ctx.lineWidth = s * 0.05;
    ctx.stroke(path);
    ctx.strokeStyle = rgba([210, 235, 255], 0.85 * c.alpha);
    ctx.lineWidth = 1.4;
    ctx.stroke(path);
    spr(ctx, glow([255, 240, 120], true, 64), 0.44 * s * sc, -0.09 * s * sc, s * 0.05, c.alpha);
    // crackling arcs around the wings
    for (let i = 0; i < (q > 0.5 ? 3 : 1); i++) {
      if (Math.random() > 0.6) continue;
      const ang = Math.random() * TAU;
      drawBolt(ctx, 0, 0, Math.cos(ang) * s * 0.9, Math.sin(ang) * s * 0.7, s * 0.2, blue, 1.2, c.alpha);
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------- toad */

function renderToad(ctx: CanvasRenderingContext2D, c: ShikigamiCmd, pass: Pass, t: number): void {
  const S = CFG.SHADOWS;
  const a = c.age;
  const s = c.size * 1.15;
  const f = c.facing;
  const sitX = c.x + f * s * 0.15;
  const sitY = c.y - s * 0.05;
  let x = sitX;
  let y = sitY;
  let sc = 1;
  if (a < S.SUMMON) {
    const u = a / S.SUMMON;
    x = lerp(c.x, sitX, u);
    y = c.y + s * 0.3 * (1 - u) - Math.sin(Math.PI * u) * s * 0.9;
    sc = 0.5 + 0.5 * u;
  }
  const exitAt = c.life - S.DISAPPEAR;
  if (a > exitAt) {
    const u = clamp((a - exitAt) / S.DISAPPEAR);
    y = sitY - Math.sin(Math.PI * u) * s * 0.5 + u * s * 0.6;
    sc = 1 - 0.5 * u;
  }
  const ss = s * sc;
  // tongue
  const t0 = S.TOAD_TONGUE;
  let e = 0;
  if (a > t0 && a < t0 + 0.25) e = easeOutCubic((a - t0) / 0.25);
  else if (a >= t0 + 0.25 && a < t0 + 0.35) e = 1;
  else if (a >= t0 + 0.35 && a < t0 + 0.75) e = 1 - easeInOut((a - t0 - 0.35) / 0.4);
  const mx = x + f * ss * 0.42;
  const my = y - ss * 0.42;
  const tx = lerp(mx, c.tx, e);
  const ty = lerp(my, c.ty, e);
  const nx = -(ty - my);
  const ny = tx - mx;
  const wob = Math.sin(a * 30) * 0.12 * e;

  const body = new Path2D();
  body.ellipse(0, -0.36 * ss, 0.56 * ss, 0.36 * ss, 0, 0, TAU);
  body.ellipse(-0.42 * ss, -0.12 * ss, 0.24 * ss, 0.14 * ss, -0.3, 0, TAU); // back leg
  body.ellipse(0.3 * ss, -0.04 * ss, 0.14 * ss, 0.07 * ss, 0, 0, TAU); // front foot
  body.arc(0.18 * ss, -0.7 * ss, 0.13 * ss, 0, TAU); // eye bumps
  body.arc(-0.16 * ss, -0.72 * ss, 0.13 * ss, 0, TAU);

  if (pass === 'dark') {
    if (e > 0.01) {
      ctx.globalAlpha = c.alpha;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.quadraticCurveTo((mx + tx) / 2 + nx * wob, (my + ty) / 2 + ny * wob, tx, ty);
      ctx.strokeStyle = '#3a0a1a';
      ctx.lineWidth = ss * 0.11;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.strokeStyle = '#ff5a8a';
      ctx.lineWidth = ss * 0.075;
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#ff7aa2';
      ctx.beginPath();
      ctx.arc(tx, ty, ss * 0.08, 0, TAU);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(f, 1);
    ctx.globalAlpha = c.alpha;
    const g = ctx.createLinearGradient(0, -0.75 * ss, 0, 0);
    g.addColorStop(0, '#1d3b22');
    g.addColorStop(1, '#050c07');
    ctx.fillStyle = g;
    ctx.fill(body);
    ctx.fillStyle = 'rgba(70,110,60,0.55)';
    ctx.beginPath();
    ctx.ellipse(0.12 * ss, -0.22 * ss, 0.3 * ss, 0.16 * ss, 0, 0, TAU);
    ctx.fill(); // belly
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0.48 * ss, -0.42 * ss);
    ctx.quadraticCurveTo(0.15 * ss, -0.34 * ss, -0.15 * ss, -0.46 * ss);
    ctx.stroke(); // mouth
    for (const ex of [0.18, -0.16]) {
      ctx.fillStyle = '#e8c43a';
      ctx.beginPath();
      ctx.arc(ex * ss, -0.72 * ss, 0.08 * ss, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.fillRect(ex * ss - 0.012 * ss, -0.79 * ss, 0.024 * ss, 0.14 * ss);
    }
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(f, 1);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba([60, 220, 140], 0.4 * c.alpha);
    ctx.lineWidth = ss * 0.035;
    ctx.stroke(body);
    ctx.restore();
    if (e > 0.6) spr(ctx, glow([255, 120, 170], false), tx, ty, ss * 0.3, (e - 0.6) * c.alpha);
  }
  void t;
}

export function renderShikigami(ctx: CanvasRenderingContext2D, c: ShikigamiCmd, W: number, H: number, pass: Pass, t: number, q: number): void {
  if (c.kind === 'dogs') renderDogs(ctx, c, W, pass, t);
  else if (c.kind === 'nue') renderNue(ctx, c, W, H, pass, t, q);
  else renderToad(ctx, c, pass, t);
}
