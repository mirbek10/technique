import { readFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * @mediapipe/tasks-vision references a source map it doesn't ship, which makes Vite
 * print "Failed to load source map" on every start. Load the file ourselves without that comment.
 */
function mediapipeNoSourcemap(): Plugin {
  return {
    name: 'mediapipe-no-sourcemap',
    enforce: 'pre',
    async load(id) {
      const file = id.split('?')[0];
      if (!/@mediapipe[\\/]tasks-vision[\\/].*\.m?js$/.test(file)) return null;
      const code = await readFile(file, 'utf8');
      return { code: code.replace(/\/\/# sourceMappingURL=.*$/gm, ''), map: null };
    },
  };
}

export default defineConfig({
  plugins: [mediapipeNoSourcemap(), react()],
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
});
