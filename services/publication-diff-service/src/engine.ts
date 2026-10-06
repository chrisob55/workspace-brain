import { createHash } from 'node:crypto';

import type { PublicationSnapshot } from '@workspace-brain/catalogue';
import type {
  KnowledgeEntity,
  KnowledgeRelationship,
  PublishedEntity,
  PublishedRelationship,
} from '@workspace-brain/domain';
import {
  ChangeType,
  entityContentFields,
  publicationDiffSchemaVersion,
  relationshipContentFields,
  type ChangeSummary,
  type EntityChange,
  type PublicationDiffContent,
  type RelationshipChange,
} from '@workspace-brain/domain-evolution';

export class PublicationDiffScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicationDiffScopeError';
  }
}

/**
 * Compares two immutable publication snapshots of the same Knowledge Model.
 *
 * Pure and deterministic: the result depends only on the two snapshots, all
 * collections are ordered by stable identity using ordinal comparison, and no
 * clock, random value or generated identifier is consulted.
 *
 * Classification per stable identity:
 * - ADDED: present only in `to`.
 * - REMOVED: present only in `from`.
 * - MODIFIED: present in both with a different immutable version and a
 *   different content hash.
 * - Unchanged (counted, not listed): same version, or a different version
 *   whose content hash is identical.
 */
export function comparePublicationSnapshots(
  from: PublicationSnapshot,
  to: PublicationSnapshot,
): PublicationDiffContent {
  if (from.publication.knowledgeModelId !== to.publication.knowledgeModelId) {
    throw new PublicationDiffScopeError(
      'Publications must belong to the same Knowledge Model to be compared',
    );
  }
  const entityResult = diffObjects(
    'entity',
    from.entities.map(publishedEntityVersion),
    to.entities.map(publishedEntityVersion),
    entityContentFields,
  );
  const relationshipResult = diffObjects(
    'relationship',
    from.relationships.map(publishedRelationshipVersion),
    to.relationships.map(publishedRelationshipVersion),
    relationshipContentFields,
  );
  const entityChanges = entityResult.changes.map(
    ({ changeType, from: before, to: after, changedFields }): EntityChange => {
      const descriptive = (after ?? before)!.snapshot;
      return {
        changeType,
        entityId: descriptive.id,
        entityType: descriptive.type,
        name: descriptive.name,
        from: before === undefined ? null : versionReference(before),
        to: after === undefined ? null : versionReference(after),
        changedFields,
      };
    },
  );
  const relationshipChanges = relationshipResult.changes.map(
    ({
      changeType,
      from: before,
      to: after,
      changedFields,
    }): RelationshipChange => {
      const descriptive = (after ?? before)!.snapshot;
      return {
        changeType,
        relationshipId: descriptive.id,
        relationshipType: descriptive.type,
        sourceEntityId: descriptive.sourceEntityId,
        targetEntityId: descriptive.targetEntityId,
        from: before === undefined ? null : versionReference(before),
        to: after === undefined ? null : versionReference(after),
        changedFields,
      };
    },
  );
  const summary: ChangeSummary = {
    entitiesAdded: countChanges(entityChanges, ChangeType.ADDED),
    entitiesRemoved: countChanges(entityChanges, ChangeType.REMOVED),
    entitiesModified: countChanges(entityChanges, ChangeType.MODIFIED),
    entitiesUnchanged: entityResult.unchanged,
    relationshipsAdded: countChanges(relationshipChanges, ChangeType.ADDED),
    relationshipsRemoved: countChanges(relationshipChanges, ChangeType.REMOVED),
    relationshipsModified: countChanges(
      relationshipChanges,
      ChangeType.MODIFIED,
    ),
    relationshipsUnchanged: relationshipResult.unchanged,
  };
  const body: Omit<PublicationDiffContent, 'contentHash'> = {
    schemaVersion: publicationDiffSchemaVersion,
    knowledgeModelId: from.publication.knowledgeModelId,
    fromPublicationId: from.publication.id,
    fromPublicationVersion: from.publication.version,
    fromPublicationContentHash: from.publication.contentHash,
    toPublicationId: to.publication.id,
    toPublicationVersion: to.publication.version,
    toPublicationContentHash: to.publication.contentHash,
    summary,
    entityChanges,
    relationshipChanges,
  };
  return { ...body, contentHash: createPublicationDiffContentHash(body) };
}

export { publicationDiffContent } from '@workspace-brain/domain-evolution';

export function createPublicationDiffContentHash(
  body: Omit<PublicationDiffContent, 'contentHash'>,
): string {
  return sha256(stableJson(body));
}

