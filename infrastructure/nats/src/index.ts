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
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';

import {
  discoveryEventSubject,
  runtimeHeartbeatSubject,
  type DiscoveryEvent,
  type RuntimeHeartbeat,
} from '@workspace-brain/domain';

const streamName = 'WORKSPACE_DISCOVERY';
const streamSubjects = [
  'workspace.discovery.>',
  'workspace.processing.>',
  'workspace.knowledge.>',
  'workspace.search.>',
];
const deadLetterSubject = 'workspace.discovery.dead-letter';
const maxProcessingAttempts = 5;
const runtimePublishTimeoutMs = 5_000;
const codec = StringCodec();

export type DiscoveryEventHandler = (event: DiscoveryEvent) => Promise<void>;
export type RequestHandler = (data: unknown) => Promise<unknown>;
export type RuntimeConnectionState =
  'connected' | 'reconnecting' | 'disconnected';

export type NatsDiscoveryBus = {
  readonly maxPayloadBytes: number;
  publish(event: DiscoveryEvent): Promise<void>;
  publishRuntimeHeartbeat(event: RuntimeHeartbeat): Promise<void>;
  subscribeRuntimeHeartbeats(
    handler: (event: unknown) => Promise<void>,
  ): Promise<() => void>;
  connectionState(): RuntimeConnectionState;
  onConnectionState(
    handler: (state: RuntimeConnectionState) => void,
  ): () => void;
  subscribe(
    subject: string,
    durableName: string,
    handler: DiscoveryEventHandler,
  ): Promise<void>;
  subscribeRequests(subject: string, handler: RequestHandler): void;
  request<T>(
    subject: string,
    payload: unknown,
    options?: { readonly timeoutMs: number },
  ): Promise<T>;
  close(): Promise<void>;
};

export class NonRetryableEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableEventError';
  }
}

export class NatsPayloadTooLargeError extends NonRetryableEventError {
  constructor(
    readonly payloadBytes: number,
    readonly maxPayloadBytes: number,
  ) {
    super(
      `NATS event payload is ${payloadBytes} bytes; server maximum is ${maxPayloadBytes}`,
    );
    this.name = 'NatsPayloadTooLargeError';
  }
}

export function serializeDiscoveryEvent(event: DiscoveryEvent): Uint8Array {
  return codec.encode(JSON.stringify(event));
}

