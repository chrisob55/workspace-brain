import type { RuntimeHeartbeat } from '@workspace-brain/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHeartbeatPublisher,
  type HeartbeatPublisherOptions,
} from './runtime-heartbeat.js';

const logger = { error: vi.fn(), info: vi.fn() };

function createHarness(
  publishRuntimeHeartbeat: (
    heartbeat: RuntimeHeartbeat,
  ) => Promise<void> = async () => undefined,
) {
  const heartbeats: RuntimeHeartbeat[] = [];
  let connectionStateHandler:
    | ((state: 'connected' | 'reconnecting' | 'disconnected') => void)
    | undefined;
  const nats: HeartbeatPublisherOptions['nats'] = {
    async publishRuntimeHeartbeat(heartbeat) {
      heartbeats.push(heartbeat);
      return publishRuntimeHeartbeat(heartbeat);
    },
    onConnectionState(handler) {
      connectionStateHandler = handler;
      handler('connected');
      return () => {
        connectionStateHandler = undefined;
      };
    },
  };
  return {
    heartbeats,
    nats,
    connectionState: (state: 'connected' | 'reconnecting' | 'disconnected') =>
      connectionStateHandler?.(state),
  };
}

function createPublisher(
  nats: HeartbeatPublisherOptions['nats'],
  overrides: Partial<HeartbeatPublisherOptions> = {},
) {
  return createHeartbeatPublisher({
    nats,
    componentId: 'parser-worker',
    componentName: 'Parser Worker',
    componentType: 'worker',
    instanceId: 'parser-worker-1',
    version: '1.0.0',
    logger,
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('createHeartbeatPublisher', () => {
  it('publishes immediately and periodically with a stable process start time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T08:00:00.000Z'));
    const harness = createHarness();
    const publisher = createPublisher(harness.nats);
    await publisher.start();
    expect(harness.heartbeats).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(harness.heartbeats).toHaveLength(3);
    expect(harness.heartbeats.map(({ startedAt }) => startedAt)).toEqual([
      '2026-10-19T08:00:00.000Z',
      '2026-10-19T08:00:00.000Z',
      '2026-10-19T08:00:00.000Z',
    ]);
    expect(harness.heartbeats[2]?.uptimeSeconds).toBe(30);
    expect(JSON.parse(JSON.stringify(harness.heartbeats[0]))).toEqual(
      harness.heartbeats[0],
    );
    await publisher.stop();
  });

  it('clears its timer, connection listener and waits for in-flight publication on stop', async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const harness = createHarness(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const publisher = createPublisher(harness.nats);
    const starting = publisher.start();
    const stopping = publisher.stop();
    finish?.();
    await Promise.all([starting, stopping]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.heartbeats).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    harness.connectionState('connected');
    expect(harness.heartbeats).toHaveLength(1);
  });

  it('does not overlap publishes when metadata takes longer than an interval', async () => {
    vi.useFakeTimers();
    let releaseMetadata: (() => void) | undefined;
    const metadata = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          releaseMetadata = () => resolve({ queueDepth: 0 });
        }),
    );
    const harness = createHarness();
    const publisher = createPublisher(harness.nats, { metadata });
    const starting = publisher.start();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(metadata).toHaveBeenCalledOnce();
    releaseMetadata?.();
    await starting;
    await publisher.stop();
  });

  it('publishes without metadata when metadata collection fails', async () => {
    const harness = createHarness();
    const publisher = createPublisher(harness.nats, {
      metadata: async () => {
        throw new Error('queue unavailable');
      },
    });
    await publisher.start();
    expect(harness.heartbeats[0]).not.toHaveProperty('metadata');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ componentId: 'parser-worker' }),
      'Runtime heartbeat metadata collection failed',
    );
    await publisher.stop();
  });

  it('does not crash when NATS publication fails and retries on the next interval', async () => {
    vi.useFakeTimers();
    const publish = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('NATS unavailable'))
      .mockResolvedValue(undefined);
    const harness = createHarness(publish);
    const publisher = createPublisher(harness.nats);
    await expect(publisher.start()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ componentId: 'parser-worker' }),
      'Runtime heartbeat publication failed',
    );
    await publisher.stop();
  });

  it('publishes again when the NATS connection recovers', async () => {
    const harness = createHarness();
    const publisher = createPublisher(harness.nats);
    await publisher.start();
    harness.connectionState('disconnected');
    harness.connectionState('connected');
    await vi.waitFor(() => expect(harness.heartbeats).toHaveLength(2));
    await publisher.stop();
  });
});