/** SHA-256 over the compared content fields of an entity snapshot. */
export function entityContentHash(entity: KnowledgeEntity): string {
  return sha256(
    stableJson(
      contentProjection(
        entity,
        ['id', 'knowledgeModelId'],
        entityContentFields,
      ),
    ),
  );
}

/** SHA-256 over the compared content fields of a relationship snapshot. */
export function relationshipContentHash(
  relationship: KnowledgeRelationship,
): string {
  return sha256(
    stableJson(
      contentProjection(
        relationship,
        ['id', 'knowledgeModelId'],
        relationshipContentFields,
      ),
    ),
  );
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort(compareOrdinal)
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

type VersionedObject<Snapshot> = {
  readonly id: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly snapshot: Snapshot;
  readonly contentHash: string;
};

type ObjectChange<Snapshot, Field extends string> = {
  readonly changeType: ChangeType;
  readonly from: VersionedObject<Snapshot> | undefined;
  readonly to: VersionedObject<Snapshot> | undefined;
  readonly changedFields: readonly Field[];
};

function diffObjects<
  Snapshot extends KnowledgeEntity | KnowledgeRelationship,
  Field extends string & keyof Snapshot,
>(
  label: 'entity' | 'relationship',
  fromObjects: readonly VersionedObject<Snapshot>[],
  toObjects: readonly VersionedObject<Snapshot>[],
  fields: readonly Field[],
): {
  readonly changes: readonly ObjectChange<Snapshot, Field>[];
  readonly unchanged: number;
} {
  const before = indexById(label, fromObjects);
  const after = indexById(label, toObjects);
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort(
    compareOrdinal,
  );
  const changes: ObjectChange<Snapshot, Field>[] = [];
  let unchanged = 0;
  for (const id of ids) {
    const previous = before.get(id);
    const next = after.get(id);
    if (previous === undefined && next !== undefined) {
      changes.push({
        changeType: ChangeType.ADDED,
        from: undefined,
        to: next,
        changedFields: [],
      });
    } else if (previous !== undefined && next === undefined) {
      changes.push({
        changeType: ChangeType.REMOVED,
        from: previous,
        to: undefined,
        changedFields: [],
      });
    } else if (previous !== undefined && next !== undefined) {
      if (
        previous.versionId === next.versionId ||
        previous.contentHash === next.contentHash
      ) {
        unchanged += 1;
        continue;
      }
      changes.push({
        changeType: ChangeType.MODIFIED,
        from: previous,
        to: next,
        changedFields: fields.filter(
          (field) =>
            stableJson(previous.snapshot[field]) !==
            stableJson(next.snapshot[field]),
        ),
      });
    }
  }
  return { changes, unchanged };
}

function indexById<Snapshot>(
  label: 'entity' | 'relationship',
  objects: readonly VersionedObject<Snapshot>[],
): Map<string, VersionedObject<Snapshot>> {
  const byId = new Map<string, VersionedObject<Snapshot>>();
  for (const object of objects) {
    if (byId.has(object.id)) {
      throw new Error(
        `Publication snapshot contains ${label} ${object.id} more than once`,
      );
    }
    byId.set(object.id, object);
  }
  return byId;
}

function publishedEntityVersion(
  published: PublishedEntity,
): VersionedObject<KnowledgeEntity> {
  return {
    id: published.entity.id,
    versionId: published.entityVersionId,
    versionNumber: published.versionNumber,
    snapshot: published.entity,
    contentHash: entityContentHash(published.entity),
  };
}

function publishedRelationshipVersion(
  published: PublishedRelationship,
): VersionedObject<KnowledgeRelationship> {
  return {
    id: published.relationship.id,
    versionId: published.relationshipVersionId,
    versionNumber: published.versionNumber,
    snapshot: published.relationship,
    contentHash: relationshipContentHash(published.relationship),
  };
}

function versionReference<VersionId extends string>(
  object: VersionedObject<KnowledgeEntity | KnowledgeRelationship>,
): {
  readonly versionId: VersionId;
  readonly versionNumber: number;
  readonly contentHash: string;
} {
  return {
    versionId: object.versionId as VersionId,
    versionNumber: object.versionNumber,
    contentHash: object.contentHash,
  };
}

function contentProjection<Snapshot extends object>(
  snapshot: Snapshot,
  identityFields: readonly (keyof Snapshot)[],
  fields: readonly (keyof Snapshot)[],
): Record<string, unknown> {
  const projection: Record<string, unknown> = {};
  for (const field of [...identityFields, ...fields]) {
    projection[field as string] = snapshot[field];
  }
  return projection;
}

function countChanges(
  changes: readonly { readonly changeType: ChangeType }[],
  changeType: ChangeType,
): number {
  return changes.filter((change) => change.changeType === changeType).length;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
