import pino from 'pino';

import { FilesystemSourceScanner } from '@workspace-brain/filesystem';
import { connectNatsDiscoveryBus } from '@workspace-brain/nats';

import { NatsEventConsumer } from './event-consumer.js';
import { createIngestionWorker } from './worker.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const natsServers = process.env.NATS_SERVERS ?? 'nats://nats:4222';
const scanIntervalMilliseconds = Number(
  process.env.SCAN_INTERVAL_MS ?? 300_000,
);
const bus = await connectNatsDiscoveryBus(natsServers, logger);
const worker = createIngestionWorker(
  new NatsEventConsumer(
    new FilesystemSourceScanner(),
    bus,
    logger,
    scanIntervalMilliseconds,
  ),
);

try {
  await worker.start();
} catch (error) {
  await worker.stop();
  throw error;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void worker.stop().then(
      () => logger.info({ signal }, 'Ingestion worker stopped'),
      (error: unknown) => {
        logger.error(
          { err: error, signal },
          'Ingestion worker shutdown failed',
        );
        process.exitCode = 1;
      },
    );
  });
}
