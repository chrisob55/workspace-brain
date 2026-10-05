import { randomUUID } from 'node:crypto';

import type {
  KnowledgeModelPublishedEvent,
  SearchEntityRequest,
  SearchProjectionRequestedEvent,
  SearchRelationshipRequest,
} from '@workspace-brain/catalogue';
import {
  knowledgeRelationshipTypes,
  parseEntityVersionId,
  parseEvidenceId,
  parseKnowledgeEntityId,
  parseKnowledgeModelId,
  parseKnowledgePublicationId,
  parseKnowledgeRelationshipId,
  parseRelationshipVersionId,
  searchMatchModes,
  searchProjectionSchemaVersion,
  type DiscoveryEvent,
  type KnowledgePublication,
  type ProjectedEntity,
  type ProjectedRelationship,
  type ProjectionStatistics,
  type SearchProjection,
  type SearchProjectionSummary,
} from '@workspace-brain/domain';
import { z } from 'zod';

import type { DuckDbConnection } from './index.js';
import {
  getKnowledgePublication,
  parseEntitySnapshotJson,
  parseRelationshipSnapshotJson,
} from './knowledge.js';
import {
  buildSearchProjection,
  normalizeSearchText,
} from './search-projection-builder.js';

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
const maxQueryLength = 256;
const insertChunkSize = 200;

const projectedEntityRowSchema = z.object({
  publication_id: idSchema,
  entity_id: idSchema,
  knowledge_model_id: idSchema,
  entity_type: z.enum(entityTypes),
  name: z.string(),
  lifecycle_status: z.enum(entityStatuses),
  source_evidence_json: z.string(),
  relationship_count: z.coerce.number().int().nonnegative(),
  published_at: z.string(),
});
const projectedRelationshipRowSchema = z.object({
  publication_id: idSchema,
  relationship_id: idSchema,
  knowledge_model_id: idSchema,
  relationship_type: z.enum(knowledgeRelationshipTypes),
  source_entity_id: idSchema,
  target_entity_id: idSchema,
  lifecycle_status: z.enum(relationshipStatuses),
  source_evidence_json: z.string(),
  published_at: z.string(),
});
const projectionRunRowSchema = z.object({
  publication_id: idSchema,
  knowledge_model_id: idSchema,
  publication_version: z.coerce.number().int().positive(),
  publication_content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  projection_schema_version: z.coerce.number().int(),
  projection_content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  entity_count: z.coerce.number().int().nonnegative(),
  relationship_count: z.coerce.number().int().nonnegative(),
  document_count: z.coerce.number().int().nonnegative(),
  built_at: z.string(),
});

const entityColumns =
  "e.publication_id, e.entity_id, e.knowledge_model_id, e.entity_type, e.name, e.lifecycle_status, CAST(e.source_evidence_json AS VARCHAR) AS source_evidence_json, e.relationship_count, strftime(e.published_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS published_at";
const relationshipColumns =
  "r.publication_id, r.relationship_id, r.knowledge_model_id, r.relationship_type, r.source_entity_id, r.target_entity_id, r.lifecycle_status, CAST(r.source_evidence_json AS VARCHAR) AS source_evidence_json, strftime(r.published_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS published_at";
const runColumns =
  "publication_id, knowledge_model_id, publication_version, publication_content_hash, projection_schema_version, projection_content_hash, entity_count, relationship_count, document_count, strftime(built_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS built_at";
// Latest publication of each Knowledge Model, read from the authoritative
// publication table so "current" never silently falls back to an older
// projection while the newest one is still being built.
const currentPublicationIds =
  'SELECT p.id FROM knowledge_publications p JOIN (SELECT knowledge_model_id, max(version_number) AS version_number FROM knowledge_publications GROUP BY knowledge_model_id) latest ON latest.knowledge_model_id = p.knowledge_model_id AND latest.version_number = p.version_number';

