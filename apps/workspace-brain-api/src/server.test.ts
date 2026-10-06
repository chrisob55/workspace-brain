import {
  createDocumentId,
  createDocumentVersionId,
  createEntityVersionId,
  createEvidenceId,
  createKnowledgeEntityId,
  createKnowledgeModelId,
  createKnowledgePublicationId,
  createKnowledgeRelationshipId,
  createRelationshipVersionId,
  createRepositoryId,
  createSourceId,
  createWorkspaceId,
} from '@workspace-brain/domain';
import type {
  PublicationSnapshot,
  SearchEntityRequest,
  SearchRelationshipRequest,
} from '@workspace-brain/catalogue';
import {
  publicationComparisonHeader,
  type PublicationDiff,
} from '@workspace-brain/domain-evolution';
import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
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
const entityVersionId = createEntityVersionId();
const relationshipVersionId = createRelationshipVersionId();
const entityProvenance = {
  evidenceId: evidence.id,
  documentVersionId: documentVersion.id,
  documentId: document.id,
  sourceId: source.id,
  documentPath: document.path,
  contentFingerprint: document.fingerprint,
  locator: evidence.locator,
  processorId: documentVersion.processorId,
  processorVersion: documentVersion.processorVersion,
  extractionRuleId: documentVersion.extractionRuleId,
  extractionRuleVersion: documentVersion.extractionRuleVersion,
  knowledgeExtractorId: 'deterministic-knowledge-extractors',
  knowledgeExtractorVersion: 1,
};
const publishedEntityObject = {
  id: projectedEntities[0]!.entityId,
  knowledgeModelId: knowledgeModel.id,
  type: 'package' as const,
  name: 'service',
  sourceEvidenceIds: [evidence.id],
  provenance: [entityProvenance],
  lifecycleStatus: 'observed' as const,
  currentVersionId: entityVersionId,
  createdAt: publication.publishedAt,
  updatedAt: publication.publishedAt,
};
const publishedRelationshipObject = {
  id: projectedRelationship.relationshipId,
  knowledgeModelId: knowledgeModel.id,
  type: 'DEPENDS_ON' as const,
  sourceEntityId: projectedEntities[0]!.entityId,
  targetEntityId: projectedEntities[1]!.entityId,
  sourceEvidenceIds: [evidence.id],
  provenance: [entityProvenance],
  confidence: 1,
  lifecycleStatus: 'related' as const,
  currentVersionId: relationshipVersionId,
  createdAt: publication.publishedAt,
  updatedAt: publication.publishedAt,
};
const publishedEntity = {
  publicationId: publication.id,
  entityVersionId,
  versionNumber: 2,
  entity: publishedEntityObject,
};
const publishedRelationship = {
  publicationId: publication.id,
  relationshipVersionId,
  versionNumber: 3,
  relationship: publishedRelationshipObject,
};
const incomingRelationshipId = createKnowledgeRelationshipId();
const incomingRelationshipVersionId = createRelationshipVersionId();
const incomingPublishedRelationship = {
  publicationId: publication.id,
  relationshipVersionId: incomingRelationshipVersionId,
  versionNumber: 1,
  direction: 'incoming' as const,
  relationship: {
    ...publishedRelationshipObject,
    id: incomingRelationshipId,
    sourceEntityId: projectedEntities[1]!.entityId,
    targetEntityId: publishedEntityObject.id,
    currentVersionId: incomingRelationshipVersionId,
  },
};
const publishedRelationshipTraversals = [
  {
    ...publishedRelationship,
    direction: 'outgoing' as const,
  },
  incomingPublishedRelationship,
].sort((left, right) =>
  left.relationship.id.localeCompare(right.relationship.id),
);
const secondEvidence = { ...evidence, id: createEvidenceId() };
const secondProvenance = {
  ...entityProvenance,
  evidenceId: secondEvidence.id,
};
const secondEvidenceExplanation = {
  ...evidenceExplanation,
  evidence: secondEvidence,
};
const publishedProvenance = {
  publicationId: publication.id,
  knowledgeObjectType: 'entity' as const,
  knowledgeObjectId: publishedEntityObject.id,
  knowledgeVersionId: entityVersionId,
  knowledgeVersionNumber: 2,
  items: [
    { provenance: entityProvenance, evidenceExplanation },
    {
      provenance: secondProvenance,
      evidenceExplanation: secondEvidenceExplanation,
    },
  ].sort((left, right) =>
    left.provenance.evidenceId.localeCompare(right.provenance.evidenceId),
  ),
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
    async listAvailableKnowledgePublications() {
      return { items: [] };
    },
    async getKnowledgePublication(publicationId: string) {
      return publicationId === publication.id ? publication : undefined;
    },
    async getLatestKnowledgePublication(modelId: string) {
      return modelId === knowledgeModel.id ? publication : undefined;
    },
    async getKnowledgePublicationSummary(publicationId: string) {
      return publicationId === publication.id
        ? {
            publication,
            entityCount: 2,
            relationshipCount: 1,
          }
        : undefined;
    },
    async getPublishedEntity(publicationId: string, entityId: string) {
      return publicationId === publication.id &&
        entityId === publishedEntity.entity.id
        ? publishedEntity
        : undefined;
    },
    async getPublishedRelationship(
      publicationId: string,
      relationshipId: string,
    ) {
      return publicationId === publication.id &&
        relationshipId === publishedRelationship.relationship.id
        ? publishedRelationship
        : undefined;
    },
    async listPublishedEntityRelationships(request: {
      publicationId: string;
      entityId: string;
      direction: 'incoming' | 'outgoing' | 'both';
      relationshipType?: string;
      afterId?: string;
      limit: number;
    }) {
      const items = publishedRelationshipTraversals.filter(
        (item) =>
          request.publicationId === publication.id &&
          (request.direction === 'both' ||
            request.direction === item.direction) &&
          (request.relationshipType === undefined ||
            item.relationship.type === request.relationshipType) &&
          (request.afterId === undefined ||
            item.relationship.id > request.afterId),
      );
      return { items: items.slice(0, request.limit) };
    },
    async getPublishedEntityProvenance(
      publicationId: string,
      entityId: string,
    ) {
      return publicationId === publication.id &&
        entityId === publishedEntity.entity.id
        ? publishedProvenance
        : undefined;
    },
    async getPublishedRelationshipProvenance(
      publicationId: string,
      relationshipId: string,
    ) {
      return publicationId === publication.id &&
        relationshipId === publishedRelationship.relationship.id
        ? {
            ...publishedProvenance,
            knowledgeObjectType: 'relationship' as const,
            knowledgeObjectId: publishedRelationship.relationship.id,
            knowledgeVersionId: publishedRelationship.relationshipVersionId,
            knowledgeVersionNumber: publishedRelationship.versionNumber,
          }
        : undefined;
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

  it('resolves concrete publications and opens immutable objects by publication', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });
    const latest = await server.inject(
      `/api/v1/knowledge/models/${knowledgeModel.id}/publications/latest`,
    );
    const selectedPublication = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}`,
    );
    const summary = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/summary`,
    );
    const entity = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/entities/${publishedEntity.entity.id}`,
    );
    const relationship = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/relationships/${publishedRelationship.relationship.id}`,
    );
    const searchEntity = await server.inject(
      `/api/v1/search/entity/${publishedEntity.entity.id}?publicationId=${publication.id}`,
    );
    const searchRelationship = await server.inject(
      `/api/v1/search/relationship/${publishedRelationship.relationship.id}?publicationId=${publication.id}`,
    );
    const absent = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/entities/${projectedEntities[2]!.entityId}`,
    );

    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({
      id: publication.id,
      knowledgeModelId: knowledgeModel.id,
    });
    expect(selectedPublication.json()).toEqual(publication);
    expect(summary.json()).toEqual({
      publication,
      entityCount: 2,
      relationshipCount: 1,
    });
    expect(entity.json()).toEqual(publishedEntity);
    expect(entity.json().entityVersionId).toBe(entityVersionId);
    expect(entity.json().versionNumber).toBe(2);
    expect(relationship.json()).toEqual(publishedRelationship);
    expect(relationship.json().relationshipVersionId).toBe(
      relationshipVersionId,
    );
    expect(searchEntity.json()).toMatchObject({
      entityId: entity.json().entity.id,
      publicationId: entity.json().publicationId,
    });
    expect(searchRelationship.json()).toMatchObject({
      relationshipId: relationship.json().relationship.id,
      publicationId: relationship.json().publicationId,
    });
    expect(absent.statusCode).toBe(404);
    await server.close();
  });

  it('paginates one-hop relationships and provenance with publication-bound cursors', async () => {
    const server = createApiServer(createCatalogue(), { logger: false });
    const entityId = publishedEntity.entity.id;
    const relationshipPage1 = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/entities/${entityId}/relationships?limit=1&direction=both`,
    );
    const firstRelationshipItem = relationshipPage1.json().items[0];
    const relationshipPage2 = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/entities/${entityId}/relationships?limit=1&direction=both&cursor=${encodeURIComponent(relationshipPage1.json().nextCursor)}`,
    );
    const mismatchedRelationshipCursor = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/entities/${entityId}/relationships?limit=1&direction=incoming&cursor=${encodeURIComponent(relationshipPage1.json().nextCursor)}`,
    );
    const invalidCursor = Buffer.from(
      JSON.stringify({
        version: 8,
        kind: 'published-relationships',
        publicationId: publication.id,
        entityId,
        direction: 'both',
        afterId: incomingRelationshipId,
      }),
    ).toString('base64url');
    const unsupportedCursor = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/entities/${entityId}/relationships?cursor=${invalidCursor}`,
    );

    const provenancePath = `/api/v1/knowledge/publications/${publication.id}/entities/${entityId}/provenance`;
    const provenancePage1 = await server.inject(`${provenancePath}?limit=1`);
    const provenancePage2 = await server.inject(
      `${provenancePath}?limit=1&cursor=${encodeURIComponent(provenancePage1.json().nextCursor)}`,
    );
    const relationshipProvenanceWithEntityCursor = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/relationships/${publishedRelationship.relationship.id}/provenance?cursor=${encodeURIComponent(provenancePage1.json().nextCursor)}`,
    );

    expect(relationshipPage1.statusCode).toBe(200);
    expect(relationshipPage1.json().publicationId).toBe(publication.id);
    expect(firstRelationshipItem).toMatchObject({
      publicationId: publication.id,
      versionNumber: expect.any(Number),
      direction: expect.stringMatching(/^(incoming|outgoing)$/),
    });
    expect(firstRelationshipItem.relationshipVersionId).toBeDefined();
    expect(relationshipPage2.json().items).toHaveLength(1);
    expect(relationshipPage2.json().items[0].relationship.id).not.toBe(
      firstRelationshipItem.relationship.id,
    );
    expect(mismatchedRelationshipCursor.statusCode).toBe(400);
    expect(unsupportedCursor.statusCode).toBe(400);
    expect(provenancePage1.json()).toMatchObject({
      publicationId: publication.id,
      knowledgeObjectType: 'entity',
      knowledgeObjectId: entityId,
      knowledgeVersionId: entityVersionId,
      knowledgeVersionNumber: 2,
    });
    expect(provenancePage1.json().items).toHaveLength(1);
    expect(provenancePage1.json().nextCursor).toBeTruthy();
    expect(provenancePage2.json().items).toHaveLength(1);
    expect(relationshipProvenanceWithEntityCursor.statusCode).toBe(400);
    await server.close();
  });

  it('returns an explicit integrity problem when a published read detects corrupt authority', async () => {
    const catalogue = {
      ...createCatalogue(),
      async getPublishedEntity() {
        throw new CatalogueIntegrityError('publication version is missing');
      },
    };
    const server = createApiServer(
      catalogue as Parameters<typeof createApiServer>[0],
      { logger: false },
    );
    const response = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/entities/${publishedEntity.entity.id}`,
    );
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      title: 'Knowledge Integrity Failure',
      status: 500,
    });
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

const evolvedEntityVersionId = createEntityVersionId();
const nextPublication = {
  ...publication,
  id: createKnowledgePublicationId(),
  version: 2,
  contentHash: 'd'.repeat(64),
  publishedAt: '2026-10-02T12:00:00.000Z',
};
const foreignPublication = {
  ...publication,
  id: createKnowledgePublicationId(),
  knowledgeModelId: createKnowledgeModelId(),
  contentHash: 'e'.repeat(64),
};

function createDiffCatalogue() {
  const base = createCatalogue();
  const publications = [publication, nextPublication, foreignPublication];
  const snapshots = new Map<string, PublicationSnapshot>([
    [
      publication.id,
      {
        publication,
        entities: [publishedEntity],
        relationships: [],
      },
    ],
    [
      nextPublication.id,
      {
        publication: nextPublication,
        entities: [
          {
            publicationId: nextPublication.id,
            entityVersionId: evolvedEntityVersionId,
            versionNumber: 3,
            entity: {
              ...publishedEntityObject,
              name: 'service-renamed',
              currentVersionId: evolvedEntityVersionId,
            },
          },
          {
            publicationId: nextPublication.id,
            entityVersionId: createEntityVersionId(),
            versionNumber: 1,
            entity: {
              ...publishedEntityObject,
              id: projectedEntities[1]!.entityId,
              name: 'lodash',
            },
          },
        ],
        relationships: [
          { ...publishedRelationship, publicationId: nextPublication.id },
        ],
      },
    ],
    [
      foreignPublication.id,
      { publication: foreignPublication, entities: [], relationships: [] },
    ],
  ]);
  const diffs = new Map<string, PublicationDiff>();
  return {
    ...base,
    async getKnowledgePublication(publicationId: string) {
      return publications.find(({ id }) => id === publicationId);
    },
    async getPublicationSnapshot(publicationId: string) {
      return snapshots.get(publicationId);
    },
    async findPublicationDiff(fromId: string, toId: string) {
      return [...diffs.values()].find(
        (diff) =>
          diff.fromPublicationId === fromId && diff.toPublicationId === toId,
      );
    },
    async getPublicationDiff(diffId: string) {
      return diffs.get(diffId);
    },
    async listPublicationComparisons(request: {
      publicationId: string;
      afterId?: string;
      limit: number;
    }) {
      const items = [...diffs.values()]
        .filter(
          (diff) =>
            (diff.fromPublicationId === request.publicationId ||
              diff.toPublicationId === request.publicationId) &&
            (request.afterId === undefined || diff.id > request.afterId),
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(publicationComparisonHeader);
      return { items: items.slice(0, request.limit) };
    },
    async savePublicationDiff(diff: PublicationDiff, invalidDiffId?: string) {
      const existing = [...diffs.values()].find(
        (stored) =>
          stored.fromPublicationId === diff.fromPublicationId &&
          stored.toPublicationId === diff.toPublicationId,
      );
      if (
        existing?.contentHash === diff.contentHash &&
        existing.id !== invalidDiffId
      ) {
        return existing;
      }
      if (existing !== undefined) {
        diffs.delete(existing.id);
      }
      diffs.set(diff.id, diff);
      return diff;
    },
  };
}

describe('Workspace Brain knowledge evolution routes', () => {
  it('compares two publications and serves the persisted diff', async () => {
    const server = createApiServer(createDiffCatalogue(), { logger: false });
    const diffPath = `/api/v1/knowledge/publications/${publication.id}/diff/${nextPublication.id}`;

    const response = await server.inject(diffPath);
    const repeated = await server.inject(diffPath);

    expect(response.statusCode).toBe(200);
    const diff = response.json();
    expect(diff).toMatchObject({
      schemaVersion: 1,
      knowledgeModelId: knowledgeModel.id,
      fromPublicationId: publication.id,
      fromPublicationVersion: 1,
      toPublicationId: nextPublication.id,
      toPublicationVersion: 2,
      summary: {
        entitiesAdded: 1,
        entitiesRemoved: 0,
        entitiesModified: 1,
        entitiesUnchanged: 0,
        relationshipsAdded: 1,
        relationshipsRemoved: 0,
        relationshipsModified: 0,
        relationshipsUnchanged: 0,
      },
    });
    expect(diff.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(diff.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(
      diff.entityChanges.map(
        (change: { changeType: string; changedFields: string[] }) => [
          change.changeType,
          change.changedFields,
        ],
      ),
    ).toEqual(
      expect.arrayContaining([
        ['MODIFIED', ['name']],
        ['ADDED', []],
      ]),
    );
    expect(diff.relationshipChanges[0]).toMatchObject({
      changeType: 'ADDED',
      relationshipId: publishedRelationshipObject.id,
      from: null,
      to: { versionId: relationshipVersionId, versionNumber: 3 },
    });
    expect(repeated.json()).toEqual(diff);

    const retrieved = await server.inject(`/api/v1/knowledge/diffs/${diff.id}`);
    expect(retrieved.statusCode).toBe(200);
    expect(retrieved.json()).toEqual(diff);
    await server.close();
  });

  it('lists known comparisons for a publication with cursor pagination', async () => {
    const server = createApiServer(createDiffCatalogue(), { logger: false });
    await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/diff/${nextPublication.id}`,
    );
    await server.inject(
      `/api/v1/knowledge/publications/${nextPublication.id}/diff/${publication.id}`,
    );

    const page1 = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/changes?limit=1`,
    );
    const page2 = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/changes?limit=1&cursor=${encodeURIComponent(page1.json().nextCursor)}`,
    );
    const foreign = await server.inject(
      `/api/v1/knowledge/publications/${foreignPublication.id}/changes`,
    );
    const reusedElsewhere = await server.inject(
      `/api/v1/knowledge/publications/${nextPublication.id}/changes?limit=1&cursor=${encodeURIComponent(page1.json().nextCursor)}`,
    );
    const unscopedCursor = await server.inject(
      `/api/v1/knowledge/publications/${publication.id}/changes?limit=1&cursor=${Buffer.from(page1.json().items[0].id).toString('base64url')}`,
    );

    expect(page1.statusCode).toBe(200);
    expect(page1.json().items).toHaveLength(1);
    expect(page1.json().items[0]).not.toHaveProperty('entityChanges');
    expect(page1.json().items[0].summary).toBeDefined();
    expect(page2.json().items).toHaveLength(1);
    expect(page2.json().nextCursor).toBeNull();
    expect(page2.json().items[0].id).not.toBe(page1.json().items[0].id);
    expect(foreign.json()).toEqual({ items: [], nextCursor: null });
    // Cursors are bound to the publication whose comparisons they page.
    expect(reusedElsewhere.statusCode).toBe(400);
    expect(unscopedCursor.statusCode).toBe(400);
    await server.close();
  });

  it('rejects invalid, missing and cross-model comparisons with problem details', async () => {
    const server = createApiServer(createDiffCatalogue(), { logger: false });
    const missing = createKnowledgePublicationId();
    const cases: [string, number][] = [
      [`/api/v1/knowledge/publications/bad/diff/${publication.id}`, 400],
      [`/api/v1/knowledge/publications/${publication.id}/diff/bad`, 400],
      [
        `/api/v1/knowledge/publications/${publication.id}/diff/${nextPublication.id}?x=1`,
        400,
      ],
      [
        `/api/v1/knowledge/publications/${publication.id}/diff/${foreignPublication.id}`,
        400,
      ],
      [`/api/v1/knowledge/publications/${publication.id}/diff/${missing}`, 404],
      [`/api/v1/knowledge/publications/${missing}/diff/${publication.id}`, 404],
      ['/api/v1/knowledge/publications/bad/changes', 400],
      [`/api/v1/knowledge/publications/${publication.id}/changes?limit=0`, 400],
      [
        `/api/v1/knowledge/publications/${publication.id}/changes?cursor=***`,
        400,
      ],
      [`/api/v1/knowledge/publications/${missing}/changes`, 404],
      ['/api/v1/knowledge/diffs/not-a-ulid', 400],
      [`/api/v1/knowledge/diffs/${createKnowledgePublicationId()}`, 404],
    ];
    for (const [url, status] of cases) {
      const response = await server.inject(url);
      expect(response.statusCode, url).toBe(status);
      expect(response.headers['content-type'], url).toContain(
        'application/problem+json',
      );
    }
    await server.close();
  });

  it('returns an integrity problem when a stored diff no longer matches its publications', async () => {
    const catalogue = createDiffCatalogue();
    const server = createApiServer(catalogue, { logger: false });
    const created = (
      await server.inject(
        `/api/v1/knowledge/publications/${publication.id}/diff/${nextPublication.id}`,
      )
    ).json();
    const stored = await catalogue.getPublicationDiff(created.id);
    await catalogue.savePublicationDiff(
      { ...stored!, summary: { ...stored!.summary, entitiesAdded: 7 } },
      created.id,
    );
    const tampered = (await catalogue.findPublicationDiff(
      publication.id,
      nextPublication.id,
    ))!;

    const response = await server.inject(
      `/api/v1/knowledge/diffs/${tampered.id}`,
    );

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      title: 'Knowledge Integrity Failure',
    });
    await server.close();
  });
});

