import { createHash, randomUUID } from 'node:crypto';

import type { KnowledgePageRequest } from '@workspace-brain/catalogue';
import type { DuckDbConnection } from './index.js';
import {
  createEntityVersionId,
  createKnowledgeEntityKey,
  createKnowledgeEntityId,
  createKnowledgeModelId,
  createKnowledgePublicationId,
  createKnowledgeRelationshipId,
  createRelationshipVersionId,
  knowledgeRelationshipTypes,
  parseDocumentId,
  parseDocumentVersionId,
  parseEntityVersionId,
  parseEvidenceId,
  parseKnowledgeEntityId,
  parseKnowledgeModelId,
  parseKnowledgePublicationId,
  parseKnowledgeRelationshipId,
  parseRelationshipVersionId,
  parseSourceId,
  parseWorkspaceId,
  type DiscoveryEvent,
  type Evidence,
  type EvidenceLocator,
  type KnowledgeCandidateEvent,
  type KnowledgeEntity,
  type KnowledgeEntityCandidate,
  type KnowledgeInputEvidence,
  type KnowledgeModel,
  type KnowledgeProvenance,
  type KnowledgePublication,
  type KnowledgeRelationship,
  type KnowledgeRelationshipCandidate,
  type KnowledgeDocumentRemovalEvent,
} from '@workspace-brain/domain';
import { z } from 'zod';

const entityTypes = ['package', 'container', 'api', 'module'] as const;
const entityStatuses = [
  'observed',
  'verified',
  'established',
  'rejected',
  'superseded',
] as const;
const relationshipStatuses = [
  'observed',
  'related',
  'verified',
  'established',
  'rejected',
  'superseded',
] as const;
const idSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const locatorSchema = z.union([
  z
    .object({
      kind: z.enum(['markdown-lines', 'text-lines', 'yaml-lines']),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
      headingPath: z.array(z.string()).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('json-pointer'), pointer: z.string() }).strict(),
]);
const provenanceSchema = z
  .object({
    evidenceId: idSchema,
    documentVersionId: idSchema,
    documentId: idSchema,
    sourceId: idSchema,
    documentPath: z.string().min(1).max(4096),
    contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    locator: locatorSchema,
    processorId: z.string().min(1),
    processorVersion: z.number().int().positive(),
    extractionRuleId: z.string().min(1),
    extractionRuleVersion: z.number().int().positive(),
    knowledgeExtractorId: z.literal('deterministic-knowledge-extractors'),
    knowledgeExtractorVersion: z.literal(1),
  })
  .strict();
const entityCandidateSchema = z
  .object({
    key: z.string().min(1).max(2048),
    type: z.enum(entityTypes),
    identityScope: z.string().min(1).max(4096),
    name: z.string().trim().min(1).max(1024),
    sourceEvidenceIds: z.array(idSchema).min(1).max(500),
    provenance: z.array(provenanceSchema).min(1).max(500),
    lifecycleStatus: z.literal('observed'),
  })
  .strict();
const relationshipCandidateSchema = z
  .object({
    key: z.string().min(1).max(4096),
    type: z.enum(knowledgeRelationshipTypes),
    sourceEntityKey: z.string().min(1).max(2048),
    targetEntityKey: z.string().min(1).max(2048),
    sourceEvidenceIds: z.array(idSchema).min(1).max(500),
    provenance: z.array(provenanceSchema).min(1).max(500),
    confidence: z.number().min(0).max(1),
    lifecycleStatus: z.literal('related'),
  })
  .strict();
const candidatePayloadSchema = z
  .object({
    sourceId: idSchema,
    documentId: idSchema,
    documentVersionId: idSchema,
    entities: z.array(entityCandidateSchema).max(10_000),
    relationships: z.array(relationshipCandidateSchema).max(10_000),
  })
  .strict();
