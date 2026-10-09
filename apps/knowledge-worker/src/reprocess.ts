import { randomUUID } from 'node:crypto';
import { parseSourceId } from '@workspace-brain/domain';
import { connectNatsDiscoveryBus } from '@workspace-brain/nats';
import pino from 'pino';
import { z } from 'zod';
import { submitDocumentProcessing } from './worker.js';

const logger = pino({ timestamp: pino.stdTimeFunctions.isoTime });
const base = new URL(process.env.API_URL ?? 'http://localhost:3000');
const sourceId =
  process.env.SOURCE_ID === undefined
    ? undefined
    : parseSourceId(process.env.SOURCE_ID);
const bus = await connectNatsDiscoveryBus(
  process.env.NATS_SERVERS ?? 'nats://nats:4222',
  logger,
);
const pageSchema = z
  .object({ items: z.array(z.unknown()), nextCursor: z.string().nullable() })
  .strict();
const correlationId = `architectural-reprocessing:${randomUUID()}`;
let submitted = 0;
let unsupported = 0;
try {
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const url = new URL('/api/v1/documents', base);
    url.searchParams.set('limit', '100');
    if (sourceId !== undefined) url.searchParams.set('sourceId', sourceId);
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(
        `Document inventory request failed with HTTP ${response.status}`,
      );
    const page = pageSchema.parse((await response.json()) as unknown);
    for (const document of page.items) {
      const result = await submitDocumentProcessing(
        document,
        bus,
        logger,
        correlationId,
      );
      if (result === 'submitted') submitted += 1;
      else unsupported += 1;
    }
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (seen.has(cursor))
        throw new Error('Document inventory returned a repeated cursor');
      seen.add(cursor);
    }
  } while (cursor !== null);
  logger.info(
    { correlationId, submitted, unsupported },
    'document reprocessing submitted; publication completion requires API/worker consumption',
  );
} finally {
  await bus.close();
}
