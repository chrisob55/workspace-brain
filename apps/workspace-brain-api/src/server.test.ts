import {
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createRepositoryId,
  createSourceId,
  createWorkspaceId,
} from '@workspace-brain/domain';
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

const repository = {
  id: createRepositoryId(),
  sourceId: source.id,
  path: 'root/projects',
  repositoryType: 'git' as const,
  fingerprint: 'a'.repeat(64),
  discoveredAt: '2026-10-01T12:00:00.000Z',
  lastSeenAt: '2026-10-01T12:00:00.000Z',
  discoveryMethod: 'filesystem' as const,
};
const document = {
  id: createDocumentId(),
  sourceId: source.id,
  path: 'root/projects/README.md',
  filename: 'README.md',
  extension: '.md',
  sizeBytes: 12,
  modifiedAt: '2026-10-01T12:00:00.000Z',
  fingerprint: 'b'.repeat(64),
  discoveredAt: '2026-10-01T12:00:00.000Z',
  lastSeenAt: '2026-10-01T12:00:00.000Z',
  discoveryMethod: 'filesystem' as const,
};
const documentVersion = {
  id: createDocumentVersionId(),
  documentId: document.id,
  contentHash: document.fingerprint,
  hashAlgorithm: 'sha256' as const,
  discoveredAt: document.discoveredAt,
  processorId: 'markdown',
  processorVersion: 1,
  extractionRuleId: 'markdown-blocks',
  extractionRuleVersion: 1,
  evidenceCount: 1,
};
const evidence = {
  id: createEvidenceId(),
  documentVersionId: documentVersion.id,
  key: 'markdown:1:heading',
  kind: 'heading' as const,
  excerpt: 'Overview',
  truncated: false,
  locator: { kind: 'markdown-lines' as const, lineStart: 1, lineEnd: 1 },
};
const evidenceExplanation = {
  evidence,
  documentVersion,
  document: {
    id: document.id,
    sourceId: document.sourceId,
    path: document.path,
    filename: document.filename,
    fingerprint: document.fingerprint,
  },
  provenance: {
    sourceId: document.sourceId,
    provider: 'filesystem' as const,
    documentPath: document.path,
    contentFingerprint: document.fingerprint,
    processorId: 'markdown',
    processorVersion: 1,
    extractionRuleId: 'markdown-blocks',
    extractionRuleVersion: 1,
  },
};

function createCatalogue(
  ready = true,
  sources = [source],
  workspaces = [workspace],
  repositories = [repository],
  documents = [document],
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
    async listRepositories({
      afterId,
      limit,
      sourceId,
    }: {
      afterId?: string;
      limit: number;
      sourceId?: string;
    }) {
      const items = repositories
        .filter(
          (item) =>
            (afterId === undefined || item.id > afterId) &&
            (sourceId === undefined || item.sourceId === sourceId),
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      return { items: items.slice(0, limit) };
    },
    async listDocuments({
      afterId,
      limit,
      sourceId,
      extension,
    }: {
      afterId?: string;
      limit: number;
      sourceId?: string;
      extension?: string;
    }) {
      const items = documents
        .filter(
          (item) =>
            (afterId === undefined || item.id > afterId) &&
            (sourceId === undefined || item.sourceId === sourceId) &&
            (extension === undefined ||
              item.extension.toLocaleLowerCase('en-US') ===
                extension.toLocaleLowerCase('en-US')),
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      return { items: items.slice(0, limit) };
    },
    async listDocumentEvidence(documentId: string, { afterId, limit }) {
      const items =
        documentId === document.id && evidence.id > (afterId ?? '')
          ? [evidence]
          : [];
      return { items: items.slice(0, limit) };
    },
    async explainEvidence(evidenceId: string) {
      return evidenceId === evidence.id ? evidenceExplanation : undefined;
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

  it('filters and cursor-paginates repository and document metadata', async () => {
    const secondDocument = {
      ...document,
      id: createDocumentId(),
      path: 'root/projects/notes.txt',
      filename: 'notes.txt',
      extension: '.txt',
    };
    const orderedDocuments = [document, secondDocument].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const server = createApiServer(
      createCatalogue(
        true,
        [source],
        [workspace],
        [repository],
        orderedDocuments,
      ),
      { logger: false },
    );

    const repositories = await server.inject(
      `/api/v1/repositories?sourceId=${source.id}`,
    );
    const firstPage = await server.inject(
      '/api/v1/documents?extension=.MD&limit=1',
    );
    const extensionPage = firstPage.json<{
      items: (typeof document)[];
      nextCursor: string | null;
    }>();
    const cursorPage = await server.inject('/api/v1/documents?limit=1');
    const cursor = cursorPage.json<{ nextCursor: string }>().nextCursor;
    const nextPage = await server.inject(
      `/api/v1/documents?limit=1&cursor=${cursor}`,
    );
    const txtPage = await server.inject('/api/v1/documents?extension=.txt');

    expect(repositories.statusCode).toBe(200);
    expect(repositories.json().items).toEqual([repository]);
    expect(extensionPage.items.map((item) => item.extension)).toEqual(['.md']);
    expect(extensionPage.nextCursor).toBeNull();
    expect(cursorPage.json().items).toEqual([orderedDocuments[0]]);
    expect(nextPage.json().items).toEqual([orderedDocuments[1]]);
    expect(nextPage.json().nextCursor).toBeNull();
    expect(
      txtPage.json().items.map((item: { extension: string }) => item.extension),
    ).toEqual(['.txt']);
    await server.close();
  });

  it('rejects invalid limits and malformed cursors with problem details', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });

    const badLimit = await server.inject('/api/v1/sources?limit=101');
    const badCursor = await server.inject('/api/v1/sources?cursor=%%%');
    const badFilter = await server.inject(
      '/api/v1/repositories?sourceId=invalid',
    );

    expect(badLimit.statusCode).toBe(400);
    expect(badLimit.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(badCursor.statusCode).toBe(400);
    expect(badFilter.statusCode).toBe(400);
    await server.close();
  });

  it('serves extracted evidence and provenance explanations read-only', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });
    const evidencePage = await server.inject(
      `/api/v1/documents/${document.id}/evidence?limit=100`,
    );
    const explanation = await server.inject(
      `/api/v1/evidence/${evidence.id}/explanation`,
    );
    const missing = await server.inject(
      `/api/v1/evidence/${createEvidenceId()}/explanation`,
    );
    const invalidDocument = await server.inject(
      '/api/v1/documents/not-a-ulid/evidence',
    );

    expect(evidencePage.statusCode).toBe(200);
    expect(evidencePage.json()).toEqual({
      items: [evidence],
      nextCursor: null,
    });
    expect(explanation.statusCode).toBe(200);
    expect(explanation.json()).toEqual(evidenceExplanation);
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(invalidDocument.statusCode).toBe(400);
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
