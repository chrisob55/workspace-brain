import { randomUUID } from 'node:crypto';

import type {
  CatalogueDiscovery,
  CatalogueHealth,
} from '@workspace-brain/catalogue';
import type { WorkspaceBrainConfig } from '@workspace-brain/configuration';
import {
  discoveryEventSubject,
  type KnowledgeInputEvidence,
} from '@workspace-brain/domain';
import type { NatsDiscoveryBus } from '@workspace-brain/nats';
import { z } from 'zod';

import {
  configForCatalogue,
  createDiscoveryService,
  publishPendingEvents,
} from './discovery-service.js';
import type { InternalEventPublisher } from './events.js';

export type StartupCatalogue = CatalogueDiscovery & CatalogueHealth;

export type StartupBus = Pick<
  NatsDiscoveryBus,
  'publish' | 'subscribe' | 'subscribeRequests' | 'close'
>;

export type StartupLogger = {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
};

export type StartupServer = {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
  readonly log: StartupLogger;
};

export type StartupDependencies<Catalogue extends StartupCatalogue> = {
  readonly openCatalogue: () => Promise<Catalogue>;
  readonly loadConfiguration: () => Promise<WorkspaceBrainConfig>;
  readonly connectBus: () => Promise<StartupBus>;
  readonly createServer: (catalogue: Catalogue) => StartupServer;
  readonly logger: StartupLogger;
  readonly host: string;
  readonly port: number;
};

export type RunningApi = {
  readonly server: StartupServer;
  close(): Promise<void>;
};

export type SearchProjectionStartupResult =
  | { readonly status: 'reconciled'; readonly publicationCount: number }
  | {
      readonly status: 'failed';
      readonly failedSteps: readonly SearchProjectionStartupStep[];
    };

type SearchProjectionStartupStep =
  'rebuild-missing-projections' | 'publish-pending-outbox-events';

const sourcePageSchema = z
  .object({
    afterId: z.string().optional(),
    limit: z.number().int().min(1).max(100),
  })
  .strict();
const maximumKnowledgeEvidenceResponseBytes = 512 * 1024;
const maximumKnowledgeEvidencePageItems = 128;
const knowledgeEvidenceRequestSchema = z
  .object({
    documentVersionId: z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    offset: z.number().int().nonnegative(),
  })
  .strict();

function createKnowledgeEvidencePage(
  evidence: readonly KnowledgeInputEvidence[],
  offset: number,
): {
  readonly items: readonly KnowledgeInputEvidence[];
  readonly nextOffset: number | null;
} {
  const items: KnowledgeInputEvidence[] = [];
  while (
    offset + items.length < evidence.length &&
    items.length < maximumKnowledgeEvidencePageItems
  ) {
    const nextItems = [...items, evidence[offset + items.length]!];
    const nextOffset = offset + nextItems.length;
    const candidate = {
      items: nextItems,
      nextOffset: nextOffset < evidence.length ? nextOffset : null,
    };
    if (
      Buffer.byteLength(JSON.stringify(candidate), 'utf8') >
      maximumKnowledgeEvidenceResponseBytes
    ) {
      if (items.length === 0) {
        throw new Error(
          `Knowledge evidence item at offset ${offset} exceeds the NATS response size limit`,
        );
      }
      break;
    }
    items.push(evidence[offset + items.length]!);
  }

  const nextOffset = offset + items.length;
  return {
    items,
    nextOffset: nextOffset < evidence.length ? nextOffset : null,
  };
}

export const apiDurableSubscriptions = [
  [
    'workspace.discovery.source.scan.started',
    'workspace-api-source-scan-started',
  ],
  [
    'workspace.discovery.source.inventory.submitted',
    'workspace-api-source-inventory-submitted',
  ],
  [
    'workspace.discovery.source.scan.failed',
    'workspace-api-source-scan-failed',
  ],
  [
    discoveryEventSubject('DocumentProcessingSubmitted'),
    'workspace-api-document-processing-submitted',
  ],
  [
    discoveryEventSubject('KnowledgeCandidatesSubmitted'),
    'workspace-api-knowledge-candidates-submitted',
  ],
  [
    discoveryEventSubject('KnowledgeModelPublished'),
    'workspace-api-search-projection-publication',
  ],
  [
    discoveryEventSubject('SearchProjectionRequested'),
    'workspace-api-search-projection-requested',
  ],
] as const;

/**
 * Starts the API. Catalogue, configuration, NATS and HTTP failures are fatal
 * and release every acquired resource. Search projection reconciliation is
 * best-effort: the projection is a rebuildable cache (ADD principle 10 and
 * degradation guidance), so its
 * failure is logged and leaves projections pending instead of blocking the
 * authoritative catalogue API.
 */
export async function startWorkspaceBrainApi<
  Catalogue extends StartupCatalogue,
