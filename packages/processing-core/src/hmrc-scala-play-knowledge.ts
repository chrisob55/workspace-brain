import type {
  KnowledgeInputEvidence,
  KnowledgeProvenance,
} from '@workspace-brain/domain';
import {
  analyzeHmrcScalaPlayRepository,
  type HmrcCandidateProvenance,
} from './hmrc-scala-play-candidates.js';
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
  const output = new CandidateBuilder(extractorId, 1);
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
    const components = new Map<string, string>();
    const bySymbol = new Map<string, string>();
    const routeOwners = new Set(
      analysis.routes.flatMap((route) =>
        route.resolvedHandlerMethod
          ? [ownerOfMethod(route.resolvedHandlerMethod)]
          : [],
      ),
    );
    const httpOwners = new Set(
      analysis.httpInteractions.map((http) =>
        ownerOfMethod(http.enclosingMethod),
      ),
    );
    const serviceOwners = new Set(
      analysis.dependencies.flatMap((dependency) => {
        const source = analysis.components.find(
          (component) => component.key === dependency.sourceComponentKey,
        );
        const target = analysis.components.find(
          (component) => component.key === dependency.targetComponentKey,
        );
        return source && target && routeOwners.has(source.symbolName)
          ? [target.symbolName]
          : [];
      }),
    );
    for (const component of analysis.components) {
      const role =
        routeOwners.has(component.symbolName) || component.role === 'controller'
          ? 'controller'
          : httpOwners.has(component.symbolName)
            ? 'connector'
            : serviceOwners.has(component.symbolName)
              ? 'service'
              : 'component';
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
      if (source && target)
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
      // HMRC AppConfig commonly delegates literal service names through this exact wrapper.
      const wrapped = /^baseUrl\("([a-z][a-z0-9-]*)"\)$/.exec(expression);
      if (wrapped?.[1]) {
        const wrappers = group.filter(
          (input) =>
            input.evidence.locator.kind === 'scala-call-site' &&
            input.evidence.locator.enclosingSymbol === `${owner}.baseUrl` &&
            /^[A-Za-z_$][\w$]*\.baseUrl\(serviceName\)$/.test(
              input.evidence.excerpt.replace(/\s+/g, ''),
            ),
        );
        const wrapper = wrappers.length === 1 ? wrappers[0] : undefined;
        if (!wrapper || wrapper.evidence.locator.kind !== 'scala-call-site')
          return undefined;
        const receiver = wrapper.evidence.locator.receiver;
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
        return parameter
          ? { name: wrapped[1], evidence: [wrapper, parameter] }
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
        /^[\w$]+\.(?:get|post|put|patch|delete|head|options)(?:\[[^\]]+\])?\(\s*(?:url|s)"\$\{?([\w$]+(?:\.[\w$]+)?)\}?(?:\/[^"]*)?"\s*\)$/.exec(
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
  const result = output.result();
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
