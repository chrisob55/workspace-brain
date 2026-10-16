import { describe, expect, it } from 'vitest';

import {
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createSourceId,
  type KnowledgeInputEvidence,
} from '@workspace-brain/domain';

import { analyzeHmrcScalaPlayRepository } from './hmrc-scala-play-candidates.js';
import { extractHmrcScalaPlayKnowledge } from './hmrc-scala-play-knowledge.js';
import { generateJourneysFromStaticPaths, processDocument } from './index.js';

const repositoryPath = 'agent-example';
const sourceRootId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const timestamp = '2025-01-01T00:00:00.000Z';

const fixtures = [
  {
    path: 'conf/app.routes',
    content:
      'POST /relationships @controllers.RelationshipController.create()\n',
  },
  {
    path: 'app/controllers/RelationshipController.scala',
    content: [
      'package controllers',
      'import services.RelationshipService',
      'class RelationshipController(relationshipService: RelationshipService) {',
      '  def create() = if (true) relationshipService.create().map(value => relationshipService.normalize(value)) else relationshipService.fallback()',
      '}',
    ].join('\n'),
  },
  {
    path: 'app/services/RelationshipService.scala',
    content: [
      'package services',
      'import connectors.AgentConnector',
      'class RelationshipService(agentConnector: AgentConnector) {',
      '  def create() = agentConnector.create()',
      '  def normalize(value: String) = value',
      '}',
    ].join('\n'),
  },
  {
    path: 'app/connectors/AgentConnector.scala',
    content: [
      'package connectors',
      'class AgentConnector @Inject() (http: HttpClientV2) {',
      '  def create() = http.post(url)',
      '}',
    ].join('\n'),
  },
] as const;

function candidateInputs(
  rootId: string,
  candidateFixtures: readonly {
    readonly path: string;
    readonly content: string;
  }[] = fixtures,
): KnowledgeInputEvidence[] {
  const sourceId = createSourceId();
  return candidateFixtures.flatMap(({ path, content }) => {
    const filename = path.split('/').at(-1) ?? path;
    const processed = processDocument(filename, content, path);
    const documentId = createDocumentId();
    const documentVersionId = createDocumentVersionId();
    const documentPath = `${rootId}/${repositoryPath}/${path}`;
    const fingerprint = `fingerprint:${path}`;
    const documentVersion = {
      id: documentVersionId,
      documentId,
      contentHash: fingerprint,
      hashAlgorithm: 'sha256' as const,
      discoveredAt: timestamp,
      processorId: processed.processorId,
      processorVersion: processed.processorVersion,
      extractionRuleId: processed.extractionRuleId,
      extractionRuleVersion: processed.extractionRuleVersion,
      evidenceCount: processed.evidence.length,
    };
    const document = {
      id: documentId,
      sourceId,
      path: documentPath,
      filename,
      fingerprint,
    };
    return processed.evidence.map((evidence) => ({
      evidence: {
        ...evidence,
        id: createEvidenceId(),
        documentVersionId,
      },
      documentVersion,
      document,
      provenance: {
        documentPath,
        contentFingerprint: fingerprint,
        processorId: processed.processorId,
        processorVersion: processed.processorVersion,
        extractionRuleId: processed.extractionRuleId,
        extractionRuleVersion: processed.extractionRuleVersion,
      },
      extractionContext: {
        repositories: [
          {
            id: `repository:${rootId}`,
            path: `${rootId}/${repositoryPath}`,
            fingerprint: 'a'.repeat(64),
          },
        ],
        documents: [],
      },
    }));
  });
}

