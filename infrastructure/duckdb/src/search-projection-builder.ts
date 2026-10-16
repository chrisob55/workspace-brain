import { createHash } from 'node:crypto';

import {
  searchProjectionSchemaVersion,
  type EntityVersionId,
  type KnowledgeEntity,
  type KnowledgePublication,
  type KnowledgeRelationship,
  type ProjectedEntity,
  type ProjectedRelationship,
  type ProjectedSearchDocument,
  type RelationshipVersionId,
  type SearchProjection,
} from '@workspace-brain/domain';

export type PublishedEntitySnapshot = {
  readonly versionId: EntityVersionId;
  readonly snapshot: KnowledgeEntity;
};

export type PublishedRelationshipSnapshot = {
  readonly versionId: RelationshipVersionId;
  readonly snapshot: KnowledgeRelationship;
};

/**
 * Builds the search projection for one immutable Knowledge Publication.
 *
 * The only inputs are the publication and the immutable version snapshots it
 * references; current entity/relationship rows and contribution records are
 * never consulted. Output ordering and hashing are ordinal so the same
 * publication always yields byte-identical projection records.
 */
export function buildSearchProjection(
  publication: KnowledgePublication,
  entitySnapshots: readonly PublishedEntitySnapshot[],
  relationshipSnapshots: readonly PublishedRelationshipSnapshot[],
): SearchProjection {
  const entities = resolveSnapshots(
    'entity',
    publication,
    publication.entityVersionIds,
    entitySnapshots,
  );
  const relationships = resolveSnapshots(
    'relationship',
    publication,
    publication.relationshipVersionIds,
    relationshipSnapshots,
  );
  const entitiesById = new Map<string, KnowledgeEntity>();
  for (const entity of entities) {
    if (entitiesById.has(entity.id)) {
      throw new Error(
        `Publication ${publication.id} references entity ${entity.id} more than once`,
      );
    }
    entitiesById.set(entity.id, entity);
  }
  const relationshipCounts = new Map<string, number>();
  const relationshipIds = new Set<string>();
  for (const relationship of relationships) {
    if (relationshipIds.has(relationship.id)) {
      throw new Error(
        `Publication ${publication.id} references relationship ${relationship.id} more than once`,
      );
    }
    relationshipIds.add(relationship.id);
    for (const endpoint of new Set([
      relationship.sourceEntityId,
      relationship.targetEntityId,
    ])) {
      if (!entitiesById.has(endpoint)) {
        throw new Error(
          `Publication ${publication.id} relationship ${relationship.id} references an unpublished entity`,
        );
      }
      relationshipCounts.set(
        endpoint,
        (relationshipCounts.get(endpoint) ?? 0) + 1,
      );
    }
  }

  const projectedEntities: ProjectedEntity[] = entities
    .map((entity) => ({
      entityId: entity.id,
      modelId: publication.knowledgeModelId,
      publicationId: publication.id,
      type: entity.type,
      name: entity.name,
      lifecycleStatus: entity.lifecycleStatus,
      sourceEvidenceIds: sortedUnique(entity.sourceEvidenceIds),
      relationshipCount: relationshipCounts.get(entity.id) ?? 0,
      publishedAt: publication.publishedAt,
    }))
    .sort((left, right) => compareOrdinal(left.entityId, right.entityId));
  const projectedRelationships: ProjectedRelationship[] = relationships
    .map((relationship) => ({
      relationshipId: relationship.id,
      modelId: publication.knowledgeModelId,
      publicationId: publication.id,
      type: relationship.type,
      sourceEntityId: relationship.sourceEntityId,
      targetEntityId: relationship.targetEntityId,
      lifecycleStatus: relationship.lifecycleStatus,
      sourceEvidenceIds: sortedUnique(relationship.sourceEvidenceIds),
      publishedAt: publication.publishedAt,
    }))
    .sort((left, right) =>
      compareOrdinal(left.relationshipId, right.relationshipId),
    );
  const documents: ProjectedSearchDocument[] = [
    ...projectedEntities.map((entity) => {
      const snapshot = entitiesById.get(entity.entityId);
      if (!snapshot) {
        throw new Error(
          `Publication ${publication.id} is missing entity ${entity.entityId}`,
        );
      }
      return createSearchDocument(
        publication,
        entitySearchDocumentId(entity.entityId),
        [
          entity.name,
          entity.type,
          ...(entity.type === 'journey' ? [journeySearchText(snapshot)] : []),
        ],
      );
    }),
    ...projectedRelationships.map((relationship) =>
      createSearchDocument(
        publication,
        relationshipSearchDocumentId(relationship.relationshipId),
        [
          relationship.type,
          entitiesById.get(relationship.sourceEntityId)?.name ?? '',
          entitiesById.get(relationship.targetEntityId)?.name ?? '',
        ],
      ),
    ),
  ].sort((left, right) => compareOrdinal(left.documentId, right.documentId));

  const body = {
    schemaVersion: searchProjectionSchemaVersion,
    publicationId: publication.id,
    modelId: publication.knowledgeModelId,
    publicationVersion: publication.version,
    publicationContentHash: publication.contentHash,
    entities: projectedEntities,
    relationships: projectedRelationships,
    documents,
  };
  return {
    publicationId: publication.id,
    modelId: publication.knowledgeModelId,
    publicationVersion: publication.version,
    publicationContentHash: publication.contentHash,
    schemaVersion: searchProjectionSchemaVersion,
    contentHash: createHash('sha256').update(stableJson(body)).digest('hex'),
    entities: projectedEntities,
    relationships: projectedRelationships,
    documents,
  };
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

export function tokenizeSearchText(value: string): string[] {
  return sortedUnique(
    normalizeSearchText(value)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length > 0),
  );
}

