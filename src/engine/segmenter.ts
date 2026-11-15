/**
 * Optional person segmentation (MediaPipe selfie segmenter) used only while a domain is on screen,
 * so the user can stay visible "inside" Unlimited Void / in front of the shrine.
 * Created lazily on the first domain; the app works without it (hand-landmark mask fallback).
 */
import { ImageSegmenter } from '@mediapipe/tasks-vision';
import { getFileset, isRealFile } from './handTracker';

const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const BASE = import.meta.env.BASE_URL;

async function loadModel(): Promise<Uint8Array> {
  try {
    const r = await fetch(`${BASE}models/selfie_segmenter.tflite`);
    if (isRealFile(r)) return new Uint8Array(await r.arrayBuffer());
  } catch {
    /* fall through to CDN */
  }
  const r = await fetch(REMOTE_MODEL);
  if (!r.ok) throw new Error(`segmenter model HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

export class PersonSegmenter {
  private seg: ImageSegmenter;
  /** downscaled copy of the frame: keeps inference and the mask read-back cheap */
  private input = document.createElement('canvas');
  private ictx = this.input.getContext('2d', { willReadFrequently: false })!;
  private lastTs = 0;

  private constructor(seg: ImageSegmenter) {
    this.seg = seg;
  }

  static async create(): Promise<PersonSegmenter> {
    const [fileset, model] = await Promise.all([getFileset(), loadModel()]);
    const make = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: model.slice(), delegate },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    try {
      return new PersonSegmenter(await make('GPU'));
    } catch (e) {
      console.warn('[segmenter] GPU delegate unavailable, using CPU', e);
      return new PersonSegmenter(await make('CPU'));
    }
  }

  /** Runs on the given video frame and hands the person-confidence mask to `onMask` (valid only inside the callback). */
  segment(video: HTMLVideoElement, tsMs: number, onMask: (data: Float32Array, w: number, h: number) => void): void {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const w = 256;
    const h = Math.max(1, Math.round((256 * vh) / vw));
    if (this.input.width !== w || this.input.height !== h) {
      this.input.width = w;
      this.input.height = h;
    }
    this.ictx.drawImage(video, 0, 0, w, h);
    const ts = Math.max(this.lastTs + 1, tsMs);
    this.lastTs = ts;
    this.seg.segmentForVideo(this.input, ts, (res) => {
      const masks = res.confidenceMasks;
      if (!masks || masks.length === 0) return;
      const m = masks[masks.length - 1]; // the person channel is last (or the only one)
      onMask(m.getAsFloat32Array(), m.width, m.height);
    });
  }

  close(): void {
    try {
      this.seg.close();
    } catch {
      /* already closed */
    }
  }
}
