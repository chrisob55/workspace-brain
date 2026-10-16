import { createHash } from 'node:crypto';

import type {
  Journey,
  JourneyConfidence,
  JourneyDiagnostic,
  JourneyCandidateEntityReference,
  JourneyEvidenceBasis,
  JourneyCandidateRelationshipReference,
  JourneyStep,
  JourneyTransition,
  ProvenanceReference,
} from '@workspace-brain/domain';

import type {
  HmrcCandidateStaticPath,
  HmrcStaticPathStep,
} from './hmrc-scala-play-candidates.js';

export type JourneyComponentRole =
  'controller' | 'service' | 'connector' | 'component';

export type JourneyGenerationOptions = {
  readonly componentRoles?: ReadonlyMap<string, JourneyComponentRole>;
  readonly entityKeysByComponent?: ReadonlyMap<string, string>;
  readonly operationEntityKey?: string;
  readonly relationshipReferences?: readonly JourneyCandidateRelationshipReference[];
  readonly stableIdentityScope?: string;
};

export type JourneyGenerationResult = {
  readonly journeys: readonly Journey[];
  readonly diagnostics: readonly JourneyDiagnostic[];
};

export class JourneyGenerator {
  generate(
    staticPaths: readonly HmrcCandidateStaticPath[],
    options: JourneyGenerationOptions = {},
  ): JourneyGenerationResult {
    const seen = new Map<string, string>();
    const journeys: Journey[] = [];
    const diagnostics: JourneyDiagnostic[] = [];

    for (const staticPath of [...staticPaths].sort((left, right) =>
      compareOrdinal(left.key, right.key),
    )) {
      const content = JSON.stringify(staticPath);
      const prior = seen.get(staticPath.key);
      if (prior !== undefined) {
        if (prior !== content) {
          throw new Error(
            `Conflicting static paths share candidate key ${staticPath.key}`,
          );
        }
        diagnostics.push({
          key: `duplicate:${staticPath.key}`,
          reason: 'duplicate-identical-static-path',
          target: staticPath.key,
        });
        continue;
      }
      seen.set(staticPath.key, content);

      const journey = createJourneyFromStaticPath(staticPath, options);
      diagnostics.push(...(journey.diagnostics ?? []));
      journeys.push(journey);
    }

    return {
      journeys: journeys.sort((left, right) =>
        compareOrdinal(left.id, right.id),
      ),
      diagnostics: diagnostics.sort((left, right) =>
        compareOrdinal(left.key, right.key),
      ),
    };
  }
}

export function generateJourneysFromStaticPaths(
  staticPaths: readonly HmrcCandidateStaticPath[],
  options: JourneyGenerationOptions = {},
): readonly Journey[] {
  return new JourneyGenerator().generate(staticPaths, options).journeys;
}

