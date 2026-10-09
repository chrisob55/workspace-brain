import { z } from 'zod';
import { basename } from 'node:path';
import type { KnowledgeExtractionContext } from '@workspace-brain/domain';
import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
import type { DuckDbConnection } from './index.js';

const id = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const repositoryBoundarySchema = z
  .object({
    id,
    path: z.string().min(1),
    fingerprint,
    name: z.string().min(1).optional(),
  })
  .strict();
export const extractionDocumentSchema = z
  .object({
    id,
    path: z.string().min(1),
    fingerprint,
    filename: z.string().min(1),
  })
  .strict();
export const extractionContextSchema = z
  .object({
    repositories: z.array(repositoryBoundarySchema),
    documents: z.array(extractionDocumentSchema),
  })
  .strict();

export async function snapshotExtractionContext(
  connection: DuckDbConnection,
  versionId: string,
  sourceId: string,
  documentPath: string,
): Promise<void> {
  const root = documentPath.split('/')[0];
  const sourceRows = await connection.runAndReadAll(
    'SELECT CAST(config_json AS VARCHAR) AS config_json FROM sources WHERE id = $1',
    [sourceId],
  );
  const source = sourceRows.getRowObjectsJson()[0];
  if (source === undefined)
    throw new CatalogueIntegrityError('Extraction source is missing');
  const configuration = z
    .object({
      roots: z.array(
        z.object({
          id: z.string(),
          absolutePath: z.string(),
        }),
      ),
    })
    .passthrough()
    .parse(JSON.parse(z.string().parse(source.config_json)) as unknown);
  const registeredRoot = configuration.roots.find((item) => item.id === root);
  if (!registeredRoot)
    throw new CatalogueIntegrityError('Extraction source root is missing');
  const repositoryRows = await connection.runAndReadAll(
    "SELECT r.id, r.path, i.fingerprint FROM repositories r JOIN inventory_records i ON i.source_id = r.source_id AND i.path = r.path AND i.asset_type = 'repository' AND i.is_present = true WHERE r.source_id = $1 ORDER BY r.path",
    [sourceId],
  );
  const documentRows = await connection.runAndReadAll(
    "SELECT d.id, d.path, d.filename, i.fingerprint FROM documents d JOIN inventory_records i ON i.source_id = d.source_id AND i.path = d.path AND i.asset_type = 'document' AND i.is_present = true WHERE d.source_id = $1 ORDER BY d.path",
    [sourceId],
  );
  const context = extractionContextSchema.parse({
    repositories: repositoryRows
      .getRowObjectsJson()
      .filter((row) => String(row.path).split('/')[0] === root)
      .map((row) => ({
        ...row,
        name:
          String(row.path) === root
            ? basename(registeredRoot.absolutePath)
            : basename(String(row.path)),
      })),
    documents: documentRows
      .getRowObjectsJson()
      .filter((row) => String(row.path).split('/')[0] === root),
  });
  await connection.run(
    'INSERT INTO document_extraction_contexts (document_version_id, context_json) VALUES ($1, $2)',
    [versionId, JSON.stringify(context)],
  );
}

export async function getExtractionContext(
  connection: DuckDbConnection,
  versionId: string,
): Promise<KnowledgeExtractionContext | undefined> {
  const rows = await connection.runAndReadAll(
    'SELECT CAST(context_json AS VARCHAR) AS context_json FROM document_extraction_contexts WHERE document_version_id = $1',
    [versionId],
  );
  const row = rows.getRowObjectsJson()[0];
  if (row === undefined) return undefined;
  const result = extractionContextSchema.safeParse(
    JSON.parse(z.string().parse(row.context_json)) as unknown,
  );
  if (!result.success)
    throw new CatalogueIntegrityError('Invalid immutable extraction context');
  return {
    repositories: result.data.repositories.map(({ name, ...repository }) => ({
      ...repository,
      ...(name === undefined ? {} : { name }),
    })),
    documents: result.data.documents,
  };
}
