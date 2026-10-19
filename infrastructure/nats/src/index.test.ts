import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runtimeHeartbeatSubject } from '@workspace-brain/domain';
import { connectNatsDiscoveryBus } from './index.js';

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('nats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nats')>()),
  connect,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function createHarness(deliveryCount = 1) {
  const message = {
    data: new TextEncoder().encode('{}'),
    subject: 'workspace.processing.document.extracted',
    info: { deliveryCount, stream: 'WORKSPACE_DISCOVERY', streamSequence: 1 },
    ack: vi.fn(),
    nak: vi.fn(),
    working: vi.fn(),
  };
  const iterator = (async function* () {
    yield message;
  })();
  const messages = Object.assign(iterator, { close: vi.fn(async () => {}) });
  const consume = vi.fn(async () => messages);
  const addConsumer = vi.fn(async () => {});
  const publish = vi.fn(async () => {});
  const corePublish = vi.fn();
  const flush = vi.fn(async () => {});
  const request = vi
    .fn<
      (
        subject: string,
        payload: Uint8Array,
        options: { timeout: number },
      ) => Promise<{ data: Uint8Array }>
    >()
    .mockResolvedValue({
      data: new TextEncoder().encode('{"ok":true}'),
    });
  const connection = {
    jetstream: () => ({
      publish,
      consumers: { get: vi.fn(async () => ({ consume })) },
    }),
    jetstreamManager: vi.fn(async () => ({
      streams: {
        info: vi.fn(async () => ({
          config: {
            subjects: [
              'workspace.discovery.>',
              'workspace.processing.>',
              'workspace.knowledge.>',
              'workspace.search.>',
            ],
          },
        })),
      },
      consumers: { add: addConsumer },
    })),
    request,
    publish: corePublish,
    flush,
    drain: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  connect.mockResolvedValue(connection);
  return {
    message,
    addConsumer,
    consume,
    publish,
    request,
    corePublish,
    flush,
  };
}

describe('NATS processing budgets', () => {
  it('serializes transient runtime heartbeats over Core NATS', async () => {
    const harness = createHarness();
    const bus = await connectNatsDiscoveryBus(
      'nats://test',
      pino({ level: 'silent' }),
    );
    const event = {
      schemaVersion: 1 as const,
      componentId: 'parser-worker',
      componentName: 'Parser Worker',
      componentType: 'worker',
      instanceId: 'parser-1',
      version: '1.0.0',
      startedAt: '2026-10-19T08:00:00.000Z',
      uptimeSeconds: 3600,
      timestamp: '2026-10-19T09:00:00.000Z',
    };

    await bus.publishRuntimeHeartbeat(event);

    expect(harness.corePublish).toHaveBeenCalledOnce();
    expect(harness.corePublish.mock.calls[0]?.[0]).toBe(
      runtimeHeartbeatSubject,
    );
    expect(
      JSON.parse(
        new TextDecoder().decode(harness.corePublish.mock.calls[0]?.[1]),
      ),
    ).toEqual(event);
    expect(harness.flush).toHaveBeenCalledOnce();
    await bus.close();
  });

  it('preserves the default request timeout and supports longer catalogue reads', async () => {
    const harness = createHarness();
    const bus = await connectNatsDiscoveryBus(
      'nats://test',
      pino({ level: 'silent' }),
    );
    await expect(bus.request('catalogue', {})).resolves.toEqual({ ok: true });
    await bus.request('catalogue', {}, { timeoutMs: 60_000 });
    expect(harness.request.mock.calls.map((call) => call.at(2))).toEqual([
      { timeout: 5_000 },
      { timeout: 60_000 },
    ]);
    await bus.close();
  });

  it('renews the active acknowledgement without prefetching a processing backlog', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    let finish: (() => void) | undefined;
    const processing = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const bus = await connectNatsDiscoveryBus(
      'nats://test',
      pino({ level: 'silent' }),
    );
    await bus.subscribe(
      harness.message.subject,
      'test-durable',
      () => processing,
    );
    await vi.advanceTimersByTimeAsync(35_000);
    expect(harness.message.working).toHaveBeenCalledTimes(3);
    expect(harness.message.ack).not.toHaveBeenCalled();
    expect(harness.consume).toHaveBeenCalledWith({ max_messages: 1 });
    expect(harness.addConsumer).toHaveBeenCalledWith(
      'WORKSPACE_DISCOVERY',
      expect.objectContaining({ max_ack_pending: 1, max_deliver: -1 }),
    );
    if (finish === undefined) {
      throw new Error('Processing completion was not initialized');
    }
    finish();
    await bus.close();
    expect(harness.message.ack).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(harness.message.working).toHaveBeenCalledTimes(3);
  });

  it.each([4, 5])(
    'preserves retry and dead-letter behavior at delivery %s',
    async (attempt) => {
      vi.useFakeTimers();
      const harness = createHarness(attempt);
      const logger = pino({ level: 'silent' });
      const bus = await connectNatsDiscoveryBus('nats://test', logger);
      await bus.subscribe(harness.message.subject, 'test-durable', async () => {
        throw new Error('Processing failed');
      });
      await bus.close();
      if (attempt === 4) {
        expect(harness.message.nak).toHaveBeenCalledWith(1_000);
        expect(harness.message.ack).not.toHaveBeenCalled();
        expect(harness.publish).not.toHaveBeenCalled();
      } else {
        expect(harness.publish).toHaveBeenCalledWith(
          'workspace.discovery.dead-letter',
          expect.any(Uint8Array),
          expect.any(Object),
        );
        expect(harness.message.ack).toHaveBeenCalledOnce();
        expect(harness.message.nak).not.toHaveBeenCalled();
      }
      await vi.advanceTimersByTimeAsync(20_000);
      expect(harness.message.working).not.toHaveBeenCalled();
    },
  );
});
