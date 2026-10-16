import type {
  EvidenceLocator,
  KnowledgeInputEvidence,
} from '@workspace-brain/domain';

const parserPackId = 'hmrc-scala-play';
const parserPackVersion = 2;
const routeExtractorId = 'hmrc-play-route-facts';
const componentExtractorId = 'hmrc-scala-components';
const pathExtractorId = 'hmrc-candidate-static-paths';
const maxStaticPathSteps = 256;

export type HmrcCandidateProvenance = {
  readonly sourceId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly evidenceId: string;
  readonly evidenceKey: string;
  readonly repositoryPath: string;
  readonly documentPath: string;
  readonly contentFingerprint: string;
  readonly locator: EvidenceLocator;
  readonly processorId: string;
  readonly processorVersion: number;
  readonly extractionRuleId: string;
  readonly extractionRuleVersion: number;
  readonly extractorId: string;
  readonly extractorVersion: 1;
  readonly parserPackId: typeof parserPackId;
  readonly parserPackVersion: typeof parserPackVersion;
  readonly basis: 'Proven' | 'Derived';
};

export type HmrcDiagnostic = {
  readonly key: string;
  readonly disposition: 'unresolved' | 'rejected';
  readonly reason: string;
  readonly targetText: string;
  readonly evidence: HmrcCandidateProvenance;
};

export type HmrcRouteCandidate = {
  readonly key: string;
  readonly repositoryPath: string;
  readonly relativeDocumentPath: string;
  readonly routeSet: string;
  readonly method: string;
  readonly declaredPath: string;
  readonly handlerExpression: string;
  readonly evidence: readonly HmrcCandidateProvenance[];
  readonly resolvedHandlerMethod?: string;
};

export type HmrcComponentCandidate = {
  readonly key: string;
  readonly repositoryPath: string;
  readonly symbolName: string;
  readonly packageName: string;
  readonly symbolKind: 'class' | 'object' | 'trait';
  readonly role: 'controller' | 'service' | 'connector' | 'component';
  readonly extendsType?: string;
  readonly evidence: HmrcCandidateProvenance;
};

export type HmrcDependencyCandidate = {
  readonly key: string;
  readonly sourceComponentKey: string;
  readonly targetComponentKey: string;
  readonly parameterName: string;
  readonly declaredType: string;
  readonly evidence: readonly HmrcCandidateProvenance[];
};

export type HmrcCallCandidate = {
  readonly key: string;
  readonly enclosingMethod: string;
  readonly targetText: string;
  readonly methodName: string;
  readonly resolvedTargetMethod?: string;
  readonly branchContext?: string;
  readonly asyncGroup?: string;
  readonly evidence: HmrcCandidateProvenance;
};

export type HmrcHttpInteractionCandidate = {
  readonly key: string;
  readonly enclosingMethod: string;
  readonly httpMethod: string;
  readonly targetText: string;
  readonly evidence: readonly HmrcCandidateProvenance[];
};

export type HmrcStaticPathStep = {
  readonly kind:
    'route' | 'method' | 'call' | 'unresolved-call' | 'http-request';
  readonly target: string;
  readonly order: 'entry' | 'source-order' | 'conditional' | 'grouped';
  readonly branchContext?: string;
  readonly asyncGroup?: string;
  readonly evidence: HmrcCandidateProvenance;
};

export type HmrcCandidateStaticPath = {
  readonly key: string;
  readonly label: 'Candidate Static Path';
  readonly repositoryPath: string;
  readonly routeCandidateKey: string;
  readonly steps: readonly HmrcStaticPathStep[];
  readonly diagnostics: readonly string[];
  readonly traversalBoundary?: {
    readonly reason: string;
    readonly target: string;
    readonly evidence: HmrcCandidateProvenance;
  };
};

export type HmrcScalaPlayAnalysis = {
  readonly routes: readonly HmrcRouteCandidate[];
  readonly components: readonly HmrcComponentCandidate[];
  readonly dependencies: readonly HmrcDependencyCandidate[];
  readonly calls: readonly HmrcCallCandidate[];
  readonly httpInteractions: readonly HmrcHttpInteractionCandidate[];
  readonly staticPaths: readonly HmrcCandidateStaticPath[];
  readonly diagnostics: readonly HmrcDiagnostic[];
};

