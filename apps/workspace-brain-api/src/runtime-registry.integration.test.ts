import { randomUUID } from 'node:crypto';

import {
  connectNatsDiscoveryBus,
  createHeartbeatPublisher,
} from '@workspace-brain/nats';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { RuntimeRegistryService } from './runtime-registry.js';

const servers = process.env.NATS_TEST_SERVERS;

describe.skipIf(servers === undefined)(
  'NATS runtime heartbeat integration',
  () => {
    it('receives, ages, and recovers a publisher heartbeat through the API registry', async () => {
      if (servers === undefined) {
        throw new Error(
          'NATS_TEST_SERVERS is required for this integration test',
        );
      }
      let now = Date.parse('2026-10-19T09:00:00.000Z');
      const logger = pino({ level: 'silent' });
      const apiBus = await connectNatsDiscoveryBus(servers, logger);
      const publisherBus = await connectNatsDiscoveryBus(servers, logger);
      const registry = new RuntimeRegistryService({
        expectedComponents: [],
        logger,
        now: () => now,
      });
      const componentId = `integration-${randomUUID()}`;

      try {
        await registry.start(apiBus);
        const publisher = createHeartbeatPublisher({
          nats: publisherBus,
          componentId,
          componentName: 'Integration Worker',
          componentType: 'worker',
          instanceId: 'integration-1',
          version: 'test',
          intervalMs: 300_000,
          logger,
          now: () => now,
        });
        const publisherStartedAt = new Date(now).toISOString();
        await publisher.start();
        const instanceStatus = () =>
          registry
            .snapshot()
            .components.find(({ componentId: id }) => id === componentId)
            ?.status;
        await vi.waitFor(() => expect(instanceStatus()).toBe('healthy'));

        now += 30_000;
        expect(instanceStatus()).toBe('degraded');
        now += 61_000;
        expect(instanceStatus()).toBe('offline');

        now += 1_000;
        await publisherBus.publishRuntimeHeartbeat({
          schemaVersion: 1,
          componentId,
          componentName: 'Integration Worker',
          componentType: 'worker',
          instanceId: 'integration-1',
          version: 'test',
          startedAt: publisherStartedAt,
          uptimeSeconds: 92,
          timestamp: new Date(now).toISOString(),
        });
        await vi.waitFor(() => expect(instanceStatus()).toBe('healthy'));
        await publisher.stop();
      } finally {
        registry.stop();
        await Promise.all([apiBus.close(), publisherBus.close()]);
      }
    }, 15_000);
  },
);
