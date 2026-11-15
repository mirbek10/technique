import type { OrbKind } from './types';
import type { LayerName, Sfx, SfxName } from './fx/api';

/**
 * Procedural sound design: everything is synthesised with Web Audio, no samples.
 * Continuous layers (blue hum, red crackle, purple drone) are mixed by intensity every frame;
 * one-shots (fire, merge) are built on demand.
 */
export class AudioEngine implements Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private blueGain!: GainNode;
  private redGain!: GainNode;
  private crackleGain!: GainNode;
  private purpleGain!: GainNode;
  private purpleFilter!: BiquadFilterNode;
  private purpleOscs: { osc: OscillatorNode; base: number }[] = [];
  private tremolo!: OscillatorNode;
  private layers: Partial<Record<LayerName, { gain: GainNode; level: number; peak: number }>> = {};
  private muted = false;

  /** Must be called from a user gesture (click) so the browser allows audio. */
  init(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(comp);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.buildBlue(ctx);
    this.buildRed(ctx);
    this.buildPurple(ctx);
    this.buildLayers(ctx);
    void ctx.resume();
  }

  private osc(type: OscillatorType, freq: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    return o;
  }

  private lfo(freq: number, depth: number, target: AudioParam): OscillatorNode {
    const o = this.osc('sine', freq);
    const g = this.ctx!.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    return o;
  }

  private buildBlue(ctx: AudioContext): void {
    this.blueGain = ctx.createGain();
    this.blueGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const wobble = ctx.createGain();
    wobble.gain.value = 0.65;
    this.lfo(5.5, 0.35, wobble.gain);
    for (const [type, f] of [['sine', 55], ['sine', 110.6], ['triangle', 82.4]] as const) this.osc(type, f).connect(lp);
    lp.connect(wobble).connect(this.blueGain).connect(this.master);
  }

  private buildRed(ctx: AudioContext): void {
    this.redGain = ctx.createGain();
    this.redGain.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 760;
    bp.Q.value = 1.3;
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(60);
    this.osc('sawtooth', 92).connect(bp);
    this.osc('square', 138.6).connect(bp);
    bp.connect(shaper).connect(this.redGain).connect(this.master);

    // electric crackle: looping noise through a highpass, gated randomly every frame
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    src.connect(hp).connect(this.crackleGain).connect(this.master);
    src.start();
  }

  private buildPurple(ctx: AudioContext): void {
    this.purpleGain = ctx.createGain();
    this.purpleGain.gain.value = 0;
    this.purpleFilter = ctx.createBiquadFilter();
    this.purpleFilter.type = 'lowpass';
    this.purpleFilter.frequency.value = 200;
    this.purpleFilter.Q.value = 6;
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    this.tremolo = this.lfo(4, 0.4, trem.gain);
    for (const [type, f] of [['sawtooth', 41], ['sawtooth', 41.5], ['sawtooth', 61.8], ['sine', 27.5]] as const) {
      const o = this.osc(type, f);
      o.connect(this.purpleFilter);
      this.purpleOscs.push({ osc: o, base: f });
    }
    this.purpleFilter.connect(trem).connect(this.purpleGain).connect(this.master);
  }

  /** Continuous beds for the new techniques: each is a small graph whose gain follows `layer()`. */
  private buildLayers(ctx: AudioContext): void {
    const mk = (name: LayerName, peak: number, build: (out: GainNode) => void) => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.master);
      build(gain);
      this.layers[name] = { gain, level: 0, peak };
    };
    // Unlimited Void: airy detuned pad with a slow shimmer
    mk('void', 0.12, (out) => {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      const trem = ctx.createGain();
      trem.gain.value = 0.7;
      this.lfo(0.25, 0.3, trem.gain);
      for (const f of [110, 164.8, 220.6, 329.2, 440.9]) this.osc('sine', f).connect(lp);
      lp.connect(trem).connect(out);
    });
    // Malevolent Shrine: low rumble + filtered noise wind
    mk('shrine', 0.3, (out) => {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 160;
      this.osc('sawtooth', 36).connect(lp);
      this.osc('sawtooth', 36.7).connect(lp);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 500;
      bp.Q.value = 0.7;
      const ng = ctx.createGain();
      ng.gain.value = 0.25;
      src.connect(bp).connect(ng).connect(out);
      src.start();
      lp.connect(out);
    });
    // Piercing Blood compression: pressurised hiss + pulsing tone
    mk('blood', 0.16, (out) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      const pulse = ctx.createGain();
      pulse.gain.value = 0.5;
      this.lfo(7, 0.4, pulse.gain);
      src.connect(hp).connect(out);
      src.start();
      this.osc('sine', 180).connect(pulse).connect(out);
    });
    // Black Flash fist aura: electric buzz
    mk('fist', 0.1, (out) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 2;
      const shaper = ctx.createWaveShaper();
      shaper.curve = distortionCurve(80);
      this.osc('sawtooth', 61).connect(bp);
      bp.connect(shaper).connect(out);
    });
  }

  layer(name: LayerName, intensity: number): void {
    const l = this.layers[name];
    if (!this.ctx || !l) return;
    const v = Math.max(0, Math.min(1, intensity));
    if (Math.abs(v - l.level) < 0.01) return;
    l.level = v;
    l.gain.gain.setTargetAtTime(v * l.peak, this.ctx.currentTime, 0.15);
  }

  play(name: SfxName, power = 1): void {
    if (!this.ctx || this.muted) return;
    const p = Math.max(0.1, Math.min(1, power));
    switch (name) {
      case 'slash':
        this.noiseBurst(0.22, 0.25 + 0.35 * p, 9000, 1200);
        this.sweep('sawtooth', 2600, 260, 0.12, 0.06 + 0.05 * p);
        break;
      case 'tripleSlash':
        for (const at of [0, 0.06, 0.12]) this.noiseBurst(0.22, 0.5, 9000, 900, at);
        this.sweep('sine', 140, 28, 0.9, 0.9, 0.1);
        break;
      case 'blackFlash':
        this.sweep('sine', 95, 24, 1.0, 1.0);
        this.noiseBurst(0.7, 0.9, 6500, 90);
        this.sweep('square', 1900, 55, 0.16, 0.14);
        this.noiseBurst(1.1, 0.25, 700, 50, 0.08);
        break;
      case 'fistCharge':
        this.sweep('triangle', 80, 320, 0.35, 0.1);
        break;
      case 'bloodCharge':
        this.sweep('sine', 180, 900, 1.5, 0.06);
        break;
      case 'beam':
        this.sweep('sawtooth', 3200, 180, 0.35, 0.1 + 0.08 * p);
        this.noiseBurst(0.5, 0.3 + 0.4 * p, 8500, 300);
        this.sweep('sine', 320, 55, 0.45, 0.5 * p + 0.2);
        break;
      case 'portal':
        this.sweep('sine', 320, 55, 0.8, 0.3);
        this.noiseBurst(1.0, 0.22, 1300, 80);
        break;
      case 'summon':
        this.sweep('sawtooth', 55, 130, 0.6, 0.1);
        this.noiseBurst(0.8, 0.3, 2500, 120);
        break;
      case 'howl':
        this.sweep('sine', 340, 610, 0.45, 0.14, 0.1);
        this.sweep('sine', 610, 390, 0.7, 0.14, 0.55);
        break;
      case 'thunder':
        this.noiseBurst(1.4, 1.0, 5200, 60);
        this.sweep('sine', 75, 24, 1.2, 0.9);
        break;
      case 'croak':
        this.sweep('square', 95, 70, 0.14, 0.12);
        this.sweep('square', 92, 66, 0.16, 0.12, 0.2);
        break;
      case 'domain':
        this.sweep('sawtooth', 48, 190, 1.0, 0.1);
        this.noiseBurst(1.0, 0.3, 300, 5000);
        break;
      case 'voidExpand':
        this.sweep('sine', 115, 20, 2.0, 1.0);
        this.noiseBurst(2.4, 0.85, 9000, 60);
        this.sweep('sine', 1200, 2400, 1.5, 0.04);
        break;
      case 'shrineSummon':
        this.sweep('sine', 72, 22, 2.0, 1.0);
        this.sweep('square', 230, 55, 1.2, 0.08);
        this.noiseBurst(2.0, 0.7, 5000, 70);
        break;
      case 'collapse':
        this.sweep('sine', 620, 80, 1.0, 0.18);
        this.noiseBurst(1.0, 0.3, 3200, 100);
        break;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(m ? 0 : 0.75, this.ctx.currentTime, 0.05);
  }

  /** Called every frame with current visual intensities (0..1). */
  update(blue: number, red: number, purple: number, charge: number, merge: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const n = ctx.currentTime;
    this.blueGain.gain.setTargetAtTime(blue * 0.22, n, 0.08);
    this.redGain.gain.setTargetAtTime(red * 0.09, n, 0.08);
    const crackle = red * (Math.random() < 0.25 ? 0.16 : 0.015) + merge * (Math.random() < 0.4 ? 0.2 : 0);
    this.crackleGain.gain.setTargetAtTime(crackle, n, 0.008);
    this.purpleGain.gain.setTargetAtTime(purple * (0.16 + 0.16 * charge) + merge * 0.14, n, 0.1);
    this.purpleFilter.frequency.setTargetAtTime(180 + charge * 1500 + merge * 500, n, 0.12);
    const pitch = 1 + charge * 0.6 + merge * 0.35;
    for (const { osc, base } of this.purpleOscs) osc.frequency.setTargetAtTime(base * pitch, n, 0.2);
    this.tremolo.frequency.setTargetAtTime(3 + charge * 13 + merge * 8, n, 0.2);
  }

  private noiseBurst(dur: number, gain: number, f0: number, f1: number, at = 0): void {
    const ctx = this.ctx!;
    const n = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f0, n);
    lp.frequency.exponentialRampToValueAtTime(f1, n + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, n);
    g.gain.exponentialRampToValueAtTime(gain, n + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, n + dur);
    src.connect(lp).connect(g).connect(this.master);
    src.start(n);
    src.stop(n + dur + 0.05);
  }

  private sweep(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, at = 0): void {
    const ctx = this.ctx!;
    const n = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, n);
    o.frequency.exponentialRampToValueAtTime(f1, n + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, n);
    g.gain.exponentialRampToValueAtTime(gain, n + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, n + dur);
    o.connect(g).connect(this.master);
    o.start(n);
    o.stop(n + dur + 0.05);
  }

  fire(kind: OrbKind, power: number): void {
    if (!this.ctx || this.muted) return;
    if (kind === 'purple') {
      this.noiseBurst(1.8, 0.9 * power + 0.1, 7000, 120);
      this.sweep('sine', 160, 24, 1.6, 1.0);
      this.sweep('sawtooth', 90, 30, 1.1, 0.25);
      this.noiseBurst(2.4, 0.35, 900, 60, 0.15);
    } else {
      this.noiseBurst(0.5, 0.45 + 0.3 * power, 4500, 180);
      this.sweep('sine', 210, 42, 0.45, 0.8);
      if (kind === 'red') this.sweep('square', 1400, 70, 0.18, 0.12);
      else this.sweep('sine', 900, 110, 0.25, 0.18);
    }
  }

  merge(): void {
    if (!this.ctx || this.muted) return;
    this.sweep('sawtooth', 220, 1800, 0.35, 0.12);
    this.noiseBurst(1.2, 0.7, 9000, 200, 0.05);
    this.sweep('sine', 120, 30, 1.2, 0.9, 0.05);
  }

  mergeStart(): void {
    if (!this.ctx || this.muted) return;
    this.sweep('triangle', 80, 400, 0.9, 0.1);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
