import pino from 'pino';

import { StubEventConsumer } from './event-consumer.js';
import type { SourceScanner } from './scanner.js';
import { createIngestionWorker } from './worker.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const scanner: SourceScanner = {
  async scan() {
    throw new Error('Filesystem scanning is not implemented in Slice 0');
  },
};
const worker = createIngestionWorker(scanner, new StubEventConsumer(logger));

await worker.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void worker.stop().finally(() => {
      logger.info({ signal }, 'Ingestion worker stopped');
    });
  });
}
