import { randomUUID } from 'node:crypto';

import pino from 'pino';

import {
  parseDiscoveryInventoryConfig,
  parseRuntimeObservabilityConfig,
} from '@workspace-brain/configuration';
import { FilesystemSourceScanner } from '@workspace-brain/filesystem';
import {
  connectNatsDiscoveryBus,
  createHeartbeatPublisher,
} from '@workspace-brain/nats';

import { NatsEventConsumer } from './event-consumer.js';
import { createIngestionWorker } from './worker.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
});
const natsServers = process.env.NATS_SERVERS ?? 'nats://nats:4222';
const runtimeObservability = parseRuntimeObservabilityConfig();
const discoveryInventoryConfig = parseDiscoveryInventoryConfig();
const scanIntervalMilliseconds = Number(
  process.env.SCAN_INTERVAL_MS ?? 300_000,
);
const bus = await connectNatsDiscoveryBus(natsServers, logger);
const heartbeatPublisher = runtimeObservability.heartbeatEnabled
  ? createHeartbeatPublisher({
      nats: bus,
      componentId: 'ingestion-worker',
      componentName: 'Ingestion Worker',
      componentType: 'worker',
      instanceId:
        runtimeObservability.instanceId ?? `ingestion-worker-${randomUUID()}`,
      version:
        process.env.WORKSPACE_BRAIN_VERSION ??
        process.env.npm_package_version ??
        '0.1.0',
      intervalMs: runtimeObservability.heartbeatIntervalMs,
      logger,
    })
  : undefined;
const worker = createIngestionWorker(
  new NatsEventConsumer(
    new FilesystemSourceScanner(),
    bus,
    logger,
    scanIntervalMilliseconds,
    discoveryInventoryConfig,
  ),
);

try {
  await heartbeatPublisher?.start();
  await worker.start();
} catch (error) {
  await heartbeatPublisher?.stop();
  await worker.stop();
  throw error;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      try {
        await heartbeatPublisher?.stop();
        await worker.stop();
        logger.info({ signal }, 'Ingestion worker stopped');
      } catch (error) {
        logger.error(
          { err: error, signal },
          'Ingestion worker shutdown failed',
        );
        process.exitCode = 1;
      }
    })();
  });
}