>(dependencies: StartupDependencies<Catalogue>): Promise<RunningApi> {
  const catalogue = await dependencies.openCatalogue();
  let bus: StartupBus | undefined;
  let server: StartupServer | undefined;

  try {
    const registration = configForCatalogue(
      await dependencies.loadConfiguration(),
    );
    await catalogue.registerConfiguration(
      registration.sources,
      registration.workspaces,
    );

    bus = await dependencies.connectBus();
    const discovery = createDiscoveryService(
      catalogue,
      bus,
      dependencies.logger,
    );
    bus.subscribeRequests(
      'workspace.catalogue.discovery.sources',
      async (body) => {
        const request = sourcePageSchema.parse(body);
        return catalogue.listSourcesForDiscovery({
          ...(request.afterId === undefined
            ? {}
            : { afterId: request.afterId }),
          limit: request.limit,
        });
      },
    );
    bus.subscribeRequests(
      'workspace.catalogue.knowledge.document-evidence',
      async (body) => {
        const request = knowledgeEvidenceRequestSchema.parse(body);
        const evidence = await catalogue.listKnowledgeInputEvidence(
          request.documentVersionId,
        );
        return createKnowledgeEvidencePage(evidence, request.offset);
      },
    );
    for (const [subject, durableName] of apiDurableSubscriptions) {
      await bus.subscribe(subject, durableName, (event) =>
        discovery.handle(event),
      );
    }

    await reconcileSearchProjectionsAtStartup(
      catalogue,
      bus,
      dependencies.logger,
    );

    server = dependencies.createServer(catalogue);
    await server.listen({ host: dependencies.host, port: dependencies.port });
    server.log.info(
      { port: dependencies.port },
      'Workspace Brain API listening',
    );
  } catch (error) {
    const cleanupErrors = await closeResources(server, bus, catalogue);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'API startup failed and cleanup was incomplete',
        { cause: error },
      );
    }
    throw error;
  }

  const runningServer = server;
  const runningBus = bus;
  let closing: Promise<void> | undefined;
  return {
    server: runningServer,
    close() {
      closing ??= (async () => {
        await runningServer.close();
        await runningBus.close();
        await catalogue.close();
      })();
      return closing;
    },
  };
}

/**
 * Rebuilds missing or outdated search projections and flushes pending outbox
 * events. Never throws: failures are logged and the affected projections stay
 * pending (searches return the existing empty/pending results) until a later
 * SearchProjectionRequested delivery or restart rebuilds them. Each
 * publication's rebuild is transactional, so a failure never records a
 * successful build or emits SearchProjectionBuilt for that publication.
 */
export async function reconcileSearchProjectionsAtStartup(
  catalogue: Pick<
    StartupCatalogue,
    | 'rebuildSearchProjections'
    | 'listPendingDiscoveryEvents'
    | 'markDiscoveryEventPublished'
  >,
  events: InternalEventPublisher,
  logger: StartupLogger,
): Promise<SearchProjectionStartupResult> {
  const correlationId = `search-projection-startup:${randomUUID()}`;
  const failedSteps: SearchProjectionStartupStep[] = [];
  let publicationCount = 0;
  try {
    publicationCount = (
      await catalogue.rebuildSearchProjections({
        mode: 'missing',
        correlationId,
      })
    ).length;
  } catch (error) {
    failedSteps.push('rebuild-missing-projections');
    logReconciliationFailure(
      logger,
      'rebuild-missing-projections',
      correlationId,
      error,
    );
  }
  // Flush even after a rebuild failure: earlier publications may have
  // committed SearchProjectionBuilt events. Unpublished events stay in the
  // transactional outbox and are retried by the next publish.
  try {
    await publishPendingEvents(catalogue, events);
  } catch (error) {
    failedSteps.push('publish-pending-outbox-events');
    logReconciliationFailure(
      logger,
      'publish-pending-outbox-events',
      correlationId,
      error,
    );
  }
  if (failedSteps.length > 0) {
    return { status: 'failed', failedSteps };
  }
  logger.info(
    { publicationCount, correlationId },
    'Search projections reconciled with publications',
  );
  return { status: 'reconciled', publicationCount };
}

function logReconciliationFailure(
  logger: StartupLogger,
  step: SearchProjectionStartupStep,
  correlationId: string,
  error: unknown,
): void {
  logger.error(
    {
      err: error,
      operation: 'search-projection-startup-reconciliation',
      step,
      correlationId,
    },
    'Search projection startup reconciliation failed; affected projections remain pending and the API continues without them',
  );
}

async function closeResources(
  server: StartupServer | undefined,
  bus: StartupBus | undefined,
  catalogue: CatalogueHealth,
): Promise<unknown[]> {
  const cleanupErrors: unknown[] = [];
  for (const close of [
    server === undefined ? undefined : () => server.close(),
    bus === undefined ? undefined : () => bus.close(),
    () => catalogue.close(),
  ]) {
    if (close === undefined) {
      continue;
    }
    try {
      await close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  return cleanupErrors;
}
