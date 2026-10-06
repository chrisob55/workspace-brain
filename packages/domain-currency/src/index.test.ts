import type {
  DocumentId,
  DocumentVersionId,
  EntityVersionId,
  EvidenceId,
  KnowledgeEntity,
  KnowledgeEntityId,
  KnowledgeModelId,
  KnowledgeProvenance,
  KnowledgePublication,
  KnowledgePublicationId,
  KnowledgeRelationship,
  KnowledgeRelationshipId,
  PublishedEntity,
  PublishedRelationship,
  RelationshipVersionId,
  SourceId,
} from '@workspace-brain/domain';
import { describe, expect, it } from 'vitest';

import {
  classifyPublicationCurrency,
  combineCurrencyStates,
  createCurrencyBasisHash,
  CurrencyReason,
  currencyReasons,
  currencyStates,
  PublicationCurrencyLineageError,
  type CatalogueDocumentVersion,
  type DocumentCurrentVersionState,
  type PublicationCurrencyInputs,
} from './index.js';

const id = (prefix: string, n: number): string =>
  `01K${prefix}${String(n).padStart(22 - prefix.length + 1, '0')}`.slice(0, 26);

const modelId = id('M', 1) as KnowledgeModelId;
const publicationId = id('P', 1) as KnowledgePublicationId;
const sourceId = id('S', 1) as SourceId;
const doc = (n: number) => id('D', n) as DocumentId;
const docVersion = (n: number) => id('V', n) as DocumentVersionId;
const hash = (n: number) => n.toString(16).padStart(64, '0');

function provenance(
  documentNumber: number,
  versionNumber: number,
  evidenceNumber: number,
): KnowledgeProvenance {
  return {
    evidenceId: id('E', evidenceNumber) as EvidenceId,
    documentVersionId: docVersion(versionNumber),
    documentId: doc(documentNumber),
    sourceId,
    documentPath: `doc-${documentNumber}.json`,
    contentFingerprint: `sha256:${hash(versionNumber)}`,
    locator: { kind: 'json-pointer', pointer: '/name' },
    processorId: 'json',
    processorVersion: 1,
    extractionRuleId: 'json-scalar-values',
    extractionRuleVersion: 1,
    knowledgeExtractorId: 'deterministic',
    knowledgeExtractorVersion: 1,
  } as KnowledgeProvenance;
}

