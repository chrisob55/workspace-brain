import { describe, expect, it } from 'vitest';

import type { KnowledgeEntity } from './types';
import {
  decodePublishedJourney,
  journeyMatches,
  resolveJourneyEntityReference,
} from './journeys';

const journey = {
  id: 'a'.repeat(64),
  name: 'GET /subscriptions/:id (static candidate)',
  description: 'A deterministic source-level candidate.',
  sourceServices: ['services.SubscriptionService'],
  confidence: 'derived',
  completeness: 'partial',
  provenance: [
    {
      id: 'evidence-1',
      kind: 'evidence',
      label: 'SubscriptionController.scala',
      documentPath: 'source/repo/app/controllers/SubscriptionController.scala',
    },
  ],
  steps: [
    {
      id: 'route-0',
      type: 'HttpRouteStep',
      method: 'GET',
      route: '/subscriptions/:id',
      evidenceBasis: 'proven',
      order: 'entry',
      provenance: [
        {
          id: 'evidence-1',
          kind: 'evidence',
          label: 'route declaration',
        },
      ],
    },
    {
      id: 'call-1',
      type: 'UnresolvedCallStep',
      targetExpression: 'service.accept(id)',
      reason: 'unresolved',
      evidenceBasis: 'unresolved',
      order: 'source-order',
      provenance: [
        {
          id: 'evidence-1',
          kind: 'evidence',
          label: 'controller call',
        },
      ],
    },
  ],
  transitions: [
    {
      id: 'transition-0',
      type: 'RouteDispatch',
      from: 'route-0',
      to: 'call-1',
      order: 'source-order',
      provenance: [],
      certainty: 'unresolved',
    },
  ],
  entityReferences: [
    {
      entityKey: 'module:services.SubscriptionService',
      role: 'service',
      label: 'services.SubscriptionService',
    },
  ],
  relationshipReferences: [],
  unresolvedBoundaries: [
    {
      key: 'call-1',
      reason: 'unresolved',
      target: 'service.accept(id)',
    },
  ],
  diagnostics: [],
};

const entity: KnowledgeEntity = {
  id: '01J00000000000000000000000',
  knowledgeModelId: '01J00000000000000000000001',
  name: journey.name,
  type: 'journey',
  lifecycleStatus: 'observed',
  provenance: [
    {
      contentFingerprint: 'a'.repeat(64),
      documentId: '01J00000000000000000000002',
      documentPath: 'source/repo/app/controllers/SubscriptionController.scala',
      documentVersionId: '01J00000000000000000000003',
      evidenceId: '01J00000000000000000000004',
      extractionRuleId: 'scala-symbols',
      extractionRuleVersion: 1,
      locator: {
        kind: 'text-lines',
        lineStart: 1,
        lineEnd: 2,
      },
      processorId: 'scala-source',
      processorVersion: 1,
      sourceId: '01J00000000000000000000005',
      facts: { journeyJson: JSON.stringify(journey) },
    },
  ],
  sourceEvidenceIds: ['01J00000000000000000000004'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('published Journey decoding', () => {
  it('links only exact published IDs, even when multiple entities share a name', () => {
    const first = {
      ...entity,
      id: 'service-a',
      type: 'module',
      name: 'services.SharedService',
    };
    const second = { ...first, id: 'service-b' };
    expect(
      resolveJourneyEntityReference([first, second], {
        entityId: second.id,
        entityType: 'module',
      }),
    ).toBe(second);
    expect(resolveJourneyEntityReference([first], {})).toBeUndefined();
    expect(
      resolveJourneyEntityReference([first], { entityId: second.id }),
    ).toBeUndefined();
    expect(
      resolveJourneyEntityReference([first], {
        entityId: first.id,
        entityType: 'api',
      }),
    ).toBeUndefined();
  });

  it('preserves published graph references and rejects malformed resolved references', () => {
    const reference = {
      ...journey.entityReferences[0]!,
      entityId: entity.id,
      entityType: 'module',
      displayName: 'Published component',
    };
    const withReferences = {
      ...entity,
      provenance: entity.provenance.map((item) => ({
        ...item,
        facts: {
          journeyJson: JSON.stringify({
            ...journey,
            entityReferences: [reference],
          }),
        },
      })),
    };
    expect(
      decodePublishedJourney(withReferences).journey?.entityReferences,
    ).toEqual([reference]);
    const malformed = {
      ...withReferences,
      provenance: withReferences.provenance.map((item) => ({
        ...item,
        facts: {
          journeyJson: JSON.stringify({
            ...journey,
            entityReferences: [{ ...reference, entityType: undefined }],
          }),
        },
      })),
    };
    expect(decodePublishedJourney(malformed).error).toMatch(/does not match/);
  });
  it('decodes published step and transition subjects and searches their display names', () => {
    const subject = {
      role: 'operation',
      label: 'GET /subscriptions/:id',
      entityId: '01J00000000000000000000006',
      entityType: 'operation',
      displayName: 'Subscription route operation',
    };
    const encode = (model: unknown) => ({
      ...entity,
      provenance: entity.provenance.map((item) => ({
        ...item,
        facts: { journeyJson: JSON.stringify(model) },
      })),
    });
    const withSubjects = {
      ...journey,
      steps: [{ ...journey.steps[0]!, subject }, journey.steps[1]!],
      transitions: [{ ...journey.transitions[0]!, fromSubject: subject }],
    };
    const decoded = decodePublishedJourney(encode(withSubjects)).journey!;
    expect(decoded.steps[0]?.subject).toEqual(subject);
    expect(decoded.transitions[0]?.fromSubject).toEqual(subject);
    expect(journeyMatches(decoded, 'route operation')).toBe(true);
    expect(
      decodePublishedJourney(
        encode({
          ...withSubjects,
          steps: [
            { ...journey.steps[0]!, subject: { ...subject, displayName: 1 } },
          ],
        }),
      ).error,
    ).toMatch(/does not match/);
  });

  it('decodes publication data without filling unresolved boundaries', () => {
    const result = decodePublishedJourney(entity);
    expect(result.journey?.steps[1]?.type).toBe('UnresolvedCallStep');
    expect(result.journey?.unresolvedBoundaries).toEqual([
      expect.objectContaining({ target: 'service.accept(id)' }),
    ]);
    expect(journeyMatches(result.journey!, 'SubscriptionService')).toBe(true);
    expect(journeyMatches(result.journey!, 'accepted')).toBe(false);
  });

  it('reports malformed or ambiguous serialized models', () => {
    const invalid = {
      ...entity,
      provenance: entity.provenance.map((item) => ({
        ...item,
        facts: { journeyJson: '{' },
      })),
    };
    const ambiguous = {
      ...entity,
      provenance: [...entity.provenance, ...entity.provenance],
    };
    expect(decodePublishedJourney(invalid).error).toMatch(/invalid JSON/);
    expect(decodePublishedJourney(ambiguous).error).toMatch(/one serialized/);
  });
});
