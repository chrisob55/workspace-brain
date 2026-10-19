import { afterEach, describe, expect, it, vi } from 'vitest';

import viteConfig from './vite.config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Explorer API proxy', () => {
  it.each(['serve', 'build'] as const)(
    'routes runtime requests to the API in dev and preview (%s)',
    async (command) => {
      vi.stubEnv('WORKSPACE_BRAIN_API_URL', 'http://127.0.0.1:3000');
      if (typeof viteConfig !== 'function') {
        throw new Error('Expected a Vite configuration factory');
      }
      const config = await viteConfig({ command, mode: 'test' });
      for (const proxy of [config.server?.proxy, config.preview?.proxy]) {
        expect(proxy?.['/runtime']).toEqual({
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
        });
        expect(proxy?.['/api']).toBeDefined();
      }
    },
  );
});
