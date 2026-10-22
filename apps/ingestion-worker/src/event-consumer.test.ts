import {
  createSourceId,
  createSourceRootId,
  type DiscoveryEvent,
  type DiscoverySource,
  type ScanResult,
} from '@workspace-brain/domain';
import type { DiscoveryInventoryConfig } from '@workspace-brain/configuration';
import type { NatsDiscoveryBus } from '@workspace-brain/nats';
import { describe, expect, it } from 'vitest';

import { NatsEventConsumer } from './event-consumer.js';

describe('NatsEventConsumer inventory publishing', () => {
  it('publishes start, byte-bounded chunks with bounded concurrency, then completion', async () => {
    const source = createSource();
    const scan = createScan(source);
    const harness = createHarness(source);
    const consumer = createConsumer(harness.bus, scan);
    await consumer.start();
    const request = harness.published.find(
      (event) => event.eventType === 'SourceScanRequested',
    );
    const handler = harness.scanHandler;
    if (request === undefined || handler === undefined) {
      throw new Error('Scan request handler was not registered');
    }

    await handler(request);

    const protocolEvents = harness.published.filter((event) =>
      event.eventType.startsWith('SourceInventory'),
    );
    const started = protocolEvents.find(
      (event) => event.eventType === 'SourceInventoryStarted',
    );
    const completed = protocolEvents.find(
      (event) => event.eventType === 'SourceInventoryCompleted',
    );
    const chunks = protocolEvents.filter(
      (
        event,
      ): event is Extract<
        DiscoveryEvent,
        { readonly eventType: 'SourceInventoryChunk' }
      > => event.eventType === 'SourceInventoryChunk',
    );

    expect(started).toBeDefined();
    expect(completed).toBe(protocolEvents.at(-1));
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      protocolEvents.every(
        (event) => Buffer.byteLength(JSON.stringify(event), 'utf8') <= 3_276,
      ),
    ).toBe(true);
    expect(harness.maxConcurrentChunks).toBeLessThanOrEqual(2);
    expect(chunks.map(({ payload }) => payload.chunkIndex)).toEqual(
      chunks.map((_, index) => index),
    );
    await consumer.stop();
  });

  it('does not publish completion after any chunk acknowledgement fails', async () => {
    const source = createSource();
    const scan = createScan(source);
    const harness = createHarness(source, true);
    const consumer = createConsumer(harness.bus, scan);
    await consumer.start();
    const request = harness.published.find(
      (event) => event.eventType === 'SourceScanRequested',
    );
    const handler = harness.scanHandler;
    if (request === undefined || handler === undefined) {
      throw new Error('Scan request handler was not registered');
    }

    await expect(handler(request)).rejects.toThrow(
      'intentional chunk publish failure',
    );
    expect(
      harness.published.some(
        (event) => event.eventType === 'SourceInventoryCompleted',
      ),
    ).toBe(false);
    await consumer.stop();
  });

  it('reuses stable start and chunk events when a scan request is redelivered', async () => {
    const source = createSource();
    const firstScan = createScan(source);
    const retryScan = {
      ...firstScan,
      discoveredAt: '2026-10-20T09:00:00.000Z',
    };
    let scanCount = 0;
    const harness = createHarness(source);
    const consumer = new NatsEventConsumer(
      {
        async scan() {
          scanCount += 1;
          return scanCount === 1 ? firstScan : retryScan;
        },
      },
      harness.bus,
      { info() {}, error() {} } as never,
      60_000,
      inventoryConfig,
    );
    await consumer.start();
    const request = harness.published.find(
      (event) => event.eventType === 'SourceScanRequested',
    );
    const handler = harness.scanHandler;
    if (request === undefined || handler === undefined) {
      throw new Error('Scan request handler was not registered');
    }

    await handler(request);
    await handler(request);

    const startedEvents = harness.published.filter(
      (event) => event.eventType === 'SourceInventoryStarted',
    );
    const chunkEvents = harness.published.filter(
      (event) => event.eventType === 'SourceInventoryChunk',
    );
    const firstChunkCount = chunkEvents.length / 2;
    expect(startedEvents).toHaveLength(2);
    expect(startedEvents[0]).toEqual(startedEvents[1]);
    expect(chunkEvents.slice(0, firstChunkCount)).toEqual(
      chunkEvents.slice(firstChunkCount),
    );
    await consumer.stop();
  });
});

function createConsumer(
  bus: NatsDiscoveryBus,
  scan: ScanResult | (() => ScanResult),
): NatsEventConsumer {
  return new NatsEventConsumer(
    {
      async scan() {
        return typeof scan === 'function' ? scan() : scan;
      },
    },
    bus,
    { info() {}, error() {} } as never,
    60_000,
    inventoryConfig,
  );
}

const inventoryConfig: DiscoveryInventoryConfig = {
  maxEventBytes: 5_000,
  payloadSafetyRatio: 0.8,
  publishConcurrency: 2,
  assemblyTtlMs: 60_000,
};

function createSource(): DiscoverySource {
  const sourceId = createSourceId();
  const rootId = createSourceRootId();
  return {
    sourceId,
    roots: [{ id: rootId, sourceId, absolutePath: '/source' }],
    workspaceRules: [],
    excludedDirectoryNames: [],
    includeExtensions: ['.md'],
    maxFileSizeBytes: 10_000,
  };
}

function createScan(source: DiscoverySource): ScanResult {
  return {
    sourceId: source.sourceId,
    discoveredAt: '2026-10-19T09:00:00.000Z',
    repositories: [],
    documents: Array.from({ length: 8 }, (_, index) => {
      const path = `${source.roots[0]!.id}/${'x'.repeat(250 * (index + 1))}/document-${index}.md`;
      return {
        path,
        filename: `document-${index}.md`,
        extension: '.md',
        sizeBytes: index * 100,
        modifiedAt: '2026-10-19T09:00:00.000Z',
        fingerprint: String(index).padStart(64, 'a'),
        discoveryMethod: 'filesystem' as const,
      };
    }),
  };
}

function createHarness(source: DiscoverySource, failChunk = false) {
  const published: DiscoveryEvent[] = [];
  let scanHandler: ((event: DiscoveryEvent) => Promise<void>) | undefined;
  let activeChunks = 0;
  let maxConcurrentChunks = 0;
  const bus = {
    maxPayloadBytes: 4_096,
    async publish(event: DiscoveryEvent) {
      if (event.eventType === 'SourceInventoryChunk') {
        activeChunks += 1;
        maxConcurrentChunks = Math.max(maxConcurrentChunks, activeChunks);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeChunks -= 1;
        if (failChunk) {
          throw new Error('intentional chunk publish failure');
        }
      }
      published.push(event);
    },
    async request<T>() {
      return { items: [source] } as T;
    },
    async subscribe(
      _subject: string,
      _durableName: string,
      handler: (event: DiscoveryEvent) => Promise<void>,
    ) {
      scanHandler = handler;
    },
    subscribeRequests() {},
    async publishRuntimeHeartbeat() {},
    async subscribeRuntimeHeartbeats() {
      return () => undefined;
    },
    connectionState() {
      return 'connected' as const;
    },
    onConnectionState() {
      return () => undefined;
    },
    async close() {},
  } as unknown as NatsDiscoveryBus;
  return {
    bus,
    published,
    get scanHandler() {
      return scanHandler;
    },
    get maxConcurrentChunks() {
      return maxConcurrentChunks;
    },
  };
}
