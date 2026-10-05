import {
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createKnowledgeEntityId,
  createKnowledgeModelId,
  createKnowledgePublicationId,
  createKnowledgeRelationshipId,
  createRepositoryId,
  createSourceId,
  createWorkspaceId,
} from '@workspace-brain/domain';
import type {
  SearchEntityRequest,
  SearchRelationshipRequest,
} from '@workspace-brain/catalogue';
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
const knowledgeModel = {
  id: createKnowledgeModelId(),
  workspaceId: workspace.id,
  name: 'Product Knowledge Model',
  schemaVersion: 1 as const,
  latestPublicationVersion: null,
  createdAt: '2026-10-01T12:00:00.000Z',
};

const publication = {
  id: createKnowledgePublicationId(),
  knowledgeModelId: knowledgeModel.id,
  version: 1,
  schemaVersion: 1 as const,
  status: 'published' as const,
  contentHash: 'c'.repeat(64),
  entityVersionIds: [],
  relationshipVersionIds: [],
  publishedAt: '2026-10-01T12:00:00.000Z',
};
const projectedEntities = [
  createKnowledgeEntityId(),
  createKnowledgeEntityId(),
  createKnowledgeEntityId(),
]
  .sort()
  .map((entityId, index) => ({
    entityId,
    modelId: knowledgeModel.id,
    publicationId: publication.id,
    type: 'package' as const,
    name: ['@workspace/service', 'lodash', 'react'][index] ?? 'unknown',
    lifecycleStatus: 'observed' as const,
    sourceEvidenceIds: [createEvidenceId()],
    relationshipCount: index === 2 ? 0 : 1,
    publishedAt: publication.publishedAt,
  }));
