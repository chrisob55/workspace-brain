import type { KnowledgeEntity } from './types';

export interface JourneyEntityReferenceView {
  entityKey?: string;
  role: string;
  label: string;
  entityId?: string;
  entityType?: string;
  displayName?: string;
  publicationId?: string;
}

export interface JourneyRelationshipReferenceView {
  relationshipKey?: string;
  type: string;
  relationshipId?: string;
  sourceEntityId?: string;
  targetEntityId?: string;
  publicationId?: string;
}

export interface JourneyStepView {
  id: string;
  type: string;
  evidenceBasis: string;
  order: string;
  stepEntityId?: string;
  entityReferences?: JourneyEntityReferenceView[];
  provenance: {
    id: string;
    kind: string;
    label: string;
    documentPath?: string;
    documentId?: string;
    documentVersionId?: string;
    documentEntityId?: string;
  }[];
  [key: string]: unknown;
}

export interface JourneyTransitionView {
  id: string;
  type: string;
  from: string;
  to: string;
  certainty: string;
  order: string;
  entityReferences?: JourneyEntityReferenceView[];
  relationshipReferences?: JourneyRelationshipReferenceView[];
  provenance: JourneyStepView['provenance'];
}

export interface JourneyDiagnosticView {
  key: string;
  reason: string;
  target: string;
  evidenceRef?: string;
}

export interface JourneyView {
  id: string;
  name: string;
  description?: string;
  sourceServices: string[];
  confidence: 'proven' | 'derived';
  completeness: 'complete' | 'partial' | 'unresolved';
  provenance: {
    id: string;
    kind: string;
    label: string;
    source?: string;
    documentPath?: string;
  }[];
  steps: JourneyStepView[];
  transitions: JourneyTransitionView[];
  entityReferences: JourneyEntityReferenceView[];
  relationshipReferences: JourneyRelationshipReferenceView[];
  unresolvedBoundaries: JourneyDiagnosticView[];
  diagnostics: JourneyDiagnosticView[];
}

export type DecodedJourney =
  { journey: JourneyView; error?: never } | { journey?: never; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isEntityReference(
  value: unknown,
): value is JourneyEntityReferenceView {
  return (
    isRecord(value) &&
    (isString(value.entityKey) || isString(value.entityId)) &&
    isString(value.role) &&
    isString(value.label) &&
    (value.entityId === undefined ||
      (isString(value.entityId) &&
        isString(value.entityType) &&
        isString(value.displayName))) &&
    (value.publicationId === undefined || isString(value.publicationId))
  );
}

function isRelationshipReference(
  value: unknown,
): value is JourneyRelationshipReferenceView {
  return (
    isRecord(value) &&
    (isString(value.relationshipKey) || isString(value.relationshipId)) &&
    isString(value.type) &&
    (value.relationshipId === undefined ||
      (isString(value.relationshipId) &&
        isString(value.sourceEntityId) &&
        isString(value.targetEntityId))) &&
    (value.publicationId === undefined || isString(value.publicationId))
  );
}

function isJourneyStep(value: unknown): value is JourneyStepView {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.type) &&
    isString(value.evidenceBasis) &&
    isString(value.order) &&
    (value.stepEntityId === undefined || isString(value.stepEntityId)) &&
    (value.entityReferences === undefined ||
      (Array.isArray(value.entityReferences) &&
        value.entityReferences.every(isEntityReference))) &&
    Array.isArray(value.provenance) &&
    value.provenance.every(
      (item) =>
        isRecord(item) &&
        isString(item.id) &&
        isString(item.kind) &&
        isString(item.label),
    )
  );
}

function isTransition(value: unknown): value is JourneyTransitionView {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.type) &&
    isString(value.from) &&
    isString(value.to) &&
    isString(value.certainty) &&
    isString(value.order) &&
    Array.isArray(value.provenance) &&
    (value.entityReferences === undefined ||
      (Array.isArray(value.entityReferences) &&
        value.entityReferences.every(isEntityReference))) &&
    (value.relationshipReferences === undefined ||
      (Array.isArray(value.relationshipReferences) &&
        value.relationshipReferences.every(isRelationshipReference)))
  );
}

function isDiagnostic(value: unknown): value is JourneyDiagnosticView {
  return (
    isRecord(value) &&
    isString(value.key) &&
    isString(value.reason) &&
    isString(value.target) &&
    (value.evidenceRef === undefined || isString(value.evidenceRef))
  );
}

function isJourney(value: unknown): value is JourneyView {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.name) &&
    (value.description === undefined || isString(value.description)) &&
    isStringArray(value.sourceServices) &&
    (value.confidence === 'proven' || value.confidence === 'derived') &&
    (value.completeness === 'complete' ||
      value.completeness === 'partial' ||
      value.completeness === 'unresolved') &&
    Array.isArray(value.provenance) &&
    value.provenance.every(
      (item) =>
        isRecord(item) &&
        isString(item.id) &&
        isString(item.kind) &&
        isString(item.label),
    ) &&
    Array.isArray(value.steps) &&
    value.steps.every(isJourneyStep) &&
    Array.isArray(value.transitions) &&
    value.transitions.every(isTransition) &&
    Array.isArray(value.entityReferences) &&
    value.entityReferences.every(isEntityReference) &&
    Array.isArray(value.relationshipReferences) &&
    value.relationshipReferences.every(isRelationshipReference) &&
    Array.isArray(value.unresolvedBoundaries) &&
    value.unresolvedBoundaries.every(isDiagnostic) &&
    (value.diagnostics === undefined ||
      (Array.isArray(value.diagnostics) &&
        value.diagnostics.every(isDiagnostic)))
  );
}

export function decodePublishedJourney(
  entity: KnowledgeEntity,
): DecodedJourney {
  const serialized = entity.provenance.flatMap((item) =>
    item.facts?.journeyJson ? [item.facts.journeyJson] : [],
  );
  if (serialized.length !== 1)
    return {
      error: `Expected one serialized Journey model; found ${serialized.length}.`,
    };
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized[0] ?? '');
  } catch {
    return { error: 'Published Journey model contains invalid JSON.' };
  }
  if (!isJourney(decoded))
    return {
      error: 'Published Journey model does not match the Explorer contract.',
    };
  if (decoded.name !== entity.name)
    return { error: 'Journey name does not match its published entity.' };
  return { journey: { ...decoded, diagnostics: decoded.diagnostics ?? [] } };
}

export function resolveJourneyEntityReference(
  graphEntities: readonly KnowledgeEntity[],
  reference: Pick<JourneyEntityReferenceView, 'entityId' | 'entityType'>,
): KnowledgeEntity | undefined {
  return reference.entityId === undefined
    ? undefined
    : graphEntities.find(
        (entity) =>
          entity.id === reference.entityId &&
          (reference.entityType === undefined ||
            entity.type === reference.entityType),
      );
}

export function journeyMatches(journey: JourneyView, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase('en-US');
  if (!normalized) return true;
  const text = [
    journey.name,
    journey.description ?? '',
    ...journey.sourceServices,
    ...journey.steps.flatMap((step) =>
      [
        'route',
        'controller',
        'service',
        'component',
        'connector',
        'target',
        'targetExpression',
      ].flatMap((key) => {
        const value = step[key];
        return isString(value) ? [value] : [];
      }),
    ),
  ]
    .join('\n')
    .toLocaleLowerCase('en-US');
  return text.includes(normalized);
}
