import { createHash } from 'node:crypto';

import type {
  KnowledgeEntity,
  KnowledgePublication,
  KnowledgeProvenance,
  PublishedEntity,
  PublishedRelationship,
  KnowledgeRelationship,
} from '@workspace-brain/domain';

export type KnowledgePublicationSnapshot = {
  readonly publication: KnowledgePublication;
  readonly entities: readonly PublishedEntity[];
  readonly relationships: readonly PublishedRelationship[];
};

export const knowledgePublicationPackageFormat =
  'workspace-brain-knowledge-publication' as const;
export const knowledgePublicationPackageFormatVersion = 1 as const;

export type KnowledgePublicationPackage = {
  readonly format: typeof knowledgePublicationPackageFormat;
  readonly formatVersion: typeof knowledgePublicationPackageFormatVersion;
  readonly metadata: {
    readonly publicationId: string;
    readonly knowledgeModelId: string;
    readonly publicationVersion: number;
    readonly schemaVersion: KnowledgePublication['schemaVersion'];
    readonly createdAt: string;
    readonly contentHash: string;
    readonly entityCount: number;
    readonly relationshipCount: number;
  };
  readonly entities: readonly PublishedEntity[];
  readonly relationships: readonly PublishedRelationship[];
  readonly provenance: readonly PublishedKnowledgeProvenance[];
};

export type PublishedKnowledgeProvenance = {
  readonly objectType: 'entity' | 'relationship';
  readonly objectId: string;
  readonly versionId: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly items: readonly KnowledgeProvenance[];
};

export class KnowledgePublicationPackageIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgePublicationPackageIntegrityError';
  }
}

export function createKnowledgePublicationPackage(
  snapshot: KnowledgePublicationSnapshot,
): KnowledgePublicationPackage {
  const publication = snapshot.publication;
  const entities = [...snapshot.entities]
    .sort((left, right) => compareOrdinal(left.entity.id, right.entity.id))
    .map((entity) => ({ ...entity, entity: { ...entity.entity } }));
  const relationships = [...snapshot.relationships]
    .sort((left, right) =>
      compareOrdinal(left.relationship.id, right.relationship.id),
    )
    .map((relationship) => ({
      ...relationship,
      relationship: { ...relationship.relationship },
    }));
  const provenance: PublishedKnowledgeProvenance[] = [
    ...entities.map((published) => ({
      objectType: 'entity' as const,
      objectId: published.entity.id,
      versionId: published.entityVersionId,
      sourceEvidenceIds: published.entity.sourceEvidenceIds,
      items: published.entity.provenance,
    })),
    ...relationships.map((published) => ({
      objectType: 'relationship' as const,
      objectId: published.relationship.id,
      versionId: published.relationshipVersionId,
      sourceEvidenceIds: published.relationship.sourceEvidenceIds,
      items: published.relationship.provenance,
    })),
  ].sort(
    (left, right) =>
      compareOrdinal(left.objectType, right.objectType) ||
      compareOrdinal(left.objectId, right.objectId),
  );
  const publicationPackage: KnowledgePublicationPackage = {
    format: knowledgePublicationPackageFormat,
    formatVersion: knowledgePublicationPackageFormatVersion,
    metadata: {
      publicationId: publication.id,
      knowledgeModelId: publication.knowledgeModelId,
      publicationVersion: publication.version,
      schemaVersion: publication.schemaVersion,
      createdAt: publication.publishedAt,
      contentHash: publication.contentHash,
      entityCount: entities.length,
      relationshipCount: relationships.length,
    },
    entities,
    relationships,
    provenance,
  };
  assertKnowledgePublicationPackageIntegrity(publicationPackage);
  return publicationPackage;
}

export function serializeKnowledgePublicationPackage(
  publicationPackage: KnowledgePublicationPackage,
): string {
  assertKnowledgePublicationPackageIntegrity(publicationPackage);
  return stableJson(publicationPackage);
}

