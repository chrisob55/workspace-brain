import type {
  Brand,
  EntityVersionId,
  KnowledgeEntityId,
  KnowledgeEntityType,
  KnowledgeModelId,
  KnowledgePublicationId,
  KnowledgeRelationshipId,
  KnowledgeRelationshipType,
  RelationshipVersionId,
} from '@workspace-brain/domain';
import { ulid } from 'ulid';

/**
 * Knowledge Evolution vocabulary.
 *
 * A Publication Diff is a derived, disposable and rebuildable comparison of two
 * immutable Knowledge Publications of the same Knowledge Model. It records only
 * observable facts about stable identities, immutable version identities and
 * content hashes. It never interprets meaning and is never authoritative:
 * publications, entity versions and relationship versions remain the
 * authority.
 */

export const publicationDiffSchemaVersion = 1 as const;

export const ChangeType = {
  ADDED: 'ADDED',
  REMOVED: 'REMOVED',
  MODIFIED: 'MODIFIED',
} as const;
export type ChangeType = (typeof ChangeType)[keyof typeof ChangeType];
export const changeTypes = [
  ChangeType.ADDED,
  ChangeType.REMOVED,
  ChangeType.MODIFIED,
] as const;

/**
 * Snapshot fields compared for an entity. Version bookkeeping
 * (`currentVersionId`, `createdAt`, `updatedAt`) is excluded because it
 * changes with every version even when the represented knowledge does not.
 */
export const entityContentFields = [
  'type',
  'name',
  'lifecycleStatus',
  'sourceEvidenceIds',
  'provenance',
] as const;
export type EntityContentField = (typeof entityContentFields)[number];

export const relationshipContentFields = [
  'type',
  'sourceEntityId',
  'targetEntityId',
  'confidence',
  'lifecycleStatus',
  'sourceEvidenceIds',
  'provenance',
] as const;
export type RelationshipContentField =
  (typeof relationshipContentFields)[number];

export type PublicationDiffId = Brand<string, 'PublicationDiffId'>;

const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export const createPublicationDiffId = (): PublicationDiffId =>
  ulid() as PublicationDiffId;

export function parsePublicationDiffId(value: string): PublicationDiffId {
  if (!ulidPattern.test(value)) {
    throw new Error('Catalogue contains an invalid ULID');
  }
  return value as PublicationDiffId;
}

/** Identifies the immutable version of a knowledge object on one side of a diff. */
export type KnowledgeVersionReference<VersionId extends string> = {
  readonly versionId: VersionId;
  readonly versionNumber: number;
  readonly contentHash: string;
};

export type EntityVersionReference = KnowledgeVersionReference<EntityVersionId>;
export type RelationshipVersionReference =
  KnowledgeVersionReference<RelationshipVersionId>;

/**
 * One observed entity change. Descriptive fields (`entityType`, `name`) come
 * from the `to` side when present, otherwise from the `from` side.
 * `changedFields` is empty for ADDED and REMOVED.
 */
export type EntityChange = {
  readonly changeType: ChangeType;
  readonly entityId: KnowledgeEntityId;
  readonly entityType: KnowledgeEntityType;
  readonly name: string;
  readonly from: EntityVersionReference | null;
  readonly to: EntityVersionReference | null;
  readonly changedFields: readonly EntityContentField[];
};

/**
 * One observed relationship change. Descriptive fields come from the `to`
 * side when present, otherwise from the `from` side. `changedFields` is empty
 * for ADDED and REMOVED.
 */
export type RelationshipChange = {
  readonly changeType: ChangeType;
  readonly relationshipId: KnowledgeRelationshipId;
  readonly relationshipType: KnowledgeRelationshipType;
  readonly sourceEntityId: KnowledgeEntityId;
  readonly targetEntityId: KnowledgeEntityId;
  readonly from: RelationshipVersionReference | null;
  readonly to: RelationshipVersionReference | null;
  readonly changedFields: readonly RelationshipContentField[];
};

export type ChangeSummary = {
  readonly entitiesAdded: number;
  readonly entitiesRemoved: number;
  readonly entitiesModified: number;
  readonly entitiesUnchanged: number;
  readonly relationshipsAdded: number;
  readonly relationshipsRemoved: number;
  readonly relationshipsModified: number;
  readonly relationshipsUnchanged: number;
};

/** Header of a generated comparison, without its detailed change sets. */
export type PublicationComparison = {
  readonly id: PublicationDiffId;
  readonly schemaVersion: typeof publicationDiffSchemaVersion;
  readonly knowledgeModelId: KnowledgeModelId;
  readonly fromPublicationId: KnowledgePublicationId;
  readonly fromPublicationVersion: number;
  readonly fromPublicationContentHash: string;
  readonly toPublicationId: KnowledgePublicationId;
  readonly toPublicationVersion: number;
  readonly toPublicationContentHash: string;
  /**
   * SHA-256 of the stable JSON of every field except `id`, `generatedAt` and
   * `contentHash` itself.
   */
  readonly contentHash: string;
  readonly generatedAt: string;
  readonly summary: ChangeSummary;
};

export type PublicationDiff = PublicationComparison & {
  readonly entityChanges: readonly EntityChange[];
  readonly relationshipChanges: readonly RelationshipChange[];
};

/** The deterministic portion of a diff: identical for identical inputs. */
export type PublicationDiffContent = Omit<
  PublicationDiff,
  'id' | 'generatedAt'
>;

/** Projects a diff onto its comparison header, dropping the change sets. */
export function publicationComparisonHeader(
  diff: PublicationComparison,
): PublicationComparison {
  return {
    id: diff.id,
    schemaVersion: diff.schemaVersion,
    knowledgeModelId: diff.knowledgeModelId,
    fromPublicationId: diff.fromPublicationId,
    fromPublicationVersion: diff.fromPublicationVersion,
    fromPublicationContentHash: diff.fromPublicationContentHash,
    toPublicationId: diff.toPublicationId,
    toPublicationVersion: diff.toPublicationVersion,
    toPublicationContentHash: diff.toPublicationContentHash,
    contentHash: diff.contentHash,
    generatedAt: diff.generatedAt,
    summary: diff.summary,
  };
}

/** Strips the non-deterministic handle fields (`id`, `generatedAt`). */
export function publicationDiffContent(
  diff: PublicationDiff,
): PublicationDiffContent {
  return {
    schemaVersion: diff.schemaVersion,
    knowledgeModelId: diff.knowledgeModelId,
    fromPublicationId: diff.fromPublicationId,
    fromPublicationVersion: diff.fromPublicationVersion,
    fromPublicationContentHash: diff.fromPublicationContentHash,
    toPublicationId: diff.toPublicationId,
    toPublicationVersion: diff.toPublicationVersion,
    toPublicationContentHash: diff.toPublicationContentHash,
    contentHash: diff.contentHash,
    summary: diff.summary,
    entityChanges: diff.entityChanges,
    relationshipChanges: diff.relationshipChanges,
  };
}
