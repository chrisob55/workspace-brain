import {
  expectedRuntimeComponents,
  type ExpectedRuntimeComponent,
  type RuntimeComponentState,
  runtimeHeartbeatSubject,
  type RuntimeHeartbeat,
  type RuntimeComponentStatus,
  type RuntimeStatusResponse,
} from '@workspace-brain/domain';
import type {
  NatsDiscoveryBus,
  RuntimeConnectionState,
} from '@workspace-brain/nats';
import { z } from 'zod';

const maximumMetadataBytes = 4 * 1024;
const sensitiveMetadataKey =
  /(password|secret|token|credential|connection|string|sourcecode|source_code|environment)/i;

const heartbeatSchema = z
  .object({
    schemaVersion: z.literal(1),
    componentId: z.string().trim().min(1).max(128),
    componentName: z.string().trim().min(1).max(128),
    componentType: z.string().trim().min(1).max(64),
    instanceId: z.string().trim().min(1).max(128),
    version: z.string().trim().min(1).max(128),
    startedAt: z.iso.datetime(),
    uptimeSeconds: z.number().finite().nonnegative(),
    timestamp: z.iso.datetime(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

type RegistryLogger = {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
};
type StoredHeartbeat = RuntimeHeartbeat;

export interface RuntimeRegistryOptions {
  readonly degradedAfterSeconds?: number;
  readonly offlineAfterSeconds?: number;
  readonly expectedComponents?: readonly ExpectedRuntimeComponent[];
  readonly logger: RegistryLogger;
  readonly now?: () => number;
}

function metadataIsSafe(metadata: Record<string, unknown> | undefined) {
  if (metadata === undefined) {
    return true;
  }
  const visit = (candidate: unknown): boolean => {
    if (Array.isArray(candidate)) {
      return candidate.every(visit);
    }
    if (typeof candidate === 'object' && candidate !== null) {
      return Object.entries(candidate).every(
        ([key, nested]) => !sensitiveMetadataKey.test(key) && visit(nested),
      );
    }
    return (
      candidate === null ||
      typeof candidate === 'string' ||
      typeof candidate === 'number' ||
      typeof candidate === 'boolean'
    );
  };
  try {
    return (
      visit(metadata) &&
      Buffer.byteLength(JSON.stringify(metadata), 'utf8') <=
        maximumMetadataBytes
    );
  } catch {
    return false;
  }
}

function stateForAge(
  ageSeconds: number,
  degradedAfterSeconds: number,
  offlineAfterSeconds: number,
): RuntimeComponentState {
  if (ageSeconds < degradedAfterSeconds) {
    return 'healthy';
  }
  if (ageSeconds <= offlineAfterSeconds) {
    return 'degraded';
  }
  return 'offline';
}

function runtimeKey(componentId: string, instanceId: string): string {
  return `${componentId}\u0000${instanceId}`;
}

export class RuntimeRegistryService {
  private readonly heartbeats = new Map<string, StoredHeartbeat>();
  private readonly expectedComponents: readonly ExpectedRuntimeComponent[];
  private readonly degradedAfterSeconds: number;
  private readonly offlineAfterSeconds: number;
  private readonly now: () => number;
  private unsubscribeHeartbeats: (() => void) | undefined;
  private unsubscribeConnection: (() => void) | undefined;
  private connectionState: RuntimeConnectionState | 'unknown' = 'unknown';
  private connectionStateAt: number;

  constructor(private readonly options: RuntimeRegistryOptions) {
    this.degradedAfterSeconds = options.degradedAfterSeconds ?? 30;
    this.offlineAfterSeconds = options.offlineAfterSeconds ?? 90;
    if (
      !Number.isFinite(this.degradedAfterSeconds) ||
      this.degradedAfterSeconds < 1 ||
      !Number.isFinite(this.offlineAfterSeconds) ||
      this.offlineAfterSeconds <= this.degradedAfterSeconds
    ) {
      throw new Error('Runtime registry thresholds are invalid');
    }
    this.expectedComponents =
      options.expectedComponents ?? expectedRuntimeComponents;
    this.now = options.now ?? Date.now;
    this.connectionStateAt = this.now();
  }

  async start(
    bus: Pick<
      NatsDiscoveryBus,
      'subscribeRuntimeHeartbeats' | 'connectionState' | 'onConnectionState'
    >,
  ): Promise<void> {
    if (this.unsubscribeHeartbeats !== undefined) {
      return;
    }
    this.unsubscribeHeartbeats = await bus.subscribeRuntimeHeartbeats(
      async (payload) => {
        this.acceptHeartbeat(payload);
      },
    );
    this.unsubscribeConnection = bus.onConnectionState((state) => {
      if (state !== this.connectionState) {
        this.connectionState = state;
        this.connectionStateAt = this.now();
      }
    });
    const currentState = bus.connectionState();
    if (currentState !== this.connectionState) {
      this.connectionState = currentState;
      this.connectionStateAt = this.now();
    }
    this.options.logger.info(
      { subject: runtimeHeartbeatSubject },
      'Runtime heartbeat subscription started',
    );
  }

  stop(): void {
    this.unsubscribeHeartbeats?.();
    this.unsubscribeHeartbeats = undefined;
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = undefined;
    this.options.logger.info(
      { subject: runtimeHeartbeatSubject },
      'Runtime heartbeat subscription stopped',
    );
  }

  acceptHeartbeat(payload: unknown): boolean {
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'schemaVersion' in payload &&
      payload.schemaVersion !== 1
    ) {
      this.options.logger.error(
        {
          schemaVersionType: typeof payload.schemaVersion,
          ...(typeof payload.schemaVersion === 'number'
            ? { schemaVersion: payload.schemaVersion }
            : {}),
        },
        'Unsupported runtime heartbeat schema version rejected',
      );
      return false;
    }
    const parsed = heartbeatSchema.safeParse(payload);
    if (!parsed.success || !metadataIsSafe(parsed.data?.metadata)) {
      this.options.logger.error(
        {
          issues: parsed.success
            ? ['Runtime heartbeat metadata is not safe JSON data']
            : parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
              })),
        },
        'Invalid runtime heartbeat rejected',
      );
      return false;
    }
    const heartbeat: RuntimeHeartbeat = {
      schemaVersion: parsed.data.schemaVersion,
      componentId: parsed.data.componentId,
      componentName: parsed.data.componentName,
      componentType: parsed.data.componentType,
      instanceId: parsed.data.instanceId,
      version: parsed.data.version,
      startedAt: parsed.data.startedAt,
      uptimeSeconds: parsed.data.uptimeSeconds,
      timestamp: parsed.data.timestamp,
      ...(parsed.data.metadata === undefined
        ? {}
        : { metadata: parsed.data.metadata }),
    };
    const key = runtimeKey(heartbeat.componentId, heartbeat.instanceId);
    const existing = this.heartbeats.get(key);
    if (
      existing !== undefined &&
      Date.parse(heartbeat.timestamp) <= Date.parse(existing.timestamp)
    ) {
      return false;
    }
    if (existing === undefined) {
      this.options.logger.info(
        {
          componentId: heartbeat.componentId,
          componentType: heartbeat.componentType,
          instanceId: heartbeat.instanceId,
        },
        'Runtime component instance discovered',
      );
    }
    this.heartbeats.set(key, heartbeat);
    return true;
  }

  snapshot(): RuntimeStatusResponse {
    const currentTime = this.now();
    const generatedAt = new Date(currentTime).toISOString();
    const statuses: RuntimeComponentStatus[] = [
      ...this.heartbeats.values(),
    ].map((heartbeat) => {
      const ageSeconds = Math.max(
        0,
        Math.floor((currentTime - Date.parse(heartbeat.timestamp)) / 1000),
      );
      return {
        ...heartbeat,
        source: 'heartbeat' as const,
        status: stateForAge(
          ageSeconds,
          this.degradedAfterSeconds,
          this.offlineAfterSeconds,
        ),
        lastHeartbeat: heartbeat.timestamp,
        ageSeconds,
      };
    });

    for (const component of this.expectedComponents) {
      if (component.source === 'nats-connection') {
        statuses.push(this.natsStatus(component, currentTime));
        continue;
      }
      if (
        statuses.some((status) => status.componentId === component.componentId)
      ) {
        continue;
      }
      statuses.push({
        ...component,
        instanceId: 'not-observed',
        source: 'heartbeat',
        status: 'unknown',
      });
    }

    statuses.sort(
      (left, right) =>
        left.componentType.localeCompare(right.componentType) ||
        left.componentName.localeCompare(right.componentName) ||
        left.instanceId.localeCompare(right.instanceId),
    );
    return {
      generatedAt,
      thresholds: {
        degradedAfterSeconds: this.degradedAfterSeconds,
        offlineAfterSeconds: this.offlineAfterSeconds,
      },
      components: statuses,
    };
  }

  private natsStatus(component: ExpectedRuntimeComponent, currentTime: number) {
    const ageSeconds = Math.max(
      0,
      Math.floor((currentTime - this.connectionStateAt) / 1000),
    );
    const status: RuntimeComponentState =
      this.connectionState === 'connected'
        ? 'healthy'
        : this.connectionState === 'reconnecting'
          ? 'degraded'
          : this.connectionState === 'disconnected'
            ? 'offline'
            : 'unknown';
    return {
      ...component,
      instanceId: 'api-nats-connection',
      source: 'nats-connection' as const,
      status,
      timestamp: new Date(this.connectionStateAt).toISOString(),
      ageSeconds,
    };
  }
}
