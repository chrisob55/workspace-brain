import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
import {
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createSourceId,
  type KnowledgeEntityCandidate,
  type KnowledgeProvenance,
  type KnowledgeRelationshipCandidate,
} from '@workspace-brain/domain';
import { describe, expect, it } from 'vitest';
import { resolveJourneyReferences } from './journey-references.js';

function fixture() {
  const provenance: KnowledgeProvenance = {
    evidenceId: createEvidenceId(),
    documentVersionId: createDocumentVersionId(),
    documentId: createDocumentId(),
    sourceId: createSourceId(),
    documentPath: 'repo/app/Service.scala',
    contentFingerprint: 'a'.repeat(64),
    locator: {
      kind: 'scala-symbol',
      symbolKind: 'method',
      symbolName: 'Service.get',
      packageName: '',
      lineStart: 1,
      lineEnd: 1,
    },
    processorId: 'scala',
    processorVersion: 1,
    extractionRuleId: 'scala',
    extractionRuleVersion: 1,
    knowledgeExtractorId: 'hmrc',
    knowledgeExtractorVersion: 2,
  };
  const entity = (
    key: string,
    type: KnowledgeEntityCandidate['type'],
  ): KnowledgeEntityCandidate => ({
    key,
    type,
    name: key,
    identityScope: 'repo',
    sourceEvidenceIds: [provenance.evidenceId],
    provenance: [provenance],
    lifecycleStatus: 'observed',
  });
  const references = [
    { entityKey: 'target', role: 'service', label: 'Service' },
    { entityKey: 'document', role: 'document', label: 'Source' },
  ];
  const evidence = [
    { id: provenance.evidenceId, kind: 'evidence', label: 'Call' },
  ];
  const model = {
    unresolvedBoundaries: [],
    entityReferences: references,
    relationshipReferences: [{ relationshipKey: 'uses', type: 'USES' }],
    provenance: evidence,
    steps: [
      {
        id: 'step-id',
        stepEntityKey: 'step',
        entityKey: 'target',
        entityReferences: references,
        provenance: evidence,
      },
    ],
    transitions: [
      {
        from: 'step-id',
        to: 'step-id',
        entityReferences: references,
        relationshipReferences: [{ relationshipKey: 'uses', type: 'USES' }],
        provenance: evidence,
      },
    ],
  };
  const candidate: KnowledgeEntityCandidate = {
    ...entity('journey', 'journey'),
    provenance: [
      { ...provenance, facts: { journeyJson: JSON.stringify(model) } },
    ],
  };
  const entities = new Map(
    [
      entity('target', 'module'),
      entity('document', 'document'),
      entity('step', 'operation'),
    ].map((item) => [item.key, item]),
  );
  const entityIds = new Map(
    [...entities.keys()].map((key) => [key, `published-${key}`]),
  );
  const relationship: KnowledgeRelationshipCandidate = {
    key: 'uses',
    type: 'USES',
    sourceEntityKey: 'step',
    targetEntityKey: 'target',
    sourceEvidenceIds: [provenance.evidenceId],
    provenance: [provenance],
    confidence: 1,
    lifecycleStatus: 'related',
  };
  const relationships = new Map([['uses', relationship]]);
  const relationshipIds = new Map([['uses', 'published-uses']]);
  return {
    candidate,
    entities,
    entityIds,
    relationships,
    relationshipIds,
    model,
    resolve: (input = candidate) =>
      resolveJourneyReferences(
        input,
        entities,
        entityIds,
        relationships,
        relationshipIds,
      ).candidate,
  };
}