export async function requestSearchProjection(
  connection: DuckDbConnection,
  event: KnowledgeModelPublishedEvent,
): Promise<void> {
  const { publication } = event.payload;
  const stored = await getKnowledgePublication(connection, publication.id);
  if (
    stored === undefined ||
    stored.knowledgeModelId !== publication.knowledgeModelId ||
    stored.version !== publication.version ||
    stored.contentHash !== publication.contentHash
  ) {
    throw new Error(
      'Knowledge Model publication event does not match a stored publication',
    );
  }
  await insertProjectionOutboxEvent(
    connection,
    createProjectionEvent(
      'SearchProjectionRequested',
      {
        publicationId: stored.id,
        knowledgeModelId: stored.knowledgeModelId,
        publicationVersion: stored.version,
        publicationContentHash: stored.contentHash,
      },
      event.partitionKey,
      event.correlationId,
      `search-projection-requested:${stored.id}`,
      event.occurredAt,
    ),
  );
}

export async function buildSearchProjectionFromRequest(
  connection: DuckDbConnection,
  event: SearchProjectionRequestedEvent,
): Promise<SearchProjectionSummary> {
  const publication = await getKnowledgePublication(
    connection,
    event.payload.publicationId,
  );
  if (
    publication === undefined ||
    publication.knowledgeModelId !== event.payload.knowledgeModelId ||
    publication.version !== event.payload.publicationVersion ||
    publication.contentHash !== event.payload.publicationContentHash
  ) {
    throw new Error(
      'Search projection request does not match a stored publication',
    );
  }
  return persistSearchProjection(
    connection,
    publication,
    event.partitionKey,
    event.correlationId,
  );
}

export async function rebuildSearchProjections(
  connection: DuckDbConnection,
  mode: 'missing' | 'all',
  correlationId: string,
): Promise<readonly SearchProjectionSummary[]> {
  if (mode === 'all') {
    await purgeOrphanedProjections(connection);
  }
  const rows = await connection.runAndReadAll(
    mode === 'all'
      ? 'SELECT p.id FROM knowledge_publications p ORDER BY p.id'
      : 'SELECT p.id FROM knowledge_publications p LEFT JOIN search_projection_runs r ON r.publication_id = p.id WHERE r.publication_id IS NULL OR r.projection_schema_version <> $1 ORDER BY p.id',
    mode === 'all' ? [] : [searchProjectionSchemaVersion],
  );
  const summaries: SearchProjectionSummary[] = [];
  for (const row of rows.getRowObjectsJson()) {
    const publication = await getKnowledgePublication(
      connection,
      idSchema.parse(row.id),
    );
    if (publication === undefined) {
      continue;
    }
    summaries.push(
      await persistSearchProjection(
        connection,
        publication,
        await publicationPartitionKey(connection, publication),
        correlationId,
      ),
    );
  }
  return summaries;
}

export async function searchProjectedEntities(
  connection: DuckDbConnection,
  request: SearchEntityRequest,
): Promise<{ readonly items: readonly ProjectedEntity[] }> {
  const parameters: (string | number)[] = [];
  const filters: string[] = [];
  addPublicationScope(parameters, filters, 'e', request.publicationId);
  if (request.type !== undefined) {
    parameters.push(requireValue(entityTypes, request.type, 'entity type'));
    filters.push(`e.entity_type = $${parameters.length}`);
  }
  if (request.lifecycleStatus !== undefined) {
    parameters.push(
      requireValue(
        entityStatuses,
        request.lifecycleStatus,
        'entity lifecycle status',
      ),
    );
    filters.push(`e.lifecycle_status = $${parameters.length}`);
  }
  if (request.text !== undefined) {
    const { query, match, field } = parseTextFilter(request.text, [
      'name',
      'text',
    ] as const);
    parameters.push(query);
    const placeholder = `$${parameters.length}`;
    filters.push(
      field === 'name'
        ? matchExpression('e.name_normalized', match, placeholder)
        : textMatchExpression(
            'entity',
            'e.publication_id',
            'e.entity_id',
            match,
            placeholder,
          ),
    );
  }
  if (request.afterId !== undefined) {
    parameters.push(parseKnowledgeEntityId(request.afterId));
    filters.push(`e.entity_id > $${parameters.length}`);
  }
  parameters.push(validateLimit(request.limit));
  const rows = await connection.runAndReadAll(
    `SELECT ${entityColumns} FROM search_projected_entities e ${whereClause(filters)} ORDER BY e.entity_id, e.publication_id LIMIT $${parameters.length}`,
    parameters,
  );
  return { items: rows.getRowObjectsJson().map(parseProjectedEntityRow) };
}

