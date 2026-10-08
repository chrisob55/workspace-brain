import { describe, expect, it } from 'vitest';

import {
  createKnowledgePublicationContentHash,
  createKnowledgePublicationPackage,
  KnowledgePublicationPackageIntegrityError,
  serializeKnowledgePublicationPackage,
} from './index.js';
import type { KnowledgePublicationSnapshot } from './index.js';
import { snapshot } from './test-fixtures.js';

describe('knowledge publication package contract', () => {
  it('creates deterministic JSON from unordered immutable snapshot entries', () => {
    const packageA = createKnowledgePublicationPackage(snapshot);
    const packageB = createKnowledgePublicationPackage({
      ...snapshot,
      entities: [...snapshot.entities].reverse(),
      relationships: [...snapshot.relationships].reverse(),
    });

    expect(serializeKnowledgePublicationPackage(packageA)).toBe(
      serializeKnowledgePublicationPackage(packageB),
    );
    expect(packageA.format).toBe('workspace-brain-knowledge-publication');
    expect(packageA.formatVersion).toBe(1);
    expect(packageA.metadata).toMatchObject({
      publicationId: snapshot.publication.id,
      publicationVersion: snapshot.publication.version,
      schemaVersion: snapshot.publication.schemaVersion,
      createdAt: snapshot.publication.publishedAt,
      contentHash: snapshot.publication.contentHash,
      entityCount: snapshot.entities.length,
      relationshipCount: snapshot.relationships.length,
    });
    expect(packageA.provenance).toHaveLength(
      snapshot.entities.length + snapshot.relationships.length,
    );
    expect(packageA.provenance[0]?.items).toEqual(
      packageA.entities[0]?.entity.provenance,
    );
  });

  it('rejects entity, relationship, membership, and provenance tampering', () => {
    const publicationPackage = createKnowledgePublicationPackage(snapshot);
    const changedEntity = {
      ...publicationPackage,
      entities: publicationPackage.entities.map((item, index) =>
        index === 0
          ? { ...item, entity: { ...item.entity, name: 'tampered' } }
          : item,
      ),
    };
    expect(() => serializeKnowledgePublicationPackage(changedEntity)).toThrow(
      KnowledgePublicationPackageIntegrityError,
    );
    expect(() =>
      serializeKnowledgePublicationPackage({
        ...publicationPackage,
        provenance: [],
      }),
    ).toThrow(/provenance is inconsistent/);
  });

  it('accepts an empty publication and rejects a content hash mismatch', () => {
    const emptySnapshot: KnowledgePublicationSnapshot = {
      ...snapshot,
      publication: {
        ...snapshot.publication,
        contentHash: createKnowledgePublicationContentHash([], [], 1),
        entityVersionIds: [],
        relationshipVersionIds: [],
      },
      entities: [],
      relationships: [],
    };
    expect(
      createKnowledgePublicationPackage(emptySnapshot).metadata.entityCount,
    ).toBe(0);
    expect(() =>
      createKnowledgePublicationPackage({
        ...emptySnapshot,
        publication: {
          ...emptySnapshot.publication,
          contentHash: '0'.repeat(64),
        },
      }),
    ).toThrow(/content hash does not match/);
  });
});
