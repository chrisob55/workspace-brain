import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
import {
  createKnowledgePublicationPackage,
  KnowledgePublicationPackageIntegrityError,
} from '@workspace-brain/domain-publication';

import type { DuckDbConnection } from './index.js';
import { getPublicationSnapshot } from './knowledge.js';

/**
 * Loads and validates one immutable publication and packages it from the
 * selected membership and version snapshots in a single read transaction.
 */
export async function getKnowledgePublicationExport(
  connection: DuckDbConnection,
  publicationId: string,
) {
  await connection.run('BEGIN TRANSACTION');
  try {
    const snapshot = await getPublicationSnapshot(connection, publicationId);
    if (snapshot === undefined) {
      await connection.run('COMMIT');
      return undefined;
    }
    const publicationPackage = createKnowledgePublicationPackage(snapshot);
    await connection.run('COMMIT');
    return publicationPackage;
  } catch (error) {
    const failure =
      error instanceof KnowledgePublicationPackageIntegrityError
        ? new CatalogueIntegrityError(error.message)
        : error;
    try {
      await connection.run('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError(
        [failure],
        'Publication export failed and its transaction could not be rolled back',
        { cause: rollbackError },
      );
    }
    throw failure;
  }
}
