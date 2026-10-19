import { randomUUID } from 'node:crypto';

import pino from 'pino';

import { parseRuntimeObservabilityConfig } from '@workspace-brain/configuration';
import {
  connectNatsDiscoveryBus,
  createHeartbeatPublisher,
} from '@workspace-brain/nats';

import { createKnowledgeWorker } from './worker.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
});
const natsServers = process.env.NATS_SERVERS ?? 'nats://nats:4222';
const runtimeObservability = parseRuntimeObservabilityConfig();
const bus = await connectNatsDiscoveryBus(natsServers, logger);
const heartbeatPublisher = runtimeObservability.heartbeatEnabled
  ? createHeartbeatPublisher({
      nats: bus,
      componentId: 'knowledge-worker',
      componentName: 'Knowledge Worker',
      componentType: 'worker',
      instanceId:
        runtimeObservability.instanceId ?? `knowledge-worker-${randomUUID()}`,
      version:
        process.env.WORKSPACE_BRAIN_VERSION ??
        process.env.npm_package_version ??
        '0.1.0',
      intervalMs: runtimeObservability.heartbeatIntervalMs,
      logger,
    })
  : undefined;
const worker = createKnowledgeWorker(bus, logger);

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
        logger.info({ signal }, 'Knowledge worker stopped');
      } catch (error) {
        logger.error(
          { err: error, signal },
          'Knowledge worker shutdown failed',
        );
        process.exitCode = 1;
      }
    })();
  });
}
