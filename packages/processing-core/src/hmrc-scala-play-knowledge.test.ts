import {
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createSourceId,
  type Journey,
  type KnowledgeInputEvidence,
} from '@workspace-brain/domain';
import { describe, expect, it } from 'vitest';
import { processDocument } from './index.js';
import { extractHmrcScalaPlayKnowledge } from './hmrc-scala-play-knowledge.js';

const sourceId = createSourceId();
const repository = {
  id: 'repository',
  path: 'root/agent',
  fingerprint: 'b'.repeat(64),
};
const fixtures = {
  'conf/app.routes':
    'GET /subscription controllers.SubscriptionController.get()\n',
  'conf/test.routes': 'GET /test controllers.TestController.get()\n',
  'app/controllers/SubscriptionController.scala': `package controllers
import services.SubscriptionService
class SubscriptionController(service: SubscriptionService) {
  def get() = service.get()
}`,
  'app/services/SubscriptionService.scala': `package services
import connectors.CitizenDetailsConnector
class SubscriptionService(connector: CitizenDetailsConnector) {
  def get() = connector.get()
}`,
  'app/connectors/CitizenDetailsConnector.scala': `package connectors
import config.AppConfig
class CitizenDetailsConnector(appConfig: AppConfig, http: HttpClientV2) {
  val baseUrl: String = appConfig.citizenDetailsBaseUrl
  def get() = http.get(url"$baseUrl/citizen-details")
}`,
  'app/config/AppConfig.scala': `package config
class AppConfig(servicesConfig: ServicesConfig) {
  def baseUrl(serviceName: String) = servicesConfig.baseUrl(serviceName)
  lazy val citizenDetailsBaseUrl: String = baseUrl("citizen-details")
}`,
  'conf/application.conf': `microservice.services.citizen-details.host = "localhost"
microservice.services.citizen-details.port = 9999`,
};

function inputs(
  files: Readonly<Record<string, string>> = fixtures,
  path = repository.path,
): KnowledgeInputEvidence[] {
  return Object.entries(files).flatMap(([relative, content]) => {
    const filename = relative.split('/').at(-1)!;
    const processed = processDocument(filename, content, relative);
    const documentId = createDocumentId();
    const versionId = createDocumentVersionId();
    return processed.evidence.map((evidence) => ({
      evidence: {
        ...evidence,
        id: createEvidenceId(),
        documentVersionId: versionId,
      },
      document: {
        id: documentId,
        sourceId,
        path: `${path}/${relative}`,
        filename,
        fingerprint: 'a'.repeat(64),
      },
      documentVersion: {
        id: versionId,
        documentId,
        contentHash: 'a'.repeat(64),
        hashAlgorithm: 'sha256',
        discoveredAt: '2026-10-13T10:00:00.000Z',
        processorId: processed.processorId,
        processorVersion: processed.processorVersion,
        extractionRuleId: processed.extractionRuleId,
        extractionRuleVersion: processed.extractionRuleVersion,
        evidenceCount: processed.evidence.length,
      },
      provenance: {
        documentPath: `${path}/${relative}`,
        contentFingerprint: 'a'.repeat(64),
        processorId: processed.processorId,
        processorVersion: processed.processorVersion,
        extractionRuleId: processed.extractionRuleId,
        extractionRuleVersion: processed.extractionRuleVersion,
      },
      extractionContext: {
        repositories: [{ ...repository, path }],
        documents: [],
      },
    }));
  });
}

