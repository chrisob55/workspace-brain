import type { Logger } from 'pino';
import type { Source } from '@workspace-brain/domain';

import type { ScanResult } from './scanner.js';

export type ScanRequestedHandler = (
  source: Source,
  correlationId: string,
) => Promise<ScanResult>;

export interface EventConsumer {
  start(onScanRequested: ScanRequestedHandler): Promise<void>;
  stop(): Promise<void>;
}

export class StubEventConsumer implements EventConsumer {
  private keepAlive: NodeJS.Timeout | undefined;

  constructor(private readonly logger: Logger) {}

  async start(onScanRequested: ScanRequestedHandler): Promise<void> {
    this.logger.warn(
      { scanHandlerRegistered: typeof onScanRequested === 'function' },
      'NATS event consumption is not configured; ingestion worker is idle',
    );
    // Keep the placeholder worker alive until the NATS consumer is implemented.
    this.keepAlive = setInterval(() => undefined, 60_000);
  }

  async stop(): Promise<void> {
    if (this.keepAlive !== undefined) {
      clearInterval(this.keepAlive);
      this.keepAlive = undefined;
    }
  }
}
