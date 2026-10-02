import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createDuckDbCatalogue } from '@workspace-brain/duckdb';

import { createApiServer } from './server.js';

const cataloguePath =
  process.env.CATALOGUE_PATH ?? './data/workspace-brain.duckdb';
const migrationsDirectory =
  process.env.DUCKDB_MIGRATIONS_DIR ??
  resolve(process.cwd(), 'infrastructure/duckdb/migrations');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

await mkdir(dirname(resolve(cataloguePath)), { recursive: true });
const catalogue = await createDuckDbCatalogue(
  cataloguePath,
  migrationsDirectory,
);
const server = createApiServer(catalogue);

try {
  await server.listen({ host, port });
  server.log.info({ port }, 'Workspace Brain API listening');
} catch (error) {
  await catalogue.close();
  throw error;
}

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void (async () => {
      try {
        await server.close();
      } catch (error) {
        server.log.error({ err: error, signal }, 'API server shutdown failed');
        process.exitCode = 1;
      }
      try {
        await catalogue.close();
      } catch (error) {
        server.log.error({ err: error, signal }, 'Catalogue shutdown failed');
        process.exitCode = 1;
      }
    })();
  });
}
