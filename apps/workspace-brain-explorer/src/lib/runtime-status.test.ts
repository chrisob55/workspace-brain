import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RuntimeComponentStatus,
  RuntimeStatusResponse,
} from '@workspace-brain/domain';

import {
  RuntimeStatusPanel,
  SystemArchitectureRuntimeScreen,
} from '../screens/system-architecture-runtime-screen';
import {
  COMPONENTS,
  getTroubleshootingGuidance,
} from './operational-architecture';
import { loadRuntimeKnowledgeFacts } from './queries';
import {
  createNonOverlappingRunner,
  refreshRuntimeStatus,
  RUNTIME_STATUS_REFRESH_INTERVAL_MS,
  scheduleRuntimeStatusRefresh,
  type RuntimeDashboardState,
} from './runtime-status';

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function runtimeComponent(
  componentId: string,
  componentName: string,
  instanceId: string,
  status: RuntimeComponentStatus['status'],
  extras: Partial<RuntimeComponentStatus> = {},
): RuntimeComponentStatus {
  return {
    componentId,
    componentName,
    componentType: componentId === 'nats' ? 'infrastructure' : 'worker',
    instanceId,
    source: componentId === 'nats' ? 'nats-connection' : 'heartbeat',
    status,
    version: '1.0.0',
    startedAt: new Date().toISOString(),
    uptimeSeconds: 3_720,
    timestamp: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    ageSeconds: 8,
    ...extras,
  };
}

function dashboard(
  snapshot?: RuntimeStatusResponse,
  overrides: Partial<RuntimeDashboardState> = {},
): RuntimeDashboardState {
  return {
    ...(snapshot === undefined ? {} : { snapshot }),
    loading: false,
    refreshing: false,
    stale: false,
    endpointUnavailable: false,
    refresh: vi.fn(),
    ...overrides,
  };
}

