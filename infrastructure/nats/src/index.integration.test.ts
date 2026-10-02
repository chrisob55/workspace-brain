import { randomUUID } from 'node:crypto';

import { connect, StringCodec } from 'nats';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { connectNatsDiscoveryBus } from './index.js';

const servers = process.env.NATS_TEST_SERVERS;
const codec = StringCodec();

describe.skipIf(servers === undefined)(
  'NATS JetStream dead-letter delivery',
  () => {
    it('moves an event to the dead-letter subject after repeated processing failures', async () => {
      if (servers === undefined) {
        throw new Error(
          'NATS_TEST_SERVERS is required for this integration test',
        );
      }
      const subject = `workspace.discovery.integration.${randomUUID()}`;
      const durableName = `nats-integration-${randomUUID()}`;
      const bus = await connectNatsDiscoveryBus(
        servers,
        pino({ level: 'silent' }),
      );
      const observer = await connect({ servers });
      const deadLetters = observer.subscribe('workspace.discovery.dead-letter');

      try {
        await bus.subscribe(subject, durableName, async () => {
          throw new Error('intentional integration-test failure');
        });
        await observer
          .jetstream()
          .publish(subject, codec.encode('{}'), { msgID: randomUUID() });

        const deadLetter = await Promise.race([
          (async () => {
            for await (const message of deadLetters) {
              return JSON.parse(codec.decode(message.data)) as {
                readonly consumer: string;
                readonly deliveryCount: number;
                readonly originalSubject: string;
              };
            }
            throw new Error('Dead-letter subscription closed unexpectedly');
          })(),
          new Promise<never>((_, reject) => {
            const timer = setTimeout(
              () =>
                reject(new Error('Timed out waiting for dead-letter event')),
              15_000,
            );
            timer.unref();
          }),
        ]);

        expect(deadLetter).toMatchObject({
          consumer: durableName,
          deliveryCount: 5,
          originalSubject: subject,
        });
      } finally {
        deadLetters.unsubscribe();
        await bus.close();
        await observer.close();
      }
    }, 20_000);
  },
);