export function createJourneyFromStaticPath(
  staticPath: HmrcCandidateStaticPath,
  options: JourneyGenerationOptions = {},
): Journey {
  const steps = staticPath.steps.map((step, index) =>
    toJourneyStep(step, staticPath, index, options),
  );
  const confidence = determineConfidence(
    staticPath.steps,
    staticPath.traversalBoundary?.evidence.basis,
  );
  const unresolvedBoundaries = steps.flatMap((step) =>
    step.type === 'UnresolvedCallStep'
      ? [
          {
            key: `${step.id}:unresolved`,
            reason: step.reason,
            target: step.targetExpression,
            ...(step.evidenceRef ? { evidenceRef: step.evidenceRef } : {}),
          },
        ]
      : step.type === 'HttpClientCallStep'
        ? [
            {
              key: `${step.id}:destination-unresolved`,
              reason: 'http-client-destination-not-bound-to-published-api',
              target: step.targetExpression,
              ...(step.evidenceRef ? { evidenceRef: step.evidenceRef } : {}),
            },
          ]
        : [],
  );
  const traversalBoundary = staticPath.traversalBoundary;
  const staticPathDiagnostics = staticPath.diagnostics.map((reason, index) => {
    const isTraversalBoundary =
      traversalBoundary !== undefined &&
      reason === `${traversalBoundary.reason}:${traversalBoundary.target}`;
    const step = isTraversalBoundary
      ? undefined
      : staticPath.steps.find((candidate) => reason.includes(candidate.target));
    return {
      key: `${staticPath.key}:diag:${index}`,
      reason,
      target: isTraversalBoundary
        ? traversalBoundary.target
        : (step?.target ?? staticPath.routeCandidateKey),
      ...(isTraversalBoundary
        ? { evidenceRef: traversalBoundary.evidence.evidenceId }
        : step
          ? { evidenceRef: step.evidence.evidenceId }
          : {}),
    };
  });
  const traversalBoundaries = staticPathDiagnostics
    .filter(({ reason }) => reason.startsWith('traversal-stopped-'))
    .map((diagnostic) => ({
      key: diagnostic.key,
      reason: diagnostic.reason,
      target: diagnostic.target,
      ...(diagnostic.evidenceRef
        ? { evidenceRef: diagnostic.evidenceRef }
        : {}),
    }));
  unresolvedBoundaries.push(...traversalBoundaries);
  const diagnostics = [...staticPathDiagnostics, ...unresolvedBoundaries].sort(
    (left, right) => compareOrdinal(left.key, right.key),
  );
  const componentReferences = createComponentReferences(
    staticPath.steps,
    options,
  );
  const entityReferences = [
    ...(options.operationEntityKey
      ? [
          {
            entityKey: options.operationEntityKey,
            role: 'operation' as const,
            label: deriveJourneyName(staticPath),
          },
        ]
      : []),
    ...componentReferences,
  ].sort((left, right) => compareOrdinal(left.entityKey, right.entityKey));
  const sourceServices = [
    ...new Set(
      staticPath.steps.flatMap((step) => {
        if (step.kind !== 'call') return [];
        const component = ownerOfMethod(step.target);
        return options.componentRoles?.get(component) === 'service'
          ? [component]
          : [];
      }),
    ),
  ].sort(compareOrdinal);

  return {
    id: stableJourneyId(
      staticPath.key,
      options.stableIdentityScope ?? staticPath.repositoryPath,
    ),
    name: deriveJourneyName(staticPath),
    description: `Static candidate flow for ${deriveJourneyName(staticPath)}. It describes source-level evidence, not observed runtime execution.`,
    sourceServices,
    confidence,
    completeness:
      steps.length === 0
        ? 'unresolved'
        : staticPathDiagnostics.length > 0 || unresolvedBoundaries.length > 0
          ? 'partial'
          : 'complete',
    provenance: collectProvenance(
      staticPath.steps,
      staticPath.traversalBoundary?.evidence,
    ),
    steps,
    transitions: buildTransitions(steps),
    entityReferences,
    relationshipReferences: [...(options.relationshipReferences ?? [])].sort(
      (left, right) =>
        compareOrdinal(left.relationshipKey, right.relationshipKey),
    ),
    unresolvedBoundaries,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

export function findJourneyById(
  journeys: readonly Journey[],
  id: string,
): Journey | undefined {
  return journeys.find((journey) => journey.id === id);
}

export function findJourneyByName(
  journeys: readonly Journey[],
  name: string,
): Journey | undefined {
  return journeys.find((journey) => journey.name === name);
}

export function findJourneysByService(
  journeys: readonly Journey[],
  service: string,
): Journey[] {
  return journeys.filter((journey) =>
    journey.sourceServices.some((candidate) => candidate === service),
  );
}

export function findJourneysUsingApi(
  journeys: readonly Journey[],
  api: string,
): Journey[] {
  return journeys.filter((journey) =>
    journey.steps.some(
      (step) => step.type === 'ApiCallStep' && step.target === api,
    ),
  );
}

export function findJourneysUsingConnector(
  journeys: readonly Journey[],
  connector: string,
): Journey[] {
  return journeys.filter((journey) =>
    journey.steps.some(
      (step) => step.type === 'ConnectorStep' && step.connector === connector,
    ),
  );
}

function stableJourneyId(staticPathKey: string, scope: string): string {
  return createHash('sha256')
    .update(`${scope}\0${staticPathKey}`)
    .digest('hex');
}

function deriveJourneyName(staticPath: HmrcCandidateStaticPath): string {
  const routeStep = staticPath.steps.find((step) => step.kind === 'route');
  const routeTarget = routeStep?.target ?? staticPath.routeCandidateKey;
  return routeTarget.includes(' ') ? routeTarget : `Route ${routeTarget}`;
}

function determineConfidence(
  steps: readonly HmrcStaticPathStep[],
  additionalEvidenceBasis?: 'Proven' | 'Derived',
): JourneyConfidence {
  return additionalEvidenceBasis === 'Derived' ||
    steps.some((step) => step.evidence.basis === 'Derived')
    ? 'derived'
    : 'proven';
}

function buildTransitions(
  steps: readonly JourneyStep[],
): readonly JourneyTransition[] {
  return steps.slice(0, -1).flatMap((step, index) => {
    const next = steps[index + 1];
    if (!next) return [];
    const evidenceRef = next.evidenceRef ?? step.evidenceRef;
    return [
      {
        id: `${step.id}->${next.id}`,
        type: transitionTypeFor(step, next),
        from: step.id,
        to: next.id,
        order: next.order,
        provenance: [...step.provenance, ...next.provenance],
        certainty:
          next.type === 'UnresolvedCallStep'
            ? 'unresolved'
            : next.evidenceBasis,
        ...(evidenceRef ? { evidenceRef } : {}),
      },
    ];
  });
}

function transitionTypeFor(
  from: JourneyStep,
  to: JourneyStep,
): JourneyTransition['type'] {
  if (from.type === 'HttpRouteStep' && to.type === 'ControllerStep') {
    return 'RouteDispatch';
  }
  if (to.type === 'HttpClientCallStep' || to.type === 'ApiCallStep') {
    return 'HttpRequest';
  }
  if (from.type === 'ConnectorStep' || to.type === 'ConnectorStep') {
    return 'ConnectorInvocation';
  }
  if (from.type === 'PersistenceStep' || to.type === 'PersistenceStep') {
    return 'PersistenceOperation';
  }
  return 'MethodInvocation';
}

function collectProvenance(
  steps: readonly HmrcStaticPathStep[],
  traversalBoundaryEvidence?: NonNullable<
    HmrcCandidateStaticPath['traversalBoundary']
  >['evidence'],
): readonly ProvenanceReference[] {
  const seen = new Set<string>();
  const provenance: ProvenanceReference[] = steps.flatMap((step, index) => {
    const evidence = step.evidence;
    if (seen.has(evidence.evidenceId)) return [];
    seen.add(evidence.evidenceId);
    return [
      {
        id: evidence.evidenceId,
        kind: 'evidence',
        label: `${step.kind} evidence ${index + 1}`,
        source: evidence.repositoryPath,
        documentPath: evidence.documentPath,
      },
    ];
  });
  if (
    traversalBoundaryEvidence &&
    !seen.has(traversalBoundaryEvidence.evidenceId)
  ) {
    provenance.push({
      id: traversalBoundaryEvidence.evidenceId,
      kind: 'evidence',
      label: 'traversal boundary evidence',
      source: traversalBoundaryEvidence.repositoryPath,
      documentPath: traversalBoundaryEvidence.documentPath,
    });
  }
  return provenance;
}

function toJourneyStep(
  step: HmrcStaticPathStep,
  staticPath: HmrcCandidateStaticPath,
  index: number,
  options: JourneyGenerationOptions,
): JourneyStep {
  const id = `${staticPath.key}:${index}`;
  const owner =
    step.kind === 'method' || step.kind === 'call'
      ? ownerOfMethod(step.target)
      : undefined;
  const componentRole = owner
    ? (options.componentRoles?.get(owner) ?? 'component')
    : undefined;
  const entityKey = owner
    ? options.entityKeysByComponent?.get(owner)
    : undefined;
  const provenance: ProvenanceReference[] = [
    {
      id: step.evidence.evidenceId,
      kind: 'evidence',
      label: `${step.kind} evidence`,
      source: step.evidence.repositoryPath,
      documentPath: step.evidence.documentPath,
    },
  ];
  const base = {
    id,
    evidenceBasis: toEvidenceBasis(step.evidence.basis),
    order: step.order,
    provenance,
    ...(step.evidence.evidenceId
      ? { evidenceRef: step.evidence.evidenceId }
      : {}),
    ...(entityKey ? { entityKey } : {}),
    ...(step.branchContext ? { branchContext: step.branchContext } : {}),
    ...(step.asyncGroup ? { asyncGroup: step.asyncGroup } : {}),
  };

  switch (step.kind) {
    case 'route': {
      const segments = step.target.trim().split(/\s+/);
      return {
        ...base,
        type: 'HttpRouteStep',
        ...(options.operationEntityKey
          ? { entityKey: options.operationEntityKey }
          : {}),
        method: segments[0] ?? 'GET',
        route: segments.slice(1).join(' ') || '/',
      };
    }
    case 'method': {
      return {
        ...base,
        type: 'ControllerStep',
        controller: step.target,
      };
    }
    case 'http-request': {
      return {
        ...base,
        type: 'HttpClientCallStep',
        targetExpression: step.target,
        method: step.target.split('.').at(-1)?.toUpperCase() ?? 'UNKNOWN',
      };
    }
    case 'unresolved-call': {
      const diagnostic = staticPath.diagnostics.find((reason) =>
        reason.includes(step.target),
      );
      return {
        ...base,
        type: 'UnresolvedCallStep',
        targetExpression: step.target,
        reason: diagnostic ?? 'unresolved-call-target',
        evidenceBasis: 'unresolved',
      };
    }
    case 'call': {
      if (componentRole === 'connector') {
        return {
          ...base,
          type: 'ConnectorStep',
          connector: owner ?? step.target,
          service: owner ?? step.target,
        };
      }
      if (componentRole === 'service') {
        return {
          ...base,
          type: 'ServiceStep',
          service: owner ?? step.target,
        };
      }
      return {
        ...base,
        type: 'ComponentStep',
        component: owner ?? step.target,
      };
    }
  }
}

function createComponentReferences(
  steps: readonly HmrcStaticPathStep[],
  options: JourneyGenerationOptions,
): JourneyCandidateEntityReference[] {
  const references = new Map<string, JourneyCandidateEntityReference>();
  for (const step of steps) {
    if (step.kind !== 'method' && step.kind !== 'call') continue;
    const component = ownerOfMethod(step.target);
    const entityKey = options.entityKeysByComponent?.get(component);
    if (!entityKey) continue;
    const role = options.componentRoles?.get(component) ?? 'component';
    references.set(entityKey, {
      entityKey,
      role,
      label: component,
    });
  }
  return [...references.values()];
}

function toEvidenceBasis(basis: 'Proven' | 'Derived'): JourneyEvidenceBasis {
  return basis === 'Proven' ? 'proven' : 'derived';
}

function ownerOfMethod(method: string): string {
  const separator = method.lastIndexOf('.');
  return separator < 0 ? method : method.slice(0, separator);
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