const entitySnapshotSchema = z
  .object({
    id: idSchema,
    knowledgeModelId: idSchema,
    type: z.enum(entityTypes),
    name: z.string(),
    sourceEvidenceIds: z.array(idSchema),
    provenance: z.array(provenanceSchema),
    lifecycleStatus: z.enum(entityStatuses),
    currentVersionId: idSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
const relationshipSnapshotSchema = z
  .object({
    id: idSchema,
    knowledgeModelId: idSchema,
    type: z.enum(knowledgeRelationshipTypes),
    sourceEntityId: idSchema,
    targetEntityId: idSchema,
    sourceEvidenceIds: z.array(idSchema),
    provenance: z.array(provenanceSchema),
    confidence: z.number().min(0).max(1),
    lifecycleStatus: z.enum(relationshipStatuses),
    currentVersionId: idSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
const knowledgeModelRowSchema = z.object({
  id: idSchema,
  workspace_id: idSchema,
  name: z.string(),
  schema_version: z.coerce.number().int(),
  latest_publication_version: z.coerce.number().int().nullable(),
  created_at: z.string(),
});
const knowledgeEntityRowSchema = z.object({
  id: idSchema,
  knowledge_model_id: idSchema,
  entity_key: z.string(),
  entity_type: z.enum(entityTypes),
  name: z.string(),
  source_evidence_json: z.string(),
  provenance_json: z.string(),
  lifecycle_status: z.enum(entityStatuses),
  current_version_id: idSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
const knowledgeRelationshipRowSchema = z.object({
  id: idSchema,
  knowledge_model_id: idSchema,
  relationship_key: z.string(),
  relationship_type: z.enum(knowledgeRelationshipTypes),
  source_entity_id: idSchema,
  target_entity_id: idSchema,
  source_evidence_json: z.string(),
  provenance_json: z.string(),
  confidence: z.coerce.number(),
  lifecycle_status: z.enum(relationshipStatuses),
  current_version_id: idSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
const knowledgePublicationRowSchema = z.object({
  id: idSchema,
  knowledge_model_id: idSchema,
  version_number: z.coerce.number().int(),
  schema_version: z.coerce.number().int(),
  status: z.literal('published'),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  entity_version_ids_json: z.string(),
  relationship_version_ids_json: z.string(),
  published_at: z.string(),
});
const priorCandidateRunSchema = z.object({
  payload_hash: z.string(),
});

export async function ensureKnowledgeModels(
  connection: DuckDbConnection,
): Promise<void> {
  const rows = await connection.runAndReadAll(
    'SELECT w.id, w.name FROM workspaces w LEFT JOIN knowledge_models m ON m.workspace_id = w.id WHERE m.id IS NULL ORDER BY w.id',
  );
  for (const row of rows.getRowObjectsJson()) {
    const workspaceId = idSchema.parse(row.id);
    const name = z.string().parse(row.name);
    await connection.run(
      'INSERT INTO knowledge_models (id, workspace_id, name, schema_version, latest_publication_version, created_at) VALUES ($1, $2, $3, 1, NULL, CURRENT_TIMESTAMP) ON CONFLICT (workspace_id) DO NOTHING',
      [createKnowledgeModelId(), workspaceId, `${name} Knowledge Model`],
    );
  }
}

export async function listKnowledgeInputEvidence(
  connection: DuckDbConnection,
  documentVersionId: string,
): Promise<readonly KnowledgeInputEvidence[]> {
  const parsedVersionId = parseDocumentVersionId(documentVersionId);
  const rows = await connection.runAndReadAll(
    "SELECT e.id, e.document_version_id, e.evidence_key, e.evidence_kind, e.excerpt, e.truncated, CAST(e.locator_json AS VARCHAR) AS locator_json, v.id AS version_id, v.document_id, v.content_fingerprint, strftime(v.processed_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS processed_at, v.processor_id, v.processor_version, v.extraction_rule_id, v.extraction_rule_version, v.evidence_count, v.source_id, v.path, v.filename FROM extracted_evidence e JOIN document_versions v ON v.id = e.document_version_id WHERE v.id = $1 ORDER BY e.evidence_key",
    [parsedVersionId],
  );
  return rows.getRowObjectsJson().map(parseKnowledgeInputEvidence);
}

export async function listKnowledgeModels(
  connection: DuckDbConnection,
  request: KnowledgePageRequest,
): Promise<{ readonly items: readonly KnowledgeModel[] }> {
  const parameters: (string | number)[] = [];
  const filters: string[] = [];
  if (request.afterId !== undefined) {
    parameters.push(parseKnowledgeModelId(request.afterId));
    filters.push(`id > $${parameters.length}`);
  }
  parameters.push(validateLimit(request.limit));
  const rows = await connection.runAndReadAll(
    `SELECT id, workspace_id, name, schema_version, latest_publication_version, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM knowledge_models ${whereClause(filters)} ORDER BY id LIMIT $${parameters.length}`,
    parameters,
  );
  return { items: rows.getRowObjectsJson().map(parseKnowledgeModelRow) };
}

export async function getKnowledgeModel(
  connection: DuckDbConnection,
  modelId: string,
): Promise<KnowledgeModel | undefined> {
  const rows = await connection.runAndReadAll(
    "SELECT id, workspace_id, name, schema_version, latest_publication_version, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM knowledge_models WHERE id = $1",
    [parseKnowledgeModelId(modelId)],
  );
  const row = rows.getRowObjectsJson()[0];
  return row === undefined ? undefined : parseKnowledgeModelRow(row);
}

export async function listKnowledgeEntities(
  connection: DuckDbConnection,
  request: KnowledgePageRequest,
): Promise<{ readonly items: readonly KnowledgeEntity[] }> {
  const parameters: (string | number)[] = [];
  const filters: string[] = [];
  let from = 'knowledge_entities e';
  let select =
    "e.id, e.knowledge_model_id, e.entity_key, e.entity_type, e.name, CAST(e.source_evidence_json AS VARCHAR) AS source_evidence_json, CAST(e.provenance_json AS VARCHAR) AS provenance_json, e.lifecycle_status, e.current_version_id, strftime(e.created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at, strftime(e.updated_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS updated_at";
  if (request.publicationId !== undefined) {
    from =
      "entity_versions v JOIN knowledge_publications p ON list_contains(CAST(json_extract(p.entity_version_ids_json, '$') AS VARCHAR[]), v.id) JOIN knowledge_entities e ON e.id = v.entity_id";
    select = 'CAST(v.snapshot_json AS VARCHAR) AS snapshot_json, e.id';
    parameters.push(parseKnowledgePublicationId(request.publicationId));
    filters.push(`p.id = $${parameters.length}`);
    if (request.knowledgeModelId !== undefined) {
      parameters.push(parseKnowledgeModelId(request.knowledgeModelId));
      filters.push(`p.knowledge_model_id = $${parameters.length}`);
    }
  } else if (request.knowledgeModelId !== undefined) {
    parameters.push(parseKnowledgeModelId(request.knowledgeModelId));
    filters.push(`e.knowledge_model_id = $${parameters.length}`);
  }
  if (request.lifecycleStatus !== undefined) {
    const status = entityStatuses.find(
      (value) => value === request.lifecycleStatus,
    );
    if (status === undefined) {
      throw new Error('Unknown entity lifecycle status');
    }
    if (request.publicationId === undefined) {
      parameters.push(status);
      filters.push(`e.lifecycle_status = $${parameters.length}`);
    } else {
      parameters.push(status);
      filters.push(
        `json_extract_string(v.snapshot_json, '$.lifecycleStatus') = $${parameters.length}`,
      );
    }
  }
  if (request.type !== undefined) {
    const type = entityTypes.find((value) => value === request.type);
    if (type === undefined) {
      throw new Error('Unknown knowledge entity type');
    }
    if (request.publicationId === undefined) {
      parameters.push(type);
      filters.push(`e.entity_type = $${parameters.length}`);
    } else {
      parameters.push(type);
      filters.push(
        `json_extract_string(v.snapshot_json, '$.type') = $${parameters.length}`,
      );
    }
  }
  if (request.afterId !== undefined) {
    parameters.push(parseKnowledgeEntityId(request.afterId));
    filters.push(`e.id > $${parameters.length}`);
  }
  parameters.push(validateLimit(request.limit));
  const rows = await connection.runAndReadAll(
    `SELECT ${select} FROM ${from} ${whereClause(filters)} ORDER BY e.id LIMIT $${parameters.length}`,
    parameters,
  );
  return {
    items: rows
      .getRowObjectsJson()
      .map((row) =>
        request.publicationId === undefined
          ? parseKnowledgeEntityRow(row)
          : parseEntitySnapshotJson(row.snapshot_json),
      ),
  };
}

export async function getKnowledgeEntity(
  connection: DuckDbConnection,
  entityId: string,
): Promise<KnowledgeEntity | undefined> {
  const rows = await connection.runAndReadAll(
    "SELECT id, knowledge_model_id, entity_key, entity_type, name, CAST(source_evidence_json AS VARCHAR) AS source_evidence_json, CAST(provenance_json AS VARCHAR) AS provenance_json, lifecycle_status, current_version_id, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at, strftime(updated_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS updated_at FROM knowledge_entities WHERE id = $1",
    [parseKnowledgeEntityId(entityId)],
  );
  const row = rows.getRowObjectsJson()[0];
  return row === undefined ? undefined : parseKnowledgeEntityRow(row);
}

export async function listKnowledgeRelationships(
  connection: DuckDbConnection,
  request: KnowledgePageRequest,
): Promise<{ readonly items: readonly KnowledgeRelationship[] }> {
  const parameters: (string | number)[] = [];
  const filters: string[] = [];
  let from = 'knowledge_relationships r';
  let select =
    "r.id, r.knowledge_model_id, r.relationship_key, r.relationship_type, r.source_entity_id, r.target_entity_id, CAST(r.source_evidence_json AS VARCHAR) AS source_evidence_json, CAST(r.provenance_json AS VARCHAR) AS provenance_json, r.confidence, r.lifecycle_status, r.current_version_id, strftime(r.created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at, strftime(r.updated_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS updated_at";
  if (request.publicationId !== undefined) {
    from =
      "relationship_versions v JOIN knowledge_publications p ON list_contains(CAST(json_extract(p.relationship_version_ids_json, '$') AS VARCHAR[]), v.id) JOIN knowledge_relationships r ON r.id = v.relationship_id";
    select = 'CAST(v.snapshot_json AS VARCHAR) AS snapshot_json, r.id';
    parameters.push(parseKnowledgePublicationId(request.publicationId));
    filters.push(`p.id = $${parameters.length}`);
    if (request.knowledgeModelId !== undefined) {
      parameters.push(parseKnowledgeModelId(request.knowledgeModelId));
      filters.push(`p.knowledge_model_id = $${parameters.length}`);
    }
  } else if (request.knowledgeModelId !== undefined) {
    parameters.push(parseKnowledgeModelId(request.knowledgeModelId));
    filters.push(`r.knowledge_model_id = $${parameters.length}`);
  }
  if (request.lifecycleStatus !== undefined) {
    const status = relationshipStatuses.find(
      (value) => value === request.lifecycleStatus,
    );
    if (status === undefined) {
      throw new Error('Unknown relationship lifecycle status');
    }
    if (request.publicationId === undefined) {
      parameters.push(status);
      filters.push(`r.lifecycle_status = $${parameters.length}`);
    } else {
      parameters.push(status);
      filters.push(
        `json_extract_string(v.snapshot_json, '$.lifecycleStatus') = $${parameters.length}`,
      );
    }
  }
  if (request.type !== undefined) {
    const type = knowledgeRelationshipTypes.find(
      (value) => value === request.type,
    );
    if (type === undefined) {
      throw new Error('Unknown knowledge relationship type');
    }
    if (request.publicationId === undefined) {
      parameters.push(type);
      filters.push(`r.relationship_type = $${parameters.length}`);
    } else {
      parameters.push(type);
      filters.push(
        `json_extract_string(v.snapshot_json, '$.type') = $${parameters.length}`,
      );
    }
  }
  if (request.afterId !== undefined) {
    parameters.push(parseKnowledgeRelationshipId(request.afterId));
    filters.push(`r.id > $${parameters.length}`);
  }
  parameters.push(validateLimit(request.limit));
  const rows = await connection.runAndReadAll(
    `SELECT ${select} FROM ${from} ${whereClause(filters)} ORDER BY r.id LIMIT $${parameters.length}`,
    parameters,
  );
  return {
    items: rows
      .getRowObjectsJson()
      .map((row) =>
        request.publicationId === undefined
          ? parseKnowledgeRelationshipRow(row)
          : parseRelationshipSnapshotJson(row.snapshot_json),
      ),
  };
}

export async function getKnowledgeRelationship(
  connection: DuckDbConnection,
  relationshipId: string,
): Promise<KnowledgeRelationship | undefined> {
  const rows = await connection.runAndReadAll(
    "SELECT id, knowledge_model_id, relationship_key, relationship_type, source_entity_id, target_entity_id, CAST(source_evidence_json AS VARCHAR) AS source_evidence_json, CAST(provenance_json AS VARCHAR) AS provenance_json, confidence, lifecycle_status, current_version_id, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at, strftime(updated_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS updated_at FROM knowledge_relationships WHERE id = $1",
    [parseKnowledgeRelationshipId(relationshipId)],
  );
  const row = rows.getRowObjectsJson()[0];
  return row === undefined ? undefined : parseKnowledgeRelationshipRow(row);
}

export async function listKnowledgePublications(
  connection: DuckDbConnection,
  request: KnowledgePageRequest,
): Promise<{ readonly items: readonly KnowledgePublication[] }> {
  const parameters: (string | number)[] = [];
  const filters: string[] = [];
  if (request.knowledgeModelId !== undefined) {
    parameters.push(parseKnowledgeModelId(request.knowledgeModelId));
    filters.push(`knowledge_model_id = $${parameters.length}`);
  }
  if (request.afterId !== undefined) {
    parameters.push(parseKnowledgePublicationId(request.afterId));
    filters.push(`id > $${parameters.length}`);
  }
  parameters.push(validateLimit(request.limit));
  const rows = await connection.runAndReadAll(
    `SELECT id, knowledge_model_id, version_number, schema_version, status, content_hash, CAST(entity_version_ids_json AS VARCHAR) AS entity_version_ids_json, CAST(relationship_version_ids_json AS VARCHAR) AS relationship_version_ids_json, strftime(published_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS published_at FROM knowledge_publications ${whereClause(filters)} ORDER BY id LIMIT $${parameters.length}`,
    parameters,
  );
  return { items: rows.getRowObjectsJson().map(parseKnowledgePublicationRow) };
}

export function createKnowledgePublicationContentHash(
  entities: readonly KnowledgeEntity[],
  relationships: readonly KnowledgeRelationship[],
): string {
  return createHash('sha256')
    .update(
      stableJson({
        schemaVersion: 1,
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

export async function applyKnowledgeCandidates(
  connection: DuckDbConnection,
  event: KnowledgeCandidateEvent,
): Promise<void> {
  if (
    event.eventType !== 'KnowledgeCandidatesSubmitted' ||
    event.eventVersion !== 1 ||
    event.producer !== 'workspace-brain-knowledge-worker' ||
    event.eventId.length === 0 ||
    event.eventId.length > 128 ||
    event.correlationId.length === 0 ||
    event.idempotencyKey.length === 0
  ) {
    throw new Error('Invalid knowledge candidate submission');
  }
  const parsedPayload = candidatePayloadSchema.safeParse(event.payload);
  if (
    !parsedPayload.success ||
    event.partitionKey !== parsedPayload.data.sourceId
  ) {
    throw new Error('Invalid knowledge candidate submission');
  }
  const rawPayload = parsedPayload.data;
  const payload: KnowledgeCandidateEvent['payload'] = {
    sourceId: parseSourceId(rawPayload.sourceId),
    documentId: parseDocumentId(rawPayload.documentId),
    documentVersionId: parseDocumentVersionId(rawPayload.documentVersionId),
    entities: rawPayload.entities.map(
      (candidate): KnowledgeEntityCandidate => ({
        ...candidate,
        sourceEvidenceIds: candidate.sourceEvidenceIds.map(parseEvidenceId),
        provenance: parseProvenance(candidate.provenance),
      }),
    ),
    relationships: rawPayload.relationships.map(
      (candidate): KnowledgeRelationshipCandidate => ({
        ...candidate,
        sourceEvidenceIds: candidate.sourceEvidenceIds.map(parseEvidenceId),
        provenance: parseProvenance(candidate.provenance),
      }),
    ),
  };
  const canonicalPayload = canonicalizeCandidatePayload(payload);
  const sourceId = payload.sourceId;
  for (const candidate of canonicalPayload.entities) {
    if (
      candidate.key !==
        createKnowledgeEntityKey(
          candidate.type,
          sourceId,
          candidate.identityScope,
          candidate.name,
        ) ||
      !hasValidIdentityScope(candidate) ||
      !hasUniqueEvidence(candidate.sourceEvidenceIds, candidate.provenance)
    ) {
      throw new Error('Invalid knowledge entity candidate');
    }
  }
  for (const candidate of canonicalPayload.relationships) {
    if (
      candidate.key !==
        `${candidate.type}:${candidate.sourceEntityKey}->${candidate.targetEntityKey}` ||
      candidate.sourceEntityKey === candidate.targetEntityKey ||
      !hasUniqueEvidence(candidate.sourceEvidenceIds, candidate.provenance)
    ) {
      throw new Error('Invalid knowledge relationship candidate');
    }
  }

  const payloadHash = createHash('sha256')
    .update(stableJson(canonicalPayload))
    .digest('hex');
  await connection.run('BEGIN TRANSACTION');
  try {
    const priorRows = await connection.runAndReadAll(
      'SELECT payload_hash FROM knowledge_candidate_runs WHERE event_id = $1',
      [event.eventId],
    );
    const prior = priorRows.getRowObjectsJson()[0];
    if (prior !== undefined) {
      const parsedPrior = priorCandidateRunSchema.parse(prior);
      if (parsedPrior.payload_hash !== payloadHash) {
        throw new Error(
          `Knowledge candidate event ${event.eventId} was reused with a different payload`,
        );
      }
      await connection.run('COMMIT');
      return;
    }

    await validateCandidateProvenance(
      connection,
      sourceId,
      canonicalPayload.documentId,
      canonicalPayload.documentVersionId,
      [
        ...canonicalPayload.entities.flatMap(({ provenance }) => provenance),
        ...canonicalPayload.relationships.flatMap(
          ({ provenance }) => provenance,
        ),
      ],
      [
        ...canonicalPayload.entities.flatMap(
          ({ sourceEvidenceIds }) => sourceEvidenceIds,
        ),
        ...canonicalPayload.relationships.flatMap(
          ({ sourceEvidenceIds }) => sourceEvidenceIds,
        ),
      ],
    );
    const isCurrent = await isCurrentDocumentVersion(
      connection,
      canonicalPayload.documentId,
      canonicalPayload.documentVersionId,
      sourceId,
    );
    const modelRows = await connection.runAndReadAll(
      "SELECT m.id, m.workspace_id, m.name, m.schema_version, m.latest_publication_version, strftime(m.created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at, CAST(w.config_json AS VARCHAR) AS workspace_config FROM knowledge_models m JOIN workspaces w ON w.id = m.workspace_id ORDER BY m.id",
    );
    const models = modelRows
      .getRowObjectsJson()
      .filter((row) => {
        const configuration = z
          .object({ sourceIds: z.array(idSchema) })
          .passthrough()
          .parse(JSON.parse(z.string().parse(row.workspace_config)) as unknown);
        return configuration.sourceIds.includes(sourceId);
      })
      .map(parseKnowledgeModelRow);
    if (models.length === 0) {
      throw new Error(
        `No Knowledge Model is configured for source ${sourceId}`,
      );
    }

    for (const model of models) {
      await storeDocumentContribution(
        connection,
        model.id,
        canonicalPayload,
        payloadHash,
        event.occurredAt,
      );
      if (isCurrent) {
        const activeVersion = await getActiveContributionVersion(
          connection,
          model.id,
          canonicalPayload.documentId,
        );
        if (activeVersion !== canonicalPayload.documentVersionId) {
          await setActiveContribution(
            connection,
            model.id,
            canonicalPayload.documentId,
            canonicalPayload.documentVersionId,
            event.occurredAt,
          );
          await reconcileKnowledgeModel(
            connection,
            model,
            sourceId,
            event.correlationId,
            event.occurredAt,
          );
        }
      }
    }
    await connection.run(
      'INSERT INTO knowledge_candidate_runs (event_id, payload_hash, source_id, correlation_id, completed_at) VALUES ($1, $2, $3, $4, $5)',
      [
        event.eventId,
        payloadHash,
        sourceId,
        event.correlationId,
        event.occurredAt,
      ],
    );
    await connection.run('COMMIT');
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
}

export async function withdrawKnowledgeDocument(
  connection: DuckDbConnection,
  event: KnowledgeDocumentRemovalEvent,
): Promise<void> {
  const { inventoryRecord } = event.payload;
  if (
    event.eventType !== 'DocumentRemoved' ||
    event.eventVersion !== 1 ||
    event.producer !== 'workspace-brain-api' ||
    event.partitionKey !== inventoryRecord.sourceId
  ) {
    throw new Error('Invalid knowledge document removal event');
  }
  const sourceId = parseSourceId(inventoryRecord.sourceId);
  const documentId = parseDocumentId(inventoryRecord.id);
  const models = await activeContributionModels(
    connection,
    sourceId,
    documentId,
  );
  for (const model of models) {
    const activeVersion = await getActiveContributionVersion(
      connection,
      model.id,
      documentId,
    );
    if (activeVersion === undefined) {
      continue;
    }
    await connection.run(
      'DELETE FROM knowledge_active_document_contributions WHERE knowledge_model_id = $1 AND document_id = $2',
      [model.id, documentId],
    );
    await reconcileKnowledgeModel(
      connection,
      model,
      sourceId,
      event.correlationId,
      event.occurredAt,
    );
  }
}

type ExistingEntity = {
  readonly entityKey: string;
  readonly entity: KnowledgeEntity;
};

type ExistingRelationship = {
  readonly relationshipKey: string;
  readonly relationship: KnowledgeRelationship;
};

type ActiveContribution = {
  readonly documentId: string;
  readonly payload: KnowledgeCandidateEvent['payload'];
};

async function isCurrentDocumentVersion(
  connection: DuckDbConnection,
  documentId: string,
  documentVersionId: string,
  sourceId: string,
): Promise<boolean> {
  const rows = await connection.runAndReadAll(
    "SELECT v.document_id, v.source_id, v.content_fingerprint, i.fingerprint AS current_fingerprint, i.is_present, current_version.document_version_id AS current_document_version_id FROM document_versions v LEFT JOIN inventory_records i ON i.source_id = v.source_id AND i.path = v.path AND i.asset_type = 'document' LEFT JOIN document_current_versions current_version ON current_version.document_id = v.document_id WHERE v.id = $1",
    [documentVersionId],
  );
  const row = rows.getRowObjectsJson()[0];
  if (row === undefined) {
    throw new Error(
      `Knowledge document version ${documentVersionId} was not found`,
    );
  }
  const parsed = z
    .object({
      document_id: idSchema,
      source_id: idSchema,
      content_fingerprint: z.string(),
      current_fingerprint: z.string().nullable(),
      is_present: z.boolean().nullable(),
      current_document_version_id: idSchema.nullable(),
    })
    .parse(row);
  if (parsed.document_id !== documentId || parsed.source_id !== sourceId) {
    throw new Error('Knowledge document version does not match its submission');
  }
  return (
    parsed.is_present === true &&
    parsed.current_fingerprint === parsed.content_fingerprint &&
    parsed.current_document_version_id === documentVersionId
  );
}

function canonicalizeCandidatePayload(
  payload: KnowledgeCandidateEvent['payload'],
): KnowledgeCandidateEvent['payload'] {
  const entities = payload.entities
    .map((candidate) => ({
      ...candidate,
      sourceEvidenceIds: sortedUnique(candidate.sourceEvidenceIds),
      provenance: mergeProvenance([], candidate.provenance),
    }))
    .sort((left, right) => compareOrdinal(left.key, right.key));
  const relationships = payload.relationships
    .map((candidate) => ({
      ...candidate,
      sourceEvidenceIds: sortedUnique(candidate.sourceEvidenceIds),
      provenance: mergeProvenance([], candidate.provenance),
    }))
    .sort((left, right) => compareOrdinal(left.key, right.key));
  return {
    sourceId: payload.sourceId,
    documentId: payload.documentId,
    documentVersionId: payload.documentVersionId,
    entities,
    relationships,
  };
}

function hasValidIdentityScope(candidate: KnowledgeEntityCandidate): boolean {
  const sourceRootId =
    candidate.provenance[0]?.documentPath.split('/')[0] ?? '';
  if (
    candidate.type === 'module' &&
    candidate.identityScope.startsWith('external:')
  ) {
    return candidate.identityScope.length > 'external:'.length;
  }
  const segments = candidate.identityScope.split('/');
  return (
    segments[0] === sourceRootId &&
    sourceRootId.length > 0 &&
    segments.every(
      (segment) => segment.length > 0 && segment !== '.' && segment !== '..',
    ) &&
    !candidate.identityScope.includes('\\')
  );
}

async function storeDocumentContribution(
  connection: DuckDbConnection,
  modelId: string,
  payload: KnowledgeCandidateEvent['payload'],
  payloadHash: string,
  occurredAt: string,
): Promise<void> {
  const rows = await connection.runAndReadAll(
    'SELECT payload_hash FROM knowledge_document_contributions WHERE knowledge_model_id = $1 AND document_id = $2 AND document_version_id = $3',
    [modelId, payload.documentId, payload.documentVersionId],
  );
  const existing = rows.getRowObjectsJson()[0];
  if (existing !== undefined) {
    const parsed = z.object({ payload_hash: z.string() }).parse(existing);
    if (parsed.payload_hash !== payloadHash) {
      throw new Error(
        `Knowledge contribution for document version ${payload.documentVersionId} changed after acceptance`,
      );
    }
    return;
  }
  await connection.run(
    'INSERT INTO knowledge_document_contributions (knowledge_model_id, document_id, document_version_id, source_id, payload_hash, candidate_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [
      modelId,
      payload.documentId,
      payload.documentVersionId,
      payload.sourceId,
      payloadHash,
      stableJson(payload),
      occurredAt,
    ],
  );
}

async function getActiveContributionVersion(
  connection: DuckDbConnection,
  modelId: string,
  documentId: string,
): Promise<string | undefined> {
  const rows = await connection.runAndReadAll(
    'SELECT document_version_id FROM knowledge_active_document_contributions WHERE knowledge_model_id = $1 AND document_id = $2',
    [modelId, documentId],
  );
  const versionId = rows.getRowObjectsJson()[0]?.document_version_id;
  return versionId === undefined
    ? undefined
    : parseDocumentVersionId(z.string().parse(versionId));
}

async function setActiveContribution(
  connection: DuckDbConnection,
  modelId: string,
  documentId: string,
  documentVersionId: string,
  updatedAt: string,
): Promise<void> {
  await connection.run(
    'INSERT INTO knowledge_active_document_contributions (knowledge_model_id, document_id, document_version_id, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (knowledge_model_id, document_id) DO UPDATE SET document_version_id = excluded.document_version_id, updated_at = excluded.updated_at',
    [modelId, documentId, documentVersionId, updatedAt],
  );
}

async function loadActiveContributions(
  connection: DuckDbConnection,
  modelId: string,
): Promise<ActiveContribution[]> {
  const rows = await connection.runAndReadAll(
    'SELECT c.document_id, CAST(c.candidate_json AS VARCHAR) AS candidate_json FROM knowledge_active_document_contributions a JOIN knowledge_document_contributions c USING (knowledge_model_id, document_id, document_version_id) WHERE a.knowledge_model_id = $1 ORDER BY c.document_id',
    [modelId],
  );
  return rows.getRowObjectsJson().map((row) => {
    const parsed = z
      .object({ document_id: idSchema, candidate_json: z.string() })
      .parse(row);
    const payload = candidatePayloadSchema.parse(
      JSON.parse(parsed.candidate_json) as unknown,
    );
    return {
      documentId: parseDocumentId(parsed.document_id),
      payload: canonicalizeCandidatePayload({
        sourceId: parseSourceId(payload.sourceId),
        documentId: parseDocumentId(payload.documentId),
        documentVersionId: parseDocumentVersionId(payload.documentVersionId),
        entities: payload.entities.map((candidate) => ({
          ...candidate,
          sourceEvidenceIds: candidate.sourceEvidenceIds.map(parseEvidenceId),
          provenance: parseProvenance(candidate.provenance),
        })),
        relationships: payload.relationships.map((candidate) => ({
          ...candidate,
          sourceEvidenceIds: candidate.sourceEvidenceIds.map(parseEvidenceId),
          provenance: parseProvenance(candidate.provenance),
        })),
      }),
    };
  });
}

function aggregateEntityCandidates(
  contributions: readonly ActiveContribution[],
): Map<string, KnowledgeEntityCandidate> {
  const result = new Map<string, KnowledgeEntityCandidate>();
  for (const contribution of contributions) {
    for (const candidate of contribution.payload.entities) {
      const previous = result.get(candidate.key);
      result.set(candidate.key, {
        ...candidate,
        name:
          previous === undefined
            ? candidate.name
            : ([previous.name, candidate.name].sort(compareOrdinal)[0] ??
              candidate.name),
        sourceEvidenceIds: sortedUnique([
          ...(previous?.sourceEvidenceIds ?? []),
          ...candidate.sourceEvidenceIds,
        ]),
        provenance: mergeProvenance(
          previous?.provenance ?? [],
          candidate.provenance,
        ),
        lifecycleStatus: 'observed',
      });
    }
  }
  return result;
}

function aggregateRelationshipCandidates(
  contributions: readonly ActiveContribution[],
): Map<string, KnowledgeRelationshipCandidate> {
  const result = new Map<string, KnowledgeRelationshipCandidate>();
  for (const contribution of contributions) {
    for (const candidate of contribution.payload.relationships) {
      const previous = result.get(candidate.key);
      result.set(candidate.key, {
        ...candidate,
        sourceEvidenceIds: sortedUnique([
          ...(previous?.sourceEvidenceIds ?? []),
          ...candidate.sourceEvidenceIds,
        ]),
        provenance: mergeProvenance(
          previous?.provenance ?? [],
          candidate.provenance,
        ),
        confidence: Math.max(previous?.confidence ?? 0, candidate.confidence),
        lifecycleStatus: 'related',
      });
    }
  }
  return result;
}

async function activeContributionModels(
  connection: DuckDbConnection,
  sourceId: string,
  documentId: string,
): Promise<KnowledgeModel[]> {
  const rows = await connection.runAndReadAll(
    "SELECT DISTINCT m.id, m.workspace_id, m.name, m.schema_version, m.latest_publication_version, strftime(m.created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM knowledge_active_document_contributions a JOIN knowledge_document_contributions c USING (knowledge_model_id, document_id, document_version_id) JOIN knowledge_models m ON m.id = a.knowledge_model_id WHERE c.source_id = $1 AND a.document_id = $2 ORDER BY m.id",
    [sourceId, documentId],
  );
  return rows.getRowObjectsJson().map(parseKnowledgeModelRow);
}

async function reconcileKnowledgeModel(
  connection: DuckDbConnection,
  model: KnowledgeModel,
  sourceId: string,
  correlationId: string,
  occurredAt: string,
): Promise<void> {
  const contributions = await loadActiveContributions(connection, model.id);
  const desiredEntities = aggregateEntityCandidates(contributions);
  const existingEntities = await loadModelEntities(connection, model.id);
  const entitiesByKey = new Map(
    existingEntities.map((item) => [item.entityKey, item.entity]),
  );
  const entityIdsByKey = new Map<string, string>();
  let changed = false;

  for (const candidate of desiredEntities.values()) {
    const existing = entitiesByKey.get(candidate.key);
    const result = await upsertEntity(
      connection,
      model.id,
      candidate,
      existing,
      occurredAt,
    );
    if (result.entity.lifecycleStatus !== 'rejected') {
      entityIdsByKey.set(candidate.key, result.entity.id);
    }
    if (result.changed) {
      changed = true;
      if (existing === undefined) {
        await insertKnowledgeOutboxEvent(
          connection,
          createKnowledgeEvent(
            'KnowledgeEntityDiscovered',
            { entity: result.entity },
            sourceId,
            correlationId,
            `knowledge-entity-discovered:${model.id}:${result.entity.id}`,
            occurredAt,
          ),
        );
      }
    }
  }

  for (const existing of existingEntities) {
    if (
      !desiredEntities.has(existing.entityKey) &&
      existing.entity.lifecycleStatus !== 'superseded'
    ) {
      const superseded = await supersedeEntity(
        connection,
        existing.entity,
        occurredAt,
      );
      changed = true;
      await insertKnowledgeOutboxEvent(
        connection,
        createKnowledgeEvent(
          'KnowledgeEntitySuperseded',
          { entity: superseded },
          sourceId,
          correlationId,
          `knowledge-entity-superseded:${model.id}:${superseded.currentVersionId}`,
          occurredAt,
        ),
      );
    }
  }

  const desiredRelationships = aggregateRelationshipCandidates(contributions);
  const existingRelationships = await loadModelRelationships(
    connection,
    model.id,
  );
  const relationshipsByKey = new Map(
    existingRelationships.map((item) => [
      item.relationshipKey,
      item.relationship,
    ]),
  );
  const activeRelationshipKeys = new Set<string>();
  for (const candidate of desiredRelationships.values()) {
    const sourceEntityId = entityIdsByKey.get(candidate.sourceEntityKey);
    const targetEntityId = entityIdsByKey.get(candidate.targetEntityKey);
    if (sourceEntityId === undefined || targetEntityId === undefined) {
      throw new Error(
        `Knowledge relationship ${candidate.key} references an unknown entity`,
      );
    }
    activeRelationshipKeys.add(candidate.key);
    const existing = relationshipsByKey.get(candidate.key);
    const result = await upsertRelationship(
      connection,
      model.id,
      candidate,
      sourceEntityId,
      targetEntityId,
      existing,
      occurredAt,
    );
    if (result.changed) {
      changed = true;
      if (existing === undefined) {
        await insertKnowledgeOutboxEvent(
          connection,
          createKnowledgeEvent(
            'KnowledgeRelationshipDiscovered',
            { relationship: result.relationship },
            sourceId,
            correlationId,
            `knowledge-relationship-discovered:${model.id}:${result.relationship.id}`,
            occurredAt,
          ),
        );
      }
    }
  }
  for (const existing of existingRelationships) {
    if (
      !activeRelationshipKeys.has(existing.relationshipKey) &&
      existing.relationship.lifecycleStatus !== 'superseded'
    ) {
      const superseded = await supersedeRelationship(
        connection,
        existing.relationship,
        occurredAt,
      );
      changed = true;
      await insertKnowledgeOutboxEvent(
        connection,
        createKnowledgeEvent(
          'KnowledgeRelationshipSuperseded',
          { relationship: superseded },
          sourceId,
          correlationId,
          `knowledge-relationship-superseded:${model.id}:${superseded.currentVersionId}`,
          occurredAt,
        ),
      );
    }
  }
  if (changed) {
    await publishKnowledgeModel(
      connection,
      model,
      sourceId,
      correlationId,
      occurredAt,
    );
  }
}

async function loadModelEntities(
  connection: DuckDbConnection,
  modelId: string,
): Promise<ExistingEntity[]> {
  const rows = await connection.runAndReadAll(
    "SELECT id, knowledge_model_id, entity_key, entity_type, name, CAST(source_evidence_json AS VARCHAR) AS source_evidence_json, CAST(provenance_json AS VARCHAR) AS provenance_json, lifecycle_status, current_version_id, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at, strftime(updated_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS updated_at FROM knowledge_entities WHERE knowledge_model_id = $1 ORDER BY id",
    [modelId],
  );
  return rows.getRowObjectsJson().map((row) => {
    const parsed = knowledgeEntityRowSchema.parse(row);
    return {
      entityKey: parsed.entity_key,
      entity: parseKnowledgeEntityRow(row),
    };
  });
}

async function loadModelRelationships(
  connection: DuckDbConnection,
  modelId: string,
): Promise<ExistingRelationship[]> {
  const rows = await connection.runAndReadAll(
    "SELECT id, knowledge_model_id, relationship_key, relationship_type, source_entity_id, target_entity_id, CAST(source_evidence_json AS VARCHAR) AS source_evidence_json, CAST(provenance_json AS VARCHAR) AS provenance_json, confidence, lifecycle_status, current_version_id, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at, strftime(updated_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS updated_at FROM knowledge_relationships WHERE knowledge_model_id = $1 ORDER BY id",
    [modelId],
  );
  return rows.getRowObjectsJson().map((row) => {
    const parsed = knowledgeRelationshipRowSchema.parse(row);
    return {
      relationshipKey: parsed.relationship_key,
      relationship: parseKnowledgeRelationshipRow(row),
    };
  });
}

async function upsertEntity(
  connection: DuckDbConnection,
  modelId: string,
  candidate: KnowledgeEntityCandidate,
  existing: KnowledgeEntity | undefined,
  occurredAt: string,
): Promise<{ readonly entity: KnowledgeEntity; readonly changed: boolean }> {
  const sourceEvidenceIds = sortedUnique(candidate.sourceEvidenceIds);
  const provenance = mergeProvenance([], candidate.provenance);
  const lifecycleStatus =
    existing?.lifecycleStatus === 'superseded'
      ? candidate.lifecycleStatus
      : (existing?.lifecycleStatus ?? candidate.lifecycleStatus);
  if (
    existing !== undefined &&
    existing.type === candidate.type &&
    existing.name === candidate.name &&
    stableJson(existing.sourceEvidenceIds) === stableJson(sourceEvidenceIds) &&
    stableJson(existing.provenance) === stableJson(provenance) &&
    existing.lifecycleStatus === lifecycleStatus
  ) {
    return { entity: existing, changed: false };
  }
  const entityId = existing?.id ?? createKnowledgeEntityId();
  const entityVersionId = createEntityVersionId();
  const entity: KnowledgeEntity = {
    id: entityId,
    knowledgeModelId: parseKnowledgeModelId(modelId),
    type: candidate.type,
    name: candidate.name,
    sourceEvidenceIds,
    provenance,
    lifecycleStatus,
    currentVersionId: entityVersionId,
    createdAt: existing?.createdAt ?? occurredAt,
    updatedAt: occurredAt,
  };
  const versionNumber = await nextVersionNumber(
    connection,
    'entity_versions',
    'entity_id',
    entityId,
  );
  if (existing === undefined) {
    await connection.run(
      'INSERT INTO knowledge_entities (id, knowledge_model_id, entity_key, entity_type, name, source_evidence_json, provenance_json, lifecycle_status, current_version_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [
        entity.id,
        entity.knowledgeModelId,
        candidate.key,
        entity.type,
        entity.name,
        JSON.stringify(entity.sourceEvidenceIds),
        JSON.stringify(entity.provenance),
        entity.lifecycleStatus,
        entity.currentVersionId,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
  } else {
    await connection.run(
      'UPDATE knowledge_entities SET entity_type = $2, name = $3, source_evidence_json = $4, provenance_json = $5, lifecycle_status = $6, current_version_id = $7, updated_at = $8 WHERE id = $1',
      [
        entity.id,
        entity.type,
        entity.name,
        JSON.stringify(entity.sourceEvidenceIds),
        JSON.stringify(entity.provenance),
        entity.lifecycleStatus,
        entity.currentVersionId,
        entity.updatedAt,
      ],
    );
  }
  await connection.run(
    'INSERT INTO entity_versions (id, entity_id, version_number, snapshot_json, created_at) VALUES ($1, $2, $3, $4, $5)',
    [
      entityVersionId,
      entity.id,
      versionNumber,
      JSON.stringify(entity),
      occurredAt,
    ],
  );
  return { entity, changed: true };
}

async function upsertRelationship(
  connection: DuckDbConnection,
  modelId: string,
  candidate: KnowledgeRelationshipCandidate,
  sourceEntityId: string,
  targetEntityId: string,
  existing: KnowledgeRelationship | undefined,
  occurredAt: string,
): Promise<{
  readonly relationship: KnowledgeRelationship;
  readonly changed: boolean;
}> {
  const sourceEvidenceIds = sortedUnique(candidate.sourceEvidenceIds);
  const provenance = mergeProvenance([], candidate.provenance);
  const confidence = candidate.confidence;
  const lifecycleStatus =
    existing?.lifecycleStatus === 'superseded'
      ? candidate.lifecycleStatus
      : (existing?.lifecycleStatus ?? candidate.lifecycleStatus);
  if (
    existing !== undefined &&
    existing.type === candidate.type &&
    existing.sourceEntityId === sourceEntityId &&
    existing.targetEntityId === targetEntityId &&
    stableJson(existing.sourceEvidenceIds) === stableJson(sourceEvidenceIds) &&
    stableJson(existing.provenance) === stableJson(provenance) &&
    existing.confidence === confidence &&
    existing.lifecycleStatus === lifecycleStatus
  ) {
    return { relationship: existing, changed: false };
  }
  const relationshipId = existing?.id ?? createKnowledgeRelationshipId();
  const relationshipVersionId = createRelationshipVersionId();
  const relationship: KnowledgeRelationship = {
    id: relationshipId,
    knowledgeModelId: parseKnowledgeModelId(modelId),
    type: candidate.type,
    sourceEntityId: parseKnowledgeEntityId(sourceEntityId),
    targetEntityId: parseKnowledgeEntityId(targetEntityId),
    sourceEvidenceIds,
    provenance,
    confidence,
    lifecycleStatus,
    currentVersionId: relationshipVersionId,
    createdAt: existing?.createdAt ?? occurredAt,
    updatedAt: occurredAt,
  };
  const versionNumber = await nextVersionNumber(
    connection,
    'relationship_versions',
    'relationship_id',
    relationshipId,
  );
  if (existing === undefined) {
    await connection.run(
      'INSERT INTO knowledge_relationships (id, knowledge_model_id, relationship_key, relationship_type, source_entity_id, target_entity_id, source_evidence_json, provenance_json, confidence, lifecycle_status, current_version_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      [
        relationship.id,
        relationship.knowledgeModelId,
        candidate.key,
        relationship.type,
        relationship.sourceEntityId,
        relationship.targetEntityId,
        JSON.stringify(relationship.sourceEvidenceIds),
        JSON.stringify(relationship.provenance),
        relationship.confidence,
        relationship.lifecycleStatus,
        relationship.currentVersionId,
        relationship.createdAt,
        relationship.updatedAt,
      ],
    );
  } else {
    await connection.run(
      'UPDATE knowledge_relationships SET relationship_type = $2, source_entity_id = $3, target_entity_id = $4, source_evidence_json = $5, provenance_json = $6, confidence = $7, lifecycle_status = $8, current_version_id = $9, updated_at = $10 WHERE id = $1',
      [
        relationship.id,
        relationship.type,
        relationship.sourceEntityId,
        relationship.targetEntityId,
        JSON.stringify(relationship.sourceEvidenceIds),
        JSON.stringify(relationship.provenance),
        relationship.confidence,
        relationship.lifecycleStatus,
        relationship.currentVersionId,
        relationship.updatedAt,
      ],
    );
  }
  await connection.run(
    'INSERT INTO relationship_versions (id, relationship_id, version_number, snapshot_json, created_at) VALUES ($1, $2, $3, $4, $5)',
    [
      relationshipVersionId,
      relationship.id,
      versionNumber,
      JSON.stringify(relationship),
      occurredAt,
    ],
  );
  return { relationship, changed: true };
}

async function supersedeEntity(
  connection: DuckDbConnection,
  existing: KnowledgeEntity,
  occurredAt: string,
): Promise<KnowledgeEntity> {
  const entity: KnowledgeEntity = {
    ...existing,
    lifecycleStatus: 'superseded',
    currentVersionId: createEntityVersionId(),
    updatedAt: occurredAt,
  };
  const versionNumber = await nextVersionNumber(
    connection,
    'entity_versions',
    'entity_id',
    entity.id,
  );
  await connection.run(
    'UPDATE knowledge_entities SET lifecycle_status = $2, current_version_id = $3, updated_at = $4 WHERE id = $1',
    [entity.id, entity.lifecycleStatus, entity.currentVersionId, occurredAt],
  );
  await connection.run(
    'INSERT INTO entity_versions (id, entity_id, version_number, snapshot_json, created_at) VALUES ($1, $2, $3, $4, $5)',
    [
      entity.currentVersionId,
      entity.id,
      versionNumber,
      JSON.stringify(entity),
      occurredAt,
    ],
  );
  return entity;
}

async function supersedeRelationship(
  connection: DuckDbConnection,
  existing: KnowledgeRelationship,
  occurredAt: string,
): Promise<KnowledgeRelationship> {
  const relationship: KnowledgeRelationship = {
    ...existing,
    lifecycleStatus: 'superseded',
    currentVersionId: createRelationshipVersionId(),
    updatedAt: occurredAt,
  };
  const versionNumber = await nextVersionNumber(
    connection,
    'relationship_versions',
    'relationship_id',
    relationship.id,
  );
  await connection.run(
    'UPDATE knowledge_relationships SET lifecycle_status = $2, current_version_id = $3, updated_at = $4 WHERE id = $1',
    [
      relationship.id,
      relationship.lifecycleStatus,
      relationship.currentVersionId,
      occurredAt,
    ],
  );
  await connection.run(
    'INSERT INTO relationship_versions (id, relationship_id, version_number, snapshot_json, created_at) VALUES ($1, $2, $3, $4, $5)',
    [
      relationship.currentVersionId,
      relationship.id,
      versionNumber,
      JSON.stringify(relationship),
      occurredAt,
    ],
  );
  return relationship;
}

async function publishKnowledgeModel(
  connection: DuckDbConnection,
  model: KnowledgeModel,
  sourceId: string,
  correlationId: string,
  publishedAt: string,
): Promise<void> {
  const entities = await loadModelEntities(connection, model.id);
  const entitySnapshots = await connection.runAndReadAll(
    "SELECT CAST(v.snapshot_json AS VARCHAR) AS snapshot_json FROM entity_versions v JOIN knowledge_entities e ON e.id = v.entity_id AND e.current_version_id = v.id WHERE e.knowledge_model_id = $1 AND e.lifecycle_status NOT IN ('superseded', 'rejected') ORDER BY e.id",
    [model.id],
  );
  const publishedEntities = entitySnapshots
    .getRowObjectsJson()
    .map((row) => parseEntitySnapshotJson(row.snapshot_json))
    .sort((left, right) => compareOrdinal(left.id, right.id));
  const relationships = await loadModelRelationships(connection, model.id);
  const relationshipSnapshots = await connection.runAndReadAll(
    "SELECT CAST(v.snapshot_json AS VARCHAR) AS snapshot_json FROM relationship_versions v JOIN knowledge_relationships r ON r.id = v.relationship_id AND r.current_version_id = v.id WHERE r.knowledge_model_id = $1 AND r.lifecycle_status NOT IN ('superseded', 'rejected') ORDER BY r.id",
    [model.id],
  );
  const publishedRelationships = relationshipSnapshots
    .getRowObjectsJson()
    .map((row) => parseRelationshipSnapshotJson(row.snapshot_json))
    .sort((left, right) => compareOrdinal(left.id, right.id));
  const entityVersionIds = entities
    .filter(
      ({ entity }) =>
        entity.lifecycleStatus !== 'superseded' &&
        entity.lifecycleStatus !== 'rejected',
    )
    .map(({ entity }) => entity.currentVersionId)
    .sort(compareOrdinal);
  const relationshipVersionIds = relationships
    .filter(
      ({ relationship }) =>
        relationship.lifecycleStatus !== 'superseded' &&
        relationship.lifecycleStatus !== 'rejected',
    )
    .map(({ relationship }) => relationship.currentVersionId)
    .sort(compareOrdinal);
  const version = (model.latestPublicationVersion ?? 0) + 1;
  const contentHash = createKnowledgePublicationContentHash(
    publishedEntities,
    publishedRelationships,
  );
  const publication: KnowledgePublication = {
    id: createKnowledgePublicationId(),
    knowledgeModelId: model.id,
    version,
    schemaVersion: 1,
    status: 'published',
    contentHash,
    entityVersionIds,
    relationshipVersionIds,
    publishedAt,
  };
  await connection.run(
    'INSERT INTO knowledge_publications (id, knowledge_model_id, version_number, schema_version, status, content_hash, entity_version_ids_json, relationship_version_ids_json, published_at) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)',
    [
      publication.id,
      publication.knowledgeModelId,
      publication.version,
      publication.status,
      publication.contentHash,
      JSON.stringify(publication.entityVersionIds),
      JSON.stringify(publication.relationshipVersionIds),
      publication.publishedAt,
    ],
  );
  await connection.run(
    'UPDATE knowledge_models SET latest_publication_version = $2 WHERE id = $1',
    [model.id, version],
  );
  await insertKnowledgeOutboxEvent(
    connection,
    createKnowledgeEvent(
      'KnowledgeModelPublished',
      { publication },
      sourceId,
      correlationId,
      `knowledge-model-published:${model.id}:${version}`,
      publishedAt,
    ),
  );
}

async function validateCandidateProvenance(
  connection: DuckDbConnection,
  sourceId: string,
  documentId: string,
  documentVersionId: string,
  provenance: readonly KnowledgeProvenance[],
  rawEvidenceIds: readonly string[],
): Promise<void> {
  const evidenceIds = sortedUnique(rawEvidenceIds);
  const byEvidenceId = new Map<string, KnowledgeProvenance>();
  for (const item of provenance) {
    const evidenceId = parseEvidenceId(item.evidenceId);
    if (item.sourceId !== sourceId) {
      throw new Error('Knowledge provenance source does not match its event');
    }
    byEvidenceId.set(evidenceId, item);
  }
  if (evidenceIds.length === 0 && provenance.length === 0) {
    return;
  }
  if (
    evidenceIds.length === 0 ||
    evidenceIds.some((id) => !byEvidenceId.has(id)) ||
    [...byEvidenceId.keys()].some((id) => !evidenceIds.includes(id))
  ) {
    throw new Error(
      'Knowledge candidates require matching evidence provenance',
    );
  }

  const inputsByVersion = new Map<string, KnowledgeInputEvidence[]>();
  for (const item of byEvidenceId.values()) {
    if (
      item.documentId !== documentId ||
      item.documentVersionId !== documentVersionId
    ) {
      throw new Error(
        'Knowledge provenance does not match the submitted document version',
      );
    }
    let inputs = inputsByVersion.get(item.documentVersionId);
    if (inputs === undefined) {
      inputs = [
        ...(await listKnowledgeInputEvidence(
          connection,
          item.documentVersionId,
        )),
      ];
      inputsByVersion.set(item.documentVersionId, inputs);
    }
  }
  for (const evidenceId of evidenceIds) {
    const item = byEvidenceId.get(evidenceId);
    const input = inputsByVersion
      .get(item?.documentVersionId ?? '')
      ?.find(({ evidence }) => evidence.id === evidenceId);
    if (item === undefined || input === undefined) {
      throw new Error(`Knowledge source evidence ${evidenceId} was not found`);
    }
    const expected: KnowledgeProvenance = {
      evidenceId: input.evidence.id,
      documentVersionId: input.documentVersion.id,
      documentId: input.document.id,
      sourceId: input.document.sourceId,
      documentPath: input.document.path,
      contentFingerprint: input.provenance.contentFingerprint,
      locator: input.evidence.locator,
      processorId: input.provenance.processorId,
      processorVersion: input.provenance.processorVersion,
      extractionRuleId: input.provenance.extractionRuleId,
      extractionRuleVersion: input.provenance.extractionRuleVersion,
      knowledgeExtractorId: item.knowledgeExtractorId,
      knowledgeExtractorVersion: item.knowledgeExtractorVersion,
    };
    if (stableJson(expected) !== stableJson(item)) {
      throw new Error(
        `Knowledge provenance does not match source evidence ${evidenceId}`,
      );
    }
  }
}

function hasUniqueEvidence(
  evidenceIds: readonly string[],
  provenance: readonly KnowledgeProvenance[],
): boolean {
  const sourceIds = sortedUnique(evidenceIds);
  const provenanceIds = sortedUnique(
    provenance.map(({ evidenceId }) => evidenceId),
  );
  return (
    sourceIds.length === evidenceIds.length &&
    provenanceIds.length === provenance.length &&
    stableJson(sourceIds) === stableJson(provenanceIds)
  );
}

function mergeProvenance(
  left: readonly KnowledgeProvenance[],
  right: readonly KnowledgeProvenance[],
): KnowledgeProvenance[] {
  const byEvidenceId = new Map<string, KnowledgeProvenance>();
  for (const item of [...left, ...right]) {
    const previous = byEvidenceId.get(item.evidenceId);
    if (previous !== undefined && stableJson(previous) !== stableJson(item)) {
      throw new Error(
        `Conflicting provenance for source evidence ${item.evidenceId}`,
      );
    }
    byEvidenceId.set(item.evidenceId, item);
  }
  return [...byEvidenceId.values()].sort((a, b) =>
    compareOrdinal(a.evidenceId, b.evidenceId),
  );
}

async function nextVersionNumber(
  connection: DuckDbConnection,
  table: 'entity_versions' | 'relationship_versions',
  idColumn: 'entity_id' | 'relationship_id',
  id: string,
): Promise<number> {
  const rows = await connection.runAndReadAll(
    `SELECT COALESCE(MAX(version_number), 0) AS current_version FROM ${table} WHERE ${idColumn} = $1`,
    [id],
  );
  const currentVersion = z.coerce
    .number()
    .int()
    .parse(rows.getRowObjectsJson()[0]?.current_version);
  return currentVersion + 1;
}

function parseKnowledgeInputEvidence(row: unknown): KnowledgeInputEvidence {
  const parsed = z
    .object({
      id: idSchema,
      document_version_id: idSchema,
      evidence_key: z.string(),
      evidence_kind: z.enum([
        'heading',
        'paragraph',
        'list-item',
        'table-row',
        'code-block',
        'structured-value',
      ]),
      excerpt: z.string(),
      truncated: z.boolean(),
      locator_json: z.string(),
      version_id: idSchema,
      document_id: idSchema,
      content_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      processed_at: z.string(),
      processor_id: z.string(),
      processor_version: z.coerce.number().int(),
      extraction_rule_id: z.string(),
      extraction_rule_version: z.coerce.number().int(),
      evidence_count: z.coerce.number().int(),
      source_id: idSchema,
      path: z.string(),
      filename: z.string(),
    })
    .parse(row);
  const locator = locatorSchema.parse(
    JSON.parse(parsed.locator_json) as unknown,
  ) as EvidenceLocator;
  const evidence: Evidence = {
    id: parseEvidenceId(parsed.id),
    documentVersionId: parseDocumentVersionId(parsed.document_version_id),
    key: parsed.evidence_key,
    kind: parsed.evidence_kind,
    excerpt: parsed.excerpt,
    truncated: parsed.truncated,
    locator,
  };
  return {
    evidence,
    documentVersion: {
      id: parseDocumentVersionId(parsed.version_id),
      documentId: parseDocumentId(parsed.document_id),
      contentHash: parsed.content_fingerprint,
      hashAlgorithm: 'sha256',
      discoveredAt: normalizeTimestamp(parsed.processed_at),
      processorId: parsed.processor_id,
      processorVersion: parsed.processor_version,
      extractionRuleId: parsed.extraction_rule_id,
      extractionRuleVersion: parsed.extraction_rule_version,
      evidenceCount: parsed.evidence_count,
    },
    document: {
      id: parseDocumentId(parsed.document_id),
      sourceId: parseSourceId(parsed.source_id),
      path: parsed.path,
      filename: parsed.filename,
      fingerprint: parsed.content_fingerprint,
    },
    provenance: {
      documentPath: parsed.path,
      contentFingerprint: parsed.content_fingerprint,
      processorId: parsed.processor_id,
      processorVersion: parsed.processor_version,
      extractionRuleId: parsed.extraction_rule_id,
      extractionRuleVersion: parsed.extraction_rule_version,
    },
  };
}

function parseKnowledgeModelRow(row: unknown): KnowledgeModel {
  const parsed = knowledgeModelRowSchema.parse(row);
  if (parsed.schema_version !== 1) {
    throw new Error('DuckDB returned an unsupported Knowledge Model schema');
  }
  return {
    id: parseKnowledgeModelId(parsed.id),
    workspaceId: parseWorkspaceId(parsed.workspace_id),
    name: parsed.name,
    schemaVersion: 1,
    latestPublicationVersion: parsed.latest_publication_version,
    createdAt: normalizeTimestamp(parsed.created_at),
  };
}

function parseKnowledgeEntityRow(row: unknown): KnowledgeEntity {
  const parsed = knowledgeEntityRowSchema.parse(row);
  const entity: KnowledgeEntity = {
    id: parseKnowledgeEntityId(parsed.id),
    knowledgeModelId: parseKnowledgeModelId(parsed.knowledge_model_id),
    type: parsed.entity_type,
    name: parsed.name,
    sourceEvidenceIds: parseJsonStringArray(
      parsed.source_evidence_json,
      'entity source evidence',
    ).map(parseEvidenceId),
    provenance: parseProvenanceArray(parsed.provenance_json),
    lifecycleStatus: parsed.lifecycle_status,
    currentVersionId: parseEntityVersionId(parsed.current_version_id),
    createdAt: normalizeTimestamp(parsed.created_at),
    updatedAt: normalizeTimestamp(parsed.updated_at),
  };
  entitySnapshotSchema.parse(entity);
  return entity;
}

function parseKnowledgeRelationshipRow(row: unknown): KnowledgeRelationship {
  const parsed = knowledgeRelationshipRowSchema.parse(row);
  const relationship: KnowledgeRelationship = {
    id: parseKnowledgeRelationshipId(parsed.id),
    knowledgeModelId: parseKnowledgeModelId(parsed.knowledge_model_id),
    type: parsed.relationship_type,
    sourceEntityId: parseKnowledgeEntityId(parsed.source_entity_id),
    targetEntityId: parseKnowledgeEntityId(parsed.target_entity_id),
    sourceEvidenceIds: parseJsonStringArray(
      parsed.source_evidence_json,
      'relationship source evidence',
    ).map(parseEvidenceId),
    provenance: parseProvenanceArray(parsed.provenance_json),
    confidence: parsed.confidence,
    lifecycleStatus: parsed.lifecycle_status,
    currentVersionId: parseRelationshipVersionId(parsed.current_version_id),
    createdAt: normalizeTimestamp(parsed.created_at),
    updatedAt: normalizeTimestamp(parsed.updated_at),
  };
  relationshipSnapshotSchema.parse(relationship);
  return relationship;
}

function parseEntitySnapshotJson(value: unknown): KnowledgeEntity {
  const snapshot = entitySnapshotSchema.parse(
    JSON.parse(z.string().parse(value)) as unknown,
  );
  return {
    ...snapshot,
    id: parseKnowledgeEntityId(snapshot.id),
    knowledgeModelId: parseKnowledgeModelId(snapshot.knowledgeModelId),
    sourceEvidenceIds: snapshot.sourceEvidenceIds.map(parseEvidenceId),
    provenance: parseProvenanceArray(JSON.stringify(snapshot.provenance)),
    currentVersionId: parseEntityVersionId(snapshot.currentVersionId),
  };
}

function parseRelationshipSnapshotJson(value: unknown): KnowledgeRelationship {
  const snapshot = relationshipSnapshotSchema.parse(
    JSON.parse(z.string().parse(value)) as unknown,
  );
  return {
    ...snapshot,
    id: parseKnowledgeRelationshipId(snapshot.id),
    knowledgeModelId: parseKnowledgeModelId(snapshot.knowledgeModelId),
    sourceEntityId: parseKnowledgeEntityId(snapshot.sourceEntityId),
    targetEntityId: parseKnowledgeEntityId(snapshot.targetEntityId),
    sourceEvidenceIds: snapshot.sourceEvidenceIds.map(parseEvidenceId),
    provenance: parseProvenanceArray(JSON.stringify(snapshot.provenance)),
    currentVersionId: parseRelationshipVersionId(snapshot.currentVersionId),
  };
}

function parseProvenanceArray(value: string): KnowledgeProvenance[] {
  return parseProvenance(
    z.array(provenanceSchema).parse(JSON.parse(value) as unknown),
  );
}

function parseProvenance(
  provenance: readonly z.infer<typeof provenanceSchema>[],
): KnowledgeProvenance[] {
  return provenance.map((item) => ({
    ...item,
    evidenceId: parseEvidenceId(item.evidenceId),
    documentVersionId: parseDocumentVersionId(item.documentVersionId),
    documentId: parseDocumentId(item.documentId),
    sourceId: parseSourceId(item.sourceId),
    locator: item.locator as EvidenceLocator,
  }));
}

function parseJsonStringArray(value: string, label: string): string[] {
  const parsed = z.array(z.string()).safeParse(JSON.parse(value) as unknown);
  if (!parsed.success) {
    throw new Error(`DuckDB returned an invalid ${label}`);
  }
  return parsed.data;
}

function parseKnowledgePublicationRow(row: unknown): KnowledgePublication {
  const parsed = knowledgePublicationRowSchema.parse(row);
  if (parsed.schema_version !== 1) {
    throw new Error('DuckDB returned an unsupported publication schema');
  }
  return {
    id: parseKnowledgePublicationId(parsed.id),
    knowledgeModelId: parseKnowledgeModelId(parsed.knowledge_model_id),
    version: parsed.version_number,
    schemaVersion: 1,
    status: 'published',
    contentHash: parsed.content_hash,
    entityVersionIds: parseJsonStringArray(
      parsed.entity_version_ids_json,
      'publication entity versions',
    ).map(parseEntityVersionId),
    relationshipVersionIds: parseJsonStringArray(
      parsed.relationship_version_ids_json,
      'publication relationship versions',
    ).map(parseRelationshipVersionId),
    publishedAt: normalizeTimestamp(parsed.published_at),
  };
}

function createKnowledgeEvent(
  eventType: Extract<
    DiscoveryEvent['eventType'],
    | 'KnowledgeEntityDiscovered'
    | 'KnowledgeEntitySuperseded'
    | 'KnowledgeRelationshipDiscovered'
    | 'KnowledgeRelationshipSuperseded'
    | 'KnowledgeModelPublished'
  >,
  payload: object,
  sourceId: string,
  correlationId: string,
  idempotencyKey: string,
  occurredAt: string,
): DiscoveryEvent {
  return {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    occurredAt,
    producer: 'workspace-brain-api',
    correlationId,
    idempotencyKey,
    partitionKey: sourceId,
    payload,
  } as DiscoveryEvent;
}

async function insertKnowledgeOutboxEvent(
  connection: DuckDbConnection,
  event: DiscoveryEvent,
): Promise<void> {
  await connection.run(
    'INSERT INTO discovery_outbox (event_id, idempotency_key, source_id, event_type, occurred_at, correlation_id, event_json) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (idempotency_key) DO NOTHING',
    [
      event.eventId,
      event.idempotencyKey,
      event.partitionKey,
      event.eventType,
      event.occurredAt,
      event.correlationId,
      JSON.stringify(event),
    ],
  );
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

function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error('DuckDB returned an invalid Knowledge Model timestamp');
  }
  return date.toISOString();
}

function validateLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 101) {
    throw new Error('Knowledge Model page limit must be between 1 and 101');
  }
  return limit;
}

function whereClause(filters: readonly string[]): string {
  return filters.length === 0 ? '' : `WHERE ${filters.join(' AND ')}`;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
