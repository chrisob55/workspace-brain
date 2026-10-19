export const runtimeHeartbeatSubject = 'workspace.runtime.heartbeat';

export type RuntimeComponentState =
  'healthy' | 'degraded' | 'offline' | 'unknown';

export interface RuntimeHeartbeat {
  readonly schemaVersion: 1;
  readonly componentId: string;
  readonly componentName: string;
  readonly componentType: string;
  readonly instanceId: string;
  readonly version: string;
  readonly startedAt: string;
  readonly uptimeSeconds: number;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RuntimeComponentStatus {
  readonly componentId: string;
  readonly componentName: string;
  readonly componentType: string;
  readonly instanceId: string;
  readonly status: RuntimeComponentState;
  readonly source: 'heartbeat' | 'nats-connection';
  readonly version?: string;
  readonly startedAt?: string;
  readonly uptimeSeconds?: number;
  readonly timestamp?: string;
  readonly lastHeartbeat?: string;
  readonly ageSeconds?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface RuntimeStatusResponse {
  readonly generatedAt: string;
  readonly thresholds: {
    readonly degradedAfterSeconds: number;
    readonly offlineAfterSeconds: number;
  };
  readonly components: readonly RuntimeComponentStatus[];
}

export interface ExpectedRuntimeComponent {
  readonly componentId: string;
  readonly componentName: string;
  readonly componentType: string;
  readonly source: 'heartbeat' | 'nats-connection';
}

export const expectedRuntimeComponents: readonly ExpectedRuntimeComponent[] = [
  {
    componentId: 'workspace-brain-api',
    componentName: 'Workspace Brain API',
    componentType: 'api',
    source: 'heartbeat',
  },
  {
    componentId: 'ingestion-worker',
    componentName: 'Ingestion Worker',
    componentType: 'worker',
    source: 'heartbeat',
  },
  {
    componentId: 'knowledge-worker',
    componentName: 'Knowledge Worker',
    componentType: 'worker',
    source: 'heartbeat',
  },
  {
    componentId: 'nats',
    componentName: 'NATS',
    componentType: 'infrastructure',
    source: 'nats-connection',
  },
];
