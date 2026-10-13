import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.WORKSPACE_BRAIN_API_URL ?? 'http://localhost:3000';
  const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

  return {
    plugins: [react(), tailwindcss()],
    // Editor deep links are a local-development affordance; builds omit the path.
    define: {
      __WORKSPACE_BRAIN_REPOSITORY_ROOT__: JSON.stringify(
        command === 'serve' ? repositoryRoot.replace(/\/$/, '') : '',
      ),
    },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // A single-page demo: one ~700 kB bundle (React Flow + dagre) is acceptable.
    build: { chunkSizeWarningLimit: 900 },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
    preview: {
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