describe('published Journey reference resolution', () => {
  it('rejects missing entity and step IDs rather than retaining textual fallbacks', () => {
    for (const key of ['target', 'step', 'document']) {
      const context = fixture();
      context.entityIds.delete(key);
      expect(() => context.resolve()).toThrow(CatalogueIntegrityError);
    }
  });

  it('rejects missing and mismatched relationship identities and endpoints', () => {
    const missing = fixture();
    missing.relationshipIds.clear();
    expect(() => missing.resolve()).toThrow(/unavailable relationship/);
    const mismatch = fixture();
    mismatch.relationships.set('uses', {
      ...mismatch.relationships.get('uses')!,
      type: 'REFERENCES',
    });
    expect(() => mismatch.resolve()).toThrow(/unavailable relationship/);
    const endpoint = fixture();
    endpoint.relationships.set('uses', {
      ...endpoint.relationships.get('uses')!,
      sourceEntityKey: 'unknown',
    });
    expect(() => endpoint.resolve()).toThrow(/unavailable relationship/);
  });

  it('rejects evidence outside the candidate and missing source-document identity', () => {
    const missing = fixture();
    expect(() =>
      missing.resolve({
        ...missing.candidate,
        provenance: missing.candidate.provenance.map((item) => ({
          ...item,
          evidenceId: createEvidenceId(),
        })),
      }),
    ).toThrow(/unavailable evidence/);
    const document = fixture();
    const original = document.entities.get('document')!;
    document.entities.set('document', { ...original, provenance: [] });
    expect(() => document.resolve()).toThrow(/no unique source document/);
  });

  it('rejects a component masquerading as a source document or step operation', () => {
    const document = fixture();
    document.entities.set('document', {
      ...document.entities.get('document')!,
      type: 'module',
    });
    expect(() => document.resolve()).toThrow(/no unique source document/);
    const step = fixture();
    step.entities.set('step', {
      ...step.entities.get('step')!,
      type: 'module',
    });
    expect(() => step.resolve()).toThrow(/unavailable step/);
  });

  it.each(['{', '{}'])(
    'rejects invalid serialized models: %s',
    (journeyJson) => {
      const context = fixture();
      expect(() =>
        context.resolve({
          ...context.candidate,
          provenance: context.candidate.provenance.map((item) => ({
            ...item,
            facts: { journeyJson },
          })),
        }),
      ).toThrow(CatalogueIntegrityError);
    },
  );

  it('requires exactly one immutable Journey model', () => {
    const context = fixture();
    expect(() =>
      context.resolve({ ...context.candidate, provenance: [] }),
    ).toThrow(/exactly one model/);
    expect(() =>
      context.resolve({
        ...context.candidate,
        provenance: [
          ...context.candidate.provenance,
          ...context.candidate.provenance,
        ],
      }),
    ).toThrow(/exactly one model/);
  });

  it('resolves IDs without retaining candidate keys or mutating the candidate', () => {
    const context = fixture();
    const before = JSON.stringify(context.candidate);
    const resolved = context.resolve();
    const json = resolved.provenance[0]?.facts?.journeyJson ?? '';
    expect(json).toContain('"entityId":"published-target"');
    expect(json).toContain('"relationshipId":"published-uses"');
    expect(json).toContain('"stepEntityId":"published-step"');
    expect(json).toContain('"documentEntityId":"published-document"');
    expect(json).not.toContain('entityKey');
    expect(json).not.toContain('relationshipKey');
    expect(json).not.toContain('stepEntityKey');
    expect(JSON.stringify(context.candidate)).toBe(before);
    const other = { ...context.candidate, type: 'module' as const };
    expect(context.resolve(other)).toBe(other);
  });

  it('bounds UTF-8 publication size with an evidenced boundary and graph omissions', () => {
    const context = fixture();
    const steps = Array.from({ length: 40 }, (_, index) => {
      const key = `step-${index}`;
      context.entities.set(key, {
        ...context.entities.get('step')!,
        key,
      });
      context.entityIds.set(key, `published-${key}`);
      const relationshipKey = `contains-${index}`;
      context.relationships.set(relationshipKey, {
        ...context.relationships.get('uses')!,
        key: relationshipKey,
        type: 'CONTAINS',
        sourceEntityKey: 'journey',
        targetEntityKey: key,
      });
      context.relationshipIds.set(
        relationshipKey,
        `published-${relationshipKey}`,
      );
      return {
        ...context.model.steps[0]!,
        id: `step-id-${index}`,
        stepEntityKey: key,
        branchContext: '\u00e9'.repeat(15_000),
      };
    });
    context.entityIds.set('journey', 'published-journey');
    const original = {
      ...context.model,
      completeness: 'complete',
      steps,
      transitions: steps.slice(1).map((step, index) => ({
        ...context.model.transitions[0]!,
        from: steps[index]!.id,
        to: step.id,
      })),
      entityReferences: [
        ...context.model.entityReferences,
        ...steps.map((step) => ({
          entityKey: step.stepEntityKey,
          role: 'step',
          label: step.id,
        })),
      ],
      relationshipReferences: [
        ...context.model.relationshipReferences,
        ...steps.map((_, index) => ({
          relationshipKey: `contains-${index}`,
          type: 'CONTAINS',
        })),
      ],
    };
    const candidate = {
      ...context.candidate,
      provenance: context.candidate.provenance.map((item) => ({
        ...item,
        facts: {
          journeyJson: JSON.stringify(original),
          completeness: 'complete',
        },
      })),
    };
    const resolve = () =>
      resolveJourneyReferences(
        candidate,
        context.entities,
        context.entityIds,
        context.relationships,
        context.relationshipIds,
      );
    const resolved = resolve();
    expect(resolve()).toEqual(resolved);
    expect(
      Buffer.byteLength(JSON.stringify(resolved.candidate), 'utf8'),
    ).toBeLessThanOrEqual(800_000);
    const json = resolved.candidate.provenance[0]!.facts!.journeyJson!;
    expect(json.length).toBeLessThanOrEqual(850_000);
    const bounded = JSON.parse(json) as {
      completeness: string;
      steps: { id: string }[];
      transitions: { from: string; to: string }[];
      entityReferences: { entityId: string }[];
      relationshipReferences: { relationshipId: string }[];
      unresolvedBoundaries: {
        target: string;
        reason: string;
        evidenceRef: string;
      }[];
    };
    expect(bounded.completeness).toBe('partial');
    expect(bounded.steps.length).toBeGreaterThan(0);
    expect(bounded.steps.length).toBeLessThan(steps.length);
    const firstOmitted = steps[bounded.steps.length]!;
    expect(bounded.unresolvedBoundaries.at(-1)).toMatchObject({
      target: firstOmitted.id,
      reason: `journey-publication-size-limit:${40 - bounded.steps.length}-steps-omitted`,
      evidenceRef: candidate.sourceEvidenceIds[0],
    });
    expect(resolved.omittedStepKeys).toEqual(
      steps.slice(bounded.steps.length).map((step) => step.stepEntityKey),
    );
    for (const key of resolved.omittedStepKeys) {
      expect(bounded.entityReferences).not.toContainEqual(
        expect.objectContaining({ entityId: context.entityIds.get(key) }),
      );
    }
    expect(bounded.relationshipReferences).toHaveLength(
      bounded.steps.length + context.model.relationshipReferences.length,
    );
    const retainedIds = new Set(bounded.steps.map((step) => step.id));
    expect(
      bounded.transitions.every(
        (transition) =>
          retainedIds.has(transition.from) && retainedIds.has(transition.to),
      ),
    ).toBe(true);
    expect(resolved.candidate.sourceEvidenceIds).toEqual(
      candidate.sourceEvidenceIds,
    );
    expect(resolved.candidate.provenance[0]!.evidenceId).toBe(
      candidate.provenance[0]!.evidenceId,
    );
    expect(candidate.provenance[0]!.facts.completeness).toBe('complete');
  });

  it('rejects oversized baseline provenance rather than silently discarding it', () => {
    const context = fixture();
    const candidate = {
      ...context.candidate,
      name: 'x'.repeat(800_001),
    };
    expect(() => context.resolve(candidate)).toThrow(
      /cannot fit the publication size limit with its route and provenance intact/,
    );
  });
});
