import {
  CatalogueIntegrityError,
  type CataloguePage,
  type PublicationComparisonPageRequest,
} from '@workspace-brain/catalogue';
import {
  knowledgeRelationshipTypes,
  knowledgeEntityTypes,
  parseEntityVersionId,
  parseKnowledgeEntityId,
  parseKnowledgeModelId,
  parseKnowledgePublicationId,
  parseKnowledgeRelationshipId,
  parseRelationshipVersionId,
} from '@workspace-brain/domain';
import {
  changeTypes,
  entityContentFields,
  parsePublicationDiffId,
  publicationDiffSchemaVersion,
  relationshipContentFields,
  type ChangeSummary,
  type EntityChange,
  type KnowledgeVersionReference,
  type PublicationComparison,
  type PublicationDiff,
  type RelationshipChange,
} from '@workspace-brain/domain-evolution';
import { z } from 'zod';

import type { DuckDbConnection } from './index.js';

/*
 * Storage for derived Publication Diffs (Slice 6). These functions read and
 * write only the publication_diff* tables; publications, entity versions,
 * relationship versions and search projections are never touched.
 */

const idSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const countSchema = z.coerce.number().int().nonnegative();
const versionSchema = z.coerce.number().int().positive();
const entityTypes = knowledgeEntityTypes;
const insertChunkSize = 200;

const diffRowSchema = z.object({
  id: idSchema,
  schema_version: z.coerce.number().int(),
  knowledge_model_id: idSchema,
  from_publication_id: idSchema,
  from_publication_version: versionSchema,
  from_publication_content_hash: hashSchema,
  to_publication_id: idSchema,
  to_publication_version: versionSchema,
  to_publication_content_hash: hashSchema,
  content_hash: hashSchema,
  entities_added: countSchema,
  entities_removed: countSchema,
  entities_modified: countSchema,
  entities_unchanged: countSchema,
  relationships_added: countSchema,
  relationships_removed: countSchema,
  relationships_modified: countSchema,
  relationships_unchanged: countSchema,
  generated_at: z.string(),
});

const versionColumnsSchema = {
  from_version_id: idSchema.nullable(),
  from_version_number: versionSchema.nullable(),
  from_content_hash: hashSchema.nullable(),
  to_version_id: idSchema.nullable(),
  to_version_number: versionSchema.nullable(),
  to_content_hash: hashSchema.nullable(),
  changed_fields_json: z.string(),
};

const entityChangeRowSchema = z.object({
  entity_id: idSchema,
  change_type: z.enum(changeTypes),
  entity_type: z.enum(entityTypes),
  name: z.string(),
  ...versionColumnsSchema,
});

const relationshipChangeRowSchema = z.object({
  relationship_id: idSchema,
  change_type: z.enum(changeTypes),
  relationship_type: z.enum(knowledgeRelationshipTypes),
  source_entity_id: idSchema,
  target_entity_id: idSchema,
  ...versionColumnsSchema,
});

const diffColumns =
  "id, schema_version, knowledge_model_id, from_publication_id, from_publication_version, from_publication_content_hash, to_publication_id, to_publication_version, to_publication_content_hash, content_hash, entities_added, entities_removed, entities_modified, entities_unchanged, relationships_added, relationships_removed, relationships_modified, relationships_unchanged, strftime(generated_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS generated_at";
const versionColumns =
  'from_version_id, from_version_number, from_content_hash, to_version_id, to_version_number, to_content_hash, CAST(changed_fields_json AS VARCHAR) AS changed_fields_json';

export async function findPublicationDiff(
  connection: DuckDbConnection,
  fromPublicationId: string,
  toPublicationId: string,
): Promise<PublicationDiff | undefined> {
  const rows = await connection.runAndReadAll(
    `SELECT ${diffColumns} FROM publication_diffs WHERE from_publication_id = $1 AND to_publication_id = $2`,
    [
      parseKnowledgePublicationId(fromPublicationId),
      parseKnowledgePublicationId(toPublicationId),
    ],
  );
  const row = rows.getRowObjectsJson()[0];
  return row === undefined ? undefined : loadDiff(connection, row);
}

