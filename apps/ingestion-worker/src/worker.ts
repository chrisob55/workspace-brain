import type { EventConsumer } from './event-consumer.js';

export type IngestionWorker = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createIngestionWorker(
  consumer: EventConsumer,
): IngestionWorker {
  return {
    start: () => consumer.start(),
    stop: () => consumer.stop(),
  };
}
