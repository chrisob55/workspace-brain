import { createSourceId, createWorkspaceId } from '@workspace-brain/domain';
import { describe, expect, it } from 'vitest';

import { createApiServer } from './server.js';

const source = {
  id: createSourceId(),
  name: 'Projects',
  type: 'filesystem' as const,
  containerPaths: ['/sources/projects'],
  createdAt: '2026-10-01T12:00:00.000Z',
};

const workspace = {
  id: createWorkspaceId(),
  name: 'Product',
  sourceIds: [source.id],
  createdAt: '2026-10-01T12:00:00.000Z',
};

function createCatalogue(
  ready = true,
  sources = [source],
  workspaces = [workspace],
) {
  return {
    async listSources({ afterId, limit }: { afterId?: string; limit: number }) {
      const items = sources
        .filter((item) => afterId === undefined || item.id > afterId)
        .sort((left, right) => left.id.localeCompare(right.id));
      return { items: items.slice(0, limit) };
    },
    async listWorkspaces({
      afterId,
      limit,
    }: {
      afterId?: string;
      limit: number;
    }) {
      const items = workspaces
        .filter((item) => afterId === undefined || item.id > afterId)
        .sort((left, right) => left.id.localeCompare(right.id));
      return { items: items.slice(0, limit) };
    },
    async check() {
      if (!ready) {
        throw new Error('catalogue offline');
      }
    },
    async close() {},
  };
}

describe('Workspace Brain API routes', () => {
  it('reports liveness and catalogue readiness', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });

    const health = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'test-correlation' },
    });
    const ready = await server.inject('/ready');

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    expect(health.headers['x-correlation-id']).toBe('test-correlation');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });
    await server.close();
  });

  it('replaces malformed correlation IDs before logging or returning them', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });

    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'not_valid!' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/i);
    await server.close();
  });

  it('returns not-ready when the catalogue cannot be queried', async () => {
    const server = createApiServer(createCatalogue(false), { logger: false });

    const response = await server.inject('/ready');

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
    await server.close();
  });

  it('serves domain objects through versioned read-only endpoints', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });

    const sources = await server.inject('/api/v1/sources');
    const workspaces = await server.inject('/api/v1/workspaces');

    expect(sources.statusCode).toBe(200);
    expect(sources.json()).toEqual({ items: [source], nextCursor: null });
    expect(workspaces.statusCode).toBe(200);
    expect(workspaces.json()).toEqual({ items: [workspace], nextCursor: null });
    expect(sources.headers['content-type']).toContain('application/json');
    await server.close();
  });

  it('rejects invalid limits and malformed cursors with problem details', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });

    const badLimit = await server.inject('/api/v1/sources?limit=101');
    const badCursor = await server.inject('/api/v1/sources?cursor=%%%');

    expect(badLimit.statusCode).toBe(400);
    expect(badLimit.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(badCursor.statusCode).toBe(400);
    await server.close();
  });

  it('continues pagination from an opaque cursor', async () => {
    const secondSource = {
      ...source,
      id: createSourceId(),
      name: 'Archive',
    };
    const orderedSources = [source, secondSource].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const server = createApiServer(
      createCatalogue(true, orderedSources, [workspace]),
      { logger: false },
    );

    const firstPage = await server.inject('/api/v1/sources?limit=1');
    const nextCursor = firstPage.json<{ nextCursor: string }>().nextCursor;
    const secondPage = await server.inject(
      `/api/v1/sources?limit=1&cursor=${nextCursor}`,
    );

    expect(firstPage.json().items).toEqual([orderedSources[0]]);
    expect(secondPage.json().items).toEqual([orderedSources[1]]);
    expect(secondPage.json().nextCursor).toBeNull();
    await server.close();
  });
});
