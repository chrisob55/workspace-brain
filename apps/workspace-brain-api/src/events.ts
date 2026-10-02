import { randomUUID } from 'node:crypto';

import type {
  DiscoveryEvent,
  DiscoveryEventName,
  DiscoveryEventPayloads,
  SourceId,
} from '@workspace-brain/domain';

export type InternalEventPublisher = {
  publish(event: DiscoveryEvent): Promise<void>;
};

export function createDiscoveryEvent<Name extends DiscoveryEventName>(
  eventType: Name,
  payload: DiscoveryEventPayloads[Name],
  producer: DiscoveryEvent['producer'],
  correlationId: string,
  idempotencyKey: string,
  partitionKey: SourceId,
): DiscoveryEvent {
  return {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    producer,
    correlationId,
    idempotencyKey,
    partitionKey,
    payload,
  } as DiscoveryEvent;
}
