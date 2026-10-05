import {
  AckPolicy,
  connect,
  RetentionPolicy,
  StorageType,
  StringCodec,
  type JetStreamClient,
  type ConsumerMessages,
  type NatsConnection,
} from 'nats';
import type { Logger } from 'pino';

import {
  discoveryEventSubject,
  type DiscoveryEvent,
} from '@workspace-brain/domain';

const streamName = 'WORKSPACE_DISCOVERY';
const streamSubjects = [
  'workspace.discovery.>',
  'workspace.processing.>',
  'workspace.knowledge.>',
];
const deadLetterSubject = 'workspace.discovery.dead-letter';
const maxProcessingAttempts = 5;
const codec = StringCodec();

export type DiscoveryEventHandler = (event: DiscoveryEvent) => Promise<void>;
export type RequestHandler = (data: unknown) => Promise<unknown>;

export type NatsDiscoveryBus = {
  publish(event: DiscoveryEvent): Promise<void>;
  subscribe(
    subject: string,
    durableName: string,
    handler: DiscoveryEventHandler,
  ): Promise<void>;
  subscribeRequests(subject: string, handler: RequestHandler): void;
  request<T>(subject: string, payload: unknown): Promise<T>;
  close(): Promise<void>;
};

export async function connectNatsDiscoveryBus(
  servers: string,
  logger: Logger,
): Promise<NatsDiscoveryBus> {
  const connection = await connect({ servers });
  try {
    await ensureStream(connection);
  } catch (error) {
    await connection.close();
    throw error;
  }
  const js = connection.jetstream();
  const subscriptions: ConsumerMessages[] = [];
  const requestSubscriptions: ReturnType<NatsConnection['subscribe']>[] = [];
  const consumerTasks: Promise<void>[] = [];

  return {
    async publish(event) {
      await js.publish(
        discoveryEventSubject(event.eventType),
        codec.encode(JSON.stringify(event)),
        { msgID: event.idempotencyKey },
      );
    },

    async subscribe(subject, durableName, handler) {
      await ensureConsumer(connection, durableName, subject);
      const consumer = await js.consumers.get(streamName, durableName);
      const messages = await consumer.consume();
      subscriptions.push(messages);
      const task = consume(messages, handler, durableName, js, logger);
      consumerTasks.push(task);
    },

    subscribeRequests(subject, handler) {
      const subscription = connection.subscribe(subject);
      requestSubscriptions.push(subscription);
      const task = (async () => {
        for await (const message of subscription) {
          try {
            const request = JSON.parse(codec.decode(message.data)) as unknown;
            const response = await handler(request);
            message.respond(codec.encode(JSON.stringify(response)));
          } catch (error) {
            logger.error({ err: error, subject }, 'NATS request failed');
          }
        }
      })();
      consumerTasks.push(task);
    },

    async request<T>(subject: string, payload: unknown) {
      const response = await connection.request(
        subject,
        codec.encode(JSON.stringify(payload)),
        { timeout: 5_000 },
      );
      return JSON.parse(codec.decode(response.data)) as T;
    },

    async close() {
      for (const subscription of subscriptions) {
        await subscription.close();
      }
      for (const subscription of requestSubscriptions) {
        subscription.unsubscribe();
      }
      await Promise.all(consumerTasks);
      await connection.drain();
    },
  };
}

async function consume(
  messages: ConsumerMessages,
  handler: DiscoveryEventHandler,
  durableName: string,
  js: JetStreamClient,
  logger: Logger,
): Promise<void> {
  for await (const message of messages) {
    try {
      const event = JSON.parse(codec.decode(message.data)) as DiscoveryEvent;
      await handler(event);
      message.ack();
    } catch (error) {
      logger.error({ err: error }, 'NATS discovery event processing failed');
      if (message.info.deliveryCount < maxProcessingAttempts) {
        message.nak(1_000);
        continue;
      }
      try {
        await js.publish(
          deadLetterSubject,
          codec.encode(
            JSON.stringify({
              deadLetteredAt: new Date().toISOString(),
              originalSubject: message.subject,
              stream: message.info.stream,
              consumer: durableName,
              streamSequence: message.info.streamSequence,
              deliveryCount: message.info.deliveryCount,
              error: error instanceof Error ? error.message : String(error),
              payloadBase64: Buffer.from(message.data).toString('base64'),
            }),
          ),
          {
            msgID: `dead-letter:${message.info.stream}:${message.info.streamSequence}:${durableName}`,
          },
        );
        message.ack();
      } catch (deadLetterError) {
        logger.error(
          { err: deadLetterError, subject: message.subject },
          'Could not publish exhausted discovery event to dead-letter subject',
        );
        message.nak(1_000);
      }
    }
  }
}

async function ensureConsumer(
  connection: NatsConnection,
  durableName: string,
  subject: string,
): Promise<void> {
  const manager = await connection.jetstreamManager();
  try {
    await manager.consumers.add(streamName, {
      durable_name: durableName,
      ack_policy: AckPolicy.Explicit,
      filter_subject: subject,
      max_deliver: -1,
    });
  } catch (createError) {
    try {
      await manager.consumers.info(streamName, durableName);
      await manager.consumers.update(streamName, durableName, {
        filter_subject: subject,
        max_deliver: -1,
      });
    } catch (verifyError) {
      throw new AggregateError(
        [createError, verifyError],
        `Could not create or verify discovery consumer ${durableName}`,
        { cause: verifyError },
      );
    }
  }
}

async function ensureStream(connection: NatsConnection): Promise<void> {
  const manager = await connection.jetstreamManager();
  let existingSubjects: readonly string[] = [];
  try {
    const info = await manager.streams.info(streamName);
    existingSubjects = info.config.subjects ?? [];
  } catch (infoError) {
    try {
      await manager.streams.add({
        name: streamName,
        subjects: streamSubjects,
        retention: RetentionPolicy.Limits,
        storage: StorageType.File,
      });
      existingSubjects = streamSubjects;
    } catch (createError) {
      try {
        const info = await manager.streams.info(streamName);
        existingSubjects = info.config.subjects ?? [];
      } catch (verifyError) {
        throw new AggregateError(
          [infoError, createError, verifyError],
          'Could not create or verify the discovery JetStream stream',
          { cause: verifyError },
        );
      }
    }
  }
  const subjects = [...new Set([...existingSubjects, ...streamSubjects])];
  if (
    subjects.length !== existingSubjects.length ||
    subjects.some((subject, index) => subject !== existingSubjects[index])
  ) {
    await manager.streams.update(streamName, { subjects });
  }
}