export async function searchProjectedRelationships(
  connection: DuckDbConnection,
  request: SearchRelationshipRequest,
): Promise<{ readonly items: readonly ProjectedRelationship[] }> {
  const parameters: (string | number)[] = [];
  const filters: string[] = [];
  addPublicationScope(parameters, filters, 'r', request.publicationId);
  if (request.type !== undefined) {
    parameters.push(
      requireValue(
        knowledgeRelationshipTypes,
        request.type,
        'relationship type',
      ),
    );
    filters.push(`r.relationship_type = $${parameters.length}`);
  }
  if (request.entityId !== undefined) {
    parameters.push(parseKnowledgeEntityId(request.entityId));
    filters.push(
      `(r.source_entity_id = $${parameters.length} OR r.target_entity_id = $${parameters.length})`,
    );
  }
  if (request.text !== undefined) {
    const { query, match, field } = parseTextFilter(request.text, [
      'type',
      'text',
    ] as const);
    parameters.push(query);
    const placeholder = `$${parameters.length}`;
    filters.push(
      field === 'type'
        ? matchExpression('r.type_normalized', match, placeholder)
        : textMatchExpression(
            'relationship',
            'r.publication_id',
            'r.relationship_id',
            match,
            placeholder,
          ),
    );
  }
  if (request.afterId !== undefined) {
    parameters.push(parseKnowledgeRelationshipId(request.afterId));
    filters.push(`r.relationship_id > $${parameters.length}`);
  }
  parameters.push(validateLimit(request.limit));
  const rows = await connection.runAndReadAll(
    `SELECT ${relationshipColumns} FROM search_projected_relationships r ${whereClause(filters)} ORDER BY r.relationship_id, r.publication_id LIMIT $${parameters.length}`,
    parameters,
  );
  return {
    items: rows.getRowObjectsJson().map(parseProjectedRelationshipRow),
  };
}

export async function getProjectedEntity(
  connection: DuckDbConnection,
  entityId: string,
  publicationId?: string,
): Promise<ProjectedEntity | undefined> {
  const parameters: (string | number)[] = [parseKnowledgeEntityId(entityId)];
  const filters = ['e.entity_id = $1'];
  addPublicationScope(parameters, filters, 'e', publicationId);
  const rows = await connection.runAndReadAll(
    `SELECT ${entityColumns} FROM search_projected_entities e ${whereClause(filters)} ORDER BY e.publication_id LIMIT 1`,
    parameters,
  );
  const row = rows.getRowObjectsJson()[0];
  return row === undefined ? undefined : parseProjectedEntityRow(row);
}

export async function getProjectedRelationship(
  connection: DuckDbConnection,
  relationshipId: string,
  publicationId?: string,
): Promise<ProjectedRelationship | undefined> {
  const parameters: (string | number)[] = [
    parseKnowledgeRelationshipId(relationshipId),
  ];
  const filters = ['r.relationship_id = $1'];
  addPublicationScope(parameters, filters, 'r', publicationId);
  const rows = await connection.runAndReadAll(
    `SELECT ${relationshipColumns} FROM search_projected_relationships r ${whereClause(filters)} ORDER BY r.publication_id LIMIT 1`,
    parameters,
  );
  const row = rows.getRowObjectsJson()[0];
  return row === undefined ? undefined : parseProjectedRelationshipRow(row);
}