const projectedRelationship = {
  relationshipId: createKnowledgeRelationshipId(),
  modelId: knowledgeModel.id,
  publicationId: publication.id,
  type: 'DEPENDS_ON' as const,
  sourceEntityId: projectedEntities[0]!.entityId,
  targetEntityId: projectedEntities[1]!.entityId,
  lifecycleStatus: 'related' as const,
  sourceEvidenceIds: [createEvidenceId()],
  publishedAt: publication.publishedAt,
};
const projectionStatistics = {
  publication,
  projectionStatus: 'built' as const,
  projectionSchemaVersion: 1 as const,
  projectionContentHash: 'd'.repeat(64),
  projectedEntityCount: 3,
  projectedRelationshipCount: 1,
  projectedSearchDocumentCount: 4,
  builtAt: '2026-10-01T12:00:01.000Z',
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
  const searchEntityRequests: SearchEntityRequest[] = [];
  const searchRelationshipRequests: SearchRelationshipRequest[] = [];
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
    async listKnowledgeInputEvidence() {
      return [];
    },
    async listKnowledgeModels({
      afterId,
      limit,
    }: {
      afterId?: string;
      limit: number;
    }) {
      return {
        items:
          afterId === undefined || knowledgeModel.id > afterId
            ? [knowledgeModel].slice(0, limit)
            : [],
      };
    },
    async getKnowledgeModel(modelId: string) {
      return modelId === knowledgeModel.id ? knowledgeModel : undefined;
    },
    async listKnowledgeEntities() {
      return { items: [] };
    },
    async getKnowledgeEntity() {
      return undefined;
    },
    async listKnowledgeRelationships() {
      return { items: [] };
    },
    async getKnowledgeRelationship() {
      return undefined;
    },
    async listKnowledgePublications() {
      return { items: [] };
    },
    searchEntityRequests,
    searchRelationshipRequests,
    async searchProjectedEntities(request: SearchEntityRequest) {
      searchEntityRequests.push(request);
      const items = projectedEntities.filter(
        (item) =>
          (request.afterId === undefined || item.entityId > request.afterId) &&
          (request.type === undefined || item.type === request.type) &&
          (request.publicationId === undefined ||
            item.publicationId === request.publicationId) &&
          (request.text === undefined ||
            item.name.includes(request.text.query)),
      );
      return { items: items.slice(0, request.limit) };
    },
    async searchProjectedRelationships(request: SearchRelationshipRequest) {
      searchRelationshipRequests.push(request);
      const items = [projectedRelationship].filter(
        (item) =>
          (request.afterId === undefined ||
            item.relationshipId > request.afterId) &&
          (request.entityId === undefined ||
            item.sourceEntityId === request.entityId ||
            item.targetEntityId === request.entityId),
      );
      return { items: items.slice(0, request.limit) };
    },
    async getProjectedEntity(entityId: string, publicationId?: string) {
      return projectedEntities.find(
        (item) =>
          item.entityId === entityId &&
          (publicationId === undefined || item.publicationId === publicationId),
      );
    },
    async getProjectedRelationship(relationshipId: string) {
      return relationshipId === projectedRelationship.relationshipId
        ? projectedRelationship
        : undefined;
    },
    async getProjectionStatistics(publicationId: string) {
      return publicationId === publication.id
        ? projectionStatistics
        : undefined;
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

  it('serves read-only Knowledge Model, entity, relationship, and publication queries', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });
    const models = await server.inject('/api/v1/knowledge/models');
    const model = await server.inject(
      `/api/v1/knowledge/models/${knowledgeModel.id}`,
    );
    const entities = await server.inject('/api/v1/knowledge/entities');
    const relationships = await server.inject(
      '/api/v1/knowledge/relationships',
    );
    const publications = await server.inject('/api/v1/knowledge/publications');
    const invalidEntityType = await server.inject(
      '/api/v1/knowledge/entities?type=arbitrary',
    );
    const invalidRelationshipType = await server.inject(
      '/api/v1/knowledge/relationships?type=OWNS',
    );
    const missingRelationship = await server.inject(
      `/api/v1/knowledge/relationships/${createEvidenceId()}`,
    );

    expect(models.statusCode).toBe(200);
    expect(models.json()).toEqual({
      items: [knowledgeModel],
      nextCursor: null,
    });
    expect(model.statusCode).toBe(200);
    expect(model.json()).toEqual(knowledgeModel);
    expect(entities.json()).toEqual({ items: [], nextCursor: null });
    expect(relationships.json()).toEqual({ items: [], nextCursor: null });
    expect(publications.json()).toEqual({ items: [], nextCursor: null });
    expect(invalidEntityType.statusCode).toBe(400);
    expect(invalidRelationshipType.statusCode).toBe(400);
    expect(missingRelationship.statusCode).toBe(404);
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
  it('serves deterministic filtered search over projected entities', async () => {
    const catalogue = createCatalogue();
    const server = createApiServer(catalogue, { logger: false });

    const all = await server.inject('/api/v1/search/entities');
    const filtered = await server.inject(
      `/api/v1/search/entities?publicationId=${publication.id}&type=package&lifecycleStatus=observed&query=%20lodash%20&match=exact&field=name&limit=5`,
    );
    const textSearch = await server.inject(
      '/api/v1/search/entities?query=pack&match=prefix&field=text',
    );

    expect(all.statusCode).toBe(200);
    expect(all.json()).toEqual({ items: projectedEntities, nextCursor: null });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toEqual({
      items: [projectedEntities[1]],
      nextCursor: null,
    });
    expect(catalogue.searchEntityRequests[0]).toEqual({ limit: 51 });
    expect(catalogue.searchEntityRequests[1]).toEqual({
      publicationId: publication.id,
      type: 'package',
      lifecycleStatus: 'observed',
      text: { query: 'lodash', match: 'exact', field: 'name' },
      limit: 6,
    });
    expect(catalogue.searchEntityRequests[2]?.text).toEqual({
      query: 'pack',
      match: 'prefix',
      field: 'text',
    });
    expect(textSearch.statusCode).toBe(200);
    await server.close();
  });

  it('cursor-paginates projected entities by entity ID', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });

    const first = await server.inject('/api/v1/search/entities?limit=2');
    const firstPage = first.json<{
      items: typeof projectedEntities;
      nextCursor: string | null;
    }>();
    const second = await server.inject(
      `/api/v1/search/entities?limit=2&cursor=${firstPage.nextCursor ?? ''}`,
    );

    expect(firstPage.items).toEqual(projectedEntities.slice(0, 2));
    expect(firstPage.nextCursor).toBe(
      Buffer.from(projectedEntities[1]!.entityId).toString('base64url'),
    );
    expect(second.json()).toEqual({
      items: projectedEntities.slice(2),
      nextCursor: null,
    });
    await server.close();
  });

  it('filters projected relationships by type, entity and text', async () => {
    const catalogue = createCatalogue();
    const server = createApiServer(catalogue, { logger: false });

    const byEntity = await server.inject(
      `/api/v1/search/relationships?entityId=${projectedEntities[1]!.entityId}&type=DEPENDS_ON&query=depends&match=prefix`,
    );
    const none = await server.inject(
      `/api/v1/search/relationships?entityId=${projectedEntities[2]!.entityId}`,
    );

    expect(byEntity.statusCode).toBe(200);
    expect(byEntity.json()).toEqual({
      items: [projectedRelationship],
      nextCursor: null,
    });
    expect(catalogue.searchRelationshipRequests[0]).toEqual({
      entityId: projectedEntities[1]!.entityId,
      type: 'DEPENDS_ON',
      text: { query: 'depends', match: 'prefix', field: 'type' },
      limit: 51,
    });
    expect(none.json()).toEqual({ items: [], nextCursor: null });
    await server.close();
  });

  it('looks up projected entities, relationships and publication statistics by ID', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });

    const entity = await server.inject(
      `/api/v1/search/entity/${projectedEntities[0]!.entityId}?publicationId=${publication.id}`,
    );
    const relationship = await server.inject(
      `/api/v1/search/relationship/${projectedRelationship.relationshipId}`,
    );
    const statistics = await server.inject(
      `/api/v1/search/publication/${publication.id}`,
    );
    const missingEntity = await server.inject(
      `/api/v1/search/entity/${createKnowledgeEntityId()}`,
    );
    const missingRelationship = await server.inject(
      `/api/v1/search/relationship/${createKnowledgeRelationshipId()}`,
    );
    const missingPublication = await server.inject(
      `/api/v1/search/publication/${createKnowledgePublicationId()}`,
    );

    expect(entity.statusCode).toBe(200);
    expect(entity.json()).toEqual(projectedEntities[0]);
    expect(relationship.json()).toEqual(projectedRelationship);
    expect(statistics.json()).toEqual(projectionStatistics);
    expect(missingEntity.statusCode).toBe(404);
    expect(missingEntity.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(missingRelationship.statusCode).toBe(404);
    expect(missingPublication.statusCode).toBe(404);
    await server.close();
  });

  it('rejects invalid search requests with problem details', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });
    const invalid = [
      '/api/v1/search/entities?limit=101',
      '/api/v1/search/entities?cursor=%%%',
      `/api/v1/search/entities?cursor=${Buffer.from('not-a-ulid').toString('base64url')}`,
      '/api/v1/search/entities?match=exact',
      '/api/v1/search/entities?field=text',
      '/api/v1/search/entities?query=',
      `/api/v1/search/entities?query=${'a'.repeat(257)}`,
      '/api/v1/search/entities?query=x&match=fuzzy',
      '/api/v1/search/entities?query=x&field=type',
      '/api/v1/search/entities?type=arbitrary',
      '/api/v1/search/entities?publicationId=invalid',
      '/api/v1/search/entities?unknown=1',
      '/api/v1/search/relationships?type=OWNS',
      '/api/v1/search/relationships?entityId=invalid',
      '/api/v1/search/relationships?query=x&field=name',
      '/api/v1/search/entity/not-a-ulid',
      `/api/v1/search/entity/${createKnowledgeEntityId()}?publicationId=bad`,
      '/api/v1/search/relationship/not-a-ulid',
      '/api/v1/search/publication/not-a-ulid',
      `/api/v1/search/publication/${publication.id}?limit=1`,
    ];

    for (const url of invalid) {
      const response = await server.inject(url);
      expect(response.statusCode, url).toBe(400);
      expect(response.headers['content-type'], url).toContain(
        'application/problem+json',
      );
    }
    await server.close();
  });
});
