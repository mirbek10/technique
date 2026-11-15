import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { Delegate } from './types';

const VERSION = '0.10.14';
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const BASE = import.meta.env.BASE_URL;

/** Vite's SPA fallback answers missing files with index.html, so check the content type. */
export const isRealFile = (r: Response): boolean => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');

async function resolveWasmRoot(): Promise<string> {
  const local = `${BASE}mediapipe/wasm`;
  try {
    const r = await fetch(`${local}/vision_wasm_internal.js`, { method: 'HEAD' });
    if (isRealFile(r)) return local;
  } catch {
    /* fall through to CDN */
  }
  return CDN_WASM;
}

async function loadModel(): Promise<Uint8Array> {
  try {
    const r = await fetch(`${BASE}models/hand_landmarker.bin`);
    if (isRealFile(r)) return new Uint8Array(await r.arrayBuffer());
  } catch {
    /* fall through to CDN */
  }
  const r = await fetch(REMOTE_MODEL);
  if (!r.ok) throw new Error(`Не удалось загрузить модель руки (HTTP ${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

let filesetPromise: Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> | null = null;
/** One WASM fileset shared by every MediaPipe task (hand landmarker, person segmenter). */
export function getFileset() {
  filesetPromise ??= resolveWasmRoot().then((root) => FilesetResolver.forVisionTasks(root));
  return filesetPromise;
}

export interface HandTracker {
  landmarker: HandLandmarker;
  delegate: Delegate;
}

/** Creates a two-hand landmarker (one instance for all techniques), preferring GPU and falling back to CPU. */
export async function createHandTracker(): Promise<HandTracker> {
  const [fileset, model] = await Promise.all([getFileset(), loadModel()]);

  const make = (delegate: Delegate) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model.slice(), delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  try {
    return { landmarker: await make('GPU'), delegate: 'GPU' };
  } catch (e) {
    console.warn('[tracker] GPU delegate unavailable, using CPU', e);
    return { landmarker: await make('CPU'), delegate: 'CPU' };
  }
}
