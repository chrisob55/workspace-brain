import { describe, expect, it } from 'vitest';

import {
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createSourceId,
  type KnowledgeInputEvidence,
} from '@workspace-brain/domain';

import { analyzeHmrcScalaPlayRepository } from './hmrc-scala-play-candidates.js';
import { processDocument } from './index.js';

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
});
