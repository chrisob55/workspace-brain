import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { parseWorkspaceBrainConfig } from '@workspace-brain/configuration';
import { createDuckDbCatalogue } from '@workspace-brain/duckdb';
import { connectNatsDiscoveryBus } from '@workspace-brain/nats';
import pino from 'pino';

import { createApiServer } from './server.js';
import { startWorkspaceBrainApi } from './startup.js';

const cataloguePath =
  process.env.CATALOGUE_PATH ?? './data/workspace-brain.duckdb';
const configurationPath =
  process.env.CONFIG_PATH ??
  resolve(process.cwd(), 'config/workspace-brain.yaml');
const migrationsDirectory =
  process.env.DUCKDB_MIGRATIONS_DIR ??
  resolve(process.cwd(), 'infrastructure/duckdb/migrations');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const natsServers = process.env.NATS_SERVERS ?? 'nats://nats:4222';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});

const api = await startWorkspaceBrainApi({
  async openCatalogue() {
    await mkdir(dirname(resolve(cataloguePath)), { recursive: true });
    return createDuckDbCatalogue(cataloguePath, migrationsDirectory);
  },
  async loadConfiguration() {
    return parseWorkspaceBrainConfig(await readFile(configurationPath, 'utf8'));
  },
  connectBus: () => connectNatsDiscoveryBus(natsServers, logger),
  createServer: (catalogue) => createApiServer(catalogue),
  logger,
  host,
  port,
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void (async () => {
      try {
        await api.close();
      } catch (error) {
        api.server.log.error({ err: error, signal }, 'API shutdown failed');
        process.exitCode = 1;
      }
    })();
  });
}