export async function getPublicationDiff(
  connection: DuckDbConnection,
  diffId: string,
): Promise<PublicationDiff | undefined> {
  const rows = await connection.runAndReadAll(
    `SELECT ${diffColumns} FROM publication_diffs WHERE id = $1`,
    [parsePublicationDiffId(diffId)],
  );
  const row = rows.getRowObjectsJson()[0];
  return row === undefined ? undefined : loadDiff(connection, row);
}

export async function listPublicationComparisons(
  connection: DuckDbConnection,
  request: PublicationComparisonPageRequest,
): Promise<CataloguePage<PublicationComparison>> {
  const publicationId = parseKnowledgePublicationId(request.publicationId);
  if (
    !Number.isInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > 101
  ) {
    throw new Error(
      'Publication comparison page limit must be between 1 and 101',
    );
  }
  const parameters: (string | number)[] = [publicationId];
  let afterFilter = '';
  if (request.afterId !== undefined) {
    parameters.push(parsePublicationDiffId(request.afterId));
    afterFilter = ` AND id > $${parameters.length}`;
  }
  parameters.push(request.limit);
  const rows = await connection.runAndReadAll(
    `SELECT ${diffColumns} FROM publication_diffs WHERE (from_publication_id = $1 OR to_publication_id = $1)${afterFilter} ORDER BY id LIMIT $${parameters.length}`,
    parameters,
  );
  try {
    return { items: rows.getRowObjectsJson().map(parseComparisonRow) };
  } catch (error) {
    throw new CatalogueIntegrityError(
      `Stored publication diff is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Persists a diff for its ordered publication pair in one transaction. An
 * existing diff with the same content hash is kept (stable ID and generation
 * time) when it is still readable and the caller has not identified it as
 * invalid; otherwise it is replaced.
 */
export async function savePublicationDiff(
  connection: DuckDbConnection,
  diff: PublicationDiff,
  invalidDiffId?: string,
): Promise<PublicationDiff> {
  let savedId: string = diff.id;
  await connection.run('BEGIN TRANSACTION');
  try {
    const existingRows = await connection.runAndReadAll(
      'SELECT id, content_hash FROM publication_diffs WHERE from_publication_id = $1 AND to_publication_id = $2',
      [diff.fromPublicationId, diff.toPublicationId],
    );
    const existing = existingRows.getRowObjectsJson()[0];
    // The raw stored ID is used so that a malformed (non-ULID) row can still
    // be replaced; only a valid, readable row is ever reused.
    const existingId =
      existing === undefined ? undefined : z.string().parse(existing.id);
    const reusable =
      existingId !== undefined &&
      existing?.content_hash === diff.contentHash &&
      existingId !== invalidDiffId &&
      idSchema.safeParse(existingId).success &&
      (await isReadable(connection, existingId));
    if (existingId !== undefined && reusable) {
      savedId = existingId;
    } else {
      if (existingId !== undefined) {
        await deleteDiffRows(connection, existingId);
      }
      await insertDiff(connection, diff);
    }
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
  await connection.run('COMMIT');
  const stored = await getPublicationDiff(connection, savedId);
  if (stored === undefined) {
    throw new Error('Saved publication diff could not be read back');
  }
  return stored;
}

async function isReadable(
  connection: DuckDbConnection,
  diffId: string,
): Promise<boolean> {
  try {
    return (await getPublicationDiff(connection, diffId)) !== undefined;
  } catch (error) {
    if (error instanceof CatalogueIntegrityError) {
      return false;
    }
    throw error;
  }
}

async function deleteDiffRows(
  connection: DuckDbConnection,
  diffId: string,
): Promise<void> {
  await connection.run(
    'DELETE FROM publication_diff_entity_changes WHERE diff_id = $1',
    [diffId],
  );
  await connection.run(
    'DELETE FROM publication_diff_relationship_changes WHERE diff_id = $1',
    [diffId],
  );
  await connection.run('DELETE FROM publication_diffs WHERE id = $1', [diffId]);
}

async function insertDiff(
  connection: DuckDbConnection,
  diff: PublicationDiff,
): Promise<void> {
  const { summary } = diff;
  await insertRows(connection, 'publication_diffs', [
    [
      diff.id,
      diff.schemaVersion,
      diff.knowledgeModelId,
      diff.fromPublicationId,
      diff.fromPublicationVersion,
      diff.fromPublicationContentHash,
      diff.toPublicationId,
      diff.toPublicationVersion,
      diff.toPublicationContentHash,
      diff.contentHash,
      summary.entitiesAdded,
      summary.entitiesRemoved,
      summary.entitiesModified,
      summary.entitiesUnchanged,
      summary.relationshipsAdded,
      summary.relationshipsRemoved,
      summary.relationshipsModified,
      summary.relationshipsUnchanged,
      diff.generatedAt,
    ],
  ]);
  await insertRows(
    connection,
    'publication_diff_entity_changes',
    diff.entityChanges.map((change) => [
      diff.id,
      change.entityId,
      change.changeType,
      change.entityType,
      change.name,
      ...versionValues(change.from),
      ...versionValues(change.to),
      JSON.stringify(change.changedFields),
    ]),
  );
  await insertRows(
    connection,
    'publication_diff_relationship_changes',
    diff.relationshipChanges.map((change) => [
      diff.id,
      change.relationshipId,
      change.changeType,
      change.relationshipType,
      change.sourceEntityId,
      change.targetEntityId,
      ...versionValues(change.from),
      ...versionValues(change.to),
      JSON.stringify(change.changedFields),
    ]),
  );
}

function versionValues(
  reference: KnowledgeVersionReference<string> | null,
): (string | number | null)[] {
  return reference === null
    ? [null, null, null]
    : [reference.versionId, reference.versionNumber, reference.contentHash];
}

async function loadDiff(
  connection: DuckDbConnection,
  row: unknown,
): Promise<PublicationDiff> {
  try {
    return await readDiff(connection, row);
  } catch (error) {
    throw new CatalogueIntegrityError(
      `Stored publication diff is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readDiff(
  connection: DuckDbConnection,
  row: unknown,
): Promise<PublicationDiff> {
  const comparison = parseComparisonRow(row);
  const entityRows = await connection.runAndReadAll(
    `SELECT entity_id, change_type, entity_type, name, ${versionColumns} FROM publication_diff_entity_changes WHERE diff_id = $1 ORDER BY entity_id`,
    [comparison.id],
  );
  const relationshipRows = await connection.runAndReadAll(
    `SELECT relationship_id, change_type, relationship_type, source_entity_id, target_entity_id, ${versionColumns} FROM publication_diff_relationship_changes WHERE diff_id = $1 ORDER BY relationship_id`,
    [comparison.id],
  );
  return {
    ...comparison,
    entityChanges: entityRows.getRowObjectsJson().map(parseEntityChangeRow),
    relationshipChanges: relationshipRows
      .getRowObjectsJson()
      .map(parseRelationshipChangeRow),
  };
}

function parseComparisonRow(row: unknown): PublicationComparison {
  const parsed = diffRowSchema.parse(row);
  if (parsed.schema_version !== publicationDiffSchemaVersion) {
    throw new Error(
      `Unsupported publication diff schema version ${parsed.schema_version}`,
    );
  }
  const summary: ChangeSummary = {
    entitiesAdded: parsed.entities_added,
    entitiesRemoved: parsed.entities_removed,
    entitiesModified: parsed.entities_modified,
    entitiesUnchanged: parsed.entities_unchanged,
    relationshipsAdded: parsed.relationships_added,
    relationshipsRemoved: parsed.relationships_removed,
    relationshipsModified: parsed.relationships_modified,
    relationshipsUnchanged: parsed.relationships_unchanged,
  };
  return {
    id: parsePublicationDiffId(parsed.id),
    schemaVersion: publicationDiffSchemaVersion,
    knowledgeModelId: parseKnowledgeModelId(parsed.knowledge_model_id),
    fromPublicationId: parseKnowledgePublicationId(parsed.from_publication_id),
    fromPublicationVersion: parsed.from_publication_version,
    fromPublicationContentHash: parsed.from_publication_content_hash,
    toPublicationId: parseKnowledgePublicationId(parsed.to_publication_id),
    toPublicationVersion: parsed.to_publication_version,
    toPublicationContentHash: parsed.to_publication_content_hash,
    contentHash: parsed.content_hash,
    generatedAt: normalizeTimestamp(parsed.generated_at),
    summary,
  };
}

function parseEntityChangeRow(row: unknown): EntityChange {
  const parsed = entityChangeRowSchema.parse(row);
  return {
    changeType: parsed.change_type,
    entityId: parseKnowledgeEntityId(parsed.entity_id),
    entityType: parsed.entity_type,
    name: parsed.name,
    from: parseVersionReference(
      parsed.from_version_id,
      parsed.from_version_number,
      parsed.from_content_hash,
      parseEntityVersionId,
    ),
    to: parseVersionReference(
      parsed.to_version_id,
      parsed.to_version_number,
      parsed.to_content_hash,
      parseEntityVersionId,
    ),
    changedFields: parseChangedFields(
      parsed.changed_fields_json,
      entityContentFields,
    ),
  };
}

function parseRelationshipChangeRow(row: unknown): RelationshipChange {
  const parsed = relationshipChangeRowSchema.parse(row);
  return {
    changeType: parsed.change_type,
    relationshipId: parseKnowledgeRelationshipId(parsed.relationship_id),
    relationshipType: parsed.relationship_type,
    sourceEntityId: parseKnowledgeEntityId(parsed.source_entity_id),
    targetEntityId: parseKnowledgeEntityId(parsed.target_entity_id),
    from: parseVersionReference(
      parsed.from_version_id,
      parsed.from_version_number,
      parsed.from_content_hash,
      parseRelationshipVersionId,
    ),
    to: parseVersionReference(
      parsed.to_version_id,
      parsed.to_version_number,
      parsed.to_content_hash,
      parseRelationshipVersionId,
    ),
    changedFields: parseChangedFields(
      parsed.changed_fields_json,
      relationshipContentFields,
    ),
  };
}

function parseVersionReference<VersionId extends string>(
  versionId: string | null,
  versionNumber: number | null,
  contentHash: string | null,
  parseVersionId: (value: string) => VersionId,
): KnowledgeVersionReference<VersionId> | null {
  if (versionId === null && versionNumber === null && contentHash === null) {
    return null;
  }
  if (versionId === null || versionNumber === null || contentHash === null) {
    throw new Error('Publication diff contains a partial version reference');
  }
  return {
    versionId: parseVersionId(versionId),
    versionNumber,
    contentHash,
  };
}

function parseChangedFields<Field extends string>(
  value: string,
  fields: readonly [Field, ...Field[]],
): Field[] {
  return z.array(z.enum(fields)).parse(JSON.parse(value));
}

async function insertRows(
  connection: DuckDbConnection,
  target: string,
  rows: readonly (readonly (string | number | null)[])[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += insertChunkSize) {
    const chunk = rows.slice(start, start + insertChunkSize);
    const parameters: (string | number | null)[] = [];
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

function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error('DuckDB returned an invalid publication diff timestamp');
  }
  return date.toISOString();
}
