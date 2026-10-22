import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Document, Journey } from '@workspace-brain/domain';
import { processDocument } from '@workspace-brain/processing-core';
import { serializeKnowledgePublicationPackage } from '@workspace-brain/domain-publication';
import { describe, expect, it } from 'vitest';
import { FilesystemSourceScanner } from '../../filesystem/src/index.js';
import { extractKnowledgeCandidates } from '../../../apps/knowledge-worker/src/knowledge-extractors.js';
import { createDuckDbCatalogue } from './index.js';

describe('HMRC normal publication pipeline', () => {
  it.each(['missing', 'unique', 'ambiguous', 'oversized'] as const)(
    'resolves graph identities, preserves historic exports and handles %s provider declarations',
    async (scenario) => {
      const providerState = scenario === 'oversized' ? 'unique' : scenario;
      const duplicateProvider = providerState === 'ambiguous';
      const directory = await mkdtemp(
        join(tmpdir(), 'brain-hmrc-publication-'),
      );
      const root = join(directory, 'agent');
      const catalogue = await createDuckDbCatalogue(
        join(directory, 'catalogue.duckdb'),
        resolve('infrastructure/duckdb/migrations'),
        scenario === 'oversized'
          ? { memoryLimitMb: 512, threads: 1 }
          : undefined,
      );
      try {
        await mkdir(join(root, '.git'), { recursive: true });
        await mkdir(join(root, 'provider/.git'), { recursive: true });
        if (duplicateProvider)
          await mkdir(join(root, 'duplicate/.git'), { recursive: true });
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
  def get() = ${
    scenario === 'oversized'
      ? `{\n${Array.from({ length: 220 }, () => '    connector.get()').join('\n')}\n  }`
      : 'connector.get()'
  }
}`,
          'app/connectors/SubscriptionConnector.scala': `package connectors
class SubscriptionConnector(servicesConfig: ServicesConfig, http: HttpClientV2) {
  val baseUrl = servicesConfig.baseUrl("citizen-details")
  def get() = http.get(url"$baseUrl/details")
}`,
          'conf/application.conf':
            'appName = "subscription"\nmicroservice.services.citizen-details.host = "localhost"\n',
          'provider/conf/application.conf':
            providerState === 'missing'
              ? 'otherName = "citizen-details"\n'
              : 'appName = "citizen-details"\n',
          'provider/conf/app.routes':
            'GET /details controllers.SubscriptionController.get()\n',
          'provider/app/controllers/SubscriptionController.scala': `package controllers
class SubscriptionController {
  def get() = "ok"
}`,
          ...(duplicateProvider
            ? {
                'duplicate/conf/application.conf':
                  'appName = "citizen-details"\n',
              }
            : {}),
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
          const rootId = source.roots[0]!.id;
          // Inventory-only metadata enlarges each immutable extraction context
          // without processing thousands of unrelated fixture files.
          const padding =
            scenario === 'oversized'
              ? Array.from({ length: 3992 }, (_, index) => ({
                  path: `${rootId}/padding/${'x'.repeat(160)}/${index}.txt`,
                  filename: `${index}.txt`,
                  extension: '.txt',
                  sizeBytes: 1,
                  modifiedAt: inventory.discoveredAt,
                  fingerprint: 'a'.repeat(64),
                  discoveryMethod: 'filesystem' as const,
                }))
              : [];
          const result = await catalogue.persistScan(
            source.sourceId,
            inventory.repositories,
            [...inventory.documents, ...padding],
            inventory.discoveredAt,
            randomUUID(),
            1,
          );
          return {
            ...result,
            documents: result.documents.filter(
              (document) => document.extension !== '.txt',
            ),
          };
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
        const journeyEntity = exported.entities.find(
          ({ entity }) =>
            entity.type === 'journey' && entity.name === 'GET /subscription',
        )?.entity;
        const serializedJourney = journeyEntity?.provenance
          .map(({ facts }) => facts?.journeyJson)
          .find((value): value is string => value !== undefined);
        expect(journeyEntity).toBeDefined();
        expect(serializedJourney).toBeDefined();
        const journey = JSON.parse(serializedJourney!) as Journey;
        expect(serializedJourney!.length).toBeLessThanOrEqual(850_000);
        expect(journey.completeness).toBe('partial');
        if (scenario === 'oversized') {
          expect(
            journey.unresolvedBoundaries.some((boundary) =>
              boundary.reason.startsWith('journey-publication-size-limit:'),
            ),
            JSON.stringify({
              steps: journey.steps.length,
              bytes: Buffer.byteLength(serializedJourney!, 'utf8'),
            }),
          ).toBe(true);
          expect(journey.steps.length).toBeLessThan(256);
          const publishedSteps = exported.entities.filter(({ entity }) =>
            entity.provenance.some(
              ({ facts }) =>
                facts?.role === 'journey-step' &&
                facts.journeyId === journey.id,
            ),
          );
          expect(publishedSteps.map(({ entity }) => entity.id).sort()).toEqual(
            journey.steps.map((step) => step.stepEntityId).sort(),
          );
          expect(
            exported.relationships.filter(
              ({ relationship }) =>
                relationship.type === 'CONTAINS' &&
                relationship.sourceEntityId === journeyEntity!.id,
            ),
          ).toHaveLength(journey.steps.length);
          for (const event of await catalogue.listPendingDiscoveryEvents(
            1000,
          )) {
            expect(
              Buffer.byteLength(JSON.stringify(event), 'utf8'),
            ).toBeLessThanOrEqual(900_000);
          }
        }
        expect(journey.steps.map(({ type }) => type)).toContain(
          'HttpRouteStep',
        );
        expect(journey.unresolvedBoundaries.length).toBeGreaterThan(0);
        expect(journey.entityReferences.length).toBeGreaterThan(0);
        const publishedEntities = new Map(
          exported.entities.map(({ entity }) => [entity.id as string, entity]),
        );
        const publishedRelationships = new Map(
          exported.relationships.map(({ relationship }) => [
            relationship.id as string,
            relationship,
          ]),
        );
        for (const reference of [
          ...journey.entityReferences,
          ...journey.steps.flatMap((step) => step.entityReferences ?? []),
          ...journey.transitions.flatMap(
            (transition) => transition.entityReferences ?? [],
          ),
          ...journey.steps.flatMap((step) =>
            step.subject ? [step.subject] : [],
          ),
          ...journey.transitions.flatMap((transition) => [
            ...(transition.fromSubject ? [transition.fromSubject] : []),
            ...(transition.toSubject ? [transition.toSubject] : []),
          ]),
        ]) {
          const entity = publishedEntities.get(reference.entityId ?? '');
          expect(entity).toBeDefined();
          expect(reference.entityType).toBe(entity?.type);
          expect(reference.displayName).toBe(entity?.name);
          expect(reference).not.toHaveProperty('entityKey');
        }
        for (const reference of [
          ...journey.relationshipReferences,
          ...journey.transitions.flatMap(
            (transition) => transition.relationshipReferences ?? [],
          ),
        ]) {
          expect(reference).not.toHaveProperty('relationshipKey');
          expect(
            publishedRelationships.get(reference.relationshipId ?? ''),
          ).toMatchObject({
            type: reference.type,
            sourceEntityId: reference.sourceEntityId,
            targetEntityId: reference.targetEntityId,
          });
          expect(reference.sourceDisplayName).toBe(
            publishedEntities.get(reference.sourceEntityId ?? '')?.name,
          );
          expect(reference.targetDisplayName).toBe(
            publishedEntities.get(reference.targetEntityId ?? '')?.name,
          );
        }
        const subjectRoles = new Map(
          journey.steps.map((step) => [step.type, step.subject?.role]),
        );
        expect(subjectRoles.get('HttpRouteStep')).toBe('operation');
        expect(journey.steps[0]?.subject?.displayName).toBe(journey.name);
        for (const [type, role] of [
          ['ControllerStep', 'controller'],
          ['ServiceStep', 'service'],
          ['ConnectorStep', 'connector'],
        ] as const) {
          for (const step of journey.steps.filter(
            (candidate) => candidate.type === type,
          )) {
            expect(step.subject?.role).toBe(role);
          }
        }
        for (const step of journey.steps.filter(
          (candidate) =>
            candidate.type === 'HttpClientCallStep' &&
            new Set(
              (candidate.entityReferences ?? [])
                .filter((reference) => reference.role === 'api')
                .map((reference) => reference.entityId),
            ).size === 1,
        )) {
          expect(step.subject?.entityType).toBe('api');
        }
        const stepsById = new Map(journey.steps.map((step) => [step.id, step]));
        for (const transition of journey.transitions) {
          expect(transition.fromSubject).toEqual(
            stepsById.get(transition.from)?.subject,
          );
          expect(transition.toSubject).toEqual(
            stepsById.get(transition.to)?.subject,
          );
        }
        for (const step of journey.steps) {
          expect(step).not.toHaveProperty('entityKey');
          expect(step).not.toHaveProperty('stepEntityKey');
          expect(
            publishedEntities
              .get(step.stepEntityId ?? '')
              ?.provenance.some((item) => item.facts?.stepId === step.id),
          ).toBe(true);
          for (const reference of step.provenance) {
            expect(
              publishedEntities.get(reference.documentEntityId ?? '')?.type,
            ).toBe('document');
            expect(reference.documentId).toBeDefined();
            expect(reference.documentVersionId).toBeDefined();
          }
        }
        const serviceReference = journey.entityReferences.find(
          (reference) => reference.role === 'service',
        )!;
        const connectorReference = journey.entityReferences.find(
          (reference) => reference.role === 'connector',
        )!;
        const apiReference = journey.entityReferences.find(
          (reference) =>
            reference.role === 'api' &&
            publishedEntities
              .get(reference.entityId ?? '')
              ?.provenance.some(
                (item) => item.facts?.role === 'downstream-system',
              ),
        )!;
        expect(apiReference).toBeDefined();
        for (const [from, type, to] of [
          [journeyEntity.id, 'USES', serviceReference.entityId],
          [serviceReference.entityId, 'USES', connectorReference.entityId],
          [connectorReference.entityId, 'CONSUMES', apiReference.entityId],
        ]) {
          expect(
            exported.relationships.some(
              ({ relationship }) =>
                relationship.sourceEntityId === from &&
                relationship.type === type &&
                relationship.targetEntityId === to,
            ),
          ).toBe(true);
        }
        const crossRepositoryLinks = exported.relationships.filter(
          ({ relationship }) =>
            relationship.provenance.some(
              (item) =>
                item.facts?.relationship === 'CONFIGURED_SERVICE_TARGET',
            ),
        );
        expect(crossRepositoryLinks.length).toBe(
          providerState === 'unique' ? 1 : 0,
        );
        if (providerState === 'unique') {
          const binding = crossRepositoryLinks[0]!.relationship;
          expect(binding.sourceEntityId).toBe(apiReference.entityId);
          expect(
            publishedEntities
              .get(binding.targetEntityId)
              ?.provenance.some((item) =>
                item.documentPath.includes('/provider/'),
              ),
          ).toBe(true);
          expect(
            new Set(binding.provenance.map((item) => item.documentId)).size,
          ).toBeGreaterThan(1);
          expect(
            journey.entityReferences.some(
              (reference) => reference.entityId === binding.targetEntityId,
            ),
          ).toBe(true);
        }
        expect(
          exported.entities.filter(
            ({ entity }) =>
              entity.type === 'module' &&
              entity.name === 'controllers.SubscriptionController',
          ),
        ).toHaveLength(2);
        const controllerReference = journey.entityReferences.find(
          (reference) => reference.role === 'controller',
        )!;
        expect(
          publishedEntities
            .get(controllerReference.entityId ?? '')
            ?.provenance.every(
              (item) => !item.documentPath.includes('/provider/'),
            ),
        ).toBe(true);
        const publicationJson = JSON.parse(bytes) as {
          entities: { entity: { id: string; type: string } }[];
        };
        expect(
          publicationJson.entities.some(
            ({ entity }) =>
              entity.id === journeyEntity.id && entity.type === 'journey',
          ),
        ).toBe(true);
        expect(publication.schemaVersion).toBe(2);
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
          files['app/services/SubscriptionService.scala'].replaceAll(
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
    },
    20_000,
  );
});
