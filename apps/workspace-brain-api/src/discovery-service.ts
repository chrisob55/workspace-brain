import type { CatalogueDiscovery } from '@workspace-brain/catalogue';
import type { WorkspaceBrainConfig } from '@workspace-brain/configuration';
import type { DiscoveryEvent } from '@workspace-brain/domain';

import type { InternalEventPublisher } from './events.js';

export type DiscoveryService = {
  handle(event: DiscoveryEvent): Promise<void>;
};

type DiscoveryCatalogue = Pick<
  CatalogueDiscovery,
  | 'getSource'
  | 'persistScan'
  | 'listPendingDiscoveryEvents'
  | 'markDiscoveryEventPublished'
  | 'recordScanStarted'
  | 'recordScanFailed'
  | 'applyDocumentProcessing'
>;

export function createDiscoveryService(
  catalogue: DiscoveryCatalogue,
  events: InternalEventPublisher,
): DiscoveryService {
  return {
    async handle(event) {
      if (event.eventType === 'SourceScanRequested') {
        return;
      }

      if (event.eventType === 'SourceScanCompleted') {
        return;
      }

      if (event.eventType === 'SourceScanStarted') {
        await catalogue.recordScanStarted(
          event.payload.sourceId,
          event.correlationId,
          event.payload.startedAt,
        );
        return;
      }

      if (event.eventType === 'SourceScanFailed') {
        await catalogue.recordScanFailed(
          event.payload.sourceId,
          event.correlationId,
          event.payload.failedAt,
          event.payload.durationMilliseconds,
          event.payload.failureType,
        );
        return;
      }

      if (event.eventType === 'DocumentProcessingSubmitted') {
        const { candidate } = event.payload;
        if (
          event.producer !== 'workspace-brain-knowledge-worker' ||
          event.partitionKey !== candidate.sourceId
        ) {
          throw new Error(
            'Document processing source does not match event ownership',
          );
        }
        await catalogue.applyDocumentProcessing(event);
        await publishPendingEvents(catalogue, events);
        return;
      }

      if (event.eventType !== 'SourceInventorySubmitted') {
        throw new Error(`Unexpected discovery event: ${event.eventType}`);
      }

      const { scan } = event.payload;
      if (scan.sourceId !== event.partitionKey) {
        throw new Error('Inventory source does not match event partition');
      }
      const source = await catalogue.getSource(scan.sourceId);
      if (source === undefined) {
        throw new Error(`Source ${scan.sourceId} is not registered`);
      }
      const rootIds = new Set<string>((source.roots ?? []).map(({ id }) => id));
      for (const candidate of scan.repositories) {
        if (!isSafeInventoryPath(candidate.path, rootIds, true)) {
          throw new Error('Inventory path is outside registered source roots');
        }
      }
      for (const candidate of scan.documents) {
        if (
          !isSafeInventoryPath(candidate.path, rootIds, false) ||
          candidate.filename !== candidate.path.split('/').at(-1)
        ) {
          throw new Error('Inventory path is outside registered source roots');
        }
      }
      await catalogue.persistScan(
        scan.sourceId,
        scan.repositories,
        scan.documents,
        scan.discoveredAt,
        event.correlationId,
        event.payload.durationMilliseconds,
      );
      await publishPendingEvents(catalogue, events);
    },
  };
}

function isSafeInventoryPath(
  path: string,
  registeredRootIds: ReadonlySet<string>,
  allowRootPath: boolean,
): boolean {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0')
  ) {
    return false;
  }
  const segments = path.split('/');
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..',
    ) ||
    !registeredRootIds.has(segments[0] ?? '') ||
    (!allowRootPath && segments.length < 2)
  ) {
    return false;
  }
  return true;
}

async function publishPendingEvents(
  catalogue: DiscoveryCatalogue,
  events: InternalEventPublisher,
): Promise<void> {
  while (true) {
    const pending = await catalogue.listPendingDiscoveryEvents(100);
    if (pending.length === 0) {
      return;
    }
    for (const event of pending) {
      await events.publish(event);
      await catalogue.markDiscoveryEventPublished(
        event.eventId,
        new Date().toISOString(),
      );
    }
  }
}

export function configForCatalogue(config: WorkspaceBrainConfig): {
  readonly sources: Parameters<CatalogueDiscovery['registerConfiguration']>[0];
  readonly workspaces: Parameters<
    CatalogueDiscovery['registerConfiguration']
  >[1];
} {
  return {
    sources: config.sources.map((source) => ({
      configId: source.id,
      name: source.name,
      rootPaths: source.roots,
      excludeDirs: source.defaults.exclude_dirs,
      includeExtensions: source.defaults.include_extensions,
      maxFileSizeBytes: source.defaults.max_file_size_mb * 1024 * 1024,
    })),
    workspaces: config.workspaces.map((workspace) => ({
      configId: workspace.id,
      name: workspace.name,
      sourceConfigIds: workspace.sourceIds,
      include: workspace.include,
      exclude: workspace.exclude,
    })),
  };
}