function snapshot(
  components: readonly RuntimeComponentStatus[],
): RuntimeStatusResponse {
  return {
    generatedAt: new Date().toISOString(),
    thresholds: {
      degradedAfterSeconds: 30,
      offlineAfterSeconds: 90,
    },
    components,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('runtime status refresh', () => {
  it.each([
    ['HTTP 404', () => new Response('', { status: 404 })],
    [
      'SPA HTML fallback',
      () =>
        new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ],
    [
      'invalid JSON',
      () =>
        new Response('{invalid', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ],
  ])(
    'reports first-load %s as unavailable and logs diagnostics when enabled',
    async (_name, reply) => {
      vi.stubGlobal('location', {
        search: '?runtimeDebug=1',
        origin: 'http://localhost:4173',
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => reply()),
      );
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(
        refreshRuntimeStatus(new AbortController().signal),
      ).resolves.toMatchObject({
        ok: false,
        stale: false,
        endpointUnavailable: true,
      });
      expect(debug).toHaveBeenCalledWith(
        '[runtime/status] Refresh started',
        expect.objectContaining({ requestUrl: '/runtime/status' }),
      );
      expect(warn).toHaveBeenCalledWith(
        '[runtime/status] Refresh failed',
        expect.objectContaining({
          requestUrl: '/runtime/status',
          error: expect.any(Error),
        }),
      );
    },
  );

  it('loads inventory and latest publication facts from the knowledge API', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/v1/repositories?limit=100')) {
        return response(200, { items: [{}, {}, {}], nextCursor: null });
      }
      if (path.endsWith('/api/v1/knowledge/models?limit=100')) {
        return response(200, {
          items: [
            {
              id: 'model-1',
              name: 'Older publication with a higher version',
              latestPublicationVersion: 2,
            },
            {
              id: 'model-2',
              name: 'Most recently published model',
              latestPublicationVersion: 1,
            },
          ],
          nextCursor: null,
        });
      }
      if (
        path.endsWith('/api/v1/knowledge/models/model-1/publications/latest')
      ) {
        return response(200, {
          publishedAt: '2026-10-19T09:00:00.000Z',
          version: 2,
        });
      }
      if (
        path.endsWith('/api/v1/knowledge/models/model-2/publications/latest')
      ) {
        return response(200, {
          publishedAt: '2026-10-19T09:30:00.000Z',
          version: 1,
        });
      }
      throw new Error(`Unexpected API request: ${path}`);
    });
    vi.stubGlobal('fetch', fetch);

    await expect(
      loadRuntimeKnowledgeFacts(new AbortController().signal),
    ).resolves.toEqual({
      repositoriesInInventory: 3,
      latestPublication: {
        publishedAt: '2026-10-19T09:30:00.000Z',
        version: 1,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('consumes the runtime REST endpoint and preserves its contract', async () => {
    const expected = snapshot([
      runtimeComponent('parser', 'Parser Worker', 'parser-1', 'healthy'),
    ]);
    const fetch = vi.fn(async () => response(200, expected));
    vi.stubGlobal('fetch', fetch);

    const result = await refreshRuntimeStatus(
      new AbortController().signal,
      undefined,
      () => new Date('2026-10-19T09:00:05.000Z'),
    );

    expect(fetch).toHaveBeenCalledWith(
      '/runtime/status',
      expect.objectContaining({
        headers: { accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual({
      ok: true,
      snapshot: expected,
      refreshedAt: '2026-10-19T09:00:05.000Z',
    });
  });

  it('labels a failed refresh after success as stale without treating components as offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(503, {})),
    );
    const previous = snapshot([
      runtimeComponent('parser', 'Parser Worker', 'parser-1', 'healthy'),
    ]);

    await expect(
      refreshRuntimeStatus(new AbortController().signal, previous),
    ).resolves.toMatchObject({
      ok: false,
      stale: true,
      endpointUnavailable: false,
    });
    expect(previous.components[0]?.status).toBe('healthy');
  });

  it('distinguishes an unavailable registry before any snapshot exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );
    await expect(
      refreshRuntimeStatus(new AbortController().signal),
    ).resolves.toMatchObject({
      ok: false,
      stale: false,
      endpointUnavailable: true,
    });
  });

  it('schedules refreshes every 15 seconds and stops cleanly', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const cancel = scheduleRuntimeStatusRefresh(
      refresh,
      RUNTIME_STATUS_REFRESH_INTERVAL_MS,
      (callback, delay) => {
        const timer = setInterval(callback, delay);
        return () => clearInterval(timer);
      },
    );
    expect(RUNTIME_STATUS_REFRESH_INTERVAL_MS).toBe(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(refresh).toHaveBeenCalledOnce();
    cancel();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('avoids overlapping manual and periodic refresh work', async () => {
    const finish: (() => void)[] = [];
    const task = vi.fn(
      () => new Promise<void>((resolve) => finish.push(resolve)),
    );
    const run = createNonOverlappingRunner(task);
    const first = run();
    await run();
    expect(task).toHaveBeenCalledOnce();
    finish.shift()?.();
    await first;
    const second = run();
    expect(task).toHaveBeenCalledTimes(2);
    finish.shift()?.();
    await second;
  });
});

describe('System Architecture & Runtime page', () => {
  it('renders all heartbeat states, multiple instances, and deliberate metadata', () => {
    const components = [
      runtimeComponent('api', 'Workspace Brain API', 'api-1', 'healthy'),
      runtimeComponent('parser', 'Parser Worker', 'parser-1', 'healthy', {
        metadata: {
          queueDepth: 5,
          repositoriesIndexed: 12,
          secretToken: 'must not render',
          unrecognizedMetric: 'must not render',
        },
      }),
      runtimeComponent('parser', 'Parser Worker', 'parser-2', 'degraded'),
      runtimeComponent('indexer', 'Indexing Worker', 'indexer-1', 'offline'),
      runtimeComponent('publisher', 'Publication Builder', 'none', 'unknown', {
        version: undefined,
        startedAt: undefined,
        uptimeSeconds: undefined,
        timestamp: undefined,
        lastHeartbeat: undefined,
        ageSeconds: undefined,
      }),
      runtimeComponent('nats', 'NATS', 'api-nats-connection', 'healthy'),
    ];
    const markup = renderToStaticMarkup(
      createElement(RuntimeStatusPanel, {
        runtime: dashboard(snapshot(components)),
      }),
    );

    expect(markup).toContain('Healthy');
    expect(markup).toContain('Degraded');
    expect(markup).toContain('Offline');
    expect(markup).toContain('Unknown');
    expect(markup).toContain('aria-label="Healthy status for Parser Worker"');
    expect(markup).toContain('parser-1');
    expect(markup).toContain('parser-2');
    expect(markup).toContain('Queue depth');
    expect(markup).toContain('Repositories indexed');
    expect(markup).not.toContain('must not render');
    expect(markup).toContain('8 seconds ago');
    expect(markup).toContain('1h 2m');
  });

  it('marks a previous response visibly stale and distinguishes no response', () => {
    const saved = snapshot([
      runtimeComponent('parser', 'Parser Worker', 'parser-1', 'healthy'),
    ]);
    const staleMarkup = renderToStaticMarkup(
      createElement(RuntimeStatusPanel, {
        runtime: dashboard(saved, {
          stale: true,
          refreshError:
            'Runtime registry refresh failed; the last successful snapshot is stale.',
        }),
      }),
    );
    const unavailableMarkup = renderToStaticMarkup(
      createElement(RuntimeStatusPanel, {
        runtime: dashboard(undefined, {
          endpointUnavailable: true,
          refreshError:
            'Runtime registry endpoint is unavailable; no component status has been loaded.',
        }),
      }),
    );

    expect(staleMarkup).toContain('Stale');
    expect(staleMarkup).toContain('Snapshot is stale');
    expect(unavailableMarkup).toContain(
      'Runtime registry endpoint unavailable',
    );
    expect(unavailableMarkup).not.toContain('aria-label="Offline status');
  });

  it('renders a navigation screen and text alternatives for the architecture diagrams', async () => {
    const source = await readFile(
      new URL('../screens.ts', import.meta.url),
      'utf8',
    );
    const queryClient = new QueryClient();
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(SystemArchitectureRuntimeScreen),
      ),
    );

    expect(source).toContain("id: 'system-architecture-runtime'");
    expect(source).toContain("title: 'System Architecture & Runtime'");
    expect(markup).toContain('What&#x27;s Running, Where?');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('Architecture: configured filesystem sources');
    expect(markup).toContain('<caption');
    expect(markup).toContain('workspace.runtime.heartbeat');
    expect(markup).toContain('Automatic refresh every 15 seconds');
    expect(markup).toContain('aria-label="Refresh runtime status"');
  });

  it('shows live loading and non-observable optional services without claiming they are down', () => {
    const queryClient = new QueryClient();
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(SystemArchitectureRuntimeScreen),
      ),
    );

    expect(markup).toContain(
      'Loading the runtime registry from the Workspace Brain API.',
    );
    expect(markup).toContain('Not exposed by the current API');
    expect(markup).toContain('Optional');
    expect(
      COMPONENTS.filter((component) => component.optional).map(
        (component) => component.id,
      ),
    ).toEqual(['librechat', 'mongo', 'qdrant', 'ollama']);
  });

  it('changes troubleshooting guidance when the API is offline or page data is stale', () => {
    expect(
      getTroubleshootingGuidance(
        runtimeComponent(
          'workspace-brain-api',
          'Workspace Brain API',
          'api-1',
          'offline',
        ),
      ).title,
    ).toBe('Workspace Brain API is offline');
    expect(getTroubleshootingGuidance(undefined, true).title).toBe(
      'The runtime snapshot is stale',
    );
    expect(getTroubleshootingGuidance(undefined, false, true).title).toBe(
      'Explorer cannot reach the runtime registry',
    );
  });
});
