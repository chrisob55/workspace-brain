import type { RuntimeHeartbeat } from '@workspace-brain/domain';

import type { NatsDiscoveryBus, RuntimeConnectionState } from './index.js';

const maximumMetadataBytes = 4 * 1024;
const sensitiveMetadataKey =
  /(password|secret|token|credential|connection|string|sourcecode|source_code|environment)/i;

type HeartbeatBus = Pick<
  NatsDiscoveryBus,
  'publishRuntimeHeartbeat' | 'onConnectionState'
>;

type HeartbeatLogger = {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
};

export interface HeartbeatPublisherOptions {
  readonly nats: HeartbeatBus;
  readonly componentId: string;
  readonly componentName: string;
  readonly componentType: string;
  readonly instanceId: string;
  readonly version: string;
  readonly intervalMs?: number;
  readonly metadata?: () =>
    Record<string, unknown> | Promise<Record<string, unknown>>;
  readonly logger: HeartbeatLogger;
  readonly now?: () => number;
}

export interface HeartbeatPublisher {
  start(): Promise<void>;
  stop(): Promise<void>;
}

function isSafeMetadata(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const visit = (candidate: unknown): boolean => {
    if (Array.isArray(candidate)) {
      return candidate.every(visit);
    }
    if (typeof candidate === 'object' && candidate !== null) {
      if (
        Object.getPrototypeOf(candidate) !== Object.prototype &&
        Object.getPrototypeOf(candidate) !== null
      ) {
        return false;
      }
      return Object.entries(candidate).every(
        ([key, nested]) => !sensitiveMetadataKey.test(key) && visit(nested),
      );
    }
    return (
      candidate === null ||
      typeof candidate === 'string' ||
      (typeof candidate === 'number' && Number.isFinite(candidate)) ||
      typeof candidate === 'boolean'
    );
  };
  try {
    return (
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      visit(value) &&
      Buffer.byteLength(JSON.stringify(value), 'utf8') <= maximumMetadataBytes
    );
  } catch {
    return false;
  }
}

export function createHeartbeatPublisher(
  options: HeartbeatPublisherOptions,
): HeartbeatPublisher {
  const intervalMs = options.intervalMs ?? 15_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error('Heartbeat interval must be a positive safe integer');
  }
  const now = options.now ?? Date.now;
  const startedAt = new Date(now()).toISOString();
  let timer: NodeJS.Timeout | undefined;
  let started = false;
  let inFlight: Promise<void> | undefined;
  let lastConnectionState: RuntimeConnectionState | undefined;
  let removeConnectionListener: (() => void) | undefined;

  const publish = async (): Promise<void> => {
    if (inFlight !== undefined) {
      return inFlight;
    }
    inFlight = (async () => {
      let metadata: Record<string, unknown> | undefined;
      if (options.metadata !== undefined) {
        try {
          const candidate = await options.metadata();
          if (!isSafeMetadata(candidate)) {
            throw new Error('Heartbeat metadata is not safe JSON data');
          }
          metadata = candidate;
        } catch (error) {
          options.logger.error(
            {
              componentId: options.componentId,
              errorType: error instanceof Error ? error.name : 'UnknownError',
            },
            'Runtime heartbeat metadata collection failed',
          );
        }
      }
      const timestamp = new Date(now()).toISOString();
      const heartbeat: RuntimeHeartbeat = {
        schemaVersion: 1,
        componentId: options.componentId,
        componentName: options.componentName,
        componentType: options.componentType,
        instanceId: options.instanceId,
        version: options.version,
        startedAt,
        uptimeSeconds: Math.max(
          0,
          Math.floor((now() - Date.parse(startedAt)) / 1000),
        ),
        timestamp,
        ...(metadata === undefined ? {} : { metadata }),
      };
      try {
        await options.nats.publishRuntimeHeartbeat(heartbeat);
      } catch (error) {
        options.logger.error(
          {
            componentId: options.componentId,
            errorType: error instanceof Error ? error.name : 'UnknownError',
          },
          'Runtime heartbeat publication failed',
        );
      }
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  return {
    async start() {
      if (started) {
        return;
      }
      started = true;
      removeConnectionListener = options.nats.onConnectionState((state) => {
        if (
          started &&
          state === 'connected' &&
          lastConnectionState !== undefined &&
          lastConnectionState !== 'connected'
        ) {
          void publish();
        }
        lastConnectionState = state;
      });
      timer = setInterval(() => void publish(), intervalMs);
      timer.unref();
      options.logger.info(
        { componentId: options.componentId, intervalMs },
        'Runtime heartbeat publisher started',
      );
      await publish();
    },
    async stop() {
      if (!started) {
        return;
      }
      started = false;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      removeConnectionListener?.();
      removeConnectionListener = undefined;
      await inFlight;
      options.logger.info(
        { componentId: options.componentId },
        'Runtime heartbeat publisher stopped',
      );
    },
  };
}