const currencyPublication = {
  ...publication,
  id: createKnowledgePublicationId(),
  contentHash: 'f'.repeat(64),
};
const currencyDocuments = [
  createDocumentId(),
  createDocumentId(),
  createDocumentId(),
].sort();
const [currentDocumentId, changedDocumentId, removedDocumentId] =
  currencyDocuments as [
    (typeof currencyDocuments)[number],
    (typeof currencyDocuments)[number],
    (typeof currencyDocuments)[number],
  ];
const currencyVersion = {
  current: createDocumentVersionId(),
  changedPublished: createDocumentVersionId(),
  changedCurrent: createDocumentVersionId(),
  removed: createDocumentVersionId(),
};

function currencyProvenance(
  documentId: string,
  documentVersionId: string,
): typeof entityProvenance {
  return {
    ...entityProvenance,
    evidenceId: createEvidenceId(),
    documentId: documentId as typeof entityProvenance.documentId,
    documentVersionId:
      documentVersionId as typeof entityProvenance.documentVersionId,
  };
}

const currencyEntityIds = [
  createKnowledgeEntityId(),
  createKnowledgeEntityId(),
  createKnowledgeEntityId(),
].sort();
const currencyEntitySupport = [
  [currencyProvenance(currentDocumentId, currencyVersion.current)],
  [currencyProvenance(changedDocumentId, currencyVersion.changedPublished)],
  [currencyProvenance(removedDocumentId, currencyVersion.removed)],
];
const currencyEntities = currencyEntityIds.map((id, index) => {
  const versionId = createEntityVersionId();
  const provenance = currencyEntitySupport[index]!;
  return {
    publicationId: currencyPublication.id,
    entityVersionId: versionId,
    versionNumber: index + 1,
    entity: {
      ...publishedEntityObject,
      id,
      name: `currency-${index}`,
      sourceEvidenceIds: provenance.map(({ evidenceId }) => evidenceId),
      provenance,
      currentVersionId: versionId,
    },
  };
});
const currencyRelationshipIds = [
  createKnowledgeRelationshipId(),
  createKnowledgeRelationshipId(),
].sort();
const currencyRelationshipSupport = [
  // Endpoints are CURRENT and STALE, but this relationship's own support is
  // unchanged, so it must be CURRENT.
  [currencyProvenance(currentDocumentId, currencyVersion.current)],
  [
    currencyProvenance(changedDocumentId, currencyVersion.changedPublished),
    currencyProvenance(removedDocumentId, currencyVersion.removed),
  ],
];
const currencyRelationships = currencyRelationshipIds.map((id, index) => {
  const versionId = createRelationshipVersionId();
  const provenance = currencyRelationshipSupport[index]!;
  return {
    publicationId: currencyPublication.id,
    relationshipVersionId: versionId,
    versionNumber: 1,
    relationship: {
      ...publishedRelationshipObject,
      id,
      sourceEntityId: currencyEntityIds[index]!,
      targetEntityId: currencyEntityIds[index + 1]!,
      sourceEvidenceIds: provenance.map(({ evidenceId }) => evidenceId),
      provenance,
      currentVersionId: versionId,
    },
  };
});

