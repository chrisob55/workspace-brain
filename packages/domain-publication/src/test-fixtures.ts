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
  createSourceId,
  type KnowledgeEntity,
  type KnowledgeRelationship,
  type PublishedEntity,
  type PublishedRelationship,
} from '@workspace-brain/domain';
import type { KnowledgePublicationSnapshot } from './index.js';
import { createKnowledgePublicationContentHash } from './index.js';

const modelId = createKnowledgeModelId();
const publicationId = createKnowledgePublicationId();
const sourceId = createSourceId();
const evidenceId = createEvidenceId();
const entityVersionId = createEntityVersionId();
const relationshipVersionId = createRelationshipVersionId();

const provenance = {
  evidenceId,
  documentVersionId: createDocumentVersionId(),
  documentId: createDocumentId(),
  sourceId,
  documentPath: 'repo/README.md',
  contentFingerprint: 'a'.repeat(64),
  locator: { kind: 'markdown-lines' as const, lineStart: 1, lineEnd: 1 },
  processorId: 'markdown',
  processorVersion: 1,
  extractionRuleId: 'markdown-blocks',
  extractionRuleVersion: 1,
  knowledgeExtractorId: 'deterministic',
  knowledgeExtractorVersion: 1,
};

const entityOne: KnowledgeEntity = {
  id: createKnowledgeEntityId(),
  knowledgeModelId: modelId,
  type: 'package',
  name: 'first-package',
  sourceEvidenceIds: [evidenceId],
  provenance: [provenance],
  lifecycleStatus: 'observed',
  currentVersionId: entityVersionId,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};
const entityTwo: KnowledgeEntity = {
  ...entityOne,
  id: createKnowledgeEntityId(),
  name: 'second-package',
  currentVersionId: createEntityVersionId(),
};
const relationship: KnowledgeRelationship = {
  id: createKnowledgeRelationshipId(),
  knowledgeModelId: modelId,
  type: 'DEPENDS_ON',
  sourceEntityId: entityOne.id,
  targetEntityId: entityTwo.id,
  sourceEvidenceIds: [evidenceId],
  provenance: [provenance],
  confidence: 1,
  lifecycleStatus: 'related',
  currentVersionId: relationshipVersionId,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

const entities: readonly PublishedEntity[] = [
  {
    publicationId,
    entityVersionId,
    versionNumber: 1,
    entity: entityOne,
  },
  {
    publicationId,
    entityVersionId: entityTwo.currentVersionId,
    versionNumber: 2,
    entity: entityTwo,
  },
];
const relationships: readonly PublishedRelationship[] = [
  {
    publicationId,
    relationshipVersionId,
    versionNumber: 1,
    relationship,
  },
];

const contentHash = createKnowledgePublicationContentHash(
  entities.map(({ entity }) => entity),
  relationships.map(({ relationship: item }) => item),
  1,
);

export const snapshot: KnowledgePublicationSnapshot = {
  publication: {
    id: publicationId,
    knowledgeModelId: modelId,
    version: 1,
    schemaVersion: 1,
    status: 'published',
    contentHash,
    entityVersionIds: entities.map(
      ({ entityVersionId: versionId }) => versionId,
    ),
    relationshipVersionIds: [relationships[0]!.relationshipVersionId],
    publishedAt: '2026-10-01T12:00:00.000Z',
  },
  entities,
  relationships,
};
