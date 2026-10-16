import type {
  Journey,
  JourneyCandidateRelationshipReference,
  KnowledgeInputEvidence,
  KnowledgeProvenance,
} from '@workspace-brain/domain';
import { createKnowledgeEntityKey } from '@workspace-brain/domain';
import {
  analyzeHmrcScalaPlayRepository,
  type HmrcCandidateProvenance,
} from './hmrc-scala-play-candidates.js';
import { generateJourneysFromStaticPaths } from './journey-generator.js';
import { linkJourneyGraphCandidates } from './journey-graph-candidates.js';
import {
  CandidateBuilder,
  owningRepository,
  type ExtractorResult,
} from './knowledge-extractors.js';

const extractorId = 'hmrc-scala-play-architecture';
const facts = {
  parserPackId: 'hmrc-scala-play',
  parserPackVersion: '2',
  basis: 'Derived',
  model: 'static-dependency-graph',
};
const ownerOfMethod = (method: string) =>
  method.slice(0, method.lastIndexOf('.'));

/** Joins only active evidence supplied by publication reconciliation. */
export function extractHmrcScalaPlayKnowledge(
  inputs: readonly KnowledgeInputEvidence[],
): ExtractorResult {
  const output = new CandidateBuilder(extractorId, 2);
  const journeys = new Map<string, Journey>();
  const providers = new Map<
    string,
    { key: string; inputs: KnowledgeInputEvidence[] }[]
  >();
  const downstreams: {
    key: string;
    name: string;
    inputs: KnowledgeInputEvidence[];
  }[] = [];
  const repositories = new Map<string, KnowledgeInputEvidence[]>();
  for (const input of inputs) {
    const repository = owningRepository(input);
    if (!repository) continue;
    const relative = input.document.path.slice(repository.path.length + 1);
    if (!/^(?:app\/|src\/main\/|conf\/)/.test(relative)) continue;
    if (
      relative
        .split('/')
        .some((part) => /^(?:test|tests|it|integration)$/i.test(part))
    )
      continue;
    if (
      !['scala-source', 'play-routes', 'hocon'].includes(
        input.documentVersion.processorId,
      )
    )
      continue;
    if (input.evidence.truncated) {
      output.diagnose(
        input,
        'rejected',
        'truncated-parser-evidence',
        input.evidence.key,
      );
      continue;
    }
    const key = `${input.document.sourceId}:${repository.path}`;
    const group = repositories.get(key) ?? [];
    group.push(input);
    repositories.set(key, group);
  }
  for (const group of repositories.values()) {
    const first = group[0];
    if (!first) continue;
    const repository = owningRepository(first);
    if (!repository) throw new Error('HMRC repository boundary disappeared');
    const analysis = analyzeHmrcScalaPlayRepository(repository.path, group);
    const byEvidence = new Map<string, KnowledgeInputEvidence>(
      group.map((input) => [input.evidence.id, input]),
    );
    const support = (items: readonly HmrcCandidateProvenance[]) =>
      items.map((item) => {
        const input = byEvidence.get(item.evidenceId);
        if (!input)
          throw new Error(
            'HMRC candidate references evidence outside its repository',
          );
        return input;
      });
    const extra = (
      details: Record<string, string> = {},
    ): Pick<KnowledgeProvenance, 'facts' | 'repositoryBoundary'> => ({
      repositoryBoundary: repository,
      facts: { ...facts, repositoryPath: repository.path, ...details },
    });
    const declarations = group.filter((input) => {
      const locator = input.evidence.locator;
      return (
        input.document.path === `${repository.path}/conf/application.conf` &&
        locator.kind === 'hocon-key' &&
        locator.key === 'appName' &&
        (locator.valueKind === 'string' || locator.valueKind === 'unquoted') &&
        /^[a-z][a-z0-9-]*$/.test(locator.literalValue ?? '')
      );
    });
    const serviceNames = new Set(
      declarations.flatMap((input) =>
        input.evidence.locator.kind === 'hocon-key'
          ? [input.evidence.locator.literalValue]
          : [],
      ),
    );
    let declaredServiceKey: string | undefined;
    if (serviceNames.size === 1) {
      const name = declarations[0]?.evidence.locator;
      if (name?.kind === 'hocon-key' && name.literalValue) {
        const key = output.entity(
          'api',
          name.literalValue,
          repository.path,
          declarations,
          extra({
            role: 'declared-service',
            serviceIdentifier: name.literalValue,
          }),
        );
        declaredServiceKey = key;
        const matches = providers.get(name.literalValue) ?? [];
        matches.push({ key, inputs: declarations });
        providers.set(name.literalValue, matches);
      }
    } else if (serviceNames.size > 1) {
      for (const declaration of declarations) {
        output.diagnose(
          declaration,
          'unresolved',
          'provider-appName-declaration-ambiguous',
          [...serviceNames].sort().join(', '),
        );
      }
    }
    const components = new Map<string, string>();
    const bySymbol = new Map<string, string>();
    const componentRoles = new Map<
      string,
      'controller' | 'service' | 'connector' | 'component'
    >();
    for (const component of analysis.components) {
      const role = component.role;
      componentRoles.set(component.symbolName, role);
      const key = output.entity(
        'module',
        component.symbolName,
        repository.path,
        support([component.evidence]),
        extra({ role, symbolKind: component.symbolKind }),
      );
      components.set(component.key, key);
      bySymbol.set(component.symbolName, key);
    }
    const relationshipKeysByRoute = new Map<
      string,
      JourneyCandidateRelationshipReference[]
    >();
    for (const dependency of analysis.dependencies) {
      const source = components.get(dependency.sourceComponentKey);
      const target = components.get(dependency.targetComponentKey);
      if (source && target)
        output.relationship(
          'DEPENDS_ON',
          source,
          target,
          support(dependency.evidence),
          extra({ relationship: 'constructor-injection' }),
        );
    }
    for (const call of analysis.calls) {
      if (!call.resolvedTargetMethod) continue;
      const source = bySymbol.get(ownerOfMethod(call.enclosingMethod));
      const target = bySymbol.get(ownerOfMethod(call.resolvedTargetMethod));
      const declaration = group.filter(
        (input) =>
          input.evidence.locator.kind === 'scala-symbol' &&
          input.evidence.locator.symbolKind === 'method' &&
          input.evidence.locator.symbolName === call.resolvedTargetMethod,
      );
      const dependencies = analysis.dependencies.filter(
        (dependency) =>
          components.get(dependency.sourceComponentKey) === source &&
          components.get(dependency.targetComponentKey) === target,
      );
      if (source && target) {
        output.relationship(
          'USES',
          source,
          target,
          [
            ...support([
              call.evidence,
              ...dependencies.flatMap((dependency) => dependency.evidence),
            ]),
            ...declaration,
          ],
          extra({ relationship: 'CALLS' }),
        );
      }
    }
    const operationEntityKeysByRoute = new Map<string, string>();
    for (const route of analysis.routes) {
      if (route.routeSet !== 'app') continue;
      const diagnostics = analysis.diagnostics.filter((item) =>
        item.key.includes(encodeURIComponent(route.key)),
      );
      const routeKey = output.entity(
        'operation',
        `${route.method} ${route.declaredPath}`,
        `${repository.path}/${route.relativeDocumentPath}/${route.routeSet}/${encodeURIComponent(route.method)}/${encodeURIComponent(route.declaredPath)}/${encodeURIComponent(route.handlerExpression)}`,
        support(route.evidence),
        extra({
          role: 'route',
          routeSet: route.routeSet,
          handlerExpression: route.handlerExpression,
          resolution: route.resolvedHandlerMethod ? 'resolved' : 'unresolved',
          diagnostics: JSON.stringify(
            diagnostics.map(({ reason, targetText }) => ({
              reason,
              targetText,
            })),
          ),
        }),
      );
      operationEntityKeysByRoute.set(route.key, routeKey);
      if (declaredServiceKey) {
        output.relationship(
          'EXPOSES',
          declaredServiceKey,
          routeKey,
          [...declarations, ...support(route.evidence)],
          extra({
            relationship: 'DECLARED_SERVICE_ROUTE',
            exposure: 'declared-route-only',
          }),
        );
      }
      const controller = route.resolvedHandlerMethod
        ? bySymbol.get(ownerOfMethod(route.resolvedHandlerMethod))
        : undefined;
      if (controller) {
        const handler = group.filter(
          (input) =>
            input.evidence.locator.kind === 'scala-symbol' &&
            input.evidence.locator.symbolKind === 'method' &&
            input.evidence.locator.symbolName === route.resolvedHandlerMethod,
        );
        const evidence = [...support(route.evidence), ...handler];
        const references = relationshipKeysByRoute.get(route.key) ?? [];
        references.push({
          relationshipKey: `USES:${routeKey}->${controller}`,
          type: 'USES',
        });
        relationshipKeysByRoute.set(route.key, references);
        output.relationship(
          'USES',
          routeKey,
          controller,
          evidence,
          extra({ relationship: 'IMPLEMENTED_BY' }),
        );
        output.relationship(
          'EXPOSES',
          controller,
          routeKey,
          evidence,
          extra({
            relationship: 'EXPOSES_ENDPOINT',
            exposure: 'declared-route-only',
          }),
        );
      }
    }
    for (const staticPath of analysis.staticPaths) {
      const route = analysis.routes.find(
        (candidate) => candidate.key === staticPath.routeCandidateKey,
      );
      const operationEntityKey = operationEntityKeysByRoute.get(
        staticPath.routeCandidateKey,
      );
      if (!route || !operationEntityKey) continue;
      const pathMethods = new Set(
        staticPath.steps
          .filter((step) => step.kind === 'method' || step.kind === 'call')
          .map((step) => step.target),
      );
      const relationshipReferences = [
        ...(relationshipKeysByRoute.get(route.key) ?? []),
        ...analysis.calls.flatMap((call) => {
          if (
            !call.resolvedTargetMethod ||
            !pathMethods.has(call.enclosingMethod) ||
            !pathMethods.has(call.resolvedTargetMethod)
          ) {
            return [];
          }
          const source = bySymbol.get(ownerOfMethod(call.enclosingMethod));
          const target = bySymbol.get(ownerOfMethod(call.resolvedTargetMethod));
          return source && target && source !== target
            ? [
                {
                  relationshipKey: `USES:${source}->${target}`,
                  type: 'USES' as const,
                },
              ]
            : [];
        }),
      ];
      const entityKeysByComponent = new Map(bySymbol);
      const journey = generateJourneysFromStaticPaths([staticPath], {
        componentRoles,
        entityKeysByComponent,
        operationEntityKey,
        relationshipReferences,
        stableIdentityScope: `${first.document.sourceId}:${repository.path}`,
      })[0];
      if (!journey) {
        throw new Error(
          `Journey generation returned no path for ${staticPath.key}`,
        );
      }
      const journeyEvidenceById = new Map<string, KnowledgeInputEvidence>();
      for (const step of staticPath.steps) {
        const input = support([step.evidence])[0];
        if (!input) {
          throw new Error(
            `Journey ${staticPath.key} references unavailable evidence`,
          );
        }
        journeyEvidenceById.set(step.evidence.evidenceId, input);
      }
      if (staticPath.traversalBoundary) {
        const input = support([staticPath.traversalBoundary.evidence])[0];
        if (!input)
          throw new Error(
            `Journey ${staticPath.key} has missing traversal evidence`,
          );
        journeyEvidenceById.set(input.evidence.id, input);
      }
      const journeyEvidence = [...journeyEvidenceById.values()];
      if (journeyEvidence.length === 0) {
        throw new Error(`Journey ${journey.id} has no supporting evidence`);
      }
      const sourceId = journeyEvidence[0]?.document.sourceId;
      if (!sourceId) {
        throw new Error(`Journey ${journey.id} has no source identity`);
      }
      const journeyScope = `${repository.path}/journey/${journey.id}`;
      const journeyEntityKey = createKnowledgeEntityKey(
        'journey',
        sourceId,
        journeyScope,
        journey.name,
      );
      const journeyRelationshipReferences: JourneyCandidateRelationshipReference[] =
        [];
      for (const reference of journey.entityReferences) {
        if (!reference.entityKey)
          throw new Error(
            `Journey ${journey.id} has an invalid candidate entity reference`,
          );
        const relationshipKey = `USES:${journeyEntityKey}->${reference.entityKey}`;
        journeyRelationshipReferences.push({
          relationshipKey,
          type: 'USES',
        });
      }
      const publishedJourney: Journey = {
        ...journey,
        relationshipReferences: [
          ...new Map(
            [
              ...journey.relationshipReferences,
              ...journeyRelationshipReferences,
            ].map((reference) => {
              if (!reference.relationshipKey)
                throw new Error(
                  `Journey ${journey.id} has an invalid candidate relationship reference`,
                );
              return [
                reference.relationshipKey,
                { ...reference, relationshipKey: reference.relationshipKey },
              ] as const;
            }),
          ).values(),
        ].sort((left, right) =>
          left.relationshipKey < right.relationshipKey
            ? -1
            : left.relationshipKey > right.relationshipKey
              ? 1
              : 0,
        ),
      };
      const journeyKey = output.entity(
        'journey',
        journey.name,
        journeyScope,
        journeyEvidence,
        extra({
          role: 'static-journey',
          journeyId: journey.id,
          confidence: journey.confidence,
          completeness: journey.completeness,
        }),
        (_input, index) =>
          index === 0
            ? {
                facts: {
                  journeyJson: JSON.stringify(publishedJourney),
                },
              }
            : {},
      );
      if (journeyKey !== journeyEntityKey) {
        throw new Error(`Journey identity mismatch for ${journey.id}`);
      }
      journeys.set(journeyKey, publishedJourney);
    }

    const values = new Map<string, KnowledgeInputEvidence[]>();
    for (const input of group) {
      const locator = input.evidence.locator;
      if (locator.kind !== 'scala-symbol' || locator.symbolKind !== 'value')
        continue;
      const entries = values.get(locator.symbolName) ?? [];
      entries.push(input);
      values.set(locator.symbolName, entries);
    }
    const dependencyTargets = new Map<
      string,
      { symbol: string; evidence: KnowledgeInputEvidence[] }[]
    >();
    for (const dependency of analysis.dependencies) {
      const source = analysis.components.find(
        (item) => item.key === dependency.sourceComponentKey,
      );
      const target = analysis.components.find(
        (item) => item.key === dependency.targetComponentKey,
      );
      if (!source || !target) continue;
      const key = `${source.symbolName}.${dependency.parameterName}`;
      const targets = dependencyTargets.get(key) ?? [];
      targets.push({
        symbol: target.symbolName,
        evidence: support(dependency.evidence),
      });
      dependencyTargets.set(key, targets);
    }
    type Resolution = { name: string; evidence: KnowledgeInputEvidence[] };
    const resolve = (
      owner: string,
      expression: string,
      seen = new Set<string>(),
    ): Resolution | undefined => {
      if (seen.size >= 8) return undefined;
      const reference =
        /^(?:this\.)?([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?$/.exec(
          expression,
        );
      if (reference) {
        const targets = reference[2]
          ? dependencyTargets.get(`${owner}.${reference[1]}`)
          : [{ symbol: owner, evidence: [] }];
        if (targets?.length !== 1 || !targets[0]) return undefined;
        const target = targets[0];
        const symbol = `${target.symbol}.${reference[2] ?? reference[1]}`;
        if (seen.has(symbol)) return undefined;
        const entries = values.get(symbol);
        const input = entries?.length === 1 ? entries[0] : undefined;
        if (!input || input.evidence.locator.kind !== 'scala-symbol')
          return undefined;
        const next = new Set(seen).add(symbol);
        const resolved = resolve(
          target.symbol,
          input.evidence.locator.signature ?? '',
          next,
        );
        return resolved
          ? {
              name: resolved.name,
              evidence: [input, ...target.evidence, ...resolved.evidence],
            }
          : undefined;
      }
      const interpolated =
        /^s"\$\{?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\}?(?:\/[^"$]*)?"$/.exec(
          expression,
        );
      if (interpolated?.[1]) return resolve(owner, interpolated[1], seen);
      const lookup =
        /^([A-Za-z_$][\w$]*)\.baseUrl\("([a-z][a-z0-9-]*)"\)$/.exec(expression);
      if (lookup) {
        const parameter = group.find((input) => {
          const locator = input.evidence.locator;
          return (
            locator.kind === 'scala-symbol' &&
            locator.symbolKind === 'constructor-parameter' &&
            locator.enclosingSymbol === owner &&
            locator.symbolName === lookup[1] &&
            /^(?:[\w$]+\.)*ServicesConfig$/.test(
              locator.signature?.trim() ?? '',
            )
          );
        });
        return parameter && lookup[2]
          ? { name: lookup[2], evidence: [parameter] }
          : undefined;
      }
      const wrapped = /^baseUrl\("([a-z][a-z0-9-]*)"\)$/.exec(expression);
      if (wrapped?.[1]) {
        const declarations = group.filter((input) => {
          const locator = input.evidence.locator;
          return (
            locator.kind === 'scala-symbol' &&
            locator.symbolKind === 'method' &&
            locator.symbolName === `${owner}.baseUrl`
          );
        });
        const declaration =
          declarations.length === 1 ? declarations[0] : undefined;
        const signature =
          declaration?.evidence.locator.kind === 'scala-symbol'
            ? declaration.evidence.locator.signature
            : undefined;
        const parameterName =
          /^def\s+baseUrl\(\s*([A-Za-z_$][\w$]*)\s*:\s*String\s*\)\s*(?::\s*String\s*)?=$/.exec(
            signature?.trim() ?? '',
          )?.[1];
        if (!parameterName) return undefined;
        const wrappers = group.filter(
          (input) =>
            input.evidence.locator.kind === 'scala-call-site' &&
            input.evidence.locator.enclosingSymbol === `${owner}.baseUrl` &&
            input.evidence.locator.targetText ===
              `${input.evidence.locator.receiver}.baseUrl` &&
            input.evidence.excerpt.replace(/\s+/g, '') ===
              `${input.evidence.locator.receiver}.baseUrl(${parameterName})`,
        );
        const wrapper = wrappers.length === 1 ? wrappers[0] : undefined;
        if (!wrapper || wrapper.evidence.locator.kind !== 'scala-call-site')
          return undefined;
        const receiver = wrapper.evidence.locator.receiver;
        if (
          receiver === parameterName ||
          (receiver && values.has(`${owner}.baseUrl.${receiver}`))
        )
          return undefined;
        const parameter = group.find((input) => {
          const locator = input.evidence.locator;
          return (
            locator.kind === 'scala-symbol' &&
            locator.symbolKind === 'constructor-parameter' &&
            locator.enclosingSymbol === owner &&
            locator.symbolName === receiver &&
            /^(?:[\w$]+\.)*ServicesConfig$/.test(
              locator.signature?.trim() ?? '',
            )
          );
        });
        return parameter && declaration
          ? { name: wrapped[1], evidence: [declaration, wrapper, parameter] }
          : undefined;
      }
      return undefined;
    };
    for (const http of analysis.httpInteractions) {
      const owner = ownerOfMethod(http.enclosingMethod);
      const connector = bySymbol.get(owner);
      const call = support(http.evidence).find(
        (input) => input.evidence.locator.kind === 'scala-call-site',
      );
      if (!connector || !call) continue;
      const argument =
        /^[\w$]+\s*\.\s*(?:get|post|put|patch|delete|head|options)(?:\[[^\]]+\])?\(\s*(?:url|s)"\$\{?([\w$]+(?:\.[\w$]+)?)\}?(?:\/[^"]*)?"\s*\)$/.exec(
          call.evidence.excerpt,
        );
      const reference = argument?.[1];
      const rootName = reference?.split('.')[0];
      const shadowed =
        rootName !== undefined &&
        (values.has(`${http.enclosingMethod}.${rootName}`) ||
          group.some((input) => {
            const locator = input.evidence.locator;
            return (
              locator.kind === 'scala-symbol' &&
              locator.symbolKind === 'method' &&
              locator.symbolName === http.enclosingMethod &&
              new RegExp(`\\b${rootName.replace(/\$/g, '\\$')}\\s*:`).test(
                locator.signature ?? '',
              )
            );
          }));
      const resolved =
        reference && !shadowed ? resolve(owner, reference) : undefined;
      if (!resolved) {
        output.diagnose(
          call,
          'unresolved',
          'http-downstream-not-exactly-resolved',
          http.targetText,
        );
        continue;
      }
      const configuration = group.filter((input) => {
        const locator = input.evidence.locator;
        return (
          locator.kind === 'hocon-key' &&
          locator.key === `microservice.services.${resolved.name}.host`
        );
      });
      if (configuration.length === 0) {
        output.diagnose(
          call,
          'unresolved',
          'downstream-hocon-host-not-found',
          resolved.name,
        );
      }
      const api = output.entity(
        'api',
        resolved.name,
        repository.path,
        [...resolved.evidence, ...configuration],
        extra({
          role: 'downstream-system',
          serviceIdentifier: resolved.name,
          configurationKey:
            configuration.length > 0
              ? `microservice.services.${resolved.name}.host`
              : 'not-found',
        }),
      );
      output.relationship(
        'CONSUMES',
        connector,
        api,
        [...support(http.evidence), ...resolved.evidence, ...configuration],
        extra({ relationship: 'HTTP', execution: 'static-call-site-only' }),
      );
      downstreams.push({
        key: api,
        name: resolved.name,
        inputs: [
          ...support(http.evidence),
          ...resolved.evidence,
          ...configuration,
        ],
      });
    }
    for (const diagnostic of analysis.diagnostics) {
      const input = byEvidence.get(diagnostic.evidence.evidenceId);
      if (input)
        output.diagnose(
          input,
          diagnostic.disposition,
          diagnostic.reason,
          diagnostic.targetText,
        );
    }
  }
  for (const downstream of downstreams) {
    const matches = providers.get(downstream.name) ?? [];
    const provider = matches.length === 1 ? matches[0] : undefined;
    if (provider && provider.key !== downstream.key) {
      output.relationship(
        'REFERENCES',
        downstream.key,
        provider.key,
        [...downstream.inputs, ...provider.inputs],
        {
          facts: {
            ...facts,
            relationship: 'CONFIGURED_SERVICE_TARGET',
            serviceIdentifier: downstream.name,
            resolution: 'exact-unique-appName',
          },
        },
      );
    } else if (matches.length > 1) {
      const input = downstream.inputs[0];
      if (input)
        output.diagnose(
          input,
          'unresolved',
          'downstream-provider-declaration-ambiguous',
          downstream.name,
        );
    }
  }
  const result = linkJourneyGraphCandidates(output.result(), journeys, inputs);
  const diagnosticsByDocument = new Map<string, Map<string, number>>();
  for (const diagnostic of result.diagnostics ?? []) {
    const reasons =
      diagnosticsByDocument.get(diagnostic.documentPath) ??
      new Map<string, number>();
    reasons.set(diagnostic.reason, (reasons.get(diagnostic.reason) ?? 0) + 1);
    diagnosticsByDocument.set(diagnostic.documentPath, reasons);
  }
  const annotate = (provenance: readonly KnowledgeProvenance[]) =>
    provenance.map((item) => ({
      ...item,
      facts: {
        ...item.facts,
        diagnosticCounts: JSON.stringify(
          Object.fromEntries(
            [...(diagnosticsByDocument.get(item.documentPath) ?? [])].sort(
              ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
            ),
          ),
        ),
      },
    }));
  return {
    ...result,
    entities: result.entities.map((item) => ({
      ...item,
      provenance: annotate(item.provenance),
    })),
    relationships: result.relationships.map((item) => ({
      ...item,
      provenance: annotate(item.provenance),
    })),
  };
}
