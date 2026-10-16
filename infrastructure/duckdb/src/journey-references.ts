import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
import type {
  KnowledgeEntityCandidate,
  KnowledgeProvenance,
  KnowledgeRelationshipCandidate,
} from '@workspace-brain/domain';
import { z } from 'zod';

const maximumJourneyJsonCharacters = 850_000;
const maximumJourneyCandidateBytes = 800_000;

const entityReferenceSchema = z
  .object({
    entityKey: z.string(),
    role: z.string(),
    label: z.string(),
  })
  .passthrough();
const relationshipReferenceSchema = z
  .object({
    relationshipKey: z.string(),
    type: z.string(),
  })
  .passthrough();
const provenanceReferenceSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    label: z.string(),
  })
  .passthrough();
const diagnosticSchema = z.object({
  key: z.string(),
  reason: z.string(),
  target: z.string(),
  evidenceRef: z.string().optional(),
});
const modelSchema = z
  .object({
    unresolvedBoundaries: z.array(diagnosticSchema),
    diagnostics: z.array(diagnosticSchema).optional(),
    entityReferences: z.array(entityReferenceSchema),
    relationshipReferences: z.array(relationshipReferenceSchema),
    provenance: z.array(provenanceReferenceSchema),
    steps: z.array(
      z
        .object({
          id: z.string(),
          stepEntityKey: z.string(),
          entityReferences: z.array(entityReferenceSchema),
          provenance: z.array(provenanceReferenceSchema),
        })
        .passthrough(),
    ),
    transitions: z.array(
      z
        .object({
          from: z.string(),
          to: z.string(),
          entityReferences: z.array(entityReferenceSchema),
          relationshipReferences: z.array(relationshipReferenceSchema),
          provenance: z.array(provenanceReferenceSchema),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export function resolveJourneyReferences(
  candidate: KnowledgeEntityCandidate,
  entities: ReadonlyMap<string, KnowledgeEntityCandidate>,
  entityIds: ReadonlyMap<string, string>,
  relationships: ReadonlyMap<string, KnowledgeRelationshipCandidate>,
  relationshipIds: ReadonlyMap<string, string>,
): {
  readonly candidate: KnowledgeEntityCandidate;
  readonly omittedStepKeys: readonly string[];
} {
  if (candidate.type !== 'journey') return { candidate, omittedStepKeys: [] };
  const serialized = candidate.provenance.flatMap((item) =>
    item.facts?.journeyJson === undefined ? [] : [item.facts.journeyJson],
  );
  if (serialized.length !== 1) {
    throw new CatalogueIntegrityError(
      `Journey ${candidate.key} must contain exactly one model`,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized[0] ?? '');
  } catch (error) {
    throw new CatalogueIntegrityError(
      `Journey ${candidate.key} contains invalid JSON: ${String(error)}`,
    );
  }
  const parsed = modelSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new CatalogueIntegrityError(
      `Journey ${candidate.key} has invalid graph references: ${parsed.error.message}`,
    );
  }
  const entityReference = (
    reference: z.infer<typeof entityReferenceSchema>,
  ) => {
    const { entityKey, ...presentation } = reference;
    const entity = entities.get(entityKey);
    const entityId = entityIds.get(entityKey);
    if (!entity || !entityId) {
      throw new CatalogueIntegrityError(
        `Journey ${candidate.key} references an unavailable entity ${reference.entityKey}`,
      );
    }
    return {
      ...presentation,
      entityId,
      entityType: entity.type,
      displayName: entity.name,
    };
  };
  const relationshipReference = (
    reference: z.infer<typeof relationshipReferenceSchema>,
  ) => {
    const { relationshipKey, ...presentation } = reference;
    const relationship = relationships.get(relationshipKey);
    const relationshipId = relationshipIds.get(relationshipKey);
    const sourceEntityId =
      relationship && entityIds.get(relationship.sourceEntityKey);
    const targetEntityId =
      relationship && entityIds.get(relationship.targetEntityKey);
    if (
      !relationship ||
      !relationshipId ||
      !sourceEntityId ||
      !targetEntityId ||
      relationship.type !== reference.type
    ) {
      throw new CatalogueIntegrityError(
        `Journey ${candidate.key} references an unavailable relationship ${reference.relationshipKey}`,
      );
    }
    return { ...presentation, relationshipId, sourceEntityId, targetEntityId };
  };
  const provenanceByEvidence = new Map<string, KnowledgeProvenance>(
    candidate.provenance.map((item) => [item.evidenceId, item]),
  );
  const provenanceReference = (
    reference: z.infer<typeof provenanceReferenceSchema>,
  ) => {
    if (reference.kind !== 'evidence') return reference;
    const item = provenanceByEvidence.get(reference.id);
    if (!item)
      throw new CatalogueIntegrityError(
        `Journey ${candidate.key} references unavailable evidence ${reference.id}`,
      );
    const documents = parsed.data.entityReferences.filter((ref) => {
      const entity = entities.get(ref.entityKey);
      return (
        ref.role === 'document' &&
        entity?.type === 'document' &&
        entity?.provenance.some(
          (provenance) =>
            provenance.documentId === item.documentId &&
            provenance.sourceId === item.sourceId,
        )
      );
    });
    const document = documents.length === 1 ? documents[0] : undefined;
    const documentEntityId = document && entityIds.get(document.entityKey);
    if (!documentEntityId)
      throw new CatalogueIntegrityError(
        `Journey ${candidate.key} has no unique source document for ${reference.id}`,
      );
    return {
      ...reference,
      documentId: item.documentId,
      documentVersionId: item.documentVersionId,
      documentEntityId,
    };
  };
  const model = {
    ...parsed.data,
    entityReferences: parsed.data.entityReferences.map(entityReference),
    relationshipReferences: parsed.data.relationshipReferences.map(
      relationshipReference,
    ),
    provenance: parsed.data.provenance.map(provenanceReference),
    steps: parsed.data.steps.map((step) => {
      const stepEntityId = entityIds.get(step.stepEntityKey);
      if (
        !stepEntityId ||
        entities.get(step.stepEntityKey)?.type !== 'operation'
      )
        throw new CatalogueIntegrityError(
          `Journey ${candidate.key} has an unavailable step ${step.stepEntityKey}`,
        );
      return {
        ...step,
        stepEntityKey: undefined,
        entityKey: undefined,
        stepEntityId,
        entityReferences: step.entityReferences.map(entityReference),
        provenance: step.provenance.map(provenanceReference),
      };
    }),
    transitions: parsed.data.transitions.map((transition) => ({
      ...transition,
      entityReferences: transition.entityReferences.map(entityReference),
      relationshipReferences: transition.relationshipReferences.map(
        relationshipReference,
      ),
      provenance: transition.provenance.map(provenanceReference),
    })),
  };
  const serialize = (value: typeof model, partial: boolean) => ({
    ...candidate,
    provenance: candidate.provenance.map((item) => ({
      ...item,
      ...(item.facts === undefined
        ? {}
        : {
            facts: {
              ...item.facts,
              ...(partial ? { completeness: 'partial' } : {}),
              ...(item.facts.journeyJson === undefined
                ? {}
                : { journeyJson: JSON.stringify(value) }),
            },
          }),
    })),
  });
  const fits = (value: KnowledgeEntityCandidate) =>
    value.provenance.every(
      (item) =>
        (item.facts?.journeyJson?.length ?? 0) <= maximumJourneyJsonCharacters,
    ) &&
    Buffer.byteLength(JSON.stringify(value), 'utf8') <=
      maximumJourneyCandidateBytes;
  const complete = serialize(model, false);
  if (fits(complete)) return { candidate: complete, omittedStepKeys: [] };

  const unresolvedBoundaries = model.unresolvedBoundaries;
  const diagnostics = model.diagnostics ?? [];
  for (let count = model.steps.length - 1; count >= 1; count -= 1) {
    const firstOmitted = model.steps[count]!;
    const evidence = firstOmitted.provenance.find(
      (reference) => reference.kind === 'evidence',
    );
    if (evidence === undefined) {
      throw new CatalogueIntegrityError(
        `Journey ${candidate.key} has no evidence for its publication boundary`,
      );
    }
    const omittedStepKeys = parsed.data.steps
      .slice(count)
      .map((step) => step.stepEntityKey);
    const omittedKeys = new Set(omittedStepKeys);
    const omittedIds = new Set(
      model.steps.slice(count).map((step) => step.stepEntityId),
    );
    const omittedRelationshipIds = new Set(
      [...relationships.values()]
        .filter(
          (relationship) =>
            omittedKeys.has(relationship.sourceEntityKey) ||
            omittedKeys.has(relationship.targetEntityKey),
        )
        .map((relationship) => relationshipIds.get(relationship.key)),
    );
    const steps = model.steps.slice(0, count);
    const stepIds = new Set(steps.map((step) => step.id));
    const boundary = {
      key: `${firstOmitted.id}:publication-size-limit`,
      reason: `journey-publication-size-limit:${model.steps.length - count}-steps-omitted`,
      target: firstOmitted.id,
      evidenceRef: evidence.id,
    };
    const bounded = {
      ...model,
      completeness: 'partial',
      steps,
      transitions: model.transitions.filter(
        (transition) =>
          stepIds.has(transition.from) && stepIds.has(transition.to),
      ),
      entityReferences: model.entityReferences.filter(
        (reference) => !omittedIds.has(reference.entityId),
      ),
      relationshipReferences: model.relationshipReferences.filter(
        (reference) => !omittedRelationshipIds.has(reference.relationshipId),
      ),
      unresolvedBoundaries: [...unresolvedBoundaries, boundary],
      diagnostics: [...diagnostics, boundary],
    };
    const result = serialize(bounded, true);
    if (fits(result)) return { candidate: result, omittedStepKeys };
  }
  throw new CatalogueIntegrityError(
    `Journey ${candidate.key} cannot fit the publication size limit with its route and provenance intact`,
  );
}