export async function getProjectionStatistics(
  connection: DuckDbConnection,
  publicationId: string,
): Promise<ProjectionStatistics | undefined> {
  const publication = await getKnowledgePublication(connection, publicationId);
  if (publication === undefined) {
    return undefined;
  }
  const runRows = await connection.runAndReadAll(
    `SELECT ${runColumns} FROM search_projection_runs WHERE publication_id = $1`,
    [publication.id],
  );
  const runRow = runRows.getRowObjectsJson()[0];
  const run =
    runRow === undefined ? undefined : projectionRunRowSchema.parse(runRow);
  const counts = await connection.runAndReadAll(
    'SELECT (SELECT count(*) FROM search_projected_entities WHERE publication_id = $1) AS entities, (SELECT count(*) FROM search_projected_relationships WHERE publication_id = $1) AS relationships, (SELECT count(*) FROM search_projected_documents WHERE publication_id = $1) AS documents',
    [publication.id],
  );
  const countRow = z
    .object({
      entities: z.coerce.number().int().nonnegative(),
      relationships: z.coerce.number().int().nonnegative(),
      documents: z.coerce.number().int().nonnegative(),
    })
    .parse(counts.getRowObjectsJson()[0]);
  const built =
    run !== undefined &&
    run.projection_schema_version === searchProjectionSchemaVersion;
  return {
    publication,
    projectionStatus: built ? 'built' : 'pending',
    projectionSchemaVersion: built ? searchProjectionSchemaVersion : null,
    projectionContentHash: built ? run.projection_content_hash : null,
    projectedEntityCount: countRow.entities,
    projectedRelationshipCount: countRow.relationships,
    projectedSearchDocumentCount: countRow.documents,
    builtAt: built ? normalizeTimestamp(run.built_at) : null,
  };
}

