import {
  createEntityVersionId,
  createEvidenceId,
  createKnowledgeEntityId,
  createKnowledgeModelId,
  createKnowledgePublicationId,
  createKnowledgeRelationshipId,
  createRelationshipVersionId,
  type KnowledgeEntity,
  type KnowledgePublication,
  type KnowledgeRelationship,
} from '@workspace-brain/domain';
import { describe, expect, it } from 'vitest';

import {
  buildSearchProjection,
  normalizeSearchText,
  tokenizeSearchText,
  type PublishedEntitySnapshot,
  type PublishedRelationshipSnapshot,
} from './search-projection-builder.js';

const modelId = createKnowledgeModelId();
const createdAt = '2026-11-01T10:00:00.000Z';

function entitySnapshot(
  name: string,
  overrides: Partial<KnowledgeEntity> = {},
): PublishedEntitySnapshot {
  const versionId = createEntityVersionId();
  const snapshot: KnowledgeEntity = {
    id: createKnowledgeEntityId(),
    knowledgeModelId: modelId,
    type: 'package',
    name,
    sourceEvidenceIds: [createEvidenceId(), createEvidenceId()],
    provenance: [],
    lifecycleStatus: 'observed',
    currentVersionId: versionId,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
  return { versionId: snapshot.currentVersionId, snapshot };
}

function relationshipSnapshot(
  source: KnowledgeEntity,
  target: KnowledgeEntity,
): PublishedRelationshipSnapshot {
  const versionId = createRelationshipVersionId();
  const snapshot: KnowledgeRelationship = {
    id: createKnowledgeRelationshipId(),
    knowledgeModelId: modelId,
    type: 'DEPENDS_ON',
    sourceEntityId: source.id,
    targetEntityId: target.id,
    sourceEvidenceIds: [createEvidenceId()],
    provenance: [],
    confidence: 1,
    lifecycleStatus: 'related',
    currentVersionId: versionId,
    createdAt,
    updatedAt: createdAt,
  };
  return { versionId, snapshot };
}

function publicationFor(
  entities: readonly PublishedEntitySnapshot[],
  relationships: readonly PublishedRelationshipSnapshot[],
  version = 1,
): KnowledgePublication {
  return {
    id: createKnowledgePublicationId(),
    knowledgeModelId: modelId,
    version,
    schemaVersion: 1,
    status: 'published',
    contentHash: 'c'.repeat(64),
    entityVersionIds: entities.map(({ versionId }) => versionId),
    relationshipVersionIds: relationships.map(({ versionId }) => versionId),
    publishedAt: '2026-11-01T10:00:01.000Z',
  };
}

describe('search projection builder', () => {
  const service = entitySnapshot('@Workspace/Service');
  const lodash = entitySnapshot('lodash');
  const orphan = entitySnapshot('Orphan API', { type: 'api' });
  const dependency = relationshipSnapshot(service.snapshot, lodash.snapshot);
  const entities = [service, lodash, orphan];
  const relationships = [dependency];
  const publication = publicationFor(entities, relationships);

  it('builds entity projections only from publication snapshots', () => {
    const projection = buildSearchProjection(
      publication,
      entities,
      relationships,
    );

    expect(projection.entities.map(({ entityId }) => entityId)).toEqual(
      entities.map(({ snapshot }) => snapshot.id).sort(),
    );
    expect(
      projection.entities.find(
        ({ entityId }) => entityId === service.snapshot.id,
      ),
    ).toEqual({
      entityId: service.snapshot.id,
      modelId,
      publicationId: publication.id,
      type: 'package',
      name: '@Workspace/Service',
      lifecycleStatus: 'observed',
      sourceEvidenceIds: [...service.snapshot.sourceEvidenceIds].sort(),
      relationshipCount: 1,
      publishedAt: publication.publishedAt,
    });
    expect(
      projection.entities.find(
        ({ entityId }) => entityId === orphan.snapshot.id,
      )?.relationshipCount,
    ).toBe(0);
    expect(projection).toMatchObject({
      publicationId: publication.id,
      modelId,
      publicationVersion: 1,
      publicationContentHash: publication.contentHash,
      schemaVersion: 1,
    });
  });

  it('builds relationship projections and searchable documents', () => {
    const projection = buildSearchProjection(
      publication,
      entities,
      relationships,
    );

    expect(projection.relationships).toEqual([
      {
        relationshipId: dependency.snapshot.id,
        modelId,
        publicationId: publication.id,
        type: 'DEPENDS_ON',
        sourceEntityId: service.snapshot.id,
        targetEntityId: lodash.snapshot.id,
        lifecycleStatus: 'related',
        sourceEvidenceIds: dependency.snapshot.sourceEvidenceIds,
        publishedAt: publication.publishedAt,
      },
    ]);
    expect(projection.documents).toHaveLength(4);
    expect(
      projection.documents.find(
        ({ documentId }) => documentId === `entity:${service.snapshot.id}`,
      ),
    ).toEqual({
      documentId: `entity:${service.snapshot.id}`,
      publicationId: publication.id,
      searchableText: '@workspace/service package',
      searchableTerms: ['package', 'service', 'workspace'],
      publishedAt: publication.publishedAt,
    });
    expect(
      projection.documents.find(
        ({ documentId }) =>
          documentId === `relationship:${dependency.snapshot.id}`,
      )?.searchableText,
    ).toBe('depends_on @workspace/service lodash');
  });

  it('is idempotent when the same publication is replayed', () => {
    const first = buildSearchProjection(publication, entities, relationships);
    const replay = buildSearchProjection(publication, entities, relationships);

    expect(replay).toEqual(first);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rebuilds deterministically regardless of snapshot input order', () => {
    const first = buildSearchProjection(publication, entities, relationships);
    const reordered = buildSearchProjection(
      {
        ...publication,
        entityVersionIds: [...publication.entityVersionIds].reverse(),
      },
      [...entities].reverse(),
      [...relationships].reverse(),
    );

    expect(JSON.stringify(reordered)).toBe(JSON.stringify(first));
  });

  it('distinguishes publications even when snapshots are shared', () => {
    const first = buildSearchProjection(publication, entities, relationships);
    const later = buildSearchProjection(
      { ...publicationFor(entities, relationships, 2) },
      entities,
      relationships,
    );

    expect(later.contentHash).not.toBe(first.contentHash);
    expect(
      later.entities.every(
        ({ publicationId }) => publicationId !== publication.id,
      ),
    ).toBe(true);
  });

  it('rejects snapshots that do not belong to the publication', () => {
    expect(() =>
      buildSearchProjection(publication, [service, lodash], relationships),
    ).toThrow('missing entity version');
    expect(() =>
      buildSearchProjection(
        publication,
        [
          service,
          lodash,
          {
            versionId: orphan.versionId,
            snapshot: {
              ...orphan.snapshot,
              knowledgeModelId: createKnowledgeModelId(),
            },
          },
        ],
        relationships,
      ),
    ).toThrow('does not match its snapshot');
    expect(() =>
      buildSearchProjection(
        publicationFor([service], relationships),
        [service],
        relationships,
      ),
    ).toThrow('references an unpublished entity');
  });

  it('normalizes and tokenizes text deterministically without fuzzy matching', () => {
    expect(normalizeSearchText('ＡＰＩ Gateway')).toBe('api gateway');
    expect(tokenizeSearchText('DEPENDS_ON @scope/pkg-name v2 pkg')).toEqual([
      'depends',
      'name',
      'on',
      'pkg',
      'scope',
      'v2',
    ]);
  });
});
