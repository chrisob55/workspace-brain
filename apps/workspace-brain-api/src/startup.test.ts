import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  parseWorkspaceBrainConfig,
  type WorkspaceBrainConfig,
} from '@workspace-brain/configuration';
import {
  createSourceId,
  type DiscoveryEvent,
  type DiscoverySource,
} from '@workspace-brain/domain';
import { createDuckDbCatalogue } from '@workspace-brain/duckdb';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createApiServer } from './server.js';
import {
  apiDurableSubscriptions,
  startWorkspaceBrainApi,
  type StartupBus,
  type StartupCatalogue,
  type StartupDependencies,
  type StartupLogger,
  type StartupServer,
} from './startup.js';

const migrationsDirectory = resolve(
  process.cwd(),
  'infrastructure/duckdb/migrations',
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

type LogEntry = { readonly details: Record<string, unknown>; message: string };

function recordingLogger(): StartupLogger & {
  readonly infos: LogEntry[];
  readonly errors: LogEntry[];
} {
  const infos: LogEntry[] = [];
  const errors: LogEntry[] = [];
  return {
    infos,
    errors,
    info(details, message) {
      infos.push({ details: details as Record<string, unknown>, message });
    },
    error(details, message) {
      errors.push({ details: details as Record<string, unknown>, message });
    },
  };
}

async function loadConfiguration(): Promise<WorkspaceBrainConfig> {
  return parseWorkspaceBrainConfig(
    await readFile(
      resolve(process.cwd(), 'config/workspace-brain.yaml'),
      'utf8',
    ),
  );
}

const builtEvent = {
  eventId: 'built-event',
  eventType: 'SearchProjectionBuilt',
  eventVersion: 1,
  occurredAt: '2026-10-05T00:00:00.000Z',
  producer: 'workspace-brain-api',
  correlationId: 'startup',
  idempotencyKey: 'search-projection-built:startup',
  partitionKey: 'source',
  payload: {},
} as unknown as DiscoveryEvent;

type HarnessOptions = {
  readonly rebuild?: () => Promise<readonly unknown[]>;
  readonly publish?: (event: DiscoveryEvent) => Promise<void>;
  readonly knowledgeEvidence?: readonly unknown[];
  readonly openCatalogue?: () => Promise<never>;
  readonly loadConfiguration?: () => Promise<WorkspaceBrainConfig>;
  readonly registerConfiguration?: () => Promise<void>;
  readonly listen?: () => Promise<void>;
  readonly discoverySources?: readonly DiscoverySource[];
  readonly listSources?: () => Promise<void>;
};

function createHarness(options: HarnessOptions = {}) {
  const calls: string[] = [];
  const closes = { server: 0, bus: 0, catalogue: 0 };
  const published: DiscoveryEvent[] = [];
  const marked: string[] = [];
  const subscriptions: string[] = [];
  const requestSubjects: string[] = [];
  const requestHandlers = new Map<
    string,
    (body: unknown) => Promise<unknown>
  >();
  const rebuildRequests: unknown[] = [];
  const sourceRequests: unknown[] = [];
  let pending: DiscoveryEvent[] = [builtEvent];
  const logger = recordingLogger();
  const serverLogger = recordingLogger();

  const catalogue = {
    async registerConfiguration() {
      calls.push('registerConfiguration');
      await options.registerConfiguration?.();
    },
    async listSourcesForDiscovery(request: {
      readonly afterId?: string;
      readonly limit: number;
    }) {
      calls.push('listSourcesForDiscovery');
      sourceRequests.push(request);
      await options.listSources?.();
      return {
        items: (options.discoverySources ?? [])
          .filter(
            (source) =>
              request.afterId === undefined ||
              source.sourceId > request.afterId,
          )
          .slice(0, request.limit),
      };
    },
    async rebuildSearchProjections(request: unknown) {
      calls.push('rebuildSearchProjections');
      rebuildRequests.push(request);
      return options.rebuild === undefined
        ? [{ publicationId: 'publication' }]
        : options.rebuild();
    },
    async listPendingDiscoveryEvents() {
      const events = pending;
      pending = [];
      return events;
    },
    async markDiscoveryEventPublished(eventId: string) {
      marked.push(eventId);
    },
    async listKnowledgeInputEvidence() {
      return options.knowledgeEvidence ?? [];
    },
    async check() {},
    async close() {
      closes.catalogue += 1;
      calls.push('catalogue.close');
    },
  } as unknown as StartupCatalogue;
  const bus: StartupBus = {
    async publish(event) {
      if (options.publish !== undefined) {
        await options.publish(event);
      }
      published.push(event);
    },
    async subscribe(subject) {
      subscriptions.push(subject);
    },
    subscribeRequests(subject, handler) {
      requestSubjects.push(subject);
      requestHandlers.set(subject, handler);
    },
    async close() {
      closes.bus += 1;
      calls.push('bus.close');
    },
  };
  const server: StartupServer = {
    async listen() {
      calls.push('listen');
      await options.listen?.();
    },
    async close() {
      closes.server += 1;
      calls.push('server.close');
    },
    log: serverLogger,
  };
  let serversCreated = 0;
  let busesConnected = 0;
  const dependencies: StartupDependencies<StartupCatalogue> = {
    openCatalogue:
      options.openCatalogue ??
      (async () => {
        calls.push('openCatalogue');
        return catalogue;
      }),
    loadConfiguration: options.loadConfiguration ?? loadConfiguration,
    async connectBus() {
      busesConnected += 1;
      calls.push('connectBus');
      return bus;
    },
    createServer() {
      serversCreated += 1;
      return server;
    },
    logger,
    host: '127.0.0.1',
    port: 3000,
  };
  return {
    dependencies,
    calls,
    closes,
    published,
    marked,
    subscriptions,
    requestSubjects,
    requestHandlers,
    rebuildRequests,
    sourceRequests,
    logger,
    serverLogger,
    serversCreated: () => serversCreated,
    busesConnected: () => busesConnected,
  };
}

describe('API startup orchestration', () => {
  it('serves paginated discovery configuration without queuing behind publication work', async () => {
    const sources: DiscoverySource[] = Array.from({ length: 201 }, () => ({
      sourceId: createSourceId(),
      roots: [],
      workspaceRules: [],
      excludedDirectoryNames: ['.git'],
      includeExtensions: ['.md'],
      maxFileSizeBytes: 1024,
    })).sort((left, right) =>
      left.sourceId < right.sourceId
        ? -1
        : left.sourceId > right.sourceId
          ? 1
          : 0,
    );
    let catalogueAvailable = true;
    const harness = createHarness({
      discoverySources: sources,
      listSources: async () => {
        if (!catalogueAvailable) {
          throw new Error('Catalogue is busy processing publications');
        }
      },
    });
    const api = await startWorkspaceBrainApi(harness.dependencies);
    try {
      expect(harness.sourceRequests).toEqual([
        { limit: 100 },
        { afterId: sources[99]!.sourceId, limit: 100 },
        { afterId: sources[199]!.sourceId, limit: 100 },
      ]);
      expect(harness.calls.indexOf('listSourcesForDiscovery')).toBeLessThan(
        harness.calls.indexOf('connectBus'),
      );
      catalogueAvailable = false;
      const handler = harness.requestHandlers.get(
        'workspace.catalogue.discovery.sources',
      )!;
      for (let offset = 0; offset < sources.length; offset += 100) {
        expect(
          await handler({
            ...(offset === 0 ? {} : { afterId: sources[offset - 1]!.sourceId }),
            limit: 100,
          }),
        ).toEqual({ items: sources.slice(offset, offset + 100) });
      }
      expect(
        await handler({ afterId: sources.at(-1)!.sourceId, limit: 100 }),
      ).toEqual({ items: [] });
      expect(await handler({ limit: 1 })).toEqual({
        items: sources.slice(0, 1),
      });
      await expect(handler({ limit: 101 })).rejects.toThrow();
      expect(harness.sourceRequests).toHaveLength(3);
    } finally {
      await api.close();
    }
  });

  it('keeps large knowledge evidence replies below the NATS payload limit', async () => {
    const evidenceCount = 200;
    const harness = createHarness({
      knowledgeEvidence: Array.from({ length: evidenceCount }, (_, index) => ({
        evidence: {
          excerpt: `${index}: ${'x'.repeat(4_000)}`,
        },
      })),
    });
    const api = await startWorkspaceBrainApi(harness.dependencies);
    const handler = harness.requestHandlers.get(
      'workspace.catalogue.knowledge.document-evidence',
    );
    if (handler === undefined) {
      throw new Error('Knowledge evidence request handler was not registered');
    }

    let offset = 0;
    let pageCount = 0;
    let receivedCount = 0;
    while (true) {
      const rawPage = await handler({
        documentVersionId: '01K6JQ3Z5JY0N0WZ3MEGFS9WH0',
        offset,
      });
      const page = rawPage as {
        readonly items: readonly unknown[];
        readonly nextOffset: number | null;
      };
      expect(
        Buffer.byteLength(JSON.stringify(page), 'utf8'),
      ).toBeLessThanOrEqual(512 * 1024);
      pageCount += 1;
      receivedCount += page.items.length;
      if (page.nextOffset === null) {
        break;
      }
      offset = page.nextOffset;
    }

    expect(pageCount).toBeGreaterThan(1);
    expect(receivedCount).toBe(evidenceCount);
    await api.close();
  });

  it('pages oversized extraction contexts without dropping source identities', async () => {
    const context = {
      repositories: [
        { id: 'repository', path: 'root/service', fingerprint: 'a'.repeat(64) },
      ],
      documents: Array.from({ length: 2_000 }, (_, index) => ({
        id: `document-${index}`,
        path: `root/service/${'nested/'.repeat(50)}file-${index}.scala`,
        filename: `file-${index}.scala`,
        fingerprint: 'b'.repeat(64),
      })),
    };
    expect(Buffer.byteLength(JSON.stringify(context), 'utf8')).toBeGreaterThan(
      512 * 1024,
    );
    const harness = createHarness({
      knowledgeEvidence: [
        { evidence: { excerpt: 'source' }, extractionContext: context },
      ],
    });
    const api = await startWorkspaceBrainApi(harness.dependencies);
    const handler = harness.requestHandlers.get(
      'workspace.catalogue.knowledge.document-evidence',
    )!;
    const request = {
      documentVersionId: '01K6JQ3Z5JY0N0WZ3MEGFS9WH0',
      offset: 0,
    };
    await expect(handler(request)).rejects.toThrow(
      'exceeds the NATS response size limit',
    );
    expect(await handler({ ...request, separateContext: true })).toEqual({
      items: [{ evidence: { excerpt: 'source' } }],
      hasExtractionContext: true,
      nextOffset: null,
    });
    const entries: unknown[] = [];
    let offset = 0;
    while (true) {
      const page = (await handler({
        ...request,
        offset,
        contextOnly: true,
      })) as {
        items: unknown[];
        nextOffset: number | null;
      };
      expect(
        Buffer.byteLength(JSON.stringify(page), 'utf8'),
      ).toBeLessThanOrEqual(512 * 1024);
      entries.push(...page.items);
      if (page.nextOffset === null) {
        break;
      }
      expect(page.nextOffset).toBe(offset + page.items.length);
      offset = page.nextOffset;
    }
    expect(entries).toEqual([
      ...context.repositories.map((repository) => ({ repository })),
      ...context.documents.map((document) => ({ document })),
    ]);
    await api.close();
  });

  it('reconciles search projections before listening when reconciliation succeeds', async () => {
    const harness = createHarness();

    const api = await startWorkspaceBrainApi(harness.dependencies);

    expect(harness.calls).toEqual([
      'openCatalogue',
      'registerConfiguration',
      'listSourcesForDiscovery',
      'connectBus',
      'rebuildSearchProjections',
      'listen',
    ]);
    expect(harness.subscriptions).toEqual(
      apiDurableSubscriptions.map(([subject]) => subject),
    );
    expect(harness.requestSubjects).toEqual([
      'workspace.catalogue.discovery.sources',
      'workspace.catalogue.knowledge.document-evidence',
    ]);
    expect(
      await harness.requestHandlers.get(
        'workspace.catalogue.discovery.sources',
      )!({ limit: 100 }),
    ).toEqual({ items: [] });
    expect(harness.rebuildRequests).toEqual([
      {
        mode: 'missing',
        correlationId: expect.stringMatching(/^search-projection-startup:/),
      },
    ]);
    expect(harness.published).toEqual([builtEvent]);
    expect(harness.marked).toEqual([builtEvent.eventId]);
    expect(harness.logger.errors).toEqual([]);
    expect(harness.logger.infos).toEqual([
      {
        details: { publicationCount: 1, correlationId: expect.any(String) },
        message: 'Search projections reconciled with publications',
      },
    ]);
    expect(harness.serverLogger.infos).toEqual([
      { details: { port: 3000 }, message: 'Workspace Brain API listening' },
    ]);
    expect(harness.closes).toEqual({ server: 0, bus: 0, catalogue: 0 });

    await api.close();
  });

  it('starts the API and logs, without reporting success, when projection rebuild fails', async () => {
    const failure = new Error(
      'Publication P references a missing entity version V',
    );
    const harness = createHarness({
      rebuild: () => Promise.reject(failure),
    });

    const api = await startWorkspaceBrainApi(harness.dependencies);

    expect(harness.calls.at(-1)).toBe('listen');
    expect(harness.serverLogger.infos.map(({ message }) => message)).toEqual([
      'Workspace Brain API listening',
    ]);
    expect(harness.logger.errors).toEqual([
      {
        details: {
          err: failure,
          operation: 'search-projection-startup-reconciliation',
          step: 'rebuild-missing-projections',
          correlationId: expect.stringMatching(/^search-projection-startup:/),
        },
        message: expect.stringContaining(
          'Search projection startup reconciliation failed',
        ),
      },
    ]);
    expect(harness.logger.infos).toEqual([]);
    // Already-committed outbox events are still flushed after the failure.
    expect(harness.published).toEqual([builtEvent]);
    expect(harness.closes).toEqual({ server: 0, bus: 0, catalogue: 0 });

    await api.close();
  });

  it('starts the API when flushing the outbox after reconciliation fails', async () => {
    const failure = new Error('NATS publish timed out');
    const harness = createHarness({
      publish: () => Promise.reject(failure),
    });

    const api = await startWorkspaceBrainApi(harness.dependencies);

    expect(harness.calls.at(-1)).toBe('listen');
    expect(harness.marked).toEqual([]);
    expect(harness.logger.errors).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({
          err: failure,
          operation: 'search-projection-startup-reconciliation',
          step: 'publish-pending-outbox-events',
        }),
      }),
    ]);
    expect(harness.logger.infos).toEqual([]);

    await api.close();
  });

  it('keeps authoritative startup failures fatal and releases acquired resources', async () => {
    const catalogueFailure = createHarness({
      openCatalogue: () => Promise.reject(new Error('migration failed')),
    });
    await expect(
      startWorkspaceBrainApi(catalogueFailure.dependencies),
    ).rejects.toThrow('migration failed');
    expect(catalogueFailure.busesConnected()).toBe(0);
    expect(catalogueFailure.serversCreated()).toBe(0);

    const configurationFailure = createHarness({
      loadConfiguration: () =>
        Promise.reject(new Error('invalid core configuration')),
    });
    await expect(
      startWorkspaceBrainApi(configurationFailure.dependencies),
    ).rejects.toThrow('invalid core configuration');
    expect(configurationFailure.closes).toEqual({
      server: 0,
      bus: 0,
      catalogue: 1,
    });
    expect(configurationFailure.busesConnected()).toBe(0);

    const registrationFailure = createHarness({
      registerConfiguration: () =>
        Promise.reject(new Error('catalogue registration failed')),
    });
    await expect(
      startWorkspaceBrainApi(registrationFailure.dependencies),
    ).rejects.toThrow('catalogue registration failed');
    expect(registrationFailure.closes).toEqual({
      server: 0,
      bus: 0,
      catalogue: 1,
    });

    const sourceSnapshotFailure = createHarness({
      listSources: () =>
        Promise.reject(new Error('source configuration could not be read')),
    });
    await expect(
      startWorkspaceBrainApi(sourceSnapshotFailure.dependencies),
    ).rejects.toThrow('source configuration could not be read');
    expect(sourceSnapshotFailure.closes).toEqual({
      server: 0,
      bus: 0,
      catalogue: 1,
    });
    expect(sourceSnapshotFailure.busesConnected()).toBe(0);

    // A projection failure must not mask a later authoritative failure.
    const bindFailure = createHarness({
      rebuild: () => Promise.reject(new Error('projection failed')),
      listen: () => Promise.reject(new Error('EADDRINUSE')),
    });
    await expect(
      startWorkspaceBrainApi(bindFailure.dependencies),
    ).rejects.toThrow('EADDRINUSE');
    expect(bindFailure.closes).toEqual({ server: 1, bus: 1, catalogue: 1 });
    expect(bindFailure.calls.slice(-3)).toEqual([
      'server.close',
      'bus.close',
      'catalogue.close',
    ]);
  });

  it('closes every accepted resource exactly once after a reconciliation failure', async () => {
    const harness = createHarness({
      rebuild: () => Promise.reject(new Error('projection failed')),
    });

    const api = await startWorkspaceBrainApi(harness.dependencies);
    expect(harness.closes).toEqual({ server: 0, bus: 0, catalogue: 0 });

    await Promise.all([api.close(), api.close()]);
    await api.close();

    expect(harness.closes).toEqual({ server: 1, bus: 1, catalogue: 1 });
    expect(harness.calls.slice(-3)).toEqual([
      'server.close',
      'bus.close',
      'catalogue.close',
    ]);
  });

  it('restarts with changed source configuration after child rows have been persisted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workspace-brain-startup-'));
    temporaryDirectories.push(directory);
    let configuration = await loadConfiguration();
    let catalogue:
      Awaited<ReturnType<typeof createDuckDbCatalogue>> | undefined;
    let http: FastifyInstance | undefined;
    const harness = createHarness();
    const dependencies = {
      async openCatalogue() {
        catalogue = await createDuckDbCatalogue(
          join(directory, 'catalogue.duckdb'),
          migrationsDirectory,
        );
        return catalogue;
      },
      async loadConfiguration() {
        return configuration;
      },
      connectBus: harness.dependencies.connectBus,
      createServer(openedCatalogue: StartupCatalogue) {
        http = createApiServer(openedCatalogue, { logger: false });
        return http;
      },
      logger: recordingLogger(),
      host: '127.0.0.1',
      port: 0,
    };
    let api = await startWorkspaceBrainApi(dependencies);

    try {
      const source = (await catalogue!.listSources({ limit: 10 })).items[0]!;
      await catalogue!.persistScan(
        source.id,
        [],
        [
          {
            path: 'README.md',
            filename: 'README.md',
            extension: '.md',
            sizeBytes: 12,
            modifiedAt: '2026-10-01T11:00:00.000Z',
            fingerprint: 'a'.repeat(64),
            discoveryMethod: 'filesystem',
          },
        ],
        '2026-10-01T12:00:00.000Z',
        'startup-registration-scan',
        100,
      );
      const documents = await catalogue!.listDocuments({ limit: 10 });
      await api.close();

      configuration = {
        ...configuration,
        sources: configuration.sources.map((configuredSource) => ({
          ...configuredSource,
          name: `${configuredSource.name} updated`,
          defaults: {
            ...configuredSource.defaults,
            max_file_size_mb: configuredSource.defaults.max_file_size_mb + 1,
          },
        })),
      };

      for (let restart = 0; restart < 2; restart += 1) {
        api = await startWorkspaceBrainApi(dependencies);
        expect(
          (await http!.inject({ method: 'GET', url: '/ready' })).statusCode,
        ).toBe(200);
        expect(await catalogue!.getSource(source.id)).toEqual({
          ...source,
          name: configuration.sources[0]!.name,
          maxFileSizeBytes:
            configuration.sources[0]!.defaults.max_file_size_mb * 1024 * 1024,
        });
        expect(await catalogue!.listDocuments({ limit: 10 })).toEqual(
          documents,
        );
        expect(
          (await catalogue!.listSourcesForDiscovery({ limit: 10 })).items[0]
            ?.maxFileSizeBytes,
        ).toBe(
          configuration.sources[0]!.defaults.max_file_size_mb * 1024 * 1024,
        );
        expect(
          await harness.requestHandlers.get(
            'workspace.catalogue.discovery.sources',
          )!({ limit: 10 }),
        ).toEqual(await catalogue!.listSourcesForDiscovery({ limit: 10 }));
        await api.close();
      }
    } finally {
      await api.close();
    }
  });

  it('serves authoritative and pending search routes from a real catalogue after reconciliation fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workspace-brain-startup-'));
    temporaryDirectories.push(directory);
    const logger = recordingLogger();
    const bus = createHarness().dependencies.connectBus;
    let http: FastifyInstance | undefined;
    let rebuildAttempts = 0;

    const api = await startWorkspaceBrainApi({
      async openCatalogue() {
        const catalogue = await createDuckDbCatalogue(
          join(directory, 'catalogue.duckdb'),
          migrationsDirectory,
        );
        return {
          ...catalogue,
          async rebuildSearchProjections() {
            rebuildAttempts += 1;
            throw new Error('projection storage unavailable');
          },
        };
      },
      loadConfiguration,
      connectBus: bus,
      createServer(catalogue) {
        http = createApiServer(catalogue, { logger: false });
        return http;
      },
      logger,
      host: '127.0.0.1',
      port: 0,
    });

    try {
      expect(rebuildAttempts).toBe(1);
      expect(logger.errors).toHaveLength(1);
      expect(http).toBeDefined();
      const get = async (url: string) => http!.inject({ method: 'GET', url });

      expect((await get('/health')).statusCode).toBe(200);
      expect((await get('/ready')).statusCode).toBe(200);
      const sources = await get('/api/v1/sources');
      expect(sources.statusCode).toBe(200);
      expect(sources.json().items).toHaveLength(1);
      expect((await get('/api/v1/knowledge/publications')).json()).toEqual({
        items: [],
        nextCursor: null,
      });

      for (const url of [
        '/api/v1/search/entities',
        '/api/v1/search/entities?query=lodash&match=exact',
        '/api/v1/search/relationships',
      ]) {
        const response = await get(url);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ items: [], nextCursor: null });
      }
      expect(
        (await get('/api/v1/search/publication/01J00000000000000000000000'))
          .statusCode,
      ).toBe(404);
    } finally {
      await api.close();
    }
    await expect(api.close()).resolves.toBeUndefined();
  });
});