describe('HMRC publication parser pack', () => {
  it('reports conflicting provider appName declarations without publishing a guessed provider', () => {
    const result = extractHmrcScalaPlayKnowledge(
      inputs({
        ...fixtures,
        'conf/application.conf':
          'appName = "provider-one"\nappName = "provider-two"\n',
      }),
    );
    expect(
      result.diagnostics?.some(
        (item) => item.reason === 'provider-appName-declaration-ambiguous',
      ),
    ).toBe(true);
    expect(
      result.entities.some((entity) =>
        entity.provenance.some(
          (item) => item.facts?.role === 'declared-service',
        ),
      ),
    ).toBe(false);
  });
  it('resolves direct Scala 3 configuration members and multiline HTTP receivers without promoting nested values', () => {
    const evidence = inputs({
      ...fixtures,
      'app/config/AppConfig.scala': `package config
class AppConfig(servicesConfig: ServicesConfig):
  val citizenDetailsBaseUrl: String = baseUrl("citizen-details")
  if true then
    val citizenDetailsBaseUrl: String = baseUrl("wrong-service")
  private def baseUrl(key: String) = servicesConfig.baseUrl(key)
`,
      'app/connectors/CitizenDetailsConnector.scala': fixtures[
        'app/connectors/CitizenDetailsConnector.scala'
      ].replace('http.get', 'http\n    .get'),
    });
    const result = extractHmrcScalaPlayKnowledge(evidence);
    const api = result.entities.find(
      (entity) => entity.type === 'api' && entity.name === 'citizen-details',
    );
    expect(api).toBeDefined();
    expect(
      result.relationships.some(
        (edge) => edge.type === 'CONSUMES' && edge.targetEntityKey === api?.key,
      ),
    ).toBe(true);
    expect(
      result.entities.some(
        (entity) => entity.type === 'api' && entity.name === 'wrong-service',
      ),
    ).toBe(false);
  });
  it('resolves a uniquely declared baseUrl wrapper by its actual parameter, not a hard-coded name', () => {
    const result = extractHmrcScalaPlayKnowledge(
      inputs({
        ...fixtures,
        'app/config/AppConfig.scala': fixtures[
          'app/config/AppConfig.scala'
        ].replaceAll('serviceName', 'key'),
      }),
    );
    const binding = result.relationships.find(
      (relationship) =>
        relationship.type === 'CONSUMES' &&
        relationship.provenance.some(
          (item) => item.facts?.relationship === 'HTTP',
        ),
    );
    expect(binding).toBeDefined();
    expect(
      binding?.provenance.some(
        (item) =>
          item.locator.kind === 'scala-symbol' &&
          item.locator.signature === 'def baseUrl(key: String) =',
      ),
    ).toBe(true);
  });
  it('keeps same-component calls as steps without referencing prohibited self relationships', () => {
    const result = extractHmrcScalaPlayKnowledge(
      inputs({
        ...fixtures,
        'app/services/SubscriptionService.scala': fixtures[
          'app/services/SubscriptionService.scala'
        ].replace(
          'def get() = connector.get()',
          'def get() = store()\n  def store() = connector.get()',
        ),
      }),
    );
    const entity = result.entities.find((item) => item.type === 'journey')!;
    const serialized = entity.provenance.find((item) => item.facts?.journeyJson)
      ?.facts?.journeyJson;
    const journey = JSON.parse(serialized!) as Journey;
    expect(
      journey.steps.filter((step) => step.type === 'ServiceStep').length,
    ).toBeGreaterThan(1);
    expect(
      result.relationships.every(
        (item) => item.sourceEntityKey !== item.targetEntityKey,
      ),
    ).toBe(true);
    const keys = new Set(result.relationships.map((item) => item.key));
    expect(
      journey.relationshipReferences.every(
        (item) =>
          item.relationshipKey !== undefined && keys.has(item.relationshipKey),
      ),
    ).toBe(true);
  });
  it('publishes the complete declared route-to-downstream graph with supported vocabulary and immutable evidence', () => {
    const evidence = inputs();
    const result = extractHmrcScalaPlayKnowledge(evidence);
    const byKey = new Map(
      result.entities.map((entity) => [entity.key, entity.name]),
    );
    const edges = result.relationships.map((relationship) => [
      byKey.get(relationship.sourceEntityKey),
      relationship.type,
      byKey.get(relationship.targetEntityKey),
    ]);
    expect(edges).toContainEqual([
      'GET /subscription',
      'USES',
      'controllers.SubscriptionController',
    ]);
    expect(edges).toContainEqual([
      'controllers.SubscriptionController',
      'USES',
      'services.SubscriptionService',
    ]);
    expect(edges).toContainEqual([
      'services.SubscriptionService',
      'USES',
      'connectors.CitizenDetailsConnector',
    ]);
    expect(edges).toContainEqual([
      'connectors.CitizenDetailsConnector',
      'CONSUMES',
      'citizen-details',
    ]);
    expect(edges).toContainEqual([
      'controllers.SubscriptionController',
      'EXPOSES',
      'GET /subscription',
    ]);
    for (const object of [...result.entities, ...result.relationships]) {
      expect(object.sourceEvidenceIds.length).toBeGreaterThan(0);
      expect(object.provenance.map((item) => item.evidenceId)).toEqual(
        object.sourceEvidenceIds,
      );
      expect(
        object.provenance.every(
          (item) => item.facts?.parserPackVersion === '2',
        ),
      ).toBe(true);
    }
    const downstream = result.relationships.find(
      (item) => item.type === 'CONSUMES',
    );
    expect(
      new Set(downstream?.provenance.map((item) => item.documentPath)).size,
    ).toBe(3);
    expect(extractHmrcScalaPlayKnowledge([...evidence].reverse())).toEqual(
      result,
    );
  });

  it('accepts direct ServicesConfig lookups and reports missing HOCON rather than inventing a downstream', () => {
    const files = {
      ...fixtures,
      'app/config/AppConfig.scala': `package config
class AppConfig(servicesConfig: ServicesConfig) {
  val citizenDetailsBaseUrl = servicesConfig.baseUrl("citizen-details")
}`,
    };
    expect(
      extractHmrcScalaPlayKnowledge(inputs(files)).relationships.some(
        (item) => item.type === 'CONSUMES',
      ),
    ).toBe(true);
    const result = extractHmrcScalaPlayKnowledge(
      inputs({ ...files, 'conf/application.conf': '' }),
    );
    expect(result.entities.some((item) => item.type === 'api')).toBe(true);
    expect(result.relationships.some((item) => item.type === 'CONSUMES')).toBe(
      true,
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ reason: 'downstream-hocon-host-not-found' }),
    );
    expect(
      result.entities.some((item) =>
        item.provenance.some((provenance) =>
          provenance.facts?.diagnosticCounts?.includes(
            'downstream-hocon-host-not-found',
          ),
        ),
      ),
    ).toBe(true);
  });

  it('never joins duplicate symbols, separate repositories or test-only declarations', () => {
    const evidence = inputs();
    const other = inputs(fixtures, 'root/other');
    const combined = extractHmrcScalaPlayKnowledge([...evidence, ...other]);
    expect(combined.entities).toHaveLength(
      extractHmrcScalaPlayKnowledge(evidence).entities.length * 2,
    );
    expect(
      combined.relationships.every((item) => {
        const source = combined.entities.find(
          (entity) => entity.key === item.sourceEntityKey,
        );
        const target = combined.entities.find(
          (entity) => entity.key === item.targetEntityKey,
        );
        return (
          source?.provenance[0]?.facts?.repositoryPath ===
          target?.provenance[0]?.facts?.repositoryPath
        );
      }),
    ).toBe(true);
    const duplicate = inputs({
      ...fixtures,
      'app/services/Duplicate.scala':
        fixtures['app/services/SubscriptionService.scala'],
      'test/Test.scala': 'class Test { def call() = http.get(url"$baseUrl") }',
    });
    const result = extractHmrcScalaPlayKnowledge(duplicate);
    expect(result.entities.some((item) => item.name === 'GET /test')).toBe(
      false,
    );
    expect(
      result.entities.some(
        (item) => item.name === 'services.SubscriptionService',
      ),
    ).toBe(false);
    expect(result.entities.some((item) => item.name === 'Test')).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ reason: 'duplicate-package-qualified-symbol' }),
    );
  });

  it('does not interpret comments, unrelated strings, cycles, composite URLs or truncated evidence as downstream resolution', () => {
    for (const expression of [
      '"servicesConfig.baseUrl(\\"citizen-details\\")"',
      'citizenDetailsBaseUrl',
      'servicesConfig.baseUrl("citizen-details") + "/other"',
    ]) {
      const result = extractHmrcScalaPlayKnowledge(
        inputs({
          ...fixtures,
          'app/config/AppConfig.scala': `package config
class AppConfig(servicesConfig: ServicesConfig) {
  val citizenDetailsBaseUrl = ${expression}
}`,
        }),
      );
      expect(
        result.relationships.some((item) => item.type === 'CONSUMES'),
      ).toBe(false);
    }
    const truncated = inputs().map((input) =>
      input.evidence.locator.kind === 'scala-call-site'
        ? { ...input, evidence: { ...input.evidence, truncated: true } }
        : input,
    );
    const result = extractHmrcScalaPlayKnowledge(truncated);
    expect(result.relationships.some((item) => item.type === 'CONSUMES')).toBe(
      false,
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ reason: 'truncated-parser-evidence' }),
    );
  });
});
