import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { parseWorkspaceBrainConfig } from '@workspace-brain/configuration';
import { createDuckDbCatalogue } from '@workspace-brain/duckdb';
import { connectNatsDiscoveryBus } from '@workspace-brain/nats';
import pino from 'pino';
import { z } from 'zod';

import {
  configForCatalogue,
  createDiscoveryService,
} from './discovery-service.js';
import { createApiServer } from './server.js';

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

const sourcePageSchema = z
  .object({
    afterId: z.string().optional(),
    limit: z.number().int().min(1).max(100),
  })
  .strict();

await mkdir(dirname(resolve(cataloguePath)), { recursive: true });
const catalogue = await createDuckDbCatalogue(
  cataloguePath,
  migrationsDirectory,
);
let server: ReturnType<typeof createApiServer> | undefined;
let bus: Awaited<ReturnType<typeof connectNatsDiscoveryBus>> | undefined;

try {
  const configuration = parseWorkspaceBrainConfig(
    await readFile(configurationPath, 'utf8'),
  );
  const registration = configForCatalogue(configuration);
  await catalogue.registerConfiguration(
    registration.sources,
    registration.workspaces,
  );

  const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
  });
  bus = await connectNatsDiscoveryBus(natsServers, logger);
  const discovery = createDiscoveryService(catalogue, bus);
  bus.subscribeRequests(
    'workspace.catalogue.discovery.sources',
    async (body) => {
      const request = sourcePageSchema.parse(body);
      return catalogue.listSourcesForDiscovery({
        ...(request.afterId === undefined ? {} : { afterId: request.afterId }),
        limit: request.limit,
      });
    },
  );
  for (const [subject, durableName] of [
    [
      'workspace.discovery.source.scan.started',
      'workspace-api-source-scan-started',
    ],
    [
      'workspace.discovery.source.inventory.submitted',
      'workspace-api-source-inventory-submitted',
    ],
    [
      'workspace.discovery.source.scan.failed',
      'workspace-api-source-scan-failed',
    ],
    [
      'workspace.discovery.document.processing.submitted',
      'workspace-api-document-processing-submitted',
    ],
  ] as const) {
    await bus.subscribe(subject, durableName, (event) =>
      discovery.handle(event),
    );
  }

  server = createApiServer(catalogue);
  await server.listen({ host, port });
  server.log.info({ port }, 'Workspace Brain API listening');
} catch (error) {
  const cleanupErrors: unknown[] = [];
  if (server !== undefined) {
    try {
      await server.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  if (bus !== undefined) {
    try {
      await bus.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  try {
    await catalogue.close();
  } catch (cleanupError) {
    cleanupErrors.push(cleanupError);
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [error, ...cleanupErrors],
      'API startup failed and cleanup was incomplete',
      { cause: error },
    );
  }
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
        await server?.close();
        await bus?.close();
        await catalogue.close();
      } catch (error) {
        server?.log.error({ err: error, signal }, 'API shutdown failed');
        process.exitCode = 1;
      }
    })();
  });
}
