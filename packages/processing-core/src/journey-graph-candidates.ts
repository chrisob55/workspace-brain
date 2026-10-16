import type {
  Journey,
  JourneyCandidateEntityReference,
  JourneyCandidateRelationshipReference,
  KnowledgeInputEvidence,
  KnowledgeProvenance,
} from '@workspace-brain/domain';
import { createKnowledgeEntityKey } from '@workspace-brain/domain';
import {
  CandidateBuilder,
  ordinal,
  type ExtractorResult,
} from './knowledge-extractors.js';

export function linkJourneyGraphCandidates(
  candidates: ExtractorResult,
  journeys: ReadonlyMap<string, Journey>,
  inputs: readonly KnowledgeInputEvidence[],
): ExtractorResult {
  const output = new CandidateBuilder('hmrc-scala-play-journey-graph', 1);
  const byEvidence = new Map<string, KnowledgeInputEvidence>(
    inputs.map((input) => [input.evidence.id, input]),
  );
  const models = new Map<string, Journey>();
  const entities = new Map(candidates.entities.map((item) => [item.key, item]));
  const support = (ids: readonly string[]) =>
    [...new Set(ids)].sort(ordinal).map((id) => {
      const input = byEvidence.get(id);
      if (!input)
        throw new Error(`Journey graph references missing evidence ${id}`);
      return input;
    });

  for (const [journeyKey, journey] of journeys) {
    const candidate = entities.get(journeyKey);
    if (!candidate) throw new Error(`Journey graph is missing ${journeyKey}`);
    const repositoryPath = candidate.provenance[0]?.facts?.repositoryPath;
    if (!repositoryPath)
      throw new Error(`Journey graph has no repository identity ${journeyKey}`);
    const sharedFacts = {
      parserPackId: 'hmrc-scala-play',
      parserPackVersion: '2',
      basis: 'Derived',
      model: 'static-dependency-graph',
      repositoryPath,
    };
    const extra = (details: Record<string, string>) => ({
      facts: {
        ...sharedFacts,
        journeyId: journey.id,
        ...details,
      },
    });
    const references = new Map<string, JourneyCandidateEntityReference>(
      journey.entityReferences.map((reference) => {
        if (!reference.entityKey)
          throw new Error(`Journey ${journey.id} has no candidate entity key`);
        return [
          reference.entityKey,
          { ...reference, entityKey: reference.entityKey },
        ];
      }),
    );
    const originalReferences = [...references.values()];
    const relationships = new Map<
      string,
      JourneyCandidateRelationshipReference
    >(
      journey.relationshipReferences.map((reference) => {
        if (!reference.relationshipKey)
          throw new Error(
            `Journey ${journey.id} has no candidate relationship key`,
          );
        return [
          reference.relationshipKey,
          { ...reference, relationshipKey: reference.relationshipKey },
        ];
      }),
    );
    const edge = (
      type: JourneyCandidateRelationshipReference['type'],
      source: string,
      target: string,
      evidenceIds: readonly string[],
      relationship: string,
    ) => {
      output.relationship(
        type,
        source,
        target,
        support(evidenceIds),
        extra({ relationship }),
      );
      const key = `${type}:${source}->${target}`;
      relationships.set(key, { relationshipKey: key, type });
    };
    const documents = new Map<string, string>();
    for (const item of candidate.provenance) {
      const key = createKnowledgeEntityKey(
        'document',
        item.sourceId,
        item.documentPath,
        item.documentPath.split('/').at(-1) ?? item.documentPath,
      );
      documents.set(item.evidenceId, key);
      if (!entities.has(key)) {
        output.entity(
          'document',
          item.documentPath.split('/').at(-1) ?? item.documentPath,
          item.documentPath,
          support([item.evidenceId]),
          {
            facts: { ...sharedFacts, role: 'source-document' },
          },
        );
      }
      references.set(key, {
        entityKey: key,
        role: 'document',
        label: item.documentPath,
      });
      edge(
        'DERIVED_FROM',
        journeyKey,
        key,
        [item.evidenceId],
        'JOURNEY_SOURCE_EVIDENCE',
      );
    }

    const steps = journey.steps.map((step, index) => {
      const evidenceIds = step.provenance
        .filter((item) => item.kind === 'evidence')
        .map((item) => item.id);
      const stepInputs = support(evidenceIds);
      if (stepInputs.length === 0)
        throw new Error(`Journey step ${step.id} has no evidence`);
      const stepEntityKey = output.entity(
        'operation',
        `${journey.name} [${index + 1}] ${step.type}`,
        `${candidate.identityScope}/step/${index}`,
        stepInputs,
        extra({
          role: 'journey-step',
          stepId: step.id,
          stepType: step.type,
          order: step.order,
          evidenceBasis: step.evidenceBasis,
        }),
      );
      const stepReferences = new Map<string, JourneyCandidateEntityReference>();
      const ownReference: JourneyCandidateEntityReference = {
        entityKey: stepEntityKey,
        role: 'step',
        label: `${index + 1}. ${step.type}`,
      };
      stepReferences.set(stepEntityKey, ownReference);
      references.set(stepEntityKey, ownReference);
      edge(
        'CONTAINS',
        journeyKey,
        stepEntityKey,
        evidenceIds,
        'JOURNEY_CONTAINS_STEP',
      );
      if (step.entityKey) {
        const reference = references.get(step.entityKey);
        if (!reference)
          throw new Error(
            `Journey step references unknown entity ${step.entityKey}`,
          );
        stepReferences.set(reference.entityKey, reference);
        edge(
          'REFERENCES',
          stepEntityKey,
          reference.entityKey,
          evidenceIds,
          'STEP_REFERENCES',
        );
      }
      for (const evidenceId of evidenceIds) {
        const key = documents.get(evidenceId);
        const reference = key ? references.get(key) : undefined;
        if (!reference)
          throw new Error(
            `Journey step references unknown source ${evidenceId}`,
          );
        stepReferences.set(reference.entityKey, reference);
        edge(
          'DERIVED_FROM',
          stepEntityKey,
          reference.entityKey,
          [evidenceId],
          'STEP_SOURCE_EVIDENCE',
        );
      }
      let consumedApiKeys = new Set<string>();
      if (step.type === 'HttpClientCallStep') {
        const calls = candidates.relationships.filter(
          (relationship) =>
            relationship.type === 'CONSUMES' &&
            relationship.provenance.some(
              (item) => item.facts?.relationship === 'HTTP',
            ) &&
            relationship.sourceEvidenceIds.some((id) =>
              evidenceIds.includes(id),
            ),
        );
        consumedApiKeys = new Set(calls.map((call) => call.targetEntityKey));
        for (const call of calls) {
          const api = entities.get(call.targetEntityKey);
          if (!api || api.type !== 'api')
            throw new Error(`HTTP binding has no API ${call.key}`);
          const reference: JourneyCandidateEntityReference = {
            entityKey: api.key,
            role: 'api',
            label: api.name,
          };
          references.set(api.key, reference);
          stepReferences.set(api.key, reference);
          relationships.set(call.key, {
            relationshipKey: call.key,
            type: call.type,
          });
          edge(
            'CONSUMES',
            journeyKey,
            api.key,
            call.sourceEvidenceIds,
            'JOURNEY_CALLS_API',
          );
          edge(
            'CONSUMES',
            stepEntityKey,
            api.key,
            call.sourceEvidenceIds,
            'STEP_CALLS_API',
          );
          for (const binding of candidates.relationships.filter(
            (item) =>
              item.type === 'REFERENCES' &&
              item.sourceEntityKey === api.key &&
              item.provenance.some(
                (provenance) =>
                  provenance.facts?.relationship ===
                  'CONFIGURED_SERVICE_TARGET',
              ),
          )) {
            const provider = entities.get(binding.targetEntityKey);
            if (!provider)
              throw new Error(`API binding has no provider ${binding.key}`);
            const providerReference: JourneyCandidateEntityReference = {
              entityKey: provider.key,
              role: 'api',
              label: provider.name,
            };
            references.set(provider.key, providerReference);
            stepReferences.set(provider.key, providerReference);
            relationships.set(binding.key, {
              relationshipKey: binding.key,
              type: binding.type,
            });
            edge(
              'REFERENCES',
              journeyKey,
              provider.key,
              binding.sourceEvidenceIds,
              'JOURNEY_REFERENCES_PROVIDER',
            );
          }
        }
      }
      // An HTTP call step's subject is its consumed API only when the
      // published binding evidence names exactly one.
      const [consumedApiKey] = consumedApiKeys;
      return {
        ...step,
        ...(step.entityKey === undefined &&
        consumedApiKeys.size === 1 &&
        consumedApiKey
          ? { entityKey: consumedApiKey }
          : {}),
        stepEntityKey,
        entityReferences: [...stepReferences.values()].sort((a, b) =>
          ordinal(a.entityKey, b.entityKey),
        ),
      };
    });
    for (const reference of originalReferences) {
      edge(
        'USES',
        journeyKey,
        reference.entityKey,
        candidate.sourceEvidenceIds,
        reference.role === 'service'
          ? 'JOURNEY_PARTICIPATES_IN_SERVICE'
          : 'JOURNEY_REFERENCES',
      );
    }
    const linkedSteps = new Map(steps.map((step) => [step.id, step]));
    const resolvedHttpEvidence = new Set(
      steps
        .filter(
          (step) =>
            step.type === 'HttpClientCallStep' &&
            step.entityReferences.some((reference) => reference.role === 'api'),
        )
        .flatMap((step) => (step.evidenceRef ? [step.evidenceRef] : [])),
    );
    const boundary = (
      diagnostic: NonNullable<Journey['diagnostics']>[number],
    ) =>
      diagnostic.reason ===
        'http-client-destination-not-bound-to-published-api' &&
      diagnostic.evidenceRef &&
      resolvedHttpEvidence.has(diagnostic.evidenceRef)
        ? {
            ...diagnostic,
            reason: 'http-client-operation-not-bound-to-published-route',
          }
        : diagnostic;
    const transitions = journey.transitions.map((transition) => {
      const from = linkedSteps.get(transition.from);
      const to = linkedSteps.get(transition.to);
      if (!from || !to)
        throw new Error(
          `Journey transition ${transition.id} has missing endpoints`,
        );
      const transitionReferences = new Map(
        [...from.entityReferences, ...to.entityReferences].map((item) => [
          item.entityKey,
          item,
        ]),
      );
      const transitionRelationships = candidates.relationships
        .filter(
          (item) =>
            transitionReferences.has(item.sourceEntityKey) &&
            transitionReferences.has(item.targetEntityKey) &&
            item.sourceEvidenceIds.some((id) => id === transition.evidenceRef),
        )
        .map((item) => ({ relationshipKey: item.key, type: item.type }));
      return {
        ...transition,
        entityReferences: [...transitionReferences.values()].sort((a, b) =>
          ordinal(a.entityKey, b.entityKey),
        ),
        relationshipReferences: transitionRelationships,
      };
    });
    models.set(journeyKey, {
      ...journey,
      unresolvedBoundaries: journey.unresolvedBoundaries.map(boundary),
      ...(journey.diagnostics
        ? { diagnostics: journey.diagnostics.map(boundary) }
        : {}),
      steps,
      transitions,
      entityReferences: [...references.values()].sort((a, b) =>
        ordinal(a.entityKey, b.entityKey),
      ),
      relationshipReferences: [...relationships.values()].sort((a, b) =>
        ordinal(a.relationshipKey, b.relationshipKey),
      ),
    });
  }
  const additions = output.result();
  const merged = new CandidateBuilder('hmrc-scala-play-journey-graph', 1);
  merged.merge(candidates);
  merged.merge(additions);
  const result = merged.result();
  return {
    ...result,
    entities: result.entities.map((candidate) => {
      const model = models.get(candidate.key);
      if (!model) return candidate;
      return {
        ...candidate,
        provenance: candidate.provenance.map((item): KnowledgeProvenance =>
          item.facts?.journeyJson === undefined
            ? item
            : {
                ...item,
                facts: { ...item.facts, journeyJson: JSON.stringify(model) },
              },
        ),
      };
    }),
  };
}
