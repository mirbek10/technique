// Copies MediaPipe WASM runtime into /public and downloads the models once,
// so the app runs fully locally (no network needed at runtime).
import { cp, mkdir, access, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = path.join(root, 'public', 'mediapipe', 'wasm');
try {
  await mkdir(wasmDst, { recursive: true });
  await cp(wasmSrc, wasmDst, { recursive: true });
  console.log('[setup] MediaPipe WASM copied to public/mediapipe/wasm');
} catch (e) {
  console.warn('[setup] WASM copy failed (CDN fallback will be used):', e.message);
}

const modelDir = path.join(root, 'public', 'models');
const MODELS = [
  { file: 'hand_landmarker.bin', url: MODEL_URL },
  // optional: person segmentation for the domain expansions (the app falls back to a hand mask without it)
  {
    file: 'selfie_segmenter.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  },
];
for (const { file, url } of MODELS) {
  const modelPath = path.join(modelDir, file);
  try {
    await access(modelPath);
    console.log(`[setup] ${file} already present`);
  } catch {
    try {
      await mkdir(modelDir, { recursive: true });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(modelPath, Buffer.from(await res.arrayBuffer()));
      console.log(`[setup] ${file} downloaded to public/models`);
    } catch (e) {
      console.warn(`[setup] ${file} download failed (will load from CDN at runtime):`, e.message);
    }
  }
}
