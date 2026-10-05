import { randomUUID } from 'node:crypto';

import { AckPolicy, connect, DeliverPolicy, StringCodec } from 'nats';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { connectNatsDiscoveryBus } from './index.js';

const servers = process.env.NATS_TEST_SERVERS;
const codec = StringCodec();

describe.skipIf(servers === undefined)('NATS JetStream integration', () => {
  it('routes and retains knowledge outbox events on the configured stream', async () => {
    if (servers === undefined) {
      throw new Error(
        'NATS_TEST_SERVERS is required for this integration test',
      );
    }
    const expectedPackageName = process.env.NATS_EXPECTED_PACKAGE_NAME;
    const connection = await connect({ servers });
    const manager = await connection.jetstreamManager();
    const durableName = `knowledge-flow-${randomUUID()}`;

    try {
      const stream = await manager.streams.info('WORKSPACE_DISCOVERY');
      expect(stream.config.subjects).toEqual(
        expect.arrayContaining([
          'workspace.discovery.>',
          'workspace.processing.>',
          'workspace.knowledge.>',
        ]),
      );
      await manager.consumers.add('WORKSPACE_DISCOVERY', {
        durable_name: durableName,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        filter_subject: 'workspace.knowledge.>',
      });
      const consumer = await connection
        .jetstream()
        .consumers.get('WORKSPACE_DISCOVERY', durableName);
      const messages = await consumer.fetch({
        max_messages: 100,
        expires: 5_000,
      });
      const events: Array<Record<string, unknown>> = [];
      for await (const message of messages) {
        events.push(
          JSON.parse(codec.decode(message.data)) as Record<string, unknown>,
        );
        message.ack();
      }

      const eventTypes = events.map((event) => event.eventType);
      expect(eventTypes).toContain('KnowledgeCandidatesSubmitted');
      expect(eventTypes).toContain('KnowledgeEntityDiscovered');
      expect(eventTypes).toContain('KnowledgeRelationshipDiscovered');
      expect(eventTypes).toContain('KnowledgeModelPublished');
      if (expectedPackageName !== undefined) {
        expect(
          events.some(
            (event) =>
              event.eventType === 'KnowledgeEntityDiscovered' &&
              typeof event.payload === 'object' &&
              event.payload !== null &&
              'entity' in event.payload &&
              typeof event.payload.entity === 'object' &&
              event.payload.entity !== null &&
              'name' in event.payload.entity &&
              event.payload.entity.name === expectedPackageName,
          ),
        ).toBe(true);
      }
    } finally {
      try {
        await manager.consumers.delete('WORKSPACE_DISCOVERY', durableName);
      } finally {
        await connection.close();
      }
    }
  }, 15_000);

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
            () => reject(new Error('Timed out waiting for dead-letter event')),
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
});