describe('HMRC Scala Play validation-only candidates', () => {
  it('resolves a route-to-service-to-connector-to-HTTP candidate path with stable repository-relative provenance', () => {
    const result = analyzeHmrcScalaPlayRepository(
      repositoryPath,
      candidateInputs(sourceRootId),
    );

    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]).toMatchObject({
      routeSet: 'app',
      method: 'POST',
      declaredPath: '/relationships',
      resolvedHandlerMethod: 'controllers.RelationshipController.create',
      relativeDocumentPath: 'conf/app.routes',
    });
    expect(result.dependencies).toHaveLength(2);
    expect(result.httpInteractions).toHaveLength(1);
    expect(result.httpInteractions[0]).toMatchObject({
      enclosingMethod: 'connectors.AgentConnector.create',
      httpMethod: 'POST',
      targetText: 'http.post',
    });
    expect(
      result.staticPaths[0]?.steps.map(({ kind, target }) => [kind, target]),
    ).toEqual([
      ['route', 'POST /relationships'],
      ['method', 'controllers.RelationshipController.create'],
      ['call', 'services.RelationshipService.create'],
      ['call', 'connectors.AgentConnector.create'],
      ['http-request', 'http.post'],
      ['unresolved-call', 'relationshipService.create().map'],
      ['call', 'services.RelationshipService.normalize'],
      ['unresolved-call', 'relationshipService.fallback'],
    ]);
    expect(result.staticPaths[0]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'services.RelationshipService.create',
          order: 'conditional',
          branchContext: 'if',
        }),
        expect.objectContaining({
          target: 'services.RelationshipService.normalize',
          order: 'grouped',
          branchContext: 'if',
          asyncGroup: 'map',
        }),
        expect.objectContaining({
          target: 'relationshipService.fallback',
          order: 'conditional',
          branchContext: 'else',
        }),
      ]),
    );
    expect(
      result.calls.find(
        ({ targetText }) => targetText === 'relationshipService.fallback',
      ),
    ).not.toHaveProperty('resolvedTargetMethod');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetText: 'relationshipService.fallback',
          reason: 'unresolved-call-target',
        }),
      ]),
    );
    expect(
      result.routes[0]?.evidence.every(
        ({ documentPath }) => documentPath === 'conf/app.routes',
      ),
    ).toBe(true);
  });

  it('does not classify a directly injected repository as a participating service', () => {
    const repositoryFixtures = [
      {
        path: 'conf/app.routes',
        content: 'GET /lookup controllers.LookupController.get()\n',
      },
      {
        path: 'app/controllers/LookupController.scala',
        content: [
          'package controllers',
          'import repositories.LookupRepository',
          'class LookupController(repository: LookupRepository) {',
          '  def get() = repository.lookup()',
          '}',
        ].join('\n'),
      },
      {
        path: 'app/repositories/LookupRepository.scala',
        content: [
          'package repositories',
          'class LookupRepository {',
          '  def lookup() = "value"',
          '}',
        ].join('\n'),
      },
    ];
    const analysis = analyzeHmrcScalaPlayRepository(
      repositoryPath,
      candidateInputs(sourceRootId, repositoryFixtures),
    );
    const repository = analysis.components.find(
      ({ symbolName }) => symbolName === 'repositories.LookupRepository',
    );
    const journey = generateJourneysFromStaticPaths(analysis.staticPaths, {
      componentRoles: new Map(
        analysis.components.map(({ symbolName, role }) => [symbolName, role]),
      ),
    })[0];

    expect(repository?.role).toBe('component');
    expect(journey?.sourceServices).toEqual([]);
    expect(journey?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ComponentStep',
          component: 'repositories.LookupRepository',
        }),
      ]),
    );
  });

  it('keeps candidate identities independent of generated source-root identifiers', () => {
    const inputs = candidateInputs(sourceRootId);
    const first = analyzeHmrcScalaPlayRepository(repositoryPath, inputs);
    expect(
      analyzeHmrcScalaPlayRepository(repositoryPath, [...inputs].reverse()),
    ).toEqual(first);
    const second = analyzeHmrcScalaPlayRepository(
      repositoryPath,
      candidateInputs('01ARZ3NDEKTSV4RRFFQ69G5FAA'),
    );

    expect(first.routes.map(({ key }) => key)).toEqual(
      second.routes.map(({ key }) => key),
    );
    expect(first.calls.map(({ key }) => key)).toEqual(
      second.calls.map(({ key }) => key),
    );
  });

  it('resolves same-named imports within each source file scope', () => {
    const scopedImportFixtures = [
      {
        path: 'app/controllers/FirstController.scala',
        content: [
          'package controllers',
          'import services.first.Dependency',
          'class FirstController(dependency: Dependency) {}',
        ].join('\n'),
      },
      {
        path: 'app/controllers/SecondController.scala',
        content: [
          'package controllers',
          'import services.second.Dependency',
          'class SecondController(dependency: Dependency) {}',
        ].join('\n'),
      },
      {
        path: 'app/services/first/Dependency.scala',
        content: ['package services.first', 'class Dependency {}'].join('\n'),
      },
      {
        path: 'app/services/second/Dependency.scala',
        content: ['package services.second', 'class Dependency {}'].join('\n'),
      },
    ];
    const result = analyzeHmrcScalaPlayRepository(
      repositoryPath,
      candidateInputs(sourceRootId, scopedImportFixtures),
    );

    expect(
      result.dependencies.map(({ sourceComponentKey, targetComponentKey }) => [
        sourceComponentKey,
        targetComponentKey,
      ]),
    ).toEqual([
      [
        `${repositoryPath}:component:class:controllers.FirstController`,
        `${repositoryPath}:component:class:services.first.Dependency`,
      ],
      [
        `${repositoryPath}:component:class:controllers.SecondController`,
        `${repositoryPath}:component:class:services.second.Dependency`,
      ],
    ]);
  });

  it('rejects ambiguous imported component types instead of guessing a dependency', () => {
    const ambiguousFixtures = [
      {
        path: 'app/controllers/ExampleController.scala',
        content: [
          'package controllers',
          'import services.Dependency',
          'class ExampleController(dependency: Dependency) {}',
        ].join('\n'),
      },
      {
        path: 'app/services/FirstDependency.scala',
        content: ['package services', 'class Dependency'].join('\n'),
      },
      {
        path: 'app/services/SecondDependency.scala',
        content: ['package services', 'class Dependency'].join('\n'),
      },
    ];
    const result = analyzeHmrcScalaPlayRepository(
      repositoryPath,
      candidateInputs(sourceRootId, ambiguousFixtures),
    );

    expect(result.dependencies).toEqual([]);
    expect(result.components.map(({ symbolName }) => symbolName)).toEqual([
      'controllers.ExampleController',
    ]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disposition: 'rejected',
          reason: 'duplicate-package-qualified-symbol',
          targetText: 'services.Dependency',
        }),
        expect.objectContaining({
          disposition: 'unresolved',
          reason: 'ambiguous-component-type',
          targetText: 'Dependency',
        }),
      ]),
    );
    expect(
      result.diagnostics.filter(
        ({ reason }) => reason === 'duplicate-package-qualified-symbol',
      ),
    ).toHaveLength(1);
  });

  it('resolves Play handlers without explicit argument lists', () => {
    const noArgumentFixtures = [
      {
        path: 'conf/app.routes',
        content: 'GET /health controllers.HealthController.check\n',
      },
      {
        path: 'app/controllers/HealthController.scala',
        content: [
          'package controllers',
          'class HealthController {',
          '  def check() = true',
          '}',
        ].join('\n'),
      },
    ];
    const result = analyzeHmrcScalaPlayRepository(
      repositoryPath,
      candidateInputs(sourceRootId, noArgumentFixtures),
    );

    expect(result.routes[0]?.resolvedHandlerMethod).toBe(
      'controllers.HealthController.check',
    );
  });

  it('creates deterministic journey models from static paths', () => {
    const result = analyzeHmrcScalaPlayRepository(
      repositoryPath,
      candidateInputs(sourceRootId),
    );
    const journeys = generateJourneysFromStaticPaths(result.staticPaths, {
      componentRoles: new Map(
        result.components.map(({ symbolName, role }) => [symbolName, role]),
      ),
    });

    expect(journeys).toHaveLength(1);
    expect(journeys[0]).toMatchObject({
      name: 'POST /relationships',
      confidence: 'derived',
      completeness: 'partial',
      sourceServices: ['services.RelationshipService'],
    });
    expect(
      journeys[0]?.steps.map((step) => {
        switch (step.type) {
          case 'HttpRouteStep':
            return [step.type, `${step.method} ${step.route}`];
          case 'ControllerStep':
            return [step.type, step.controller];
          case 'ServiceStep':
            return [step.type, step.service];
          case 'ComponentStep':
            return [step.type, step.component];
          case 'ConnectorStep':
            return [step.type, step.connector];
          case 'HttpClientCallStep':
            return [step.type, step.targetExpression];
          case 'ApiCallStep':
            return [step.type, step.target];
          case 'UnresolvedCallStep':
            return [step.type, step.targetExpression];
          case 'PersistenceStep':
            return [step.type, step.target];
        }
      }),
    ).toEqual([
      ['HttpRouteStep', 'POST /relationships'],
      ['ControllerStep', 'controllers.RelationshipController.create'],
      ['ServiceStep', 'services.RelationshipService'],
      ['ConnectorStep', 'connectors.AgentConnector'],
      ['HttpClientCallStep', 'http.post'],
      ['UnresolvedCallStep', 'relationshipService.create().map'],
      ['ServiceStep', 'services.RelationshipService'],
      ['UnresolvedCallStep', 'relationshipService.fallback'],
    ]);
    expect(journeys[0]?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'unresolved:relationshipService.fallback',
        }),
        expect.objectContaining({
          reason: 'http-client-destination-not-bound-to-published-api',
          target: 'http.post',
        }),
      ]),
    );
    expect(journeys[0]?.transitions).toHaveLength(7);
    expect(journeys[0]?.steps[5]).toMatchObject({
      order: 'conditional',
      branchContext: 'if',
      evidenceBasis: 'unresolved',
    });
    expect(journeys[0]?.steps[6]).toMatchObject({
      order: 'grouped',
      branchContext: 'if',
      asyncGroup: 'map',
      evidenceBasis: 'derived',
    });
    expect(journeys[0]?.transitions[3]).toMatchObject({
      certainty: 'proven',
      order: 'source-order',
    });
    expect(journeys[0]?.transitions[4]).toMatchObject({
      certainty: 'unresolved',
      order: 'conditional',
    });
    expect(journeys[0]?.transitions[5]).toMatchObject({
      certainty: 'derived',
      order: 'grouped',
    });
  });

  it('publishes a Journey candidate with serialized model and graph references', () => {
    const inputs = candidateInputs(sourceRootId);
    const first = extractHmrcScalaPlayKnowledge(inputs);
    const repeated = extractHmrcScalaPlayKnowledge([...inputs].reverse());
    const journeyEntity = first.entities.find(({ type }) => type === 'journey');
    const journeyJson = journeyEntity?.provenance
      .map(({ facts }) => facts?.journeyJson)
      .find((value): value is string => value !== undefined);

    expect(journeyEntity).toBeDefined();
    expect(journeyJson).toBeDefined();
    const journey = JSON.parse(journeyJson!) as {
      id: string;
      completeness: string;
      entityReferences: { entityKey: string }[];
      relationshipReferences: { relationshipKey: string }[];
      unresolvedBoundaries: { target: string }[];
    };
    expect(journey.completeness).toBe('partial');
    expect(journey.entityReferences.length).toBeGreaterThan(0);
    expect(journey.relationshipReferences.length).toBeGreaterThan(0);
    expect(journey.unresolvedBoundaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'relationshipService.fallback' }),
      ]),
    );
    expect(
      first.relationships.some(
        ({ sourceEntityKey, targetEntityKey }) =>
          sourceEntityKey === journeyEntity?.key &&
          journey.entityReferences.some(
            ({ entityKey }) => entityKey === targetEntityKey,
          ),
      ),
    ).toBe(true);
    expect(repeated.entities).toEqual(first.entities);
    expect(repeated.relationships).toEqual(first.relationships);
  });

  it('bounds recursive call expansion and preserves the omitted traversal boundary', () => {
    const recursiveFixtures = [
      {
        path: 'conf/app.routes',
        content: 'GET /cycle controllers.CycleController.go()\n',
      },
      {
        path: 'app/controllers/CycleController.scala',
        content: [
          'package controllers',
          'import services.CycleService',
          'class CycleController(service: CycleService) {',
          '  def go() = service.one()',
          '}',
        ].join('\n'),
      },
      {
        path: 'app/services/CycleService.scala',
        content: [
          'package services',
          'class CycleService {',
          '  def one() = two()',
          '  def two() = one()',
          '}',
        ].join('\n'),
      },
    ];
    const analysis = analyzeHmrcScalaPlayRepository(
      repositoryPath,
      candidateInputs(sourceRootId, recursiveFixtures),
    );
    const journey = generateJourneysFromStaticPaths(analysis.staticPaths, {
      componentRoles: new Map(
        analysis.components.map(({ symbolName, role }) => [symbolName, role]),
      ),
    })[0];

    expect(analysis.staticPaths[0]?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining('traversal-stopped-repeated-method'),
      ]),
    );
    expect(journey?.completeness).toBe('partial');
    expect(journey?.unresolvedBoundaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringContaining('traversal-stopped-repeated-method'),
        }),
      ]),
    );
  });

  it('bounds oversized static paths and preserves evidence for the omitted boundary', () => {
    const calls = Array.from(
      { length: 300 },
      (_, index) => `service.missing${index}()`,
    ).join(', ');
    const oversizedFixtures = [
      {
        path: 'conf/app.routes',
        content: 'GET /large controllers.LargeController.go()\n',
      },
      {
        path: 'app/controllers/LargeController.scala',
        content: [
          'package controllers',
          'import services.LargeService',
          'class LargeController(service: LargeService) {',
          `  def go() = Seq(${calls})`,
          '}',
        ].join('\n'),
      },
      {
        path: 'app/services/LargeService.scala',
        content: 'package services\nclass LargeService {}\n',
      },
    ];
    const analysis = analyzeHmrcScalaPlayRepository(
      repositoryPath,
      candidateInputs(sourceRootId, oversizedFixtures),
    );
    const staticPath = analysis.staticPaths[0];
    const journey = generateJourneysFromStaticPaths(analysis.staticPaths)[0];

    expect(staticPath?.steps).toHaveLength(256);
    expect(staticPath?.traversalBoundary).toMatchObject({
      reason: 'traversal-stopped-step-limit',
    });
    expect(journey?.completeness).toBe('partial');
    expect(journey?.unresolvedBoundaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringContaining('traversal-stopped-step-limit'),
          evidenceRef: staticPath?.traversalBoundary?.evidence.evidenceId,
        }),
      ]),
    );
    expect(journey?.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: staticPath?.traversalBoundary?.evidence.evidenceId,
        }),
      ]),
    );
  });
});