export function assertKnowledgePublicationPackageIntegrity(
  publicationPackage: KnowledgePublicationPackage,
): void {
  if (
    publicationPackage.format !== knowledgePublicationPackageFormat ||
    publicationPackage.formatVersion !==
      knowledgePublicationPackageFormatVersion
  ) {
    throw new KnowledgePublicationPackageIntegrityError(
      'Knowledge publication package format is unsupported',
    );
  }
  const { metadata, entities, relationships, provenance } = publicationPackage;
  const entityIds = new Set(entities.map(({ entity }) => entity.id));
  if (
    (metadata.schemaVersion !== 1 && metadata.schemaVersion !== 2) ||
    !Number.isInteger(metadata.publicationVersion) ||
    metadata.publicationVersion < 1 ||
    !/^[a-f0-9]{64}$/.test(metadata.contentHash) ||
    metadata.entityCount !== entities.length ||
    metadata.relationshipCount !== relationships.length ||
    !isStrictlySorted(entities.map(({ entity }) => entity.id)) ||
    !isStrictlySorted(
      relationships.map(({ relationship }) => relationship.id),
    ) ||
    entities.some(
      (published) =>
        published.publicationId !== metadata.publicationId ||
        published.entity.knowledgeModelId !== metadata.knowledgeModelId ||
        published.entityVersionId !== published.entity.currentVersionId ||
        !hasCompleteProvenance(
          published.entity.sourceEvidenceIds,
          published.entity.provenance,
        ),
    ) ||
    relationships.some(
      (published) =>
        published.publicationId !== metadata.publicationId ||
        published.relationship.knowledgeModelId !== metadata.knowledgeModelId ||
        published.relationshipVersionId !==
          published.relationship.currentVersionId ||
        !entityIds.has(published.relationship.sourceEntityId) ||
        !entityIds.has(published.relationship.targetEntityId) ||
        !hasCompleteProvenance(
          published.relationship.sourceEvidenceIds,
          published.relationship.provenance,
        ),
    )
  ) {
    throw new KnowledgePublicationPackageIntegrityError(
      `Publication ${metadata.publicationId} package membership is inconsistent`,
    );
  }

  const actualContentHash = createKnowledgePublicationContentHash(
    entities.map(({ entity }) => entity),
    relationships.map(({ relationship }) => relationship),
    metadata.schemaVersion,
  );
  if (actualContentHash !== metadata.contentHash) {
    throw new KnowledgePublicationPackageIntegrityError(
      `Publication ${metadata.publicationId} package content hash does not match`,
    );
  }

  const expectedProvenance = [
    ...entities.map((published) => ({
      objectType: 'entity' as const,
      objectId: published.entity.id,
      versionId: published.entityVersionId,
      sourceEvidenceIds: published.entity.sourceEvidenceIds,
      items: published.entity.provenance,
    })),
    ...relationships.map((published) => ({
      objectType: 'relationship' as const,
      objectId: published.relationship.id,
      versionId: published.relationshipVersionId,
      sourceEvidenceIds: published.relationship.sourceEvidenceIds,
      items: published.relationship.provenance,
    })),
  ].sort(
    (left, right) =>
      compareOrdinal(left.objectType, right.objectType) ||
      compareOrdinal(left.objectId, right.objectId),
  );
  if (
    !isStrictlySorted(
      provenance.map(({ objectType, objectId }) => `${objectType}:${objectId}`),
    ) ||
    stableJson(provenance) !== stableJson(expectedProvenance)
  ) {
    throw new KnowledgePublicationPackageIntegrityError(
      `Publication ${metadata.publicationId} package provenance is inconsistent`,
    );
  }
}

export function createKnowledgePublicationContentHash(
  entities: readonly KnowledgeEntity[],
  relationships: readonly KnowledgeRelationship[],
  schemaVersion: number,
): string {
  return createHash('sha256')
    .update(
      stableJson({
        schemaVersion,
        entities: [...entities].sort((left, right) =>
          compareOrdinal(left.id, right.id),
        ),
        relationships: [...relationships].sort((left, right) =>
          compareOrdinal(left.id, right.id),
        ),
      }),
    )
    .digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort(compareOrdinal)
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isStrictlySorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value,
  );
}

function hasCompleteProvenance(
  evidenceIds: readonly string[],
  items: readonly KnowledgeProvenance[],
): boolean {
  const provenanceIds = items
    .map(({ evidenceId }) => evidenceId)
    .sort(compareOrdinal);
  const sortedEvidenceIds = [...evidenceIds].sort(compareOrdinal);
  return (
    sortedEvidenceIds.length > 0 &&
    new Set(sortedEvidenceIds).size === sortedEvidenceIds.length &&
    new Set(provenanceIds).size === provenanceIds.length &&
    stableJson(sortedEvidenceIds) === stableJson(provenanceIds)
  );
}
