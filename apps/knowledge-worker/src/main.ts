import pino from 'pino';

import { connectNatsDiscoveryBus } from '@workspace-brain/nats';

import { createKnowledgeWorker } from './worker.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const natsServers = process.env.NATS_SERVERS ?? 'nats://nats:4222';
const bus = await connectNatsDiscoveryBus(natsServers, logger);
const worker = createKnowledgeWorker(bus, logger);

try {
  await worker.start();
} catch (error) {
  await worker.stop();
  throw error;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void worker.stop().then(
      () => logger.info({ signal }, 'Knowledge worker stopped'),
      (error: unknown) => {
        logger.error(
          { err: error, signal },
          'Knowledge worker shutdown failed',
        );
        process.exitCode = 1;
      },
    );
  });
}