export function entitySearchDocumentId(entityId: string): string {
  return `entity:${entityId}`;
}

export function relationshipSearchDocumentId(relationshipId: string): string {
  return `relationship:${relationshipId}`;
}

function createSearchDocument(
  publication: KnowledgePublication,
  documentId: string,
  parts: readonly string[],
): ProjectedSearchDocument {
  const searchableText = normalizeSearchText(
    parts.filter((part) => part.length > 0).join(' '),
  );
  return {
    documentId,
    publicationId: publication.id,
    searchableText,
    searchableTerms: tokenizeSearchText(searchableText),
    publishedAt: publication.publishedAt,
  };
}

function journeySearchText(entity: KnowledgeEntity): string {
  const serialized = entity.provenance.flatMap((item) =>
    item.facts?.journeyJson ? [item.facts.journeyJson] : [],
  );
  if (serialized.length !== 1) {
    throw new Error(
      `Published Journey ${entity.id} must contain one serialized model`,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized[0] ?? '');
  } catch (error) {
    throw new Error(
      `Published Journey ${entity.id} contains invalid model JSON`,
      { cause: error },
    );
  }
  if (
    !isRecord(decoded) ||
    typeof decoded.id !== 'string' ||
    typeof decoded.name !== 'string' ||
    !Array.isArray(decoded.sourceServices) ||
    !Array.isArray(decoded.entityReferences) ||
    !Array.isArray(decoded.steps)
  ) {
    throw new Error(
      `Published Journey ${entity.id} is missing searchable model fields`,
    );
  }
  const terms = [
    decoded.id,
    decoded.name,
    ...decoded.sourceServices.filter(isString),
    ...decoded.entityReferences.flatMap((reference) =>
      isRecord(reference) && isString(reference.label) ? [reference.label] : [],
    ),
    ...decoded.steps.flatMap((step) =>
      isRecord(step)
        ? [
            step.method,
            step.route,
            step.controller,
            step.service,
            step.component,
            step.connector,
            step.target,
            step.targetExpression,
          ].filter(isString)
        : [],
    ),
  ];
  return terms.join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function resolveSnapshots<
  Snapshot extends KnowledgeEntity | KnowledgeRelationship,
>(
  label: 'entity' | 'relationship',
  publication: KnowledgePublication,
  versionIds: readonly string[],
  snapshots: readonly {
    readonly versionId: string;
    readonly snapshot: Snapshot;
  }[],
): Snapshot[] {
  const byVersion = new Map<string, Snapshot>();
  for (const { versionId, snapshot } of snapshots) {
    byVersion.set(versionId, snapshot);
  }
  if (new Set(versionIds).size !== versionIds.length) {
    throw new Error(
      `Publication ${publication.id} lists a duplicate ${label} version`,
    );
  }
  return versionIds.map((versionId) => {
    const snapshot = byVersion.get(versionId);
    if (snapshot === undefined) {
      throw new Error(
        `Publication ${publication.id} references a missing ${label} version ${versionId}`,
      );
    }
    if (
      snapshot.currentVersionId !== versionId ||
      snapshot.knowledgeModelId !== publication.knowledgeModelId
    ) {
      throw new Error(
        `Publication ${publication.id} ${label} version ${versionId} does not match its snapshot`,
      );
    }
    return snapshot;
  });
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareOrdinal);
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