type SymbolFact = {
  readonly input: KnowledgeInputEvidence;
  readonly symbolName: string;
  readonly symbolKind: 'class' | 'object' | 'trait';
  readonly packageName: string;
  readonly extendsType: string | undefined;
};

type MethodFact = {
  readonly input: KnowledgeInputEvidence;
  readonly symbolName: string;
  readonly enclosingSymbol: string;
  readonly methodName: string;
};

type ParameterFact = {
  readonly input: KnowledgeInputEvidence;
  readonly owner: string;
  readonly parameterName: string;
  readonly declaredType: string;
};

type CallFact = {
  readonly input: KnowledgeInputEvidence;
  readonly ownerMethod: string;
  readonly targetText: string;
  readonly methodName: string;
  readonly receiver: string | undefined;
  readonly branchContext: string | undefined;
  readonly asyncGroup: string | undefined;
};

function identity(...parts: readonly string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(':');
}

function relativeToRepository(repositoryPath: string, documentPath: string) {
  const repositoryParts = repositoryPath.split('/').filter(Boolean);
  const documentParts = documentPath.split('/').filter(Boolean);
  for (
    let offset = 0;
    offset <= documentParts.length - repositoryParts.length;
    offset += 1
  ) {
    if (
      repositoryParts.every(
        (part, index) => documentParts[offset + index] === part,
      )
    ) {
      return documentParts.slice(offset + repositoryParts.length).join('/');
    }
  }
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(documentParts[0] ?? '')
    ? documentParts.slice(1).join('/')
    : documentPath;
}

function provenance(
  repositoryPath: string,
  input: KnowledgeInputEvidence,
  extractorId: string,
  basis: HmrcCandidateProvenance['basis'],
): HmrcCandidateProvenance {
  return {
    sourceId: input.document.sourceId,
    documentId: input.document.id,
    documentVersionId: input.documentVersion.id,
    evidenceId: input.evidence.id,
    evidenceKey: input.evidence.key,
    repositoryPath,
    documentPath: relativeToRepository(repositoryPath, input.document.path),
    contentFingerprint: input.document.fingerprint,
    locator: input.evidence.locator,
    processorId: input.documentVersion.processorId,
    processorVersion: input.documentVersion.processorVersion,
    extractionRuleId: input.documentVersion.extractionRuleId,
    extractionRuleVersion: input.documentVersion.extractionRuleVersion,
    extractorId,
    extractorVersion: 1,
    parserPackId,
    parserPackVersion,
    basis,
  };
}

function importMap(
  inputs: readonly KnowledgeInputEvidence[],
): Map<string, Map<string, string[]>> {
  const result = new Map<string, Map<string, string[]>>();
  for (const input of inputs) {
    const locator = input.evidence.locator;
    if (locator.kind !== 'scala-symbol' || locator.symbolKind !== 'import') {
      continue;
    }
    const imported = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)$/.exec(
      locator.symbolName,
    )?.[1];
    if (!imported) continue;
    const simpleName = imported.split('.').at(-1) ?? '';
    const fileImports = result.get(input.document.path) ?? new Map();
    const values = fileImports.get(simpleName) ?? [];
    values.push(imported);
    fileImports.set(simpleName, values);
    result.set(input.document.path, fileImports);
  }
  return result;
}

function typeReference(declaredType: string): string | undefined {
  const normalized = declaredType.replace(/\s+/g, '').replace(/=.*/, '');
  const generic = /^(?:Option|Seq|List|Set|Future|Either)\[([^,\]]+)\]$/.exec(
    normalized,
  );
  const reference = generic?.[1] ?? normalized;
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(reference)
    ? reference
    : undefined;
}