function entity(
  n: number,
  support: readonly KnowledgeProvenance[],
): PublishedEntity {
  const entityId = id('N', n) as KnowledgeEntityId;
  const versionId = id('W', n) as EntityVersionId;
  const value: KnowledgeEntity = {
    id: entityId,
    knowledgeModelId: modelId,
    type: 'package',
    name: `entity-${n}`,
    sourceEvidenceIds: support.map(({ evidenceId }) => evidenceId),
    provenance: support,
    lifecycleStatus: 'observed',
    currentVersionId: versionId,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
  return {
    publicationId,
    entityVersionId: versionId,
    versionNumber: 1,
    entity: value,
  };
}

function relationship(
  n: number,
  source: PublishedEntity,
  target: PublishedEntity,
  support: readonly KnowledgeProvenance[],
): PublishedRelationship {
  const relationshipId = id('R', n) as KnowledgeRelationshipId;
  const versionId = id('X', n) as RelationshipVersionId;
  const value: KnowledgeRelationship = {
    id: relationshipId,
    knowledgeModelId: modelId,
    type: 'DEPENDS_ON',
    sourceEntityId: source.entity.id,
    targetEntityId: target.entity.id,
    sourceEvidenceIds: support.map(({ evidenceId }) => evidenceId),
    provenance: support,
    confidence: 1,
    lifecycleStatus: 'related',
    currentVersionId: versionId,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as KnowledgeRelationship;
  return {
    publicationId,
    relationshipVersionId: versionId,
    versionNumber: 2,
    relationship: value,
  };
}

function publication(
  entities: readonly PublishedEntity[],
  relationships: readonly PublishedRelationship[],
): KnowledgePublication {
  return {
    id: publicationId,
    knowledgeModelId: modelId,
    version: 1,
    schemaVersion: 1,
    status: 'published',
    contentHash: hash(999),
    entityVersionIds: entities.map(({ entityVersionId }) => entityVersionId),
    relationshipVersionIds: relationships.map(
      ({ relationshipVersionId }) => relationshipVersionId,
    ),
    publishedAt: '2025-01-01T00:00:00.000Z',
  };
}

function version(
  versionNumber: number,
  documentNumber: number,
  contentHashNumber = versionNumber,
): CatalogueDocumentVersion {
  return {
    id: docVersion(versionNumber),
    documentId: doc(documentNumber),
    contentHash: hash(contentHashNumber),
  };
}

function pointer(
  documentNumber: number,
  versionNumber: number | null,
  revision: number | null = 1,
  documentPresent = true,
): DocumentCurrentVersionState {
  return {
    documentId: doc(documentNumber),
    documentPresent,
    currentDocumentVersionId:
      versionNumber === null ? null : docVersion(versionNumber),
    revision,
  };
}

function inputs(
  entities: readonly PublishedEntity[],
  relationships: readonly PublishedRelationship[],
  documentVersions: readonly CatalogueDocumentVersion[],
  documents: readonly DocumentCurrentVersionState[],
): PublicationCurrencyInputs {
  return {
    publication: publication(entities, relationships),
    entities,
    relationships,
    documentVersions,
    documents,
  };
}

describe('publication currency vocabulary', () => {
  it('exposes closed states and reason codes', () => {
    expect(currencyStates).toEqual(['CURRENT', 'STALE', 'UNKNOWN']);
    expect(currencyReasons).toEqual([
      'CONTENT_CHANGED',
      'PROCESSING_CHANGED',
      'CURRENT_VERSION_UNAVAILABLE',
      'DOCUMENT_REMOVED',
      'CURRENT_VERSION_UNRESOLVABLE',
    ]);
  });

  it('gives STALE precedence over UNKNOWN and UNKNOWN over CURRENT', () => {
    expect(combineCurrencyStates([])).toBe('CURRENT');
    expect(combineCurrencyStates(['CURRENT', 'CURRENT'])).toBe('CURRENT');
    expect(combineCurrencyStates(['CURRENT', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(combineCurrencyStates(['UNKNOWN', 'STALE', 'CURRENT'])).toBe(
      'STALE',
    );
  });
});

describe('classifyPublicationCurrency', () => {
  it('reports everything CURRENT when every pointer still targets the published version', () => {
    const a = entity(1, [provenance(1, 1, 1)]);
    const b = entity(2, [provenance(2, 2, 2)]);
    const r = relationship(1, a, b, [provenance(1, 1, 3)]);
    const result = classifyPublicationCurrency(
      inputs(
        [a, b],
        [r],
        [version(1, 1), version(2, 2)],
        [pointer(1, 1, 3), pointer(2, 2, 1)],
      ),
    );
    expect(result.summary).toMatchObject({
      publicationId,
      knowledgeModelId: modelId,
      currentEntities: 2,
      staleEntities: 0,
      unknownEntities: 0,
      currentRelationships: 1,
      staleRelationships: 0,
      unknownRelationships: 0,
    });
    expect(result.records.map(({ state }) => state)).toEqual([
      'CURRENT',
      'CURRENT',
      'CURRENT',
    ]);
    expect(result.records[0]?.supportingDocuments).toEqual([
      {
        documentId: doc(1),
        publishedDocumentVersionId: docVersion(1),
        publishedContentHash: hash(1),
        currentDocumentVersionId: docVersion(1),
        currentContentHash: hash(1),
        catalogueRevision: 3,
        state: 'CURRENT',
        reason: null,
      },
    ]);
  });

  it('marks an object STALE when one of many supporting documents changed content', () => {
    const support = [1, 2, 3, 4, 5].map((n) => provenance(n, n, n));
    const a = entity(1, support);
    const result = classifyPublicationCurrency(
      inputs(
        [a],
        [],
        [...[1, 2, 3, 4, 5].map((n) => version(n, n)), version(13, 3)],
        [
          pointer(1, 1),
          pointer(2, 2),
          pointer(3, 13, 2),
          pointer(4, 4),
          pointer(5, 5),
        ],
      ),
    );
    const record = result.records[0];
    expect(record?.state).toBe('STALE');
    expect(
      record?.supportingDocuments.map(({ state, reason }) => [state, reason]),
    ).toEqual([
      ['CURRENT', null],
      ['CURRENT', null],
      ['STALE', 'CONTENT_CHANGED'],
      ['CURRENT', null],
      ['CURRENT', null],
    ]);
    expect(record?.supportingDocuments[2]).toMatchObject({
      publishedDocumentVersionId: docVersion(3),
      publishedContentHash: hash(3),
      currentDocumentVersionId: docVersion(13),
      currentContentHash: hash(13),
      catalogueRevision: 2,
    });
    expect(result.summary.staleEntities).toBe(1);
  });

  it('reports PROCESSING_CHANGED when only the processing of identical content changed', () => {
    const a = entity(1, [provenance(1, 1, 1)]);
    const result = classifyPublicationCurrency(
      inputs([a], [], [version(1, 1, 7), version(2, 1, 7)], [pointer(1, 2, 2)]),
    );
    expect(result.records[0]?.state).toBe('STALE');
    expect(result.records[0]?.supportingDocuments[0]?.reason).toBe(
      CurrencyReason.PROCESSING_CHANGED,
    );
  });

  it('reports CURRENT_VERSION_UNAVAILABLE for a pending (cleared) current version', () => {
    const a = entity(1, [provenance(1, 1, 1)]);
    const result = classifyPublicationCurrency(
      inputs([a], [], [version(1, 1)], [pointer(1, null, 4)]),
    );
    expect(result.records[0]).toMatchObject({
      state: 'UNKNOWN',
      supportingDocuments: [
        {
          currentDocumentVersionId: null,
          currentContentHash: null,
          catalogueRevision: 4,
          state: 'UNKNOWN',
          reason: 'CURRENT_VERSION_UNAVAILABLE',
        },
      ],
    });
    expect(result.summary.unknownEntities).toBe(1);
  });

  it('reports CURRENT_VERSION_UNAVAILABLE when no pointer row exists', () => {
    const a = entity(1, [provenance(1, 1, 1)]);
    const result = classifyPublicationCurrency(
      inputs([a], [], [version(1, 1)], [pointer(1, null, null)]),
    );
    expect(result.records[0]?.supportingDocuments[0]).toMatchObject({
      catalogueRevision: null,
      reason: 'CURRENT_VERSION_UNAVAILABLE',
    });
  });

  it('reports DOCUMENT_REMOVED for a removed document', () => {
    const a = entity(1, [provenance(1, 1, 1)]);
    const result = classifyPublicationCurrency(
      inputs([a], [], [version(1, 1)], [pointer(1, null, 2, false)]),
    );
    expect(result.records[0]?.state).toBe('UNKNOWN');
    expect(result.records[0]?.supportingDocuments[0]?.reason).toBe(
      'DOCUMENT_REMOVED',
    );
  });

  it('reports CURRENT_VERSION_UNRESOLVABLE for unusable pointers', () => {
    const a = entity(1, [provenance(1, 1, 1)]);
    const missingTarget = classifyPublicationCurrency(
      inputs([a], [], [version(1, 1)], [pointer(1, 9)]),
    );
    const foreignTarget = classifyPublicationCurrency(
      inputs([a], [], [version(1, 1), version(9, 2)], [pointer(1, 9)]),
    );
    const absentDocument = classifyPublicationCurrency(
      inputs([a], [], [version(1, 1)], [pointer(1, 1, 1, false)]),
    );
    for (const result of [missingTarget, foreignTarget, absentDocument]) {
      expect(result.records[0]?.state).toBe('UNKNOWN');
      expect(result.records[0]?.supportingDocuments[0]?.reason).toBe(
        'CURRENT_VERSION_UNRESOLVABLE',
      );
      expect(
        result.records[0]?.supportingDocuments[0]?.currentContentHash,
      ).toBeNull();
    }
  });

  it('gives STALE precedence over UNKNOWN across supporting documents', () => {
    const a = entity(1, [provenance(1, 1, 1), provenance(2, 2, 2)]);
    const b = entity(2, [provenance(3, 3, 3)]);
    const r = relationship(1, a, b, [provenance(1, 1, 1), provenance(2, 2, 2)]);
    const result = classifyPublicationCurrency(
      inputs(
        [a, b],
        [r],
        [version(1, 1), version(2, 2), version(3, 3), version(13, 1)],
        [pointer(1, 13, 2), pointer(2, null, 2, false), pointer(3, 3, 1)],
      ),
    );
    expect(result.records[0]?.state).toBe('STALE');
    expect(
      result.records[0]?.supportingDocuments.map(({ reason }) => reason),
    ).toEqual(['CONTENT_CHANGED', 'DOCUMENT_REMOVED']);
    expect(result.summary).toMatchObject({
      staleEntities: 1,
      unknownEntities: 0,
      staleRelationships: 1,
      unknownRelationships: 0,
    });
    expect(
      result.records.find(({ objectType }) => objectType === 'relationship')
        ?.state,
    ).toBe('STALE');
  });

  it('classifies shared supporting documents consistently and never inherits relationship currency from endpoints', () => {
    // Document 1 supports entity A and the relationship; document 2 supports
    // entity B only. Document 2 changed, so B is STALE, but the relationship
    // is supported only by unchanged document 1 and stays CURRENT.
    const a = entity(1, [provenance(1, 1, 1)]);
    const b = entity(2, [provenance(2, 2, 2)]);
    const r = relationship(1, a, b, [provenance(1, 1, 3)]);
    const result = classifyPublicationCurrency(
      inputs(
        [a, b],
        [r],
        [version(1, 1), version(2, 2), version(12, 2)],
        [pointer(1, 1), pointer(2, 12, 2)],
      ),
    );
    expect(
      result.records.map(({ objectType, state }) => [objectType, state]),
    ).toEqual([
      ['entity', 'CURRENT'],
      ['entity', 'STALE'],
      ['relationship', 'CURRENT'],
    ]);
    expect(result.records[0]?.supportingDocuments).toEqual(
      result.records[2]?.supportingDocuments,
    );

    // Conversely, a relationship supported by a changed document is STALE
    // even when both endpoints are CURRENT.
    const c = entity(3, [provenance(1, 1, 4)]);
    const d = entity(4, [provenance(1, 1, 5)]);
    const s = relationship(2, c, d, [provenance(2, 2, 6)]);
    const second = classifyPublicationCurrency(
      inputs(
        [c, d],
        [s],
        [version(1, 1), version(2, 2), version(12, 2)],
        [pointer(1, 1), pointer(2, 12, 2)],
      ),
    );
    expect(second.records.map(({ state }) => state)).toEqual([
      'CURRENT',
      'CURRENT',
      'STALE',
    ]);
    expect(second.summary).toMatchObject({
      currentEntities: 2,
      staleRelationships: 1,
    });
  });

  it('deduplicates evidence from the same supporting document version', () => {
    const a = entity(1, [provenance(1, 1, 1), provenance(1, 1, 2)]);
    const result = classifyPublicationCurrency(
      inputs([a], [], [version(1, 1)], [pointer(1, 1)]),
    );
    expect(result.records[0]?.supportingDocuments).toHaveLength(1);
  });

  it('is deterministic regardless of input order', () => {
    const a = entity(1, [provenance(2, 2, 2), provenance(1, 1, 1)]);
    const b = entity(2, [provenance(3, 3, 3)]);
    const r1 = relationship(1, a, b, [provenance(3, 3, 4)]);
    const r2 = relationship(2, b, a, [provenance(1, 1, 5)]);
    const versions = [
      version(1, 1),
      version(2, 2),
      version(3, 3),
      version(4, 3),
    ];
    const pointers = [pointer(1, 1), pointer(2, null), pointer(3, 4, 2)];
    const forward = classifyPublicationCurrency(
      inputs([a, b], [r1, r2], versions, pointers),
    );
    const reversed = classifyPublicationCurrency({
      ...inputs([a, b], [r1, r2], versions, pointers),
      entities: [b, a],
      relationships: [r2, r1],
      documentVersions: [...versions].reverse(),
      documents: [...pointers].reverse(),
    });
    expect(reversed).toEqual(forward);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(
      forward.records.map(({ objectType, id }) => `${objectType}:${id}`),
    ).toEqual([
      `entity:${a.entity.id}`,
      `entity:${b.entity.id}`,
      `relationship:${r1.relationship.id}`,
      `relationship:${r2.relationship.id}`,
    ]);
    expect(
      forward.records[0]?.supportingDocuments.map(
        ({ documentId }) => documentId,
      ),
    ).toEqual([doc(1), doc(2)]);
  });

  it('hashes the catalogue basis deterministically and detects basis changes', () => {
    const pointers = [pointer(1, 1, 1), pointer(2, 2, 3)];
    const versions = [version(1, 1), version(2, 2)];
    const basis = createCurrencyBasisHash(pointers, versions);
    expect(basis).toMatch(/^[a-f0-9]{64}$/);
    expect(
      createCurrencyBasisHash([...pointers].reverse(), [...versions].reverse()),
    ).toBe(basis);
    expect(
      createCurrencyBasisHash([pointer(1, 1, 1), pointer(2, 2, 4)], versions),
    ).not.toBe(basis);
    expect(
      createCurrencyBasisHash(
        [pointer(1, 1, 1), pointer(2, 5, 3)],
        [...versions, version(5, 2)],
      ),
    ).not.toBe(basis);
    expect(
      createCurrencyBasisHash(
        [pointer(1, 1, 1), pointer(2, 2, 3, false)],
        versions,
      ),
    ).not.toBe(basis);
    expect(createCurrencyBasisHash([pointer(1, 1, 1)], versions)).not.toBe(
      basis,
    );
    expect(
      createCurrencyBasisHash(pointers, [version(1, 1), version(2, 2, 99)]),
    ).not.toBe(basis);
  });

  it('raises lineage errors instead of reporting UNKNOWN for broken history', () => {
    const a = entity(1, [provenance(1, 1, 1)]);
    expect(() =>
      classifyPublicationCurrency(inputs([a], [], [], [pointer(1, 1)])),
    ).toThrow(PublicationCurrencyLineageError);
    expect(() =>
      classifyPublicationCurrency(
        inputs([a], [], [version(1, 2)], [pointer(1, 1)]),
      ),
    ).toThrow(PublicationCurrencyLineageError);
    expect(() =>
      classifyPublicationCurrency(inputs([a], [], [version(1, 1)], [])),
    ).toThrow(PublicationCurrencyLineageError);
    expect(() =>
      classifyPublicationCurrency(inputs([entity(2, [])], [], [], [])),
    ).toThrow(PublicationCurrencyLineageError);
  });

  it('reports zero counts for an empty publication', () => {
    const result = classifyPublicationCurrency(inputs([], [], [], []));
    expect(result.records).toEqual([]);
    expect(result.summary.currencyBasisHash).toBe(
      createCurrencyBasisHash([], []),
    );
    expect(result.summary).toMatchObject({
      currentEntities: 0,
      staleEntities: 0,
      unknownEntities: 0,
      currentRelationships: 0,
      staleRelationships: 0,
      unknownRelationships: 0,
    });
  });
});
