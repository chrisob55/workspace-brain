import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
import {
  parseDocumentId,
  parseDocumentVersionId,
  type DocumentId,
  type DocumentVersionId,
} from '@workspace-brain/domain';
import type {
  CatalogueDocumentVersion,
  DocumentCurrentVersionState,
  PublicationCurrencyInputs,
} from '@workspace-brain/domain-currency';
import { z } from 'zod';

import type { DuckDbConnection } from './index.js';
import { getPublicationSnapshot } from './knowledge.js';

/*
 * Read-only catalogue access for Publication Currency (Slice 7). These
 * functions only SELECT from publication, version, document and
 * current-version pointer tables. They never write, never consult the
 * filesystem and never use timestamps or identifier order as recency.
 */

const idSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const documentVersionRowSchema = z
  .object({
    id: idSchema,
    document_id: idSchema,
    content_hash: hashSchema,
  })
  .strict();

const currentVersionRowSchema = z
  .object({
    document_id: idSchema,
    document_present: z.boolean(),
    current_document_version_id: idSchema.nullable(),
    revision: z.coerce.number().int().positive().nullable(),
  })
  .strict();

/**
 * Loads one integrity-validated publication and the catalogue current-version
 * state of every document that supports it. Historical lineage defects raise
 * `CatalogueIntegrityError`; only the current-version state may be
 * unresolvable.
 */
export async function getPublicationCurrencyInputs(
  connection: DuckDbConnection,
  publicationId: string,
): Promise<PublicationCurrencyInputs | undefined> {
  await connection.run('BEGIN TRANSACTION');
  try {
    const inputs = await readPublicationCurrencyInputs(
      connection,
      publicationId,
    );
    await connection.run('COMMIT');
    return inputs;
  } catch (error) {
    try {
      await connection.run('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError(
        [error],
        'Publication currency read failed and its transaction could not be rolled back',
        { cause: rollbackError },
      );
    }
    throw error;
  }
}

async function readPublicationCurrencyInputs(
  connection: DuckDbConnection,
  publicationId: string,
): Promise<PublicationCurrencyInputs | undefined> {
  const snapshot = await getPublicationSnapshot(connection, publicationId);
  if (snapshot === undefined) {
    return undefined;
  }
  const { publication } = snapshot;
  const published = new Map<DocumentVersionId, DocumentId>();
  for (const { provenance } of [
    ...snapshot.entities.map(({ entity }) => entity),
    ...snapshot.relationships.map(({ relationship }) => relationship),
  ]) {
    for (const item of provenance) {
      const previous = published.get(item.documentVersionId);
      if (previous !== undefined && previous !== item.documentId) {
        throw new CatalogueIntegrityError(
          `Publication ${publication.id} has inconsistent document version lineage`,
        );
      }
      published.set(item.documentVersionId, item.documentId);
    }
  }
  const documentIds = sortedUnique([...published.values()]);
  const publishedVersionIds = sortedUnique([...published.keys()]);

  const publishedVersions = await loadDocumentVersions(
    connection,
    publishedVersionIds,
    (message) =>
      new CatalogueIntegrityError(`Publication ${publication.id} ${message}`),
  );
  for (const [versionId, documentId] of published) {
    const stored = publishedVersions.get(versionId);
    if (stored === undefined || stored.documentId !== documentId) {
      throw new CatalogueIntegrityError(
        `Publication ${publication.id} references missing or inconsistent document version lineage`,
      );
    }
  }

  const documents = await loadCurrentVersionStates(connection, documentIds);
  const pointerTargets = sortedUnique(
    documents.flatMap(({ currentDocumentVersionId }) =>
      currentDocumentVersionId === null ||
      publishedVersions.has(currentDocumentVersionId)
        ? []
        : [currentDocumentVersionId],
    ),
  );
  // Malformed pointer targets are current-version state, not historical
  // lineage, so they are omitted and later classified as unresolvable.
  const currentVersions = await loadDocumentVersions(
    connection,
    pointerTargets,
    () => undefined,
  );

  const documentVersions: CatalogueDocumentVersion[] = [
    ...publishedVersions.values(),
    ...currentVersions.values(),
  ];
  return {
    publication,
    entities: snapshot.entities,
    relationships: snapshot.relationships,
    documentVersions,
    documents,
  };
}

async function loadDocumentVersions(
  connection: DuckDbConnection,
  ids: readonly string[],
  onInvalid: (message: string) => Error | undefined,
): Promise<Map<DocumentVersionId, CatalogueDocumentVersion>> {
  const versions = new Map<DocumentVersionId, CatalogueDocumentVersion>();
  if (ids.length === 0) {
    return versions;
  }
  const rows = await connection.runAndReadAll(
    "SELECT id, document_id, content_hash FROM document_versions WHERE list_contains(CAST(json_extract($1, '$') AS VARCHAR[]), id)",
    [JSON.stringify(ids)],
  );
  for (const row of rows.getRowObjectsJson()) {
    const parsed = documentVersionRowSchema.safeParse(row);
    if (!parsed.success) {
      const error = onInvalid('has a malformed document version record');
      if (error !== undefined) {
        throw error;
      }
      continue;
    }
    const id = parseDocumentVersionId(parsed.data.id);
    versions.set(id, {
      id,
      documentId: parseDocumentId(parsed.data.document_id),
      contentHash: parsed.data.content_hash,
    });
  }
  return versions;
}

async function loadCurrentVersionStates(
  connection: DuckDbConnection,
  documentIds: readonly DocumentId[],
): Promise<DocumentCurrentVersionState[]> {
  if (documentIds.length === 0) {
    return [];
  }
  const rows = await connection.runAndReadAll(
    "WITH ids AS (SELECT unnest(CAST(json_extract($1, '$') AS VARCHAR[])) AS document_id) SELECT ids.document_id, d.id IS NOT NULL AS document_present, p.document_version_id AS current_document_version_id, p.revision FROM ids LEFT JOIN documents d ON d.id = ids.document_id LEFT JOIN document_current_versions p ON p.document_id = ids.document_id ORDER BY ids.document_id",
    [JSON.stringify(documentIds)],
  );
  const states = rows.getRowObjectsJson().map((row) => {
    const parsed = currentVersionRowSchema.safeParse(row);
    if (!parsed.success) {
      throw new CatalogueIntegrityError(
        'Catalogue current-version state is malformed',
      );
    }
    return {
      documentId: parseDocumentId(parsed.data.document_id),
      documentPresent: parsed.data.document_present,
      currentDocumentVersionId:
        parsed.data.current_document_version_id === null
          ? null
          : parseDocumentVersionId(parsed.data.current_document_version_id),
      revision: parsed.data.revision,
    };
  });
  if (states.length !== documentIds.length) {
    throw new CatalogueIntegrityError(
      'Catalogue current-version state is inconsistent',
    );
  }
  return states;
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}