function resolveComponent(
  type: string,
  packageName: string,
  imports: ReadonlyMap<string, readonly string[]>,
  components: ReadonlyMap<string, readonly SymbolFact[]>,
): { fact?: SymbolFact; reason?: string } {
  const reference = typeReference(type);
  if (!reference) return { reason: 'unsupported-or-composite-type' };
  const simpleName = reference.split('.').at(-1) ?? reference;
  const imported = imports.get(simpleName) ?? [];
  const candidates = reference.includes('.')
    ? [reference]
    : imported.length > 0
      ? [...new Set(imported)]
      : [packageName ? `${packageName}.${reference}` : reference];
  const matches = candidates.flatMap(
    (candidate) => components.get(candidate) ?? [],
  );
  const match = matches[0];
  if (matches.length === 1 && match) return { fact: match };
  return {
    reason:
      matches.length > 1
        ? 'ambiguous-component-type'
        : 'unresolved-component-type',
  };
}

function methodNameFromSymbol(symbolName: string): string {
  return symbolName.split('.').at(-1) ?? symbolName;
}

function callOrder(call: CallFact): HmrcStaticPathStep['order'] {
  if (call.asyncGroup) return 'grouped';
  if (call.branchContext) return 'conditional';
  return 'source-order';
}

export function analyzeHmrcScalaPlayRepository(
  repositoryPath: string,
  evidenceInputs: readonly KnowledgeInputEvidence[],
): HmrcScalaPlayAnalysis {
  const inputs = evidenceInputs
    .map((input) => ({
      input,
      order: [
        input.document.path,
        input.evidence.key,
        JSON.stringify(input.evidence.locator),
        input.evidence.excerpt,
        input.evidence.id,
      ].join('\0'),
    }))
    .sort((left, right) =>
      left.order < right.order ? -1 : left.order > right.order ? 1 : 0,
    )
    .map(({ input }) => input);
  if (
    !repositoryPath ||
    repositoryPath.startsWith('/') ||
    repositoryPath.includes('..')
  ) {
    throw new Error('Repository scope must be a non-empty relative path');
  }
  if (
    inputs.some(
      (input) =>
        input.provenance.documentPath !== input.document.path ||
        input.provenance.contentFingerprint !== input.document.fingerprint,
    )
  ) {
    throw new Error(
      'Candidate analysis requires consistent evidence provenance',
    );
  }

  const symbols: SymbolFact[] = [];
  const methods: MethodFact[] = [];
  const parameters: ParameterFact[] = [];
  const calls: CallFact[] = [];
  const routeFacts: KnowledgeInputEvidence[] = [];
  const importsByFile = importMap(inputs);

  for (const input of inputs) {
    const locator = input.evidence.locator;
    if (
      locator.kind === 'play-route' &&
      locator.method &&
      locator.declaredPath &&
      locator.handlerExpression
    ) {
      routeFacts.push(input);
    }
    if (locator.kind === 'scala-symbol') {
      if (
        locator.symbolKind === 'class' ||
        locator.symbolKind === 'object' ||
        locator.symbolKind === 'trait'
      ) {
        symbols.push({
          input,
          symbolName: locator.symbolName,
          symbolKind: locator.symbolKind,
          packageName: locator.packageName,
          extendsType: locator.extendsType,
        });
      } else if (
        locator.symbolKind === 'method' &&
        locator.enclosingSymbol !== undefined
      ) {
        methods.push({
          input,
          symbolName: locator.symbolName,
          enclosingSymbol: locator.enclosingSymbol,
          methodName: methodNameFromSymbol(locator.symbolName),
        });
      } else if (
        locator.symbolKind === 'constructor-parameter' &&
        locator.enclosingSymbol !== undefined &&
        locator.signature !== undefined
      ) {
        parameters.push({
          input,
          owner: locator.enclosingSymbol,
          parameterName: locator.symbolName,
          declaredType: locator.signature,
        });
      }
    }
    if (locator.kind === 'scala-call-site') {
      calls.push({
        input,
        ownerMethod: locator.enclosingSymbol,
        targetText: locator.targetText,
        methodName: locator.methodName,
        receiver: locator.receiver,
        branchContext: locator.branchContext,
        asyncGroup: locator.asyncGroup,
      });
    }
  }

  const componentFacts = new Map<string, SymbolFact[]>();
  for (const fact of symbols) {
    const group = componentFacts.get(fact.symbolName) ?? [];
    group.push(fact);
    componentFacts.set(fact.symbolName, group);
  }
  const componentKey = (fact: SymbolFact) =>
    identity(repositoryPath, 'component', fact.symbolKind, fact.symbolName);
  const components: HmrcComponentCandidate[] = [];
  const diagnostics: HmrcDiagnostic[] = [];
  const reportedAmbiguousSymbols = new Set<string>();

  for (const fact of symbols) {
    if ((componentFacts.get(fact.symbolName)?.length ?? 0) !== 1) {
      if (!reportedAmbiguousSymbols.has(fact.symbolName)) {
        diagnostics.push({
          key: identity(repositoryPath, 'ambiguous-symbol', fact.symbolName),
          disposition: 'rejected',
          reason: 'duplicate-package-qualified-symbol',
          targetText: fact.symbolName,
          evidence: provenance(
            repositoryPath,
            fact.input,
            componentExtractorId,
            'Proven',
          ),
        });
        reportedAmbiguousSymbols.add(fact.symbolName);
      }
      continue;
    }
    const role =
      fact.extendsType !== undefined &&
      /^(?:Controller|BaseController|BackendController|FrontendController|InjectedController)$/.test(
        fact.extendsType.split('.').at(-1) ?? '',
      )
        ? 'controller'
        : 'component';
    components.push({
      key: componentKey(fact),
      repositoryPath,
      symbolName: fact.symbolName,
      packageName: fact.packageName,
      symbolKind: fact.symbolKind,
      role,
      ...(fact.extendsType === undefined
        ? {}
        : { extendsType: fact.extendsType }),
      evidence: provenance(
        repositoryPath,
        fact.input,
        componentExtractorId,
        'Proven',
      ),
    });
  }

  const dependencies: HmrcDependencyCandidate[] = [];
  const dependencyByParameter = new Map<string, SymbolFact>();
  for (const parameter of parameters) {
    const ownerFacts = componentFacts.get(parameter.owner) ?? [];
    if (ownerFacts.length !== 1) continue;
    const owner = ownerFacts[0];
    if (!owner) continue;
    const target = resolveComponent(
      parameter.declaredType,
      owner.packageName,
      importsByFile.get(parameter.input.document.path) ?? new Map(),
      componentFacts,
    );
    if (!target.fact) {
      if (target.reason !== 'unresolved-component-type') {
        diagnostics.push({
          key: identity(
            repositoryPath,
            'dependency',
            parameter.owner,
            parameter.parameterName,
          ),
          disposition: 'unresolved',
          reason: target.reason ?? 'unresolved-component-type',
          targetText: parameter.declaredType,
          evidence: provenance(
            repositoryPath,
            parameter.input,
            componentExtractorId,
            'Proven',
          ),
        });
      }
      continue;
    }
    const dependencyKey = identity(
      repositoryPath,
      parameter.owner,
      parameter.parameterName,
      target.fact.symbolName,
    );
    dependencyByParameter.set(
      `${parameter.owner}:${parameter.parameterName}`,
      target.fact,
    );
    dependencies.push({
      key: dependencyKey,
      sourceComponentKey: componentKey(owner),
      targetComponentKey: componentKey(target.fact),
      parameterName: parameter.parameterName,
      declaredType: parameter.declaredType,
      evidence: [
        provenance(
          repositoryPath,
          parameter.input,
          componentExtractorId,
          'Proven',
        ),
        provenance(
          repositoryPath,
          target.fact.input,
          componentExtractorId,
          'Derived',
        ),
      ],
    });
  }

  const methodsByOwner = new Map<string, MethodFact[]>();
  for (const method of methods) {
    const group = methodsByOwner.get(method.enclosingSymbol) ?? [];
    group.push(method);
    methodsByOwner.set(method.enclosingSymbol, group);
  }
  const callCandidates: HmrcCallCandidate[] = [];
  const callFactsByMethod = new Map<
    string,
    { call: CallFact; target?: MethodFact }[]
  >();
  const httpInteractions: HmrcHttpInteractionCandidate[] = [];

  for (const call of calls) {
    const owner = call.ownerMethod.slice(0, call.ownerMethod.lastIndexOf('.'));
    const receiverName =
      call.receiver !== undefined && /^[A-Za-z_$][\w$]*$/.test(call.receiver)
        ? call.receiver
        : undefined;
    const dependency = receiverName
      ? dependencyByParameter.get(`${owner}:${receiverName}`)
      : undefined;
    const candidateMethods =
      dependency === undefined
        ? receiverName
          ? []
          : (methodsByOwner.get(owner) ?? [])
        : (methodsByOwner.get(dependency.symbolName) ?? []);
    const targets = candidateMethods.filter(
      (method) => method.methodName === call.methodName,
    );
    const target = targets.length === 1 ? targets[0] : undefined;
    const isHttpRequest =
      dependency === undefined &&
      receiverName !== undefined &&
      call.input.evidence.locator.kind === 'scala-call-site' &&
      [
        'get',
        'post',
        'put',
        'patch',
        'delete',
        'head',
        'options',
        'request',
      ].includes(call.methodName) &&
      parameters.some(
        (parameter) =>
          parameter.owner === owner &&
          parameter.parameterName === receiverName &&
          /(?:^|\.)HttpClientV2(?:$|\[)/.test(parameter.declaredType),
      );

    const callKey = identity(
      repositoryPath,
      relativeToRepository(repositoryPath, call.input.document.path),
      call.ownerMethod,
      call.input.evidence.locator.kind === 'scala-call-site'
        ? `${call.input.evidence.locator.lineStart}:${call.input.evidence.locator.callIndex}`
        : '0',
      call.targetText,
    );
    const evidence = provenance(
      repositoryPath,
      call.input,
      componentExtractorId,
      'Proven',
    );
    callCandidates.push({
      key: callKey,
      enclosingMethod: call.ownerMethod,
      targetText: call.targetText,
      methodName: call.methodName,
      ...(target === undefined
        ? {}
        : { resolvedTargetMethod: target.symbolName }),
      ...(call.branchContext === undefined
        ? {}
        : { branchContext: call.branchContext }),
      ...(call.asyncGroup === undefined ? {} : { asyncGroup: call.asyncGroup }),
      evidence,
    });
    const callGroup = callFactsByMethod.get(call.ownerMethod) ?? [];
    callGroup.push({ call, ...(target === undefined ? {} : { target }) });
    callFactsByMethod.set(call.ownerMethod, callGroup);

    if (isHttpRequest) {
      const parameter = parameters.find(
        (item) => item.owner === owner && item.parameterName === receiverName,
      );
      if (parameter) {
        httpInteractions.push({
          key: identity(repositoryPath, 'http', callKey),
          enclosingMethod: call.ownerMethod,
          httpMethod: call.methodName.toUpperCase(),
          targetText: call.targetText,
          evidence: [
            provenance(
              repositoryPath,
              parameter.input,
              componentExtractorId,
              'Proven',
            ),
            evidence,
          ],
        });
      }
    }

    if (target === undefined && !isHttpRequest) {
      diagnostics.push({
        key: identity(
          repositoryPath,
          'unresolved-call',
          call.ownerMethod,
          callKey,
        ),
        disposition: 'unresolved',
        reason:
          targets.length > 1
            ? 'ambiguous-overload'
            : receiverName === undefined && call.receiver !== undefined
              ? 'complex-receiver-expression'
              : 'unresolved-call-target',
        targetText: call.targetText,
        evidence,
      });
    }
  }

  const methodsBySymbol = new Map(
    methods.map((method) => [method.symbolName, method]),
  );
  const routesByKey = new Map<string, HmrcRouteCandidate>();
  for (const input of routeFacts) {
    const locator = input.evidence.locator;
    if (locator.kind !== 'play-route') {
      throw new Error('Route evidence changed during candidate analysis');
    }
    const relativeDocumentPath = relativeToRepository(
      repositoryPath,
      input.document.path,
    );
    const routeKey = identity(
      repositoryPath,
      'route',
      relativeDocumentPath,
      locator.routeSet,
      locator.method ?? '',
      locator.declaredPath ?? '',
      locator.handlerExpression ?? '',
    );
    const handler =
      /^@?([A-Za-z_$][\w$.]*)\.([A-Za-z_$][\w$]*)(?:\s*\(|$)/.exec(
        locator.handlerExpression ?? '',
      );
    const exactMethodName = handler ? `${handler[1]}.${handler[2]}` : undefined;
    const resolved = exactMethodName
      ? methods.filter((method) => method.symbolName === exactMethodName)
      : [];
    const existing = routesByKey.get(routeKey);
    const routeEvidence = provenance(
      repositoryPath,
      input,
      routeExtractorId,
      'Proven',
    );
    routesByKey.set(
      routeKey,
      existing
        ? { ...existing, evidence: [...existing.evidence, routeEvidence] }
        : {
            key: routeKey,
            repositoryPath,
            relativeDocumentPath,
            routeSet: locator.routeSet,
            method: locator.method ?? '',
            declaredPath: locator.declaredPath ?? '',
            handlerExpression: locator.handlerExpression ?? '',
            evidence: [routeEvidence],
            ...(resolved.length === 1 && resolved[0]
              ? { resolvedHandlerMethod: resolved[0].symbolName }
              : {}),
          },
    );
  }
  const routes = [...routesByKey.values()];
  const routeOwners = new Set(
    routes.flatMap((route) =>
      route.resolvedHandlerMethod
        ? [
            route.resolvedHandlerMethod.slice(
              0,
              route.resolvedHandlerMethod.lastIndexOf('.'),
            ),
          ]
        : [],
    ),
  );
  const httpOwners = new Set(
    httpInteractions.map((interaction) =>
      interaction.enclosingMethod.slice(
        0,
        interaction.enclosingMethod.lastIndexOf('.'),
      ),
    ),
  );
  const serviceOwners = new Set(
    dependencies.flatMap((dependency) => {
      const source = components.find(
        (component) => component.key === dependency.sourceComponentKey,
      );
      const target = components.find(
        (component) => component.key === dependency.targetComponentKey,
      );
      return source &&
        target &&
        routeOwners.has(source.symbolName) &&
        target.packageName.split('.').includes('services')
        ? [target.symbolName]
        : [];
    }),
  );
  const classifiedComponents = components.map((component) => ({
    ...component,
    role:
      routeOwners.has(component.symbolName) || component.role === 'controller'
        ? ('controller' as const)
        : httpOwners.has(component.symbolName)
          ? ('connector' as const)
          : serviceOwners.has(component.symbolName)
            ? ('service' as const)
            : ('component' as const),
  }));

  const pathCandidates: HmrcCandidateStaticPath[] = [];
  for (const route of routes) {
    const handlerMethod = route.resolvedHandlerMethod
      ? methodsBySymbol.get(route.resolvedHandlerMethod)
      : undefined;
    if (!handlerMethod) {
      const evidenceInput = routeFacts.find(
        (input) =>
          input.evidence.locator.kind === 'play-route' &&
          identity(
            repositoryPath,
            'route',
            relativeToRepository(repositoryPath, input.document.path),
            input.evidence.locator.routeSet,
            input.evidence.locator.method ?? '',
            input.evidence.locator.declaredPath ?? '',
            input.evidence.locator.handlerExpression ?? '',
          ) === route.key,
      );
      if (evidenceInput) {
        diagnostics.push({
          key: identity(repositoryPath, 'route-handler', route.key),
          disposition: 'unresolved',
          reason: 'route-handler-not-exactly-resolved',
          targetText: route.handlerExpression,
          evidence: provenance(
            repositoryPath,
            evidenceInput,
            routeExtractorId,
            'Proven',
          ),
        });
      }
      continue;
    }

    const steps: HmrcStaticPathStep[] = [
      {
        kind: 'route',
        target: `${route.method} ${route.declaredPath}`,
        order: 'entry',
        evidence: route.evidence[0]!,
      },
      {
        kind: 'method',
        target: handlerMethod.symbolName,
        order: 'entry',
        evidence: provenance(
          repositoryPath,
          handlerMethod.input,
          pathExtractorId,
          'Derived',
        ),
      },
    ];
    const pathDiagnostics: string[] = [];
    let traversalBoundary: HmrcCandidateStaticPath['traversalBoundary'];
    let stepLimitReached = false;
    const visited = new Set<string>();
    const visit = (method: MethodFact, depth: number) => {
      if (stepLimitReached) return;
      if (depth >= 8) {
        pathDiagnostics.push(
          `traversal-stopped-depth-limit:${method.symbolName}`,
        );
        return;
      }
      if (visited.has(method.symbolName)) {
        pathDiagnostics.push(
          `traversal-stopped-repeated-method:${method.symbolName}`,
        );
        return;
      }
      visited.add(method.symbolName);
      const methodCalls = (callFactsByMethod.get(method.symbolName) ?? []).sort(
        (left, right) =>
          left.call.input.evidence.locator.kind === 'scala-call-site' &&
          right.call.input.evidence.locator.kind === 'scala-call-site'
            ? left.call.input.evidence.locator.lineStart -
                right.call.input.evidence.locator.lineStart ||
              left.call.input.evidence.locator.callIndex -
                right.call.input.evidence.locator.callIndex
            : 0,
      );
      for (const entry of methodCalls) {
        if (stepLimitReached) return;
        const locator = entry.call.input.evidence.locator;
        const evidence = provenance(
          repositoryPath,
          entry.call.input,
          pathExtractorId,
          entry.target ? 'Derived' : 'Proven',
        );
        if (steps.length >= maxStaticPathSteps) {
          const reason = 'traversal-stopped-step-limit';
          pathDiagnostics.push(`${reason}:${entry.call.targetText}`);
          traversalBoundary = {
            reason,
            target: entry.call.targetText,
            evidence,
          };
          stepLimitReached = true;
          return;
        }
        if (entry.target) {
          steps.push({
            kind: 'call',
            target: entry.target.symbolName,
            order: callOrder(entry.call),
            ...(entry.call.branchContext === undefined
              ? {}
              : { branchContext: entry.call.branchContext }),
            ...(entry.call.asyncGroup === undefined
              ? {}
              : { asyncGroup: entry.call.asyncGroup }),
            evidence,
          });
          visit(entry.target, depth + 1);
        } else {
          const isHttp = httpInteractions.some(
            (interaction) =>
              interaction.enclosingMethod === entry.call.ownerMethod &&
              interaction.targetText === entry.call.targetText,
          );
          steps.push({
            kind: isHttp ? 'http-request' : 'unresolved-call',
            target: entry.call.targetText,
            order: callOrder(entry.call),
            ...(entry.call.branchContext === undefined
              ? {}
              : { branchContext: entry.call.branchContext }),
            ...(entry.call.asyncGroup === undefined
              ? {}
              : { asyncGroup: entry.call.asyncGroup }),
            evidence,
          });
          if (!isHttp)
            pathDiagnostics.push(`unresolved:${entry.call.targetText}`);
        }
        if (locator.kind !== 'scala-call-site') {
          throw new Error('Call evidence changed during candidate analysis');
        }
      }
    };
    visit(handlerMethod, 0);
    pathCandidates.push({
      key: identity(repositoryPath, 'candidate-static-path', route.key),
      label: 'Candidate Static Path',
      repositoryPath,
      routeCandidateKey: route.key,
      steps,
      diagnostics: [...new Set(pathDiagnostics)].sort(),
      ...(traversalBoundary ? { traversalBoundary } : {}),
    });
  }

  const sortByKey = <T extends { readonly key: string }>(
    values: readonly T[],
  ) =>
    [...values].sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
    );
  return {
    routes: sortByKey(routes),
    components: sortByKey(classifiedComponents),
    dependencies: sortByKey(dependencies),
    calls: sortByKey(callCandidates),
    httpInteractions: sortByKey(httpInteractions),
    staticPaths: sortByKey(pathCandidates),
    diagnostics: sortByKey(diagnostics),
  };
}
