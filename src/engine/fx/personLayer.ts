/**
 * Puts the user back on top of a domain environment.
 *  - with person segmentation (MediaPipe selfie segmenter): the whole person is cut out of the camera image;
 *  - without it: a soft mask built from the hand landmarks keeps the hands visible, and the environment
 *    itself is kept semi-transparent so it never fully hides the camera image.
 */
import type { Vec2 } from '../types';
import { TAU } from '../math';
import { drawVideo, type VideoView } from './primitives';

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const PALM = [0, 1, 5, 9, 13, 17];

export interface MaskHand {
  pts: Vec2[];
  palmPx: number;
  alpha: number;
}

export class PersonLayer {
  private cv = document.createElement('canvas');
  private ctx = this.cv.getContext('2d')!;
  private seg = document.createElement('canvas');
  private segCtx = this.seg.getContext('2d')!;
  private segImg: ImageData | null = null;
  private segT = -Infinity;
  /** layer resolution relative to the screen */
  private k = 0.5;

  /** Store the latest segmentation confidence mask (in camera-frame coordinates). */
  setMask(data: Float32Array, w: number, h: number, t: number): void {
    if (this.seg.width !== w || this.seg.height !== h) {
      this.seg.width = w;
      this.seg.height = h;
      this.segImg = this.segCtx.createImageData(w, h);
    }
    const img = this.segImg!;
    const px = img.data;
    for (let i = 0; i < data.length; i++) {
      // smoothstep on the confidence gives a clean but soft edge
      const c = data[i];
      const a = c <= 0.3 ? 0 : c >= 0.7 ? 1 : ((c - 0.3) / 0.4) ** 2 * (3 - 2 * ((c - 0.3) / 0.4));
      const j = i * 4;
      px[j] = px[j + 1] = px[j + 2] = 255;
      px[j + 3] = a * 255;
    }
    this.segCtx.putImageData(img, 0, 0);
    this.segT = t;
  }

  hasSegmentation(t: number): boolean {
    return t - this.segT < 0.6;
  }

  /** Draw the cut-out person (or hands) onto the main canvas. */
  draw(main: CanvasRenderingContext2D, v: VideoView, W: number, H: number, hands: MaskHand[], t: number, alpha: number): void {
    if (alpha < 0.01 || v.video.readyState < 2) return;
    const k = this.k;
    const cw = Math.max(1, Math.round(W * k));
    const ch = Math.max(1, Math.round(H * k));
    if (this.cv.width !== cw || this.cv.height !== ch) {
      this.cv.width = cw;
      this.cv.height = ch;
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, cw, ch);
    g.setTransform(k, 0, 0, k, 0, 0);

    if (this.hasSegmentation(t)) {
      // the mask is in camera coordinates: map it exactly like the video
      g.save();
      g.translate(v.W, 0);
      g.scale(-1, 1);
      g.drawImage(this.seg, v.dx, v.dy, v.vw * v.s, v.vh * v.s);
      g.restore();
    } else {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const h of hands) {
        if (h.alpha < 0.02) continue;
        for (const [wMul, a] of [
          [0.55, 0.45],
          [0.36, 1],
        ] as const) {
          g.globalAlpha = a * h.alpha;
          g.strokeStyle = '#fff';
          g.fillStyle = '#fff';
          g.lineWidth = h.palmPx * wMul;
          g.beginPath();
          for (const [i, j] of BONES) {
            g.moveTo(h.pts[i].x, h.pts[i].y);
            g.lineTo(h.pts[j].x, h.pts[j].y);
          }
          g.stroke();
          g.beginPath();
          PALM.forEach((i, n) => (n ? g.lineTo(h.pts[i].x, h.pts[i].y) : g.moveTo(h.pts[i].x, h.pts[i].y)));
          g.closePath();
          g.fill();
          g.beginPath();
          g.arc(h.pts[9].x, h.pts[9].y, h.palmPx * 0.55 * wMul * 2, 0, TAU);
          g.fill();
        }
      }
    }
    // keep only the camera pixels under the mask
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-in';
    drawVideo(g, v);
    g.globalCompositeOperation = 'source-over';

    main.save();
    main.setTransform(main.getTransform().a, 0, 0, main.getTransform().d, 0, 0);
    main.globalCompositeOperation = 'source-over';
    main.globalAlpha = alpha;
    main.drawImage(this.cv, 0, 0, W, H);
    main.restore();
  }
}
