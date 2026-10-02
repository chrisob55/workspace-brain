import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type {
  CataloguePage,
  CataloguePageRequest,
} from '@workspace-brain/catalogue';
import type {
  DiscoveryEvent,
  DiscoverySource,
  ScanResult,
  SourceId,
} from '@workspace-brain/domain';
import type { NatsDiscoveryBus } from '@workspace-brain/nats';
import type { Logger } from 'pino';

import type { SourceScanner } from './scanner.js';

const sourceListSubject = 'workspace.catalogue.discovery.sources';
type WorkerLogger = Pick<Logger, 'error' | 'info'>;

export type EventConsumer = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export class NatsEventConsumer implements EventConsumer {
  private readonly sources = new Map<SourceId, DiscoverySource>();
  private scheduleTimer: NodeJS.Timeout | undefined;
  private scheduledScan: Promise<void> | undefined;

  constructor(
    private readonly scanner: SourceScanner,
    private readonly bus: NatsDiscoveryBus,
    private readonly logger: WorkerLogger,
    private readonly scanIntervalMilliseconds: number,
  ) {
    if (
      !Number.isSafeInteger(scanIntervalMilliseconds) ||
      scanIntervalMilliseconds < 1
    ) {
      throw new Error('SCAN_INTERVAL_MS must be a positive safe integer');
    }
  }

  async start(): Promise<void> {
    await this.refreshAndRequestScans();
    await this.bus.subscribe(
      'workspace.discovery.source.scan.requested',
      'workspace-ingestion-scan-requested',
      (event) => this.handleScanRequested(event),
    );
    this.scheduleTimer = setInterval(() => {
      void this.refreshAndRequestScans().catch((error: unknown) => {
        this.logger.error(
          { err: error },
          'scheduled source scan request failed',
        );
      });
    }, this.scanIntervalMilliseconds);
    this.scheduleTimer.unref();
  }

  async stop(): Promise<void> {
    if (this.scheduleTimer !== undefined) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = undefined;
    }
    await this.bus.close();
  }

  private async refreshAndRequestScans(): Promise<void> {
    if (this.scheduledScan !== undefined) {
      return this.scheduledScan;
    }
    const current = this.requestAllScans().finally(() => {
      if (this.scheduledScan === current) {
        this.scheduledScan = undefined;
      }
    });
    this.scheduledScan = current;
    return current;
  }

  private async requestAllScans(): Promise<void> {
    let afterId: string | undefined;
    while (true) {
      const request: CataloguePageRequest = {
        ...(afterId === undefined ? {} : { afterId }),
        limit: 100,
      };
      const page = await this.bus.request<CataloguePage<DiscoverySource>>(
        sourceListSubject,
        request,
      );
      for (const source of page.items) {
        this.sources.set(source.sourceId, source);
        await this.bus.publish(
          createWorkerEvent(
            'SourceScanRequested',
            { sourceId: source.sourceId },
            source.sourceId,
            `source-scan-requested:${source.sourceId}:${randomUUID()}`,
          ),
        );
      }
      if (page.items.length < request.limit) {
        break;
      }
      afterId = page.items.at(-1)?.sourceId;
      if (afterId === undefined) {
        throw new Error(
          'Discovery source provider returned an invalid full page',
        );
      }
    }
  }

  private async handleScanRequested(event: DiscoveryEvent): Promise<void> {
    if (event.eventType !== 'SourceScanRequested') {
      throw new Error(`Unexpected worker event: ${event.eventType}`);
    }
    const source = this.sources.get(event.payload.sourceId);
    if (source === undefined) {
      throw new Error(
        `Discovery source ${event.payload.sourceId} is unavailable`,
      );
    }

    const startedAt = new Date().toISOString();
    const startedAtMonotonic = performance.now();
    await this.bus.publish(
      createWorkerEvent(
        'SourceScanStarted',
        { sourceId: source.sourceId, startedAt },
        source.sourceId,
        `source-scan-started:${event.correlationId}`,
        event.correlationId,
      ),
    );
    let scan: ScanResult;
    try {
      scan = await this.scanner.scan(source);
      if (scan.sourceId !== source.sourceId) {
        throw new Error('Scanner returned inventory for a different source');
      }
    } catch (error) {
      const failureType = error instanceof Error ? error.name : 'UnknownError';
      await this.bus.publish(
        createWorkerEvent(
          'SourceScanFailed',
          {
            sourceId: source.sourceId,
            failedAt: new Date().toISOString(),
            durationMilliseconds: performance.now() - startedAtMonotonic,
            failureType,
          },
          source.sourceId,
          `source-scan-failed:${event.correlationId}`,
          event.correlationId,
        ),
      );
      this.logger.error(
        {
          err: error,
          sourceId: source.sourceId,
          correlationId: event.correlationId,
        },
        'source scan failed',
      );
      return;
    }
    await this.bus.publish(
      createWorkerEvent(
        'SourceInventorySubmitted',
        {
          scan,
          durationMilliseconds: performance.now() - startedAtMonotonic,
        },
        source.sourceId,
        `source-inventory-submitted:${event.correlationId}`,
        event.correlationId,
      ),
    );
    this.logger.info(
      {
        sourceId: source.sourceId,
        correlationId: event.correlationId,
        repositoryCount: scan.repositories.length,
        documentCount: scan.documents.length,
      },
      'source inventory submitted',
    );
  }
}

function createWorkerEvent<Name extends DiscoveryEvent['eventType']>(
  eventType: Name,
  payload: Extract<DiscoveryEvent, { eventType: Name }>['payload'],
  sourceId: SourceId,
  idempotencyKey: string,
  correlationId: string = randomUUID(),
): DiscoveryEvent {
  return {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    producer: 'workspace-brain-ingestion-worker',
    correlationId,
    idempotencyKey,
    partitionKey: sourceId,
    payload,
  } as DiscoveryEvent;
}