async function persistSearchProjection(
  connection: DuckDbConnection,
  publication: KnowledgePublication,
  partitionKey: string | undefined,
  correlationId: string,
): Promise<SearchProjectionSummary> {
  const projection = await loadAndBuildProjection(connection, publication);
  await connection.run('BEGIN TRANSACTION');
  try {
    const existingRows = await connection.runAndReadAll(
      `SELECT ${runColumns} FROM search_projection_runs WHERE publication_id = $1`,
      [publication.id],
    );
    const existingRow = existingRows.getRowObjectsJson()[0];
    const existing =
      existingRow === undefined
        ? undefined
        : projectionRunRowSchema.parse(existingRow);
    // Replaying an unchanged projection keeps its original build time so the
    // stored projection, including run metadata, is identical after replay.
    const builtAt =
      existing !== undefined &&
      existing.projection_content_hash === projection.contentHash &&
      existing.projection_schema_version === projection.schemaVersion
        ? normalizeTimestamp(existing.built_at)
        : new Date().toISOString();
    await deleteProjectionRows(connection, publication.id);
    await insertProjection(connection, projection, builtAt);
    const summary: SearchProjectionSummary = {
      publicationId: projection.publicationId,
      modelId: projection.modelId,
      publicationVersion: projection.publicationVersion,
      publicationContentHash: projection.publicationContentHash,
      projectionSchemaVersion: projection.schemaVersion,
      projectionContentHash: projection.contentHash,
      projectedEntityCount: projection.entities.length,
      projectedRelationshipCount: projection.relationships.length,
      projectedSearchDocumentCount: projection.documents.length,
      builtAt,
    };
    if (partitionKey !== undefined) {
      await insertProjectionOutboxEvent(
        connection,
        createProjectionEvent(
          'SearchProjectionBuilt',
          { projection: summary },
          partitionKey,
          correlationId,
          `search-projection-built:${projection.publicationId}:${projection.schemaVersion}:${projection.contentHash}`,
          builtAt,
        ),
      );
    }
    await connection.run('COMMIT');
    return summary;
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
}

async function loadAndBuildProjection(
  connection: DuckDbConnection,
  publication: KnowledgePublication,
): Promise<SearchProjection> {
  // Snapshots are selected strictly through the publication's version lists;
  // knowledge_entities/knowledge_relationships current rows are never read.
  const entityRows = await connection.runAndReadAll(
    "SELECT v.id, CAST(v.snapshot_json AS VARCHAR) AS snapshot_json FROM entity_versions v WHERE v.id IN (SELECT unnest(CAST(json_extract(p.entity_version_ids_json, '$') AS VARCHAR[])) FROM knowledge_publications p WHERE p.id = $1) ORDER BY v.id",
    [publication.id],
  );
  const relationshipRows = await connection.runAndReadAll(
    "SELECT v.id, CAST(v.snapshot_json AS VARCHAR) AS snapshot_json FROM relationship_versions v WHERE v.id IN (SELECT unnest(CAST(json_extract(p.relationship_version_ids_json, '$') AS VARCHAR[])) FROM knowledge_publications p WHERE p.id = $1) ORDER BY v.id",
    [publication.id],
  );
  return buildSearchProjection(
    publication,
    entityRows.getRowObjectsJson().map((row) => ({
      versionId: parseEntityVersionId(idSchema.parse(row.id)),
      snapshot: parseEntitySnapshotJson(row.snapshot_json),
    })),
    relationshipRows.getRowObjectsJson().map((row) => ({
      versionId: parseRelationshipVersionId(idSchema.parse(row.id)),
      snapshot: parseRelationshipSnapshotJson(row.snapshot_json),
    })),
  );
}

async function deleteProjectionRows(
  connection: DuckDbConnection,
  publicationId: string,
): Promise<void> {
  for (const table of [
    'search_projected_terms',
    'search_projected_documents',
    'search_projected_relationships',
    'search_projected_entities',
    'search_projection_runs',
  ]) {
    await connection.run(`DELETE FROM ${table} WHERE publication_id = $1`, [
      publicationId,
    ]);
  }
}

async function purgeOrphanedProjections(
  connection: DuckDbConnection,
): Promise<void> {
  await connection.run('BEGIN TRANSACTION');
  try {
    for (const table of [
      'search_projected_terms',
      'search_projected_documents',
      'search_projected_relationships',
      'search_projected_entities',
      'search_projection_runs',
    ]) {
      await connection.run(
        `DELETE FROM ${table} WHERE publication_id NOT IN (SELECT id FROM knowledge_publications)`,
      );
    }
    await connection.run('COMMIT');
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
}

async function insertProjection(
  connection: DuckDbConnection,
  projection: SearchProjection,
  builtAt: string,
): Promise<void> {
  await insertRows(
    connection,
    'search_projected_entities (publication_id, entity_id, knowledge_model_id, entity_type, name, name_normalized, lifecycle_status, source_evidence_json, relationship_count, published_at)',
    projection.entities.map((entity) => [
      entity.publicationId,
      entity.entityId,
      entity.modelId,
      entity.type,
      entity.name,
      normalizeSearchText(entity.name),
      entity.lifecycleStatus,
      JSON.stringify(entity.sourceEvidenceIds),
      entity.relationshipCount,
      entity.publishedAt,
    ]),
  );
  await insertRows(
    connection,
    'search_projected_relationships (publication_id, relationship_id, knowledge_model_id, relationship_type, type_normalized, source_entity_id, target_entity_id, lifecycle_status, source_evidence_json, published_at)',
    projection.relationships.map((relationship) => [
      relationship.publicationId,
      relationship.relationshipId,
      relationship.modelId,
      relationship.type,
      normalizeSearchText(relationship.type),
      relationship.sourceEntityId,
      relationship.targetEntityId,
      relationship.lifecycleStatus,
      JSON.stringify(relationship.sourceEvidenceIds),
      relationship.publishedAt,
    ]),
  );
  const documents = projection.documents.map((document) => {
    const [subjectKind, subjectId] = splitDocumentId(document.documentId);
    return { document, subjectKind, subjectId };
  });
  await insertRows(
    connection,
    'search_projected_documents (publication_id, document_id, subject_kind, subject_id, searchable_text, searchable_terms_json, published_at)',
    documents.map(({ document, subjectKind, subjectId }) => [
      document.publicationId,
      document.documentId,
      subjectKind,
      subjectId,
      document.searchableText,
      JSON.stringify(document.searchableTerms),
      document.publishedAt,
    ]),
  );
  await insertRows(
    connection,
    'search_projected_terms (publication_id, document_id, subject_kind, subject_id, term)',
    documents.flatMap(({ document, subjectKind, subjectId }) =>
      document.searchableTerms.map((term) => [
        document.publicationId,
        document.documentId,
        subjectKind,
        subjectId,
        term,
      ]),
    ),
  );
  await connection.run(
    'INSERT INTO search_projection_runs (publication_id, knowledge_model_id, publication_version, publication_content_hash, projection_schema_version, projection_content_hash, entity_count, relationship_count, document_count, built_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [
      projection.publicationId,
      projection.modelId,
      projection.publicationVersion,
      projection.publicationContentHash,
      projection.schemaVersion,
      projection.contentHash,
      projection.entities.length,
      projection.relationships.length,
      projection.documents.length,
      builtAt,
    ],
  );
}

async function insertRows(
  connection: DuckDbConnection,
  target: string,
  rows: readonly (readonly (string | number)[])[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += insertChunkSize) {
    const chunk = rows.slice(start, start + insertChunkSize);
    const parameters: (string | number)[] = [];
    const values = chunk.map((row) => {
      const placeholders = row.map((value) => {
        parameters.push(value);
        return `$${parameters.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await connection.run(
      `INSERT INTO ${target} VALUES ${values.join(', ')}`,
      parameters,
    );
  }
}

function splitDocumentId(
  documentId: string,
): ['entity' | 'relationship', string] {
  const separator = documentId.indexOf(':');
  const kind = documentId.slice(0, separator);
  const subjectId = documentId.slice(separator + 1);
  if (
    (kind !== 'entity' && kind !== 'relationship') ||
    !idSchema.safeParse(subjectId).success
  ) {
    throw new Error(`Invalid projected search document ID ${documentId}`);
  }
  return [kind, subjectId];
}

function addPublicationScope(
  parameters: (string | number)[],
  filters: string[],
  alias: 'e' | 'r',
  publicationId: string | undefined,
): void {
  if (publicationId === undefined) {
    filters.push(`${alias}.publication_id IN (${currentPublicationIds})`);
    return;
  }
  parameters.push(parseKnowledgePublicationId(publicationId));
  filters.push(`${alias}.publication_id = $${parameters.length}`);
}

function matchExpression(
  column: string,
  match: (typeof searchMatchModes)[number],
  placeholder: string,
): string {
  switch (match) {
    case 'exact':
      return `${column} = ${placeholder}`;
    case 'prefix':
      return `starts_with(${column}, ${placeholder})`;
    case 'contains':
      return `contains(${column}, ${placeholder})`;
  }
}

function textMatchExpression(
  subjectKind: 'entity' | 'relationship',
  publicationColumn: string,
  subjectColumn: string,
  match: (typeof searchMatchModes)[number],
  placeholder: string,
): string {
  // contains matches the whole searchable text; prefix and exact match
  // individual searchable terms so "exact" never depends on word order.
  if (match === 'contains') {
    return `EXISTS (SELECT 1 FROM search_projected_documents d WHERE d.publication_id = ${publicationColumn} AND d.subject_kind = '${subjectKind}' AND d.subject_id = ${subjectColumn} AND contains(d.searchable_text, ${placeholder}))`;
  }
  return `EXISTS (SELECT 1 FROM search_projected_terms t WHERE t.publication_id = ${publicationColumn} AND t.subject_kind = '${subjectKind}' AND t.subject_id = ${subjectColumn} AND ${matchExpression('t.term', match, placeholder)})`;
}

function parseTextFilter<Field extends string>(
  filter: {
    readonly query: string;
    readonly match: string;
    readonly field: string;
  },
  fields: readonly Field[],
): {
  readonly query: string;
  readonly match: (typeof searchMatchModes)[number];
  readonly field: Field;
} {
  const query = normalizeSearchText(filter.query);
  if (query.length === 0 || query.length > maxQueryLength) {
    throw new Error(
      `Search query must contain between 1 and ${maxQueryLength} characters`,
    );
  }
  return {
    query,
    match: requireValue(searchMatchModes, filter.match, 'search match mode'),
    field: requireValue(fields, filter.field, 'search field'),
  };
}

function requireValue<T extends string>(
  allowed: readonly T[],
  value: string,
  label: string,
): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new Error(`Unknown ${label}`);
  }
  return found;
}

function parseProjectedEntityRow(row: unknown): ProjectedEntity {
  const parsed = projectedEntityRowSchema.parse(row);
  return {
    entityId: parseKnowledgeEntityId(parsed.entity_id),
    modelId: parseKnowledgeModelId(parsed.knowledge_model_id),
    publicationId: parseKnowledgePublicationId(parsed.publication_id),
    type: parsed.entity_type,
    name: parsed.name,
    lifecycleStatus: parsed.lifecycle_status,
    sourceEvidenceIds: parseEvidenceIds(parsed.source_evidence_json),
    relationshipCount: parsed.relationship_count,
    publishedAt: normalizeTimestamp(parsed.published_at),
  };
}

function parseProjectedRelationshipRow(row: unknown): ProjectedRelationship {
  const parsed = projectedRelationshipRowSchema.parse(row);
  return {
    relationshipId: parseKnowledgeRelationshipId(parsed.relationship_id),
    modelId: parseKnowledgeModelId(parsed.knowledge_model_id),
    publicationId: parseKnowledgePublicationId(parsed.publication_id),
    type: parsed.relationship_type,
    sourceEntityId: parseKnowledgeEntityId(parsed.source_entity_id),
    targetEntityId: parseKnowledgeEntityId(parsed.target_entity_id),
    lifecycleStatus: parsed.lifecycle_status,
    sourceEvidenceIds: parseEvidenceIds(parsed.source_evidence_json),
    publishedAt: normalizeTimestamp(parsed.published_at),
  };
}

function parseEvidenceIds(value: string): ProjectedEntity['sourceEvidenceIds'] {
  return z
    .array(idSchema)
    .parse(JSON.parse(value) as unknown)
    .map(parseEvidenceId);
}

async function publicationPartitionKey(
  connection: DuckDbConnection,
  publication: KnowledgePublication,
): Promise<string | undefined> {
  const rows = await connection.runAndReadAll(
    'SELECT source_id FROM discovery_outbox WHERE idempotency_key = $1',
    [
      `knowledge-model-published:${publication.knowledgeModelId}:${publication.version}`,
    ],
  );
  const sourceId = rows.getRowObjectsJson()[0]?.source_id;
  return typeof sourceId === 'string' ? sourceId : undefined;
}

function createProjectionEvent(
  eventType: 'SearchProjectionRequested' | 'SearchProjectionBuilt',
  payload: object,
  partitionKey: string,
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
    partitionKey,
    payload,
  } as DiscoveryEvent;
}

async function insertProjectionOutboxEvent(
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

function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error('DuckDB returned an invalid search projection timestamp');
  }
  return date.toISOString();
}

function validateLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 101) {
    throw new Error('Search projection page limit must be between 1 and 101');
  }
  return limit;
}

function whereClause(filters: readonly string[]): string {
  return filters.length === 0 ? '' : `WHERE ${filters.join(' AND ')}`;
}
