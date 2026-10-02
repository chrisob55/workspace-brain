import type { EventConsumer } from './event-consumer.js';
import type { SourceScanner } from './scanner.js';

export type IngestionWorker = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createIngestionWorker(
  scanner: SourceScanner,
  consumer: EventConsumer,
): IngestionWorker {
  return {
    start: () =>
      consumer.start((source, correlationId) =>
        scanner.scan(source, correlationId),
      ),
    stop: () => consumer.stop(),
  };
}