function createCurrencyCatalogue() {
  const base = createCatalogue();
  const state = {
    changedRevision: 2,
    failure: undefined as Error | undefined,
    dropPublishedVersion: false,
  };
  const catalogue = {
    ...base,
    async getPublicationCurrencyInputs(publicationId: string) {
      if (state.failure !== undefined) {
        throw state.failure;
      }
      if (publicationId !== currencyPublication.id) {
        return undefined;
      }
      const documentVersions = [
        {
          id: currencyVersion.current,
          documentId: currentDocumentId,
          contentHash: '1'.repeat(64),
        },
        {
          id: currencyVersion.changedPublished,
          documentId: changedDocumentId,
          contentHash: '2'.repeat(64),
        },
        {
          id: currencyVersion.changedCurrent,
          documentId: changedDocumentId,
          contentHash: '3'.repeat(64),
        },
        {
          id: currencyVersion.removed,
          documentId: removedDocumentId,
          contentHash: '4'.repeat(64),
        },
      ];
      return {
        publication: {
          ...currencyPublication,
          entityVersionIds: currencyEntities.map(
            ({ entityVersionId }) => entityVersionId,
          ),
          relationshipVersionIds: currencyRelationships.map(
            ({ relationshipVersionId }) => relationshipVersionId,
          ),
        },
        entities: [...currencyEntities].reverse(),
        relationships: [...currencyRelationships].reverse(),
        documentVersions: state.dropPublishedVersion
          ? documentVersions.slice(1)
          : documentVersions,
        documents: [
          {
            documentId: currentDocumentId,
            documentPresent: true,
            currentDocumentVersionId: currencyVersion.current,
            revision: 1,
          },
          {
            documentId: changedDocumentId,
            documentPresent: true,
            currentDocumentVersionId: currencyVersion.changedCurrent,
            revision: state.changedRevision,
          },
          {
            documentId: removedDocumentId,
            documentPresent: false,
            currentDocumentVersionId: null,
            revision: 3,
          },
        ],
      };
    },
  };
  return { catalogue, state };
}