export async function connectNatsDiscoveryBus(
  servers: string,
  logger: Logger,
): Promise<NatsDiscoveryBus> {
  const connection = await connect({ servers });
  const maxPayloadBytes = connection.info?.max_payload;
  if (maxPayloadBytes === undefined || maxPayloadBytes < 1) {
    await connection.close();
    throw new Error('Connected NATS server did not advertise max_payload');
  }
  try {
    await ensureStream(connection);
  } catch (error) {
    await connection.close();
    throw error;
  }
  const js = connection.jetstream();
  const subscriptions: ConsumerMessages[] = [];
  const requestSubscriptions: ReturnType<NatsConnection['subscribe']>[] = [];
  const runtimeHeartbeatSubscriptions: ReturnType<
    NatsConnection['subscribe']
  >[] = [];
  const consumerTasks: Promise<void>[] = [];
  const connectionStateHandlers = new Set<
    (state: RuntimeConnectionState) => void
  >();
  let currentConnectionState: RuntimeConnectionState = 'connected';
  let statusTask: Promise<void> | undefined;

  function setConnectionState(state: RuntimeConnectionState): void {
    if (currentConnectionState === state) {
      return;
    }
    currentConnectionState = state;
    logger.info({ state }, 'NATS connection state changed');
    for (const handler of connectionStateHandlers) {
      handler(state);
    }
  }

  return {
    maxPayloadBytes,
    async publish(event) {
      const payload = serializeDiscoveryEvent(event);
      if (payload.byteLength > maxPayloadBytes) {
        throw new NatsPayloadTooLargeError(payload.byteLength, maxPayloadBytes);
      }
      await js.publish(discoveryEventSubject(event.eventType), payload, {
        msgID: event.idempotencyKey,
      });
    },

    async publishRuntimeHeartbeat(event) {
      connection.publish(
        runtimeHeartbeatSubject,
        codec.encode(JSON.stringify(event)),
      );
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          connection.flush(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Runtime heartbeat NATS flush timed out')),
              runtimePublishTimeoutMs,
            );
            timer.unref();
          }),
        ]);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
    },

    async subscribeRuntimeHeartbeats(handler) {
      const subscription = connection.subscribe(runtimeHeartbeatSubject);
      runtimeHeartbeatSubscriptions.push(subscription);
      const task = (async () => {
        for await (const message of subscription) {
          let event: unknown;
          try {
            event = JSON.parse(codec.decode(message.data)) as unknown;
          } catch (error) {
            logger.error(
              { err: error, subject: runtimeHeartbeatSubject },
              'Invalid runtime heartbeat JSON rejected',
            );
            continue;
          }
          try {
            await handler(event);
          } catch (error) {
            logger.error(
              { err: error, subject: runtimeHeartbeatSubject },
              'NATS runtime heartbeat handler failed',
            );
          }
        }
      })();
      consumerTasks.push(task);
      return () => subscription.unsubscribe();
    },

    connectionState() {
      return connection.isClosed() ? 'disconnected' : currentConnectionState;
    },

    onConnectionState(handler) {
      connectionStateHandlers.add(handler);
      handler(currentConnectionState);
      if (statusTask === undefined) {
        statusTask = (async () => {
          for await (const status of connection.status()) {
            if (status.type === 'disconnect') {
              setConnectionState('disconnected');
            } else if (status.type === 'reconnect') {
              setConnectionState('connected');
            } else if (status.type === 'error') {
              setConnectionState('reconnecting');
            }
          }
        })();
      }
      return () => connectionStateHandlers.delete(handler);
    },

    async subscribe(subject, durableName, handler) {
      await ensureConsumer(connection, durableName, subject);
      const consumer = await js.consumers.get(streamName, durableName);
      const messages = await consumer.consume({ max_messages: 1 });
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

    async request<T>(
      subject: string,
      payload: unknown,
      options?: { readonly timeoutMs: number },
    ) {
      const response = await connection.request(
        subject,
        codec.encode(JSON.stringify(payload)),
        { timeout: options?.timeoutMs ?? 5_000 },
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
      for (const subscription of runtimeHeartbeatSubscriptions) {
        subscription.unsubscribe();
      }
      await Promise.all(consumerTasks);
      await connection.drain();
      if (statusTask !== undefined) {
        await statusTask;
      }
      connectionStateHandlers.clear();
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
    const heartbeat = setInterval(() => message.working(), 10_000);
    heartbeat.unref();
    try {
      let event: DiscoveryEvent;
      try {
        event = JSON.parse(codec.decode(message.data)) as DiscoveryEvent;
      } catch (error) {
        throw new NonRetryableEventError(
          `Invalid discovery event JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await handler(event);
      message.ack();
    } catch (error) {
      logger.error({ err: error }, 'NATS discovery event processing failed');
      if (
        !(error instanceof NonRetryableEventError) &&
        message.info.deliveryCount < maxProcessingAttempts
      ) {
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
              error: (error instanceof Error
                ? error.message
                : String(error)
              ).slice(0, 512),
              payloadBytes: message.data.byteLength,
              payloadSha256: createHash('sha256')
                .update(message.data)
                .digest('hex'),
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
    } finally {
      clearInterval(heartbeat);
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
      max_ack_pending: 1,
    });
  } catch (createError) {
    try {
      await manager.consumers.info(streamName, durableName);
      await manager.consumers.update(streamName, durableName, {
        filter_subject: subject,
        max_deliver: -1,
        max_ack_pending: 1,
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

export { createHeartbeatPublisher } from './runtime-heartbeat.js';
export type {
  HeartbeatPublisher,
  HeartbeatPublisherOptions,
} from './runtime-heartbeat.js';
