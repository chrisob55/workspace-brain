import type { RuntimeHeartbeat } from '@workspace-brain/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeRegistryService } from './runtime-registry.js';

const fixedNow = Date.parse('2026-10-19T09:00:00.000Z');
const logger = {
  error: vi.fn(),
  info: vi.fn(),
};

function heartbeat(
  overrides: Partial<RuntimeHeartbeat> = {},
): RuntimeHeartbeat {
  return {
    schemaVersion: 1,
    componentId: 'parser-worker',
    componentName: 'Parser Worker',
    componentType: 'worker',
    instanceId: 'parser-1',
    version: '1.0.0',
    startedAt: '2026-10-19T08:00:00.000Z',
    uptimeSeconds: 3600,
    timestamp: '2026-10-19T09:00:00.000Z',
    ...overrides,
  };
}

function createRegistry(now = () => fixedNow) {
  return new RuntimeRegistryService({
    logger,
    now,
    expectedComponents: [
      {
        componentId: 'parser-worker',
        componentName: 'Parser Worker',
        componentType: 'worker',
        source: 'heartbeat',
      },
      {
        componentId: 'nats',
        componentName: 'NATS',
        componentType: 'infrastructure',
        source: 'nats-connection',
      },
    ],
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RuntimeRegistryService', () => {
  it('validates and accepts supported serialized heartbeat payloads', () => {
    const registry = createRegistry();
    expect(
      registry.acceptHeartbeat(JSON.parse(JSON.stringify(heartbeat()))),
    ).toBe(true);
    expect(registry.snapshot().components).toContainEqual(
      expect.objectContaining({
        componentId: 'parser-worker',
        instanceId: 'parser-1',
        source: 'heartbeat',
        status: 'healthy',
        lastHeartbeat: '2026-10-19T09:00:00.000Z',
      }),
    );
  });

  it('rejects unsupported schema versions and malformed or unsafe metadata', () => {
    const registry = createRegistry();
    expect(registry.acceptHeartbeat({ ...heartbeat(), schemaVersion: 2 })).toBe(
      false,
    );
    expect(
      registry.acceptHeartbeat({ ...heartbeat(), uptimeSeconds: -1 }),
    ).toBe(false);
    expect(
      registry.acceptHeartbeat({
        ...heartbeat(),
        metadata: { apiToken: 'do-not-publish' },
      }),
    ).toBe(false);
    expect(
      registry.acceptHeartbeat({
        ...heartbeat(),
        metadata: { payload: 'x'.repeat(5000) },
      }),
    ).toBe(false);
    expect(logger.error).toHaveBeenCalledTimes(4);
  });

  it('inserts instances and replaces only with a newer heartbeat', () => {
    const registry = createRegistry();
    expect(registry.acceptHeartbeat(heartbeat())).toBe(true);
    expect(
      registry.acceptHeartbeat(
        heartbeat({ timestamp: '2026-10-19T08:59:59.000Z', version: 'older' }),
      ),
    ).toBe(false);
    expect(
      registry.acceptHeartbeat(
        heartbeat({ timestamp: '2026-10-19T09:00:01.000Z', version: 'newer' }),
      ),
    ).toBe(true);
    expect(
      registry
        .snapshot()
        .components.find((component) => component.instanceId === 'parser-1')
        ?.version,
    ).toBe('newer');
  });

  it('tracks multiple instances and different component types deterministically', () => {
    const registry = createRegistry();
    registry.acceptHeartbeat(heartbeat({ instanceId: 'parser-b' }));
    registry.acceptHeartbeat(heartbeat({ instanceId: 'parser-a' }));
    registry.acceptHeartbeat(
      heartbeat({
        componentId: 'indexer',
        componentName: 'Indexer',
        componentType: 'worker',
        instanceId: 'indexer-1',
      }),
    );
    expect(
      registry
        .snapshot()
        .components.filter(
          (component) => component.componentId === 'parser-worker',
        )
        .map((component) => component.instanceId),
    ).toEqual(['parser-a', 'parser-b']);
    expect(
      registry
        .snapshot()
        .components.map(({ componentType, componentName }) => [
          componentType,
          componentName,
        ]),
    ).toEqual([
      ['infrastructure', 'NATS'],
      ['worker', 'Indexer'],
      ['worker', 'Parser Worker'],
      ['worker', 'Parser Worker'],
    ]);
  });

  it.each([
    [0, 'healthy'],
    [29, 'healthy'],
    [30, 'degraded'],
    [60, 'degraded'],
    [90, 'degraded'],
    [91, 'offline'],
    [120, 'offline'],
  ] as const)(
    'calculates age %s seconds as %s through the injected clock',
    (age, expected) => {
      const registry = createRegistry(() => fixedNow + age * 1000);
      registry.acceptHeartbeat(heartbeat());
      expect(
        registry
          .snapshot()
          .components.find(({ instanceId }) => instanceId === 'parser-1')
          ?.status,
      ).toBe(expected);
    },
  );

  it('returns expected but never observed components as unknown', () => {
    const registry = createRegistry();
    expect(
      registry
        .snapshot()
        .components.find(({ componentId }) => componentId === 'parser-worker'),
    ).toMatchObject({
      status: 'unknown',
      instanceId: 'not-observed',
      source: 'heartbeat',
    });
  });

  it('maps the NATS connection state to an explicit operational status', async () => {
    const registry = createRegistry();
    let stateHandler:
      | ((state: 'connected' | 'reconnecting' | 'disconnected') => void)
      | undefined;
    const bus = {
      async subscribeRuntimeHeartbeats() {
        return () => undefined;
      },
      connectionState: () => 'connected' as const,
      onConnectionState(handler: typeof stateHandler) {
        stateHandler = handler;
        handler?.('connected');
        return () => undefined;
      },
    };
    await registry.start(bus);
    const findNats = () =>
      registry
        .snapshot()
        .components.find(({ componentId }) => componentId === 'nats');
    expect(findNats()?.status).toBe('healthy');
    stateHandler?.('reconnecting');
    expect(findNats()?.status).toBe('degraded');
    stateHandler?.('disconnected');
    expect(findNats()?.status).toBe('offline');
    registry.stop();
  });

  it('ignores equal-timestamp heartbeat duplicates', () => {
    const registry = createRegistry();
    registry.acceptHeartbeat(heartbeat());
    expect(registry.acceptHeartbeat(heartbeat({ version: 'equal-time' }))).toBe(
      false,
    );
  });
});
