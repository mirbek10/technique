/**
 * The contract between techniques and the Effect Engine.
 * Techniques never draw: they call these methods. One-shots are retained (pooled) by the effect manager;
 * "immediate" commands describe persistent visuals for the current frame only.
 * Tests use NOOP_FX / NOOP_SFX, so the state machines run without a canvas or audio.
 */
import type { RGB } from '../math';
import type { Vec2 } from '../types';

export type ShikigamiKind = 'dogs' | 'nue' | 'toad';
export type DomainKind = 'void' | 'shrine';

export interface BurstOpts {
  life?: number;
  size?: number;
  /** drawn with normal blending (shadows, smoke) instead of additive light */
  dark?: boolean;
  drag?: number;
  /** share of white-hot sparks 0..1 */
  white?: number;
  /** direction bias (unit vector) and spread in radians */
  dir?: Vec2;
  spread?: number;
  gravity?: number;
}

export interface SlashOpts {
  color: RGB;
  width: number;
  delay?: number;
  power?: number;
  /** tear the camera image along the cut */
  distort?: boolean;
}

export interface BeamOpts {
  color: RGB;
  width: number;
  dur: number;
  power: number;
}

export interface OrbCmd {
  style: 'blood' | 'blackflash';
  x: number;
  y: number;
  r: number;
  /** 0..1 visibility */
  vis: number;
  /** 0..1 charge */
  charge: number;
}

export interface DomainCmd {
  kind: DomainKind;
  /** 0..1 overall opacity of the environment */
  intensity: number;
  /** seconds since the environment started (drives animation) */
  age: number;
  /** expansion wave 0..1 (void) / shrine rise 0..1 */
  progress: number;
  cx: number;
  cy: number;
  /** how strongly the real camera image is warped 0..1 */
  distortion: number;
}

export interface ShikigamiCmd {
  kind: ShikigamiKind;
  /** seconds since the shikigami appeared */
  age: number;
  /** 0..1 fade */
  alpha: number;
  /** portal centre */
  x: number;
  y: number;
  size: number;
  /** horizontal travel direction (+1 right, −1 left) */
  facing: 1 | -1;
  /** attack direction (toad tongue / nue strike) */
  dir: Vec2;
  /** where the attack lands (screen px) */
  tx: number;
  ty: number;
  /** total seconds the shikigami stays (for its exit animation) */
  life: number;
}

export interface Fx {
  burst(x: number, y: number, color: RGB, n: number, speed: number, o?: BurstOpts): void;
  shockwave(x: number, y: number, r0: number, r1: number, dur: number, color: RGB, width: number, delay?: number): void;
  slash(x1: number, y1: number, x2: number, y2: number, o: SlashOpts): void;
  beam(x: number, y: number, dir: Vec2, o: BeamOpts): void;
  cracks(x: number, y: number, r: number, color: RGB, n?: number): void;
  bolt(x1: number, y1: number, x2: number, y2: number, color: RGB, width: number, life?: number): void;
  flash(color: RGB, a: number, decay: number): void;
  darkFlash(a: number, decay: number): void;
  shake(a: number): void;
  slowmo(scale: number, dur: number): void;

  orb(c: OrbCmd): void;
  /** thin energy lines curling around a hand */
  handAura(pts: Vec2[], palmPx: number, color: RGB, intensity: number): void;
  portal(x: number, y: number, r: number, open: number, color: RGB): void;
  tint(color: RGB, a: number): void;
  domain(c: DomainCmd): void;
  shikigami(c: ShikigamiCmd): void;
}

export type SfxName =
  | 'slash'
  | 'tripleSlash'
  | 'blackFlash'
  | 'fistCharge'
  | 'bloodCharge'
  | 'beam'
  | 'portal'
  | 'summon'
  | 'howl'
  | 'thunder'
  | 'croak'
  | 'domain'
  | 'voidExpand'
  | 'shrineSummon'
  | 'collapse';

export type LayerName = 'void' | 'shrine' | 'blood' | 'fist';

export interface Sfx {
  play(name: SfxName, power?: number): void;
  /** continuous layer intensity 0..1, set every frame */
  layer(name: LayerName, intensity: number): void;
}

const noop = () => undefined;
export const NOOP_FX: Fx = {
  burst: noop,
  shockwave: noop,
  slash: noop,
  beam: noop,
  cracks: noop,
  bolt: noop,
  flash: noop,
  darkFlash: noop,
  shake: noop,
  slowmo: noop,
  orb: noop,
  handAura: noop,
  portal: noop,
  tint: noop,
  domain: noop,
  shikigami: noop,
};
export const NOOP_SFX: Sfx = { play: noop, layer: noop };