describe('Workspace Brain publication currency routes', () => {
  const currencyPath = `/api/v1/knowledge/publications/${currencyPublication.id}/currency`;

  it('summarises publication currency by object type and state', async () => {
    const { catalogue } = createCurrencyCatalogue();
    const server = createApiServer(catalogue, { logger: false });

    const response = await server.inject(currencyPath);
    const repeated = await server.inject(currencyPath);

    expect(response.statusCode).toBe(200);
    const summary = response.json();
    expect(Object.keys(summary).sort()).toEqual([
      'currencyBasisHash',
      'currentEntities',
      'currentRelationships',
      'knowledgeModelId',
      'publicationId',
      'staleEntities',
      'staleRelationships',
      'unknownEntities',
      'unknownRelationships',
    ]);
    expect(summary).toMatchObject({
      publicationId: currencyPublication.id,
      knowledgeModelId: knowledgeModel.id,
      currentEntities: 1,
      staleEntities: 1,
      unknownEntities: 1,
      currentRelationships: 1,
      staleRelationships: 1,
      unknownRelationships: 0,
    });
    expect(summary.currencyBasisHash).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated.json()).toEqual(summary);
    await server.close();
  });

  it('lists ordered currency details with supporting-document results', async () => {
    const { catalogue } = createCurrencyCatalogue();
    const server = createApiServer(catalogue, { logger: false });

    const response = await server.inject(`${currencyPath}/details`);

    expect(response.statusCode).toBe(200);
    const page = response.json();
    expect(page.publicationId).toBe(currencyPublication.id);
    expect(page.knowledgeModelId).toBe(knowledgeModel.id);
    expect(page.nextCursor).toBeNull();
    expect(
      page.items.map(
        (item: { objectType: string; id: string; state: string }) => [
          item.objectType,
          item.id,
          item.state,
        ],
      ),
    ).toEqual([
      ['entity', currencyEntityIds[0], 'CURRENT'],
      ['entity', currencyEntityIds[1], 'STALE'],
      ['entity', currencyEntityIds[2], 'UNKNOWN'],
      ['relationship', currencyRelationshipIds[0], 'CURRENT'],
      ['relationship', currencyRelationshipIds[1], 'STALE'],
    ]);
    expect(page.items[1]).toEqual({
      objectType: 'entity',
      id: currencyEntityIds[1],
      versionId: currencyEntities[1]!.entityVersionId,
      versionNumber: 2,
      state: 'STALE',
      supportingDocuments: [
        {
          documentId: changedDocumentId,
          publishedDocumentVersionId: currencyVersion.changedPublished,
          publishedContentHash: '2'.repeat(64),
          currentDocumentVersionId: currencyVersion.changedCurrent,
          currentContentHash: '3'.repeat(64),
          catalogueRevision: 2,
          state: 'STALE',
          reason: 'CONTENT_CHANGED',
        },
      ],
    });
    expect(
      page.items[4].supportingDocuments.map(
        (item: { reason: string }) => item.reason,
      ),
    ).toEqual(['CONTENT_CHANGED', 'DOCUMENT_REMOVED']);
    // Only domain identifiers and hashes; no paths, excerpts or SQL rows.
    expect(JSON.stringify(page)).not.toMatch(
      /documentPath|excerpt|document_id|content_hash/,
    );
    await server.close();
  });

  it('filters by object type and state and pages with bound cursors', async () => {
    const { catalogue } = createCurrencyCatalogue();
    const server = createApiServer(catalogue, { logger: false });

    const relationships = await server.inject(
      `${currencyPath}/details?objectType=relationship`,
    );
    const stale = await server.inject(`${currencyPath}/details?state=STALE`);
    const staleEntities = await server.inject(
      `${currencyPath}/details?objectType=entity&state=STALE`,
    );
    expect(
      relationships.json().items.map(({ id }: { id: string }) => id),
    ).toEqual(currencyRelationshipIds);
    expect(
      stale
        .json()
        .items.map(({ objectType, id }: { objectType: string; id: string }) => [
          objectType,
          id,
        ]),
    ).toEqual([
      ['entity', currencyEntityIds[1]],
      ['relationship', currencyRelationshipIds[1]],
    ]);
    expect(staleEntities.json().items).toHaveLength(1);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await server.inject(
        `${currencyPath}/details?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      expect(response.statusCode).toBe(200);
      const page = response.json();
      seen.push(...page.items.map(({ id }: { id: string }) => id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(seen).toEqual([...currencyEntityIds, ...currencyRelationshipIds]);

    const filteredPage1 = await server.inject(
      `${currencyPath}/details?state=STALE&limit=1`,
    );
    const filteredPage2 = await server.inject(
      `${currencyPath}/details?state=STALE&limit=1&cursor=${encodeURIComponent(filteredPage1.json().nextCursor)}`,
    );
    expect(filteredPage2.statusCode).toBe(200);
    expect(filteredPage2.json().items[0].id).toBe(currencyRelationshipIds[1]);
    expect(filteredPage2.json().nextCursor).toBeNull();
    await server.close();
  });

  it('rejects malformed, unscoped and mismatched cursors with 400', async () => {
    const { catalogue } = createCurrencyCatalogue();
    const server = createApiServer(catalogue, { logger: false });
    const first = (
      await server.inject(`${currencyPath}/details?state=STALE&limit=1`)
    ).json();
    const cursor = encodeURIComponent(first.nextCursor);
    const decoded = JSON.parse(
      Buffer.from(first.nextCursor, 'base64url').toString('utf8'),
    );
    expect(decoded).toEqual({
      version: 1,
      kind: 'publication-currency',
      publicationId: currencyPublication.id,
      state: 'STALE',
      currencyBasisHash: first.currencyBasisHash,
      afterObjectType: 'entity',
      afterId: currencyEntityIds[1],
    });
    const forged = Buffer.from(
      JSON.stringify({ ...decoded, afterObjectType: 'module' }),
    ).toString('base64url');
    const otherPublication = Buffer.from(
      JSON.stringify({ ...decoded, publicationId: publication.id }),
    ).toString('base64url');

    const cases = [
      // Filters differ from those the cursor was issued for.
      `${currencyPath}/details?limit=1&cursor=${cursor}`,
      `${currencyPath}/details?state=CURRENT&limit=1&cursor=${cursor}`,
      `${currencyPath}/details?state=STALE&objectType=entity&cursor=${cursor}`,
      // Cursor issued for this publication reused on another one.
      `/api/v1/knowledge/publications/${publication.id}/currency/details?state=STALE&cursor=${cursor}`,
      `${currencyPath}/details?state=STALE&cursor=${otherPublication}`,
      `${currencyPath}/details?state=STALE&cursor=${forged}`,
      `${currencyPath}/details?cursor=***`,
      `${currencyPath}/details?cursor=${Buffer.from(currencyEntityIds[0]!).toString('base64url')}`,
      `${currencyPath}/details?cursor=${'a'.repeat(2049)}`,
    ];
    for (const url of cases) {
      const response = await server.inject(url);
      expect(response.statusCode, url).toBe(400);
      expect(response.headers['content-type'], url).toContain(
        'application/problem+json',
      );
      expect(response.json().status, url).toBe(400);
    }
    const mismatched = await server.inject(
      `${currencyPath}/details?limit=1&cursor=${cursor}`,
    );
    expect(mismatched.json().title, 'mismatched publication cursor').toBe(
      'Invalid Cursor',
    );
    expect(mismatched.json()).toMatchObject({
      type: 'about:blank',
      title: 'Invalid Cursor',
      status: 400,
    });
    await server.close();
  });

  it('returns 409 when the catalogue basis changes during pagination', async () => {
    const { catalogue, state } = createCurrencyCatalogue();
    const server = createApiServer(catalogue, { logger: false });
    const first = (
      await server.inject(`${currencyPath}/details?limit=1`)
    ).json();
    state.changedRevision = 3;

    const response = await server.inject(
      `${currencyPath}/details?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
    );
    const summary = (await server.inject(currencyPath)).json();

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(response.json()).toEqual({
      type: 'about:blank',
      title: 'Currency Basis Changed',
      status: 409,
      detail:
        'The catalogue current-version basis changed during pagination; restart from the first page.',
    });
    expect(summary.currencyBasisHash).not.toBe(first.currencyBasisHash);
    await server.close();
  });

  it('rejects invalid requests and unknown publications with problem details', async () => {
    const { catalogue } = createCurrencyCatalogue();
    const server = createApiServer(catalogue, { logger: false });
    const missing = createKnowledgePublicationId();
    const cases: [string, number][] = [
      ['/api/v1/knowledge/publications/bad/currency', 400],
      ['/api/v1/knowledge/publications/bad/currency/details', 400],
      [`${currencyPath}?limit=1`, 400],
      [`${currencyPath}/details?state=stale`, 400],
      [`${currencyPath}/details?state=OUTDATED`, 400],
      [`${currencyPath}/details?objectType=module`, 400],
      [`${currencyPath}/details?limit=0`, 400],
      [`${currencyPath}/details?limit=101`, 400],
      [`${currencyPath}/details?unexpected=1`, 400],
      [`/api/v1/knowledge/publications/${missing}/currency`, 404],
      [`/api/v1/knowledge/publications/${missing}/currency/details`, 404],
    ];
    for (const [url, status] of cases) {
      const response = await server.inject(url);
      expect(response.statusCode, url).toBe(status);
      expect(response.headers['content-type'], url).toContain(
        'application/problem+json',
      );
      expect(response.json().status, url).toBe(status);
    }
    await server.close();
  });

  it('returns integrity problems instead of UNKNOWN for broken lineage', async () => {
    const { catalogue, state } = createCurrencyCatalogue();
    const server = createApiServer(catalogue, { logger: false });

    state.dropPublishedVersion = true;
    const lineage = await server.inject(currencyPath);
    const lineageDetails = await server.inject(`${currencyPath}/details`);
    state.dropPublishedVersion = false;
    state.failure = new CatalogueIntegrityError(
      'Publication references missing mandatory evidence',
    );
    const integrity = await server.inject(`${currencyPath}/details`);

    for (const response of [lineage, lineageDetails, integrity]) {
      expect(response.statusCode).toBe(500);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json()).toEqual({
        type: 'about:blank',
        title: 'Knowledge Integrity Failure',
        status: 500,
        detail:
          'The stored publication or provenance data is incomplete or inconsistent.',
      });
    }
    await server.close();
  });
});
