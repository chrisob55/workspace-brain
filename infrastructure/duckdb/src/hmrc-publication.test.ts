import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Document } from '@workspace-brain/domain';
import { processDocument } from '@workspace-brain/processing-core';
import { serializeKnowledgePublicationPackage } from '@workspace-brain/domain-publication';
import { describe, expect, it } from 'vitest';
import { FilesystemSourceScanner } from '../../filesystem/src/index.js';
import { extractKnowledgeCandidates } from '../../../apps/knowledge-worker/src/knowledge-extractors.js';
import { createDuckDbCatalogue } from './index.js';

describe('HMRC normal publication pipeline', () => {
  it('joins active evidence, retracts changed and deleted links, replays identically and preserves historic exports', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brain-hmrc-publication-'));
    const root = join(directory, 'agent');
    const catalogue = await createDuckDbCatalogue(
      join(directory, 'catalogue.duckdb'),
      resolve('infrastructure/duckdb/migrations'),
    );
    try {
      await mkdir(join(root, '.git'), { recursive: true });
      const files = {
        'conf/app.routes':
          'GET /subscription controllers.SubscriptionController.get()\n',
        'app/controllers/SubscriptionController.scala': `package controllers
import services.SubscriptionService
class SubscriptionController(service: SubscriptionService) {
  def get() = service.get()
}`,
        'app/services/SubscriptionService.scala': `package services
import connectors.SubscriptionConnector
class SubscriptionService(connector: SubscriptionConnector) {
  def get() = connector.get()
}`,
        'app/connectors/SubscriptionConnector.scala': `package connectors
class SubscriptionConnector(servicesConfig: ServicesConfig, http: HttpClientV2) {
  val baseUrl = servicesConfig.baseUrl("citizen-details")
  def get() = http.get(url"$baseUrl/details")
}`,
        'conf/application.conf':
          'microservice.services.citizen-details.host = "localhost"\n',
      };
      for (const [path, content] of Object.entries(files)) {
        await mkdir(join(root, path, '..'), { recursive: true });
        await writeFile(join(root, path), content);
      }
      await catalogue.registerConfiguration(
        [
          {
            configId: 'source',
            name: 'Source',
            rootPaths: [root],
            excludeDirs: ['.git'],
            includeExtensions: ['.scala', '.routes', '.conf'],
            maxFileSizeBytes: 1024 * 1024,
          },
        ],
        [
          {
            configId: 'workspace',
            name: 'Workspace',
            sourceConfigIds: ['source'],
            include: ['**'],
            exclude: [],
          },
        ],
      );
      const source = (await catalogue.listSourcesForDiscovery({ limit: 10 }))
        .items[0]!;
      const scan = async () => {
        const inventory = await new FilesystemSourceScanner().scan(source);
        return catalogue.persistScan(
          source.sourceId,
          inventory.repositories,
          inventory.documents,
          inventory.discoveredAt,
          randomUUID(),
          1,
        );
      };
      const process = async (document: Document) => {
        const path = document.path.split('/').slice(1).join('/');
        const processed = processDocument(
          document.filename,
          await readFile(join(root, path), 'utf8'),
          path,
        );
        const now = new Date().toISOString();
        const extracted = await catalogue.applyDocumentProcessing({
          eventId: randomUUID(),
          eventType: 'DocumentProcessingSubmitted',
          eventVersion: 1,
          producer: 'workspace-brain-knowledge-worker',
          occurredAt: now,
          correlationId: randomUUID(),
          idempotencyKey: randomUUID(),
          partitionKey: source.sourceId,
          payload: {
            candidate: {
              documentId: document.id,
              sourceId: source.sourceId,
              path: document.path,
              contentFingerprint: document.fingerprint,
              processedAt: now,
              durationMilliseconds: 1,
              ...processed,
            },
          },
        });
        const inputs = await catalogue.listKnowledgeInputEvidence(
          extracted.documentVersion.id,
        );
        await catalogue.applyKnowledgeCandidates({
          eventId: randomUUID(),
          eventType: 'KnowledgeCandidatesSubmitted',
          eventVersion: 1,
          producer: 'workspace-brain-knowledge-worker',
          occurredAt: now,
          correlationId: randomUUID(),
          idempotencyKey: randomUUID(),
          partitionKey: source.sourceId,
          payload: {
            sourceId: source.sourceId,
            documentId: document.id,
            documentVersionId: extracted.documentVersion.id,
            ...extractKnowledgeCandidates(inputs),
          },
        });
      };
      const inventory = await scan();
      for (const document of [...inventory.documents].reverse())
        await process(document);
      const model = (await catalogue.listKnowledgeModels({ limit: 10 }))
        .items[0]!;
      const publication = (await catalogue.getLatestKnowledgePublication(
        model.id,
      ))!;
      const exported = (await catalogue.getKnowledgePublicationExport(
        publication.id,
      ))!;
      const bytes = serializeKnowledgePublicationPackage(exported);
      const names = new Map(
        exported.entities.map(({ entity }) => [entity.id, entity.name]),
      );
      const edges = exported.relationships.map(({ relationship }) => [
        names.get(relationship.sourceEntityId),
        relationship.type,
        names.get(relationship.targetEntityId),
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
        'connectors.SubscriptionConnector',
      ]);
      expect(edges).toContainEqual([
        'connectors.SubscriptionConnector',
        'CONSUMES',
        'citizen-details',
      ]);
      expect(
        new Set(
          exported.relationships
            .find(({ relationship }) => relationship.type === 'CONSUMES')
            ?.relationship.provenance.map((item) => item.documentId),
        ).size,
      ).toBe(2);
      for (const document of inventory.documents) await process(document);
      expect(
        (await catalogue.getLatestKnowledgePublication(model.id))?.id,
      ).toBe(publication.id);

      await writeFile(
        join(root, 'app/services/SubscriptionService.scala'),
        files['app/services/SubscriptionService.scala'].replace(
          'connector.get()',
          '"disabled"',
        ),
      );
      const changed = await scan();
      await process(
        changed.documents.find(
          (document) => document.filename === 'SubscriptionService.scala',
        )!,
      );
      const modified = (await catalogue.getLatestKnowledgePublication(
        model.id,
      ))!;
      const snapshot = (await catalogue.getKnowledgePublicationExport(
        modified.id,
      ))!;
      expect(
        snapshot.relationships.some(
          ({ relationship }) =>
            relationship.type === 'USES' &&
            relationship.provenance.some(
              (item) =>
                item.locator.kind === 'scala-call-site' &&
                item.locator.enclosingSymbol ===
                  'services.SubscriptionService.get',
            ),
        ),
      ).toBe(false);
      expect(
        snapshot.relationships.some(
          ({ relationship }) => relationship.type === 'DEPENDS_ON',
        ),
      ).toBe(true);

      await rm(join(root, 'app/connectors/SubscriptionConnector.scala'));
      await scan();
      const deleted = (await catalogue.getLatestKnowledgePublication(
        model.id,
      ))!;
      const after = (await catalogue.getKnowledgePublicationExport(
        deleted.id,
      ))!;
      expect(
        after.entities.some(
          ({ entity }) => entity.name === 'connectors.SubscriptionConnector',
        ),
      ).toBe(false);
      expect(
        after.relationships.some(
          ({ relationship }) => relationship.type === 'CONSUMES',
        ),
      ).toBe(false);
      expect(
        serializeKnowledgePublicationPackage(
          (await catalogue.getKnowledgePublicationExport(publication.id))!,
        ),
      ).toBe(bytes);
    } finally {
      await catalogue.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
