import { createHash, randomUUID } from 'node:crypto';
import { snapshotExtractionContext } from './extraction-context.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import type {
  CatalogueDiscovery,
  CatalogueHealth,
  CataloguePage,
  CataloguePageRequest,
  ConfiguredSource,
  ConfiguredWorkspace,
  KnowledgePageRequest,
  PublishedRelationshipRequest,
  KnowledgeModelPublishedEvent,
  SearchEntityRequest,
  SearchProjectionRequestedEvent,
  SearchRelationshipRequest,
  DocumentProcessingEvent,
  DocumentProcessingApplyResult,
  ExpiredInventoryAssembly,
  InventoryAssemblySnapshot,
  ScanPersistenceResult,
  SourceScanMetrics,
} from '@workspace-brain/catalogue';
import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
import {
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createRepositoryId,
  createSourceId,
  createSourceRootId,
  createWorkspaceId,
  type DiscoveryEvent,
  type DiscoverySource,
  type DocumentCandidate,
  type DocumentVersion,
  type Evidence,
  type EvidenceExplanation,
  type EvidenceLocator,
  type InventoryChange,
  type InventoryRecord,
  parseDocumentId,
  parseDocumentVersionId,
  parseEvidenceId,
  type KnowledgeCandidateEvent,
  type KnowledgeEntity,
  type KnowledgeInputEvidence,
  type KnowledgeModel,
  type KnowledgePublication,
  type KnowledgePublicationSummary,
  type KnowledgeObjectProvenance,
  type KnowledgeSupportRecord,
  type KnowledgeRelationship,
  type PublishedEntity,
  type PublishedRelationship,
  type PublishedRelationshipTraversal,
  type StoredKnowledgeProvenance,
  type ProjectedEntity,
  type ProjectedRelationship,
  type ProjectionStatistics,
  type SearchProjectionSummary,
  parseRepositoryId,
  parseSourceId,
  parseSourceRootId,
  parseWorkspaceId,
  type Document,
  type RepositoryCandidate,
  type Repository,
  type Source,
  type SourceRoot,
  type Workspace,
  type WorkspaceDiscoveryRules,
} from '@workspace-brain/domain';
import { z } from 'zod';

import {
  applyKnowledgeCandidates,
  ensureKnowledgeModels,
  getAvailableKnowledgePublication,
  getKnowledgeEntity,
  getKnowledgeModel,
  getKnowledgePublicationSummary,
  getLatestKnowledgePublication,
  getKnowledgeRelationship,
  getPublicationSnapshot,
  getPublishedEntity,
  getPublishedEntityProvenance,
  getPublishedRelationship,
  getPublishedRelationshipProvenance,
  listPublishedEntityRelationships,
  listKnowledgeEntities,
  listKnowledgeInputEvidence,
  listKnowledgeModels,
  listKnowledgePublications,
  listAvailableKnowledgePublications,
  listKnowledgeRelationships,
  withdrawKnowledgeDocument,
} from './knowledge.js';
import {
  buildSearchProjectionFromRequest,
  getProjectedEntity,
  getProjectedRelationship,
  getProjectionStatistics,
  rebuildSearchProjections,
  requestSearchProjection,
  searchProjectedEntities,
  searchProjectedRelationships,
} from './search-projection.js';
import { getPublicationCurrencyInputs } from './publication-currency.js';
import { getKnowledgePublicationExport } from './publication-export.js';
import {
  findPublicationDiff,
  getPublicationDiff,
  listPublicationComparisons,
  savePublicationDiff,
} from './publication-diffs.js';

export {
  buildSearchProjection,
  normalizeSearchText,
  tokenizeSearchText,
  type PublishedEntitySnapshot,
  type PublishedRelationshipSnapshot,
} from './search-projection-builder.js';

const sourceRootSchema = z
  .object({
    id: z.string(),
    sourceId: z.string(),
    absolutePath: z.string(),
  })
  .strict();

const workspaceRulesSchema = z
  .object({
    include: z.array(z.string()),
    exclude: z.array(z.string()),
  })
  .strict();

const sourceConfigurationSchema = z
  .object({
    configId: z.string().optional(),
    roots: z.array(sourceRootSchema).optional(),
    containerPaths: z.array(z.string()).optional(),
    excludeDirs: z.array(z.string()).default([]),
    includeExtensions: z.array(z.string()).default([]),
    maxFileSizeBytes: z.number().nonnegative().optional(),
    workspaceRules: z.array(workspaceRulesSchema).default([]),
  })
  .passthrough();

const workspaceConfigurationSchema = z
  .object({
    configId: z.string().optional(),
    sourceIds: z.array(z.string()),
    include: z.array(z.string()).default([]),
    exclude: z.array(z.string()).default([]),
  })
  .passthrough();

const sourceRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  config_json: z.string(),
  created_at: z.string(),
});

const workspaceRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  config_json: z.string(),
  created_at: z.string(),
});

const repositoryRowSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  path: z.string(),
  repository_type: z.enum(['git', 'unknown']),
  fingerprint: z.string(),
  discovered_at: z.string(),
  last_seen_at: z.string(),
  discovery_method: z.string(),
});

const documentRowSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  path: z.string(),
  filename: z.string(),
  extension: z.string(),
  size_bytes: z.coerce.number(),
  modified_at: z.string(),
  fingerprint: z.string(),
  discovered_at: z.string(),
  last_seen_at: z.string(),
  discovery_method: z.string(),
});

const inventoryRowSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  path: z.string(),
  asset_type: z.enum(['repository', 'document']),
  fingerprint: z.string(),
  discovered_at: z.string(),
  last_seen_at: z.string(),
  is_present: z.boolean(),
});

const inventoryAssemblyRowSchema = z.object({
  source_id: z.string(),
  scan_id: z.string(),
  started_at: z.string().nullable(),
  discovered_at: z.string().nullable(),
  expected_repository_count: z.coerce.number().nullable(),
  expected_document_count: z.coerce.number().nullable(),
  expected_chunk_count: z.coerce.number().nullable(),
  repository_count: z.coerce.number().nullable(),
  document_count: z.coerce.number().nullable(),
  inventory_checksum: z.string().nullable(),
  completed_at: z.string().nullable(),
  duration_milliseconds: z.coerce.number().nullable(),
  status: z.enum(['assembling', 'committed', 'superseded', 'expired']),
});

const inventoryAssemblyChunkRowSchema = z.object({
  chunk_index: z.coerce.number(),
  repository_count: z.coerce.number(),
  document_count: z.coerce.number(),
  checksum: z.string(),
  repositories_json: z.string().nullable(),
  documents_json: z.string().nullable(),
});

const discoveryEventEnvelopeSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: z.enum([
      'SourceScanRequested',
      'SourceScanStarted',
      'SourceInventorySubmitted',
      'SourceInventoryStarted',
      'SourceInventoryChunk',
      'SourceInventoryCompleted',
      'SourceScanFailed',
      'SourceScanCompleted',
      'RepositoryDiscovered',
      'RepositoryModified',
      'RepositoryRemoved',
      'DocumentDiscovered',
      'DocumentModified',
      'DocumentRemoved',
      'DocumentProcessingSubmitted',
      'DocumentExtracted',
      'KnowledgeCandidatesSubmitted',
      'KnowledgeEntityDiscovered',
      'KnowledgeEntitySuperseded',
      'KnowledgeRelationshipDiscovered',
      'KnowledgeRelationshipSuperseded',
      'KnowledgeModelPublished',
      'SearchProjectionRequested',
      'SearchProjectionBuilt',
    ]),
    eventVersion: z.literal(1),
    occurredAt: z.string(),
    producer: z.enum([
      'workspace-brain-api',
      'workspace-brain-ingestion-worker',
      'workspace-brain-knowledge-worker',
    ]),
    correlationId: z.string(),
    idempotencyKey: z.string(),
    partitionKey: z.string(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

const evidenceLocatorSchema = z.union([
  z
    .object({
      kind: z.enum(['markdown-lines', 'text-lines', 'yaml-lines']),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
      headingPath: z.array(z.string()).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('json-pointer'),
      pointer: z.string().regex(/^(?:\/(?:[^~]|~[01])*)*$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('scala-symbol'),
      packageName: z.string().max(512),
      symbolKind: z.enum([
        'package',
        'import',
        'class',
        'object',
        'trait',
        'method',
        'value',
        'constructor-parameter',
      ]),
      symbolName: z.string().max(1024),
      enclosingSymbol: z.string().max(1024).optional(),
      signature: z.string().max(2000).optional(),
      extendsType: z.string().max(1024).optional(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('scala-call-site'),
      packageName: z.string().max(512),
      enclosingSymbol: z.string().max(1024),
      targetText: z.string().max(1024),
      methodName: z.string().max(256),
      receiver: z.string().max(512).optional(),
      branchContext: z.string().max(64).optional(),
      asyncGroup: z.string().max(64).optional(),
      callIndex: z.number().int().positive(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('play-route'),
      routeSet: z.string().max(64),
      method: z.string().max(16).optional(),
      declaredPath: z.string().max(4096).optional(),
      handlerExpression: z.string().max(2048).optional(),
      mountPrefix: z.string().max(4096).optional(),
      includeTarget: z.string().max(1024).optional(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('hocon-key'),
      key: z.string().min(1).max(1024),
      valueKind: z.enum([
        'substitution',
        'string',
        'boolean',
        'number',
        'unquoted',
        'unsupported',
        'redacted',
      ]),
      literalValue: z.string().max(2000).optional(),
      substitutions: z.array(z.string().max(1024)).max(50).optional(),
      lineStart: z.number().int().positive(),
      lineEnd: z.number().int().positive(),
    })
    .strict(),
]);

const processingCandidateSchema = z
  .object({
    documentId: z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    sourceId: z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    path: z.string().min(1).max(4096),
    contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    processedAt: z.string().datetime(),
    durationMilliseconds: z.number().nonnegative(),
    processorId: z.enum([
      'markdown',
      'yaml',
      'json',
      'plain-text',
      'typescript',
      'scala-source',
      'play-routes',
      'hocon',
      'dockerfile',
    ]),
    processorVersion: z.number().int().positive(),
    extractionRuleId: z.enum([
      'markdown-blocks',
      'yaml-scalar-values',
      'json-scalar-values',
      'text-paragraphs',
      'typescript-imports',
      'scala-symbols-and-calls',
      'play-route-declarations',
      'hocon-key-values',
      'dockerfile-base-images',
    ]),
    extractionRuleVersion: z.number().int().positive(),
    evidence: z
      .array(
        z
          .object({
            key: z.string().min(1).max(4096),
            kind: z.enum([
              'heading',
              'paragraph',
              'list-item',
              'table-row',
              'code-block',
              'structured-value',
            ]),
            excerpt: z.string().max(4000),
            truncated: z.boolean(),
            locator: evidenceLocatorSchema,
          })
          .strict(),
      )
      .max(100_000),
  })
  .strict()
  .superRefine((candidate, context) => {
    const expectedRule: Record<string, string> = {
      markdown: 'markdown-blocks',
      yaml: 'yaml-scalar-values',
      json: 'json-scalar-values',
      'plain-text': 'text-paragraphs',
      typescript: 'typescript-imports',
      'scala-source': 'scala-symbols-and-calls',
      'play-routes': 'play-route-declarations',
      hocon: 'hocon-key-values',
      dockerfile: 'dockerfile-base-images',
    };
    if (expectedRule[candidate.processorId] !== candidate.extractionRuleId) {
      context.addIssue({
        code: 'custom',
        path: ['extractionRuleId'],
        message: 'Extraction rule does not match the processor',
      });
    }
  });

const processingRunRowSchema = z.object({
  payload_hash: z.string(),
  document_version_id: z.string(),
});

const documentVersionRowSchema = z.object({
  id: z.string(),
  document_id: z.string(),
  content_hash: z.string(),
  processed_at: z.string(),
  processor_id: z.string(),
  processor_version: z.coerce.number().int(),
  extraction_rule_id: z.string(),
  extraction_rule_version: z.coerce.number().int(),
  evidence_count: z.coerce.number().int(),
});

const evidenceRowSchema = z.object({
  id: z.string(),
  document_version_id: z.string(),
  evidence_key: z.string(),
  evidence_kind: z.enum([
    'heading',
    'paragraph',
    'list-item',
    'table-row',
    'code-block',
    'structured-value',
  ]),
  excerpt: z.string(),
  truncated: z.boolean(),
  locator_json: z.string(),
});

const evidenceExplanationRowSchema = z.object({
  evidence_id: z.string(),
  document_version_id: z.string(),
  evidence_key: z.string(),
  evidence_kind: evidenceRowSchema.shape.evidence_kind,
  excerpt: z.string(),
  truncated: z.boolean(),
  locator_json: z.string(),
  version_id: z.string(),
  document_id: z.string(),
  content_fingerprint: z.string(),
  content_hash: z.string(),
  processed_at: z.string(),
  processor_id: z.string(),
  processor_version: z.coerce.number().int(),
  extraction_rule_id: z.string(),
  extraction_rule_version: z.coerce.number().int(),
  evidence_count: z.coerce.number().int(),
  source_id: z.string(),
  path: z.string(),
  filename: z.string(),
});

type DuckDbCatalogue = CatalogueDiscovery & CatalogueHealth;
export type DuckDbConnection = Awaited<ReturnType<DuckDBInstance['connect']>>;

export async function createDuckDbCatalogue(
  databasePath: string,
  migrationsDirectory: string,
  resources?: { readonly memoryLimitMb: number; readonly threads: number },
): Promise<DuckDbCatalogue> {
  if (
    resources !== undefined &&
    (!Number.isSafeInteger(resources.memoryLimitMb) ||
      resources.memoryLimitMb < 1 ||
      !Number.isSafeInteger(resources.threads) ||
      resources.threads < 1)
  ) {
    throw new Error(
      'DuckDB memory limit and threads must be positive safe integers',
    );
  }
  const instance = await DuckDBInstance.create(
    databasePath,
    resources === undefined
      ? undefined
      : {
          memory_limit: `${resources.memoryLimitMb}MB`,
          threads: String(resources.threads),
          preserve_insertion_order: 'false',
        },
  );
  const connection = await instance.connect();

  try {
    await runMigrations(connection, migrationsDirectory);
  } catch (error) {
    connection.closeSync();
    instance.closeSync();
    throw error;
  }

  return createCatalogueWriteCoordinator({
    async listSources(request): Promise<CataloguePage<Source>> {
      const rows = await queryPage(
        connection,
        'sources',
        request,
        "SELECT id, name, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM sources",
      );
      return { items: rows.map(parseSourceRow) };
    },

    async listWorkspaces(request): Promise<CataloguePage<Workspace>> {
      const rows = await queryPage(
        connection,
        'workspaces',
        request,
        "SELECT id, name, description, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM workspaces",
      );
      return { items: rows.map(parseWorkspaceRow) };
    },

    async listRepositories(request): Promise<CataloguePage<Repository>> {
      const { where, parameters } = buildFilters(request, false);
      const rows = await queryFilteredPage(
        connection,
        'repositories',
        request.limit,
        "SELECT * FROM (SELECT repositories.id, repositories.source_id, repositories.path, repositories.repository_type, inventory_records.fingerprint, strftime(repositories.discovered_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS discovered_at, strftime(inventory_records.last_seen_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS last_seen_at, repositories.discovery_method FROM repositories JOIN inventory_records USING (source_id, path) WHERE inventory_records.asset_type = 'repository' AND inventory_records.is_present) AS repository_catalogue",
        where,
        parameters,
      );
      return {
        items: rows.map((row) => {
          const parsed = repositoryRowSchema.parse(row);
          return {
            id: parseRepositoryId(parsed.id),
            sourceId: parseSourceId(parsed.source_id),
            path: parsed.path,
            repositoryType: parsed.repository_type,
            fingerprint: parsed.fingerprint,
            discoveredAt: parsed.discovered_at,
            lastSeenAt: parsed.last_seen_at,
            discoveryMethod: parseDiscoveryMethod(parsed.discovery_method),
          };
        }),
      };
    },

    async listDocuments(request): Promise<CataloguePage<Document>> {
      const { where, parameters } = buildFilters(request, true);
      const rows = await queryFilteredPage(
        connection,
        'documents',
        request.limit,
        "SELECT * FROM (SELECT documents.id, documents.source_id, documents.path, documents.filename, documents.extension, documents.size_bytes, strftime(documents.modified_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS modified_at, inventory_records.fingerprint, strftime(documents.discovered_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS discovered_at, strftime(inventory_records.last_seen_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS last_seen_at, documents.discovery_method FROM documents JOIN inventory_records USING (source_id, path) WHERE inventory_records.asset_type = 'document' AND inventory_records.is_present) AS document_catalogue",
        where,
        parameters,
      );
      return {
        items: rows.map((row) => {
          const parsed = documentRowSchema.parse(row);
          return {
            id: parseDocumentId(parsed.id),
            sourceId: parseSourceId(parsed.source_id),
            path: parsed.path,
            filename: parsed.filename,
            extension: parsed.extension,
            sizeBytes: parsed.size_bytes,
            modifiedAt: parsed.modified_at,
            fingerprint: parsed.fingerprint,
            discoveredAt: parsed.discovered_at,
            lastSeenAt: parsed.last_seen_at,
            discoveryMethod: parseDiscoveryMethod(parsed.discovery_method),
          };
        }),
      };
    },

    async registerConfiguration(
      sources: readonly ConfiguredSource[],
      workspaces: readonly ConfiguredWorkspace[],
    ): Promise<void> {
      const sourceIds = new Map<string, ReturnType<typeof createSourceId>>();
      const workspaceRules = new Map<string, WorkspaceDiscoveryRules[]>();
      for (const workspace of workspaces) {
        for (const sourceConfigId of workspace.sourceConfigIds) {
          const rules = workspaceRules.get(sourceConfigId) ?? [];
          rules.push({
            include: workspace.include,
            exclude: workspace.exclude,
          });
          workspaceRules.set(sourceConfigId, rules);
        }
      }

      for (const source of sources) {
        const existing = await connection.runAndReadAll(
          "SELECT id, name, config_id, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM sources WHERE config_id = $1",
          [source.configId],
        );
        const existingRow = existing.getRowObjectsJson()[0];
        const previousConfig =
          existingRow === undefined
            ? undefined
            : sourceConfigurationSchema.parse(
                JSON.parse(
                  requiredString(existingRow.config_json, 'source config'),
                ),
              );
        const id =
          existingRow === undefined
            ? createSourceId()
            : parseSourceId(requiredString(existingRow.id, 'source id'));
        sourceIds.set(source.configId, id);
        const previousRoots = new Map(
          (previousConfig?.roots ?? []).map((root) => [
            root.absolutePath,
            root,
          ]),
        );
        const roots: SourceRoot[] = source.rootPaths.map((absolutePath) => {
          const previous = previousRoots.get(absolutePath);
          return {
            id:
              previous === undefined
                ? createSourceRootId()
                : parseSourceRootId(previous.id),
            sourceId: id,
            absolutePath,
          };
        });
        const config = JSON.stringify({
          configId: source.configId,
          roots,
          containerPaths: roots.map((root) => root.absolutePath),
          excludeDirs: source.excludeDirs,
          includeExtensions: source.includeExtensions,
          maxFileSizeBytes: source.maxFileSizeBytes,
          workspaceRules: workspaceRules.get(source.configId) ?? [],
        });
        if (existingRow === undefined) {
          await connection.run(
            'INSERT INTO sources (id, name, provider_type, config_json, created_at, config_id) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)',
            [id, source.name, 'filesystem', config, source.configId],
          );
        } else if (
          existingRow.name !== source.name ||
          existingRow.config_json !== config
        ) {
          // Updating indexed config_id makes DuckDB replace a referenced parent row.
          await connection.run(
            'UPDATE sources SET name = $1, config_json = $2 WHERE id = $3',
            [source.name, config, id],
          );
        }
      }
      for (const workspace of workspaces) {
        const sourceIdsForWorkspace = workspace.sourceConfigIds.map(
          (sourceConfigId) => {
            const sourceId = sourceIds.get(sourceConfigId);
            if (sourceId === undefined) {
              throw new Error(
                `Workspace ${workspace.configId} references unregistered source ${sourceConfigId}`,
              );
            }
            return sourceId;
          },
        );
        const existing = await connection.runAndReadAll(
          'SELECT id, name, config_id, CAST(config_json AS VARCHAR) AS config_json FROM workspaces WHERE config_id = $1',
          [workspace.configId],
        );
        const existingRow = existing.getRowObjectsJson()[0];
        const existingId = existingRow?.id;
        const id =
          existingId === undefined
            ? createWorkspaceId()
            : parseWorkspaceId(requiredString(existingId, 'workspace id'));
        const config = JSON.stringify({
          configId: workspace.configId,
          sourceIds: sourceIdsForWorkspace,
          include: workspace.include,
          exclude: workspace.exclude,
        });
        if (existingId === undefined) {
          await connection.run(
            'INSERT INTO workspaces (id, name, description, config_json, created_at, config_id) VALUES ($1, $2, NULL, $3, CURRENT_TIMESTAMP, $4)',
            [id, workspace.name, config, workspace.configId],
          );
        } else if (
          existingRow?.name !== workspace.name ||
          existingRow.config_id !== workspace.configId ||
          existingRow.config_json !== config
        ) {
          await connection.run(
            'UPDATE workspaces SET name = $1, config_json = $2, config_id = $3 WHERE id = $4',
            [workspace.name, config, workspace.configId, id],
          );
        }
      }
      await ensureKnowledgeModels(connection);
    },

    async getSource(sourceId: string): Promise<Source | undefined> {
      const rows = await connection.runAndReadAll(
        "SELECT id, name, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM sources WHERE id = $1",
        [sourceId],
      );
      const row = rows.getRowObjectsJson()[0];
      return row === undefined ? undefined : parseSourceRow(row);
    },

    async listSourcesForDiscovery(
      request,
    ): Promise<CataloguePage<DiscoverySource>> {
      const rows = await queryPage(
        connection,
        'sources',
        request,
        "SELECT id, name, CAST(config_json AS VARCHAR) AS config_json, strftime(created_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS created_at FROM sources",
      );
      const sources = rows.map(parseSourceRow);
      return {
        items: sources.map((source) => {
          const rules = source.workspaceRules ?? [];
          return {
            sourceId: source.id,
            roots: source.roots ?? [],
            workspaceRules: rules,
            excludedDirectoryNames: source.excludeDirs ?? [],
            includeExtensions: source.includeExtensions ?? [],
            maxFileSizeBytes: source.maxFileSizeBytes ?? 50 * 1024 * 1024,
          };
        }),
      };
    },

    async stageInventoryStarted(payload) {
      return stageInventoryStarted(connection, payload);
    },

    async stageInventoryChunk(payload) {
      return stageInventoryChunk(connection, payload);
    },

    async stageInventoryCompleted(payload) {
      return stageInventoryCompleted(connection, payload);
    },

    async getInventoryAssembly(
      sourceId: string,
      scanId: string,
    ): Promise<InventoryAssemblySnapshot | undefined> {
      const rows = await connection.runAndReadAll(
        'SELECT source_id, scan_id, started_at, discovered_at, expected_repository_count, expected_document_count, expected_chunk_count, repository_count, document_count, inventory_checksum, completed_at, duration_milliseconds, status FROM source_inventory_assemblies WHERE source_id = $1 AND scan_id = $2',
        [sourceId, scanId],
      );
      const row = rows.getRowObjectsJson()[0];
      if (row === undefined) {
        return undefined;
      }
      const assembly = inventoryAssemblyRowSchema.parse(row);
      const chunkRows = await connection.runAndReadAll(
        'SELECT chunk_index, repository_count, document_count, checksum, CAST(repositories_json AS VARCHAR) AS repositories_json, CAST(documents_json AS VARCHAR) AS documents_json FROM source_inventory_chunks WHERE source_id = $1 AND scan_id = $2 ORDER BY chunk_index',
        [sourceId, scanId],
      );
      return {
        sourceId: assembly.source_id,
        scanId: assembly.scan_id,
        ...(assembly.started_at === null
          ? {}
          : { startedAt: assembly.started_at }),
        ...(assembly.discovered_at === null
          ? {}
          : { discoveredAt: assembly.discovered_at }),
        ...(assembly.expected_repository_count === null
          ? {}
          : { expectedRepositoryCount: assembly.expected_repository_count }),
        ...(assembly.expected_document_count === null
          ? {}
          : { expectedDocumentCount: assembly.expected_document_count }),
        ...(assembly.expected_chunk_count === null
          ? {}
          : { expectedChunkCount: assembly.expected_chunk_count }),
        ...(assembly.repository_count === null
          ? {}
          : { repositoryCount: assembly.repository_count }),
        ...(assembly.document_count === null
          ? {}
          : { documentCount: assembly.document_count }),
        ...(assembly.inventory_checksum === null
          ? {}
          : { inventoryChecksum: assembly.inventory_checksum }),
        ...(assembly.completed_at === null
          ? {}
          : { completedAt: assembly.completed_at }),
        ...(assembly.duration_milliseconds === null
          ? {}
          : { durationMilliseconds: assembly.duration_milliseconds }),
        status: assembly.status,
        chunks: chunkRows.getRowObjectsJson().map((chunkRow) => {
          const chunk = inventoryAssemblyChunkRowSchema.parse(chunkRow);
          return {
            chunkIndex: chunk.chunk_index,
            repositoryCount: chunk.repository_count,
            documentCount: chunk.document_count,
            checksum: chunk.checksum,
            repositories:
              chunk.repositories_json === null
                ? []
                : (JSON.parse(
                    chunk.repositories_json,
                  ) as RepositoryCandidate[]),
            documents:
              chunk.documents_json === null
                ? []
                : (JSON.parse(chunk.documents_json) as DocumentCandidate[]),
          };
        }),
      };
    },

    async expireInventoryAssemblies(before: string) {
      await connection.run('BEGIN TRANSACTION');
      try {
        const rows = await connection.runAndReadAll(
          "SELECT assemblies.source_id, assemblies.scan_id, COUNT(chunks.chunk_index) AS received_chunk_count, assemblies.expected_chunk_count FROM source_inventory_assemblies AS assemblies LEFT JOIN source_inventory_chunks AS chunks USING (source_id, scan_id) WHERE assemblies.status = 'assembling' AND assemblies.updated_at < CAST($1 AS TIMESTAMP) GROUP BY assemblies.source_id, assemblies.scan_id, assemblies.expected_chunk_count",
          [before],
        );
        const expired = rows.getRowObjectsJson().map((row) => {
          const parsed = z
            .object({
              source_id: z.string(),
              scan_id: z.string(),
              received_chunk_count: z.coerce.number(),
              expected_chunk_count: z.coerce.number().nullable(),
            })
            .parse(row);
          return {
            sourceId: parsed.source_id,
            scanId: parsed.scan_id,
            receivedChunkCount: parsed.received_chunk_count,
            ...(parsed.expected_chunk_count === null
              ? {}
              : { expectedChunkCount: parsed.expected_chunk_count }),
          } satisfies ExpiredInventoryAssembly;
        });
        for (const assembly of expired) {
          await connection.run(
            'DELETE FROM source_inventory_chunks WHERE source_id = $1 AND scan_id = $2',
            [assembly.sourceId, assembly.scanId],
          );
          await connection.run(
            "UPDATE source_inventory_assemblies SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE source_id = $1 AND scan_id = $2",
            [assembly.sourceId, assembly.scanId],
          );
        }
        await connection.run('COMMIT');
        return expired;
      } catch (error) {
        await connection.run('ROLLBACK');
        throw error;
      }
    },

    async persistScan(
      sourceId: string,
      repositories: readonly RepositoryCandidate[],
      documents: readonly DocumentCandidate[],
      discoveredAt: string,
      correlationId: string,
      durationMilliseconds: number,
      inventoryCommit?: {
        readonly scanId: string;
        readonly inventoryChecksum: string;
      },
    ): Promise<ScanPersistenceResult> {
      const parsedSourceId = parseSourceId(sourceId);
      const persistedRepositories: Repository[] = [];
      const persistedDocuments: Document[] = [];
      const repositoryChanges: InventoryChange<Repository | InventoryRecord>[] =
        [];
      const documentChanges: InventoryChange<Document | InventoryRecord>[] = [];
      await connection.run('BEGIN TRANSACTION');
      try {
        if (inventoryCommit !== undefined) {
          const priorStatus = await prepareInventoryCommit(
            connection,
            sourceId,
            discoveredAt,
            inventoryCommit,
          );
          if (priorStatus !== undefined) {
            await connection.run('COMMIT');
            return {
              repositories: [],
              documents: [],
              repositoryChanges: [],
              documentChanges: [],
              inventoryCommitStatus: priorStatus,
            };
          }
        }
        const inventoryResult = await connection.runAndReadAll(
          "SELECT id, source_id, path, asset_type, fingerprint, strftime(discovered_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS discovered_at, strftime(last_seen_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS last_seen_at, is_present FROM inventory_records WHERE source_id = $1",
          [sourceId],
        );
        const previousRecords = new Map(
          inventoryResult
            .getRowObjectsJson()
            .map((row) => inventoryRowSchema.parse(row))
            .map((row) => [`${row.asset_type}\0${row.path}`, row]),
        );
        const seenKeys = new Set<string>();

        for (const candidate of repositories) {
          const key = `repository\0${candidate.path}`;
          const previous = previousRecords.get(key);
          const record: Repository = {
            id:
              previous === undefined
                ? createRepositoryId()
                : parseRepositoryId(previous.id),
            sourceId: parsedSourceId,
            path: candidate.path,
            repositoryType: candidate.repositoryType,
            fingerprint: candidate.fingerprint,
            discoveredAt:
              previous === undefined
                ? discoveredAt
                : normalizeTimestamp(previous.discovered_at),
            lastSeenAt: discoveredAt,
            discoveryMethod: candidate.discoveryMethod,
          };
          const change = getInventoryChange(previous, record.fingerprint);
          seenKeys.add(key);

          await connection.run(
            'INSERT INTO repositories (id, source_id, path, repository_type, discovered_at, discovery_method) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (source_id, path) DO UPDATE SET repository_type = excluded.repository_type, discovered_at = excluded.discovered_at, discovery_method = excluded.discovery_method WHERE repositories.repository_type IS DISTINCT FROM excluded.repository_type OR repositories.discovery_method IS DISTINCT FROM excluded.discovery_method',
            [
              record.id,
              record.sourceId,
              record.path,
              record.repositoryType,
              record.discoveredAt,
              record.discoveryMethod,
            ],
          );
          await upsertInventoryRecord(
            connection,
            record.id,
            record.sourceId,
            record.path,
            'repository',
            record.fingerprint,
            record.discoveredAt,
            record.lastSeenAt,
          );
          repositoryChanges.push({ change, record });
          if (change !== 'unchanged') {
            await insertDiscoveryHistory(
              connection,
              repositoryEventType(change),
              record,
              correlationId,
              discoveredAt,
            );
          }
          persistedRepositories.push(record);
        }

        for (const candidate of documents) {
          const key = `document\0${candidate.path}`;
          const previous = previousRecords.get(key);
          const record: Document = {
            id:
              previous === undefined
                ? createDocumentId()
                : parseDocumentId(previous.id),
            sourceId: parsedSourceId,
            ...candidate,
            discoveredAt:
              previous === undefined
                ? discoveredAt
                : normalizeTimestamp(previous.discovered_at),
            lastSeenAt: discoveredAt,
          };
          const change = getInventoryChange(previous, record.fingerprint);
          seenKeys.add(key);

          if (change === 'modified') {
            await connection.run(
              'UPDATE document_current_versions SET document_version_id = NULL, revision = revision + 1, updated_at = $2 WHERE document_id = $1 AND document_version_id IS NOT NULL',
              [record.id, discoveredAt],
            );
          }
          documentChanges.push({ change, record });
          persistedDocuments.push(record);
        }

        await insertBatchedRows(
          connection,
          'INSERT INTO documents (id, source_id, path, filename, extension, size_bytes, modified_at, discovered_at, discovery_method)',
          persistedDocuments.map((record) => [
            record.id,
            record.sourceId,
            record.path,
            record.filename,
            record.extension,
            record.sizeBytes,
            record.modifiedAt,
            record.discoveredAt,
            record.discoveryMethod,
          ]),
          'ON CONFLICT (source_id, path) DO UPDATE SET filename = excluded.filename, extension = excluded.extension, size_bytes = excluded.size_bytes, modified_at = excluded.modified_at, discovered_at = excluded.discovered_at, discovery_method = excluded.discovery_method WHERE documents.filename IS DISTINCT FROM excluded.filename OR documents.extension IS DISTINCT FROM excluded.extension OR documents.size_bytes IS DISTINCT FROM excluded.size_bytes OR documents.modified_at IS DISTINCT FROM excluded.modified_at OR documents.discovery_method IS DISTINCT FROM excluded.discovery_method',
        );
        await insertBatchedRows(
          connection,
          'INSERT INTO inventory_records (id, source_id, path, asset_type, fingerprint, discovered_at, last_seen_at, is_present)',
          persistedDocuments.map((record) => [
            record.id,
            record.sourceId,
            record.path,
            'document',
            record.fingerprint,
            record.discoveredAt,
            record.lastSeenAt,
            true,
          ]),
          'ON CONFLICT (source_id, path, asset_type) DO UPDATE SET fingerprint = excluded.fingerprint, last_seen_at = excluded.last_seen_at, is_present = TRUE',
        );
        const documentHistory = documentChanges.flatMap(({ change, record }) =>
          change !== 'added' && change !== 'modified'
            ? []
            : [
                {
                  record,
                  event: createInventoryHistoryEvent(
                    documentEventType(change),
                    record,
                    correlationId,
                    discoveredAt,
                  ),
                },
              ],
        );
        await insertBatchedRows(
          connection,
          'INSERT INTO discovery_history (id, source_id, event_type, subject_id, path, fingerprint, occurred_at, correlation_id, payload_json)',
          documentHistory.map(({ event, record }) => [
            event.eventId,
            record.sourceId,
            event.eventType,
            record.id,
            record.path,
            record.fingerprint,
            discoveredAt,
            correlationId,
            JSON.stringify(record),
          ]),
        );
        await insertBatchedRows(
          connection,
          'INSERT INTO discovery_outbox (event_id, idempotency_key, source_id, event_type, occurred_at, correlation_id, event_json)',
          documentHistory.map(({ event }) => [
            event.eventId,
            event.idempotencyKey,
            event.partitionKey,
            event.eventType,
            event.occurredAt,
            event.correlationId,
            JSON.stringify(event),
          ]),
          'ON CONFLICT (idempotency_key) DO NOTHING',
        );

        for (const previous of previousRecords.values()) {
          const key = `${previous.asset_type}\0${previous.path}`;
          if (seenKeys.has(key) || !previous.is_present) {
            continue;
          }
          const record: InventoryRecord = {
            id: previous.id,
            sourceId: parsedSourceId,
            path: previous.path,
            type: previous.asset_type,
            fingerprint: previous.fingerprint,
            discoveredAt: normalizeTimestamp(previous.discovered_at),
            lastSeenAt: normalizeTimestamp(previous.last_seen_at),
          };
          const change = { change: 'removed' as const, record };
          if (previous.asset_type === 'repository') {
            repositoryChanges.push(change);
            await connection.run(
              'DELETE FROM repositories WHERE source_id = $1 AND path = $2',
              [sourceId, previous.path],
            );
            await insertDiscoveryHistory(
              connection,
              'RepositoryRemoved',
              record,
              correlationId,
              discoveredAt,
            );
          } else {
            documentChanges.push(change);
            await connection.run(
              'DELETE FROM documents WHERE source_id = $1 AND path = $2',
              [sourceId, previous.path],
            );
            const removalEvent = await insertDiscoveryHistory(
              connection,
              'DocumentRemoved',
              record,
              correlationId,
              discoveredAt,
            );
            if (removalEvent.eventType === 'DocumentRemoved') {
              await withdrawKnowledgeDocument(connection, removalEvent);
            }
            await connection.run(
              'UPDATE document_current_versions SET document_version_id = NULL, revision = revision + 1, updated_at = $2 WHERE document_id = $1',
              [record.id, discoveredAt],
            );
          }
          await connection.run(
            'UPDATE inventory_records SET is_present = FALSE WHERE source_id = $1 AND path = $2 AND asset_type = $3',
            [sourceId, previous.path, previous.asset_type],
          );
        }
        const changes = [...repositoryChanges, ...documentChanges];
        const metrics: SourceScanMetrics = {
          repositoryCount: persistedRepositories.length,
          documentCount: persistedDocuments.length,
          addedCount: changes.filter(({ change }) => change === 'added').length,
          modifiedCount: changes.filter(({ change }) => change === 'modified')
            .length,
          removedCount: changes.filter(({ change }) => change === 'removed')
            .length,
          unchangedCount: changes.filter(({ change }) => change === 'unchanged')
            .length,
          durationMilliseconds,
        };
        await completeScanAndQueueEvent(
          connection,
          sourceId,
          correlationId,
          discoveredAt,
          metrics,
        );
        if (inventoryCommit !== undefined) {
          await recordInventoryCommit(
            connection,
            sourceId,
            discoveredAt,
            inventoryCommit,
          );
        }
        await connection.run('COMMIT');
      } catch (error) {
        await connection.run('ROLLBACK');
        throw error;
      }
      return {
        repositories: persistedRepositories,
        documents: persistedDocuments,
        repositoryChanges,
        documentChanges,
        ...(inventoryCommit === undefined
          ? {}
          : { inventoryCommitStatus: 'committed' as const }),
      };
    },

    async applyDocumentProcessing(
      event: DocumentProcessingEvent,
    ): Promise<DocumentProcessingApplyResult> {
      return applyDocumentProcessing(connection, event);
    },

    async applyKnowledgeCandidates(
      event: KnowledgeCandidateEvent,
    ): Promise<void> {
      await applyKnowledgeCandidates(connection, event);
    },

    async listKnowledgeInputEvidence(
      documentVersionId: string,
    ): Promise<readonly KnowledgeInputEvidence[]> {
      return listKnowledgeInputEvidence(connection, documentVersionId);
    },

    async listKnowledgeModels(
      request: KnowledgePageRequest,
    ): Promise<CataloguePage<KnowledgeModel>> {
      return listKnowledgeModels(connection, request);
    },

    async getKnowledgeModel(
      modelId: string,
    ): Promise<KnowledgeModel | undefined> {
      return getKnowledgeModel(connection, modelId);
    },

    async listKnowledgeEntities(
      request: KnowledgePageRequest,
    ): Promise<CataloguePage<KnowledgeEntity>> {
      return listKnowledgeEntities(connection, request);
    },

    async getKnowledgeEntity(
      entityId: string,
    ): Promise<KnowledgeEntity | undefined> {
      return getKnowledgeEntity(connection, entityId);
    },

    async listKnowledgeRelationships(
      request: KnowledgePageRequest,
    ): Promise<CataloguePage<KnowledgeRelationship>> {
      return listKnowledgeRelationships(connection, request);
    },

    async getKnowledgeRelationship(
      relationshipId: string,
    ): Promise<KnowledgeRelationship | undefined> {
      return getKnowledgeRelationship(connection, relationshipId);
    },

    async listKnowledgePublications(
      request: KnowledgePageRequest,
    ): Promise<CataloguePage<KnowledgePublication>> {
      return listKnowledgePublications(connection, request);
    },

    async listAvailableKnowledgePublications(
      request: KnowledgePageRequest,
    ): Promise<CataloguePage<KnowledgePublication>> {
      return listAvailableKnowledgePublications(connection, request);
    },

    async getKnowledgePublication(
      publicationId: string,
    ): Promise<KnowledgePublication | undefined> {
      return getAvailableKnowledgePublication(connection, publicationId);
    },

    async getLatestKnowledgePublication(
      modelId: string,
    ): Promise<KnowledgePublication | undefined> {
      return getLatestKnowledgePublication(connection, modelId);
    },

    async getKnowledgePublicationSummary(
      publicationId: string,
    ): Promise<KnowledgePublicationSummary | undefined> {
      return getKnowledgePublicationSummary(connection, publicationId);
    },

    async getPublicationSnapshot(publicationId: string) {
      return getPublicationSnapshot(connection, publicationId);
    },

    async getKnowledgePublicationExport(publicationId: string) {
      return getKnowledgePublicationExport(connection, publicationId);
    },

    async getPublicationCurrencyInputs(publicationId: string) {
      return getPublicationCurrencyInputs(connection, publicationId);
    },

    async findPublicationDiff(
      fromPublicationId: string,
      toPublicationId: string,
    ) {
      return findPublicationDiff(
        connection,
        fromPublicationId,
        toPublicationId,
      );
    },

    async getPublicationDiff(diffId: string) {
      return getPublicationDiff(connection, diffId);
    },

    async listPublicationComparisons(request) {
      return listPublicationComparisons(connection, request);
    },

    async savePublicationDiff(diff, invalidDiffId) {
      return savePublicationDiff(connection, diff, invalidDiffId);
    },

    async getPublishedEntity(
      publicationId: string,
      entityId: string,
    ): Promise<PublishedEntity | undefined> {
      return getPublishedEntity(connection, publicationId, entityId);
    },

    async getPublishedRelationship(
      publicationId: string,
      relationshipId: string,
    ): Promise<PublishedRelationship | undefined> {
      return getPublishedRelationship(
        connection,
        publicationId,
        relationshipId,
      );
    },

    async listPublishedEntityRelationships(
      request: PublishedRelationshipRequest,
    ): Promise<CataloguePage<PublishedRelationshipTraversal>> {
      return listPublishedEntityRelationships(connection, request);
    },

    async getPublishedEntityProvenance(
      publicationId: string,
      entityId: string,
    ): Promise<KnowledgeObjectProvenance | undefined> {
      const stored = await getPublishedEntityProvenance(
        connection,
        publicationId,
        entityId,
      );
      return stored === undefined
        ? undefined
        : resolveKnowledgeProvenance(connection, stored);
    },

    async getPublishedRelationshipProvenance(
      publicationId: string,
      relationshipId: string,
    ): Promise<KnowledgeObjectProvenance | undefined> {
      const stored = await getPublishedRelationshipProvenance(
        connection,
        publicationId,
        relationshipId,
      );
      return stored === undefined
        ? undefined
        : resolveKnowledgeProvenance(connection, stored);
    },

    async searchProjectedEntities(
      request: SearchEntityRequest,
    ): Promise<CataloguePage<ProjectedEntity>> {
      return searchProjectedEntities(connection, request);
    },

    async searchProjectedRelationships(
      request: SearchRelationshipRequest,
    ): Promise<CataloguePage<ProjectedRelationship>> {
      return searchProjectedRelationships(connection, request);
    },

    async getProjectedEntity(
      entityId: string,
      publicationId?: string,
    ): Promise<ProjectedEntity | undefined> {
      return getProjectedEntity(connection, entityId, publicationId);
    },

    async getProjectedRelationship(
      relationshipId: string,
      publicationId?: string,
    ): Promise<ProjectedRelationship | undefined> {
      return getProjectedRelationship(
        connection,
        relationshipId,
        publicationId,
      );
    },

    async getProjectionStatistics(
      publicationId: string,
    ): Promise<ProjectionStatistics | undefined> {
      return getProjectionStatistics(connection, publicationId);
    },

    async requestSearchProjection(
      event: KnowledgeModelPublishedEvent,
    ): Promise<void> {
      await requestSearchProjection(connection, event);
    },

    async buildSearchProjection(
      event: SearchProjectionRequestedEvent,
    ): Promise<SearchProjectionSummary> {
      return buildSearchProjectionFromRequest(connection, event);
    },

    async rebuildSearchProjections(request: {
      readonly mode: 'missing' | 'all';
      readonly correlationId: string;
    }): Promise<readonly SearchProjectionSummary[]> {
      return rebuildSearchProjections(
        connection,
        request.mode,
        request.correlationId,
      );
    },

    async listDocumentEvidence(
      documentId: string,
      request: CataloguePageRequest,
    ): Promise<CataloguePage<Evidence>> {
      const parsedDocumentId = parseDocumentId(documentId);
      if (request.limit < 1 || request.limit > 101) {
        throw new Error('Evidence page limit must be between 1 and 101');
      }
      const parameters: (string | number)[] = [parsedDocumentId];
      const filters = ['v.document_id = $1'];
      if (request.afterId !== undefined) {
        parameters.push(parseEvidenceId(request.afterId));
        filters.push(`e.id > $${parameters.length}`);
      }
      parameters.push(request.limit);
      const rows = await connection.runAndReadAll(
        `SELECT e.id, e.document_version_id, e.evidence_key, e.evidence_kind, e.excerpt, e.truncated, CAST(e.locator_json AS VARCHAR) AS locator_json FROM extracted_evidence e JOIN document_versions v ON v.id = e.document_version_id WHERE ${filters.join(' AND ')} ORDER BY e.id LIMIT $${parameters.length}`,
        parameters,
      );
      return {
        items: rows.getRowObjectsJson().map(parseEvidenceRow),
      };
    },

    async explainEvidence(
      evidenceId: string,
    ): Promise<EvidenceExplanation | undefined> {
      return loadEvidenceExplanation(connection, evidenceId);
    },

    async listPendingDiscoveryEvents(limit: number): Promise<DiscoveryEvent[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error('Outbox page limit must be between 1 and 1000');
      }
      const rows = await connection.runAndReadAll(
        'SELECT CAST(event_json AS VARCHAR) AS event_json FROM discovery_outbox WHERE published_at IS NULL ORDER BY occurred_at, event_id LIMIT $1',
        [limit],
      );
      return rows.getRowObjectsJson().map((row) => {
        const eventJson = requiredString(row.event_json, 'outbox event');
        const parsed = discoveryEventEnvelopeSchema.safeParse(
          JSON.parse(eventJson) as unknown,
        );
        if (!parsed.success) {
          throw new Error('DuckDB returned an invalid discovery outbox event');
        }
        return parsed.data as DiscoveryEvent;
      });
    },

    async markDiscoveryEventPublished(
      eventId: string,
      publishedAt: string,
    ): Promise<void> {
      await connection.run(
        'UPDATE discovery_outbox SET published_at = $2 WHERE event_id = $1 AND published_at IS NULL',
        [eventId, publishedAt],
      );
      const result = await connection.runAndReadAll(
        'SELECT published_at FROM discovery_outbox WHERE event_id = $1',
        [eventId],
      );
      const published = result.getRowObjectsJson()[0]?.published_at;
      if (published === undefined || published === null) {
        throw new Error(`Discovery outbox event ${eventId} was not found`);
      }
    },

    async recordScanStarted(
      sourceId: string,
      correlationId: string,
      startedAt: string,
    ): Promise<void> {
      await connection.run(
        "INSERT INTO source_scan_runs (correlation_id, source_id, status, started_at) VALUES ($1, $2, 'started', $3) ON CONFLICT (correlation_id) DO NOTHING",
        [correlationId, sourceId, startedAt],
      );
      const existing = await connection.runAndReadAll(
        'SELECT source_id FROM source_scan_runs WHERE correlation_id = $1',
        [correlationId],
      );
      if (existing.getRowObjectsJson()[0]?.source_id !== sourceId) {
        throw new Error(
          `Source scan correlation ${correlationId} is already assigned to another source`,
        );
      }
    },

    async recordScanFailed(
      sourceId: string,
      correlationId: string,
      failedAt: string,
      durationMilliseconds: number,
      failureType: string,
    ): Promise<void> {
      await connection.run(
        "INSERT INTO source_scan_runs (correlation_id, source_id, status, started_at, completed_at, duration_milliseconds, failure_type) VALUES ($1, $2, 'failed', $3, $3, $4, $5) ON CONFLICT (correlation_id) DO UPDATE SET status = 'failed', completed_at = excluded.completed_at, duration_milliseconds = excluded.duration_milliseconds, failure_type = excluded.failure_type",
        [correlationId, sourceId, failedAt, durationMilliseconds, failureType],
      );
      await assertScanRunStatus(connection, sourceId, correlationId, 'failed');
    },

    async check(): Promise<void> {
      await connection.runAndReadAll('SELECT 1');
      const migrationFiles = await listMigrationFiles(migrationsDirectory);
      const applied = await connection.runAndReadAll(
        'SELECT version FROM schema_migrations',
      );
      const appliedVersions = new Set(
        applied
          .getRowObjectsJson()
          .map((row) => requiredString(row.version, 'migration version')),
      );
      const missing = migrationFiles.filter(
        (file) => !appliedVersions.has(file.slice(0, -'.sql'.length)),
      );
      if (missing.length > 0) {
        throw new Error(
          `DuckDB migrations are incomplete: ${missing.join(', ')}`,
        );
      }
    },

    async close(): Promise<void> {
      connection.closeSync();
      instance.closeSync();
    },
  });
}

function createCatalogueWriteCoordinator<T extends object>(catalogue: T): T {
  let pendingOperations: Promise<void> = Promise.resolve();
  let state: 'open' | 'closing' | 'closed' = 'open';
  let closePromise: Promise<void> | undefined;

  const enqueue = <Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    if (state !== 'open') {
      return Promise.reject(new Error('DuckDB catalogue is closing or closed'));
    }
    const result = pendingOperations.then(operation);
    pendingOperations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return new Proxy(catalogue, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') {
        return value;
      }
      if (property === 'close') {
        return () => {
          if (closePromise !== undefined) {
            return closePromise;
          }
          state = 'closing';
          const closing = pendingOperations.then(async () => {
            await Reflect.apply(value, target, []);
          });
          pendingOperations = closing.then(
            () => undefined,
            () => undefined,
          );
          closePromise = closing.finally(() => {
            state = 'closed';
          });
          return closePromise;
        };
      }
      return (...args: unknown[]) =>
        enqueue(() => Reflect.apply(value, target, args));
    },
  });
}

function parseSourceRow(row: unknown): Source {
  const parsedRow = sourceRowSchema.parse(row);
  const config = sourceConfigurationSchema.parse(
    JSON.parse(parsedRow.config_json),
  );
  const id = parseSourceId(parsedRow.id);
  const roots: SourceRoot[] =
    config.roots?.map((root) => ({
      id: parseSourceRootId(root.id),
      sourceId: parseSourceId(root.sourceId),
      absolutePath: root.absolutePath,
    })) ??
    (config.containerPaths ?? []).map((absolutePath) => ({
      id: createSourceRootId(),
      sourceId: id,
      absolutePath,
    }));
  return {
    id,
    name: parsedRow.name,
    type: 'filesystem',
    containerPaths: roots.map((root) => root.absolutePath),
    roots,
    excludeDirs: config.excludeDirs,
    includeExtensions: config.includeExtensions,
    ...(config.maxFileSizeBytes === undefined
      ? {}
      : { maxFileSizeBytes: config.maxFileSizeBytes }),
    workspaceRules: config.workspaceRules,
    createdAt: parsedRow.created_at,
  };
}

async function resolveKnowledgeProvenance(
  connection: DuckDbConnection,
  stored: StoredKnowledgeProvenance,
): Promise<KnowledgeObjectProvenance> {
  const items: KnowledgeSupportRecord[] = [];
  for (const provenance of stored.provenance) {
    const evidenceExplanation = await loadEvidenceExplanation(
      connection,
      provenance.evidenceId,
    );
    if (evidenceExplanation === undefined) {
      throw new CatalogueIntegrityError(
        `Published knowledge object ${stored.knowledgeObjectId} references missing evidence`,
      );
    }
    const { evidence, documentVersion, document } = evidenceExplanation;
    if (
      evidence.documentVersionId !== provenance.documentVersionId ||
      documentVersion.id !== provenance.documentVersionId ||
      document.id !== provenance.documentId ||
      document.sourceId !== provenance.sourceId ||
      document.path !== provenance.documentPath ||
      document.fingerprint !== provenance.contentFingerprint ||
      evidence.locator === undefined ||
      stableJson(evidence.locator) !== stableJson(provenance.locator) ||
      documentVersion.processorId !== provenance.processorId ||
      documentVersion.processorVersion !== provenance.processorVersion ||
      documentVersion.extractionRuleId !== provenance.extractionRuleId ||
      documentVersion.extractionRuleVersion !== provenance.extractionRuleVersion
    ) {
      throw new CatalogueIntegrityError(
        `Published knowledge object ${stored.knowledgeObjectId} has inconsistent evidence provenance`,
      );
    }
    items.push({ provenance, evidenceExplanation });
  }
  return {
    publicationId: stored.publicationId,
    knowledgeObjectType: stored.knowledgeObjectType,
    knowledgeObjectId: stored.knowledgeObjectId,
    knowledgeVersionId: stored.knowledgeVersionId,
    knowledgeVersionNumber: stored.knowledgeVersionNumber,
    items,
  };
}

async function loadEvidenceExplanation(
  connection: DuckDbConnection,
  evidenceId: string,
): Promise<EvidenceExplanation | undefined> {
  const parsedId = parseEvidenceId(evidenceId);
  const rows = await connection.runAndReadAll(
    "SELECT e.id AS evidence_id, e.document_version_id, e.evidence_key, e.evidence_kind, e.excerpt, e.truncated, CAST(e.locator_json AS VARCHAR) AS locator_json, v.id AS version_id, v.document_id, v.content_fingerprint, v.content_hash, strftime(v.processed_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS processed_at, v.processor_id, v.processor_version, v.extraction_rule_id, v.extraction_rule_version, v.evidence_count, v.source_id, v.path, v.filename FROM extracted_evidence e JOIN document_versions v ON v.id = e.document_version_id WHERE e.id = $1",
    [parsedId],
  );
  const row = rows.getRowObjectsJson()[0];
  if (row === undefined) {
    return undefined;
  }
  const parsed = evidenceExplanationRowSchema.parse(row);
  const evidence = parseEvidenceRow({
    id: parsed.evidence_id,
    document_version_id: parsed.document_version_id,
    evidence_key: parsed.evidence_key,
    evidence_kind: parsed.evidence_kind,
    excerpt: parsed.excerpt,
    truncated: parsed.truncated,
    locator_json: parsed.locator_json,
  });
  const documentVersion: DocumentVersion = {
    id: parseDocumentVersionId(parsed.version_id),
    documentId: parseDocumentId(parsed.document_id),
    contentHash: parsed.content_hash,
    hashAlgorithm: 'sha256',
    discoveredAt: parsed.processed_at,
    processorId: parsed.processor_id,
    processorVersion: parsed.processor_version,
    extractionRuleId: parsed.extraction_rule_id,
    extractionRuleVersion: parsed.extraction_rule_version,
    evidenceCount: parsed.evidence_count,
  };
  const documentIdValue = parseDocumentId(parsed.document_id);
  const sourceIdValue = parseSourceId(parsed.source_id);
  return {
    evidence,
    documentVersion,
    document: {
      id: documentIdValue,
      sourceId: sourceIdValue,
      path: parsed.path,
      filename: parsed.filename,
      fingerprint: parsed.content_fingerprint,
    },
    provenance: {
      sourceId: sourceIdValue,
      provider: 'filesystem',
      documentPath: parsed.path,
      contentFingerprint: parsed.content_fingerprint,
      processorId: parsed.processor_id,
      processorVersion: parsed.processor_version,
      extractionRuleId: parsed.extraction_rule_id,
      extractionRuleVersion: parsed.extraction_rule_version,
    },
  };
}

async function applyDocumentProcessing(
  connection: DuckDbConnection,
  event: DocumentProcessingEvent,
): Promise<DocumentProcessingApplyResult> {
  const candidateResult = processingCandidateSchema.safeParse(
    event.payload.candidate,
  );
  if (!candidateResult.success) {
    throw new Error('Invalid document processing submission', {
      cause: candidateResult.error,
    });
  }
  if (
    event.eventId.length === 0 ||
    event.eventId.length > 128 ||
    event.correlationId.length === 0 ||
    event.idempotencyKey.length === 0 ||
    event.eventVersion !== 1 ||
    event.producer !== 'workspace-brain-knowledge-worker'
  ) {
    throw new Error('Invalid document processing submission');
  }
  const candidate = candidateResult.data;
  const documentId = parseDocumentId(candidate.documentId);
  const sourceId = parseSourceId(candidate.sourceId);
  const candidateHash = stableJson(candidate);
  const payloadHash = createHash('sha256').update(candidateHash).digest('hex');
  const evidence = [...candidate.evidence].sort((left, right) =>
    compareOrdinal(left.key, right.key),
  );
  if (new Set(evidence.map(({ key }) => key)).size !== evidence.length) {
    throw new Error(
      'Invalid document processing submission: duplicate evidence key',
    );
  }
  for (const item of evidence) {
    if (
      item.locator.kind !== 'json-pointer' &&
      item.locator.lineEnd < item.locator.lineStart
    ) {
      throw new Error(
        'Invalid document processing submission: invalid locator',
      );
    }
  }

  await connection.run('BEGIN TRANSACTION');
  try {
    const priorRunRows = await connection.runAndReadAll(
      'SELECT payload_hash, document_version_id FROM document_processing_runs WHERE event_id = $1',
      [event.eventId],
    );
    const priorRun = priorRunRows.getRowObjectsJson()[0];
    if (priorRun !== undefined) {
      const parsedRun = processingRunRowSchema.parse(priorRun);
      if (parsedRun.payload_hash !== payloadHash) {
        throw new Error(
          `Document processing event ${event.eventId} was reused with a different payload`,
        );
      }
      const priorVersion = await getDocumentVersion(
        connection,
        parsedRun.document_version_id,
      );
      const priorEvidence = await listEvidenceForVersion(
        connection,
        parsedRun.document_version_id,
      );
      await connection.run('COMMIT');
      return {
        documentVersion: priorVersion,
        evidence: priorEvidence,
        duplicate: true,
      };
    }

    const documentRows = await connection.runAndReadAll(
      "SELECT d.filename, d.source_id, d.path, i.fingerprint, i.is_present FROM documents d LEFT JOIN inventory_records i ON i.source_id = d.source_id AND i.path = d.path AND i.asset_type = 'document' WHERE d.id = $1",
      [documentId],
    );
    const documentRow = documentRows.getRowObjectsJson()[0];
    if (
      documentRow === undefined ||
      documentRow.source_id !== sourceId ||
      documentRow.path !== candidate.path
    ) {
      throw new Error(
        'Document processing candidate does not match a known catalogue document',
      );
    }
    const filename = requiredString(documentRow.filename, 'document filename');
    const preferredDefinition = await preferredProcessingDefinition(
      connection,
      filename,
    );
    if (preferredDefinition === undefined) {
      throw new Error(
        `No accepted processing definition for document filename ${filename}`,
      );
    }
    const fingerprintIsCurrent =
      documentRow.is_present === true &&
      documentRow.fingerprint === candidate.contentFingerprint;

    const existingVersionRows = await connection.runAndReadAll(
      'SELECT id FROM document_versions WHERE document_id = $1 AND content_hash = $2 AND processor_id = $3 AND processor_version = $4 AND extraction_rule_id = $5 AND extraction_rule_version = $6',
      [
        documentId,
        candidate.contentFingerprint,
        candidate.processorId,
        candidate.processorVersion,
        candidate.extractionRuleId,
        candidate.extractionRuleVersion,
      ],
    );
    const existingVersionId = existingVersionRows.getRowObjectsJson()[0]?.id;
    const isNewVersion = existingVersionId === undefined;
    const versionId = isNewVersion
      ? createDocumentVersionId()
      : parseDocumentVersionId(
          requiredString(existingVersionId, 'document version ID'),
        );
    if (isNewVersion) {
      await connection.run(
        'INSERT INTO document_versions (id, document_id, source_id, path, filename, content_fingerprint, content_hash, hash_algorithm, processed_at, processor_id, processor_version, extraction_rule_id, extraction_rule_version, evidence_count) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13)',
        [
          versionId,
          documentId,
          sourceId,
          candidate.path,
          filename,
          candidate.contentFingerprint,
          'sha256',
          candidate.processedAt,
          candidate.processorId,
          candidate.processorVersion,
          candidate.extractionRuleId,
          candidate.extractionRuleVersion,
          evidence.length,
        ],
      );
      for (const item of evidence) {
        await connection.run(
          'INSERT INTO extracted_evidence (id, document_version_id, evidence_key, evidence_kind, excerpt, truncated, locator_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [
            createEvidenceId(),
            versionId,
            item.key,
            item.kind,
            item.excerpt,
            item.truncated,
            JSON.stringify(item.locator),
            candidate.processedAt,
          ],
        );
      }
      if (
        candidate.processorVersion >= 3 ||
        (candidate.processorId === 'scala-source' &&
          candidate.processorVersion >= 2) ||
        candidate.processorId === 'play-routes' ||
        candidate.processorId === 'hocon'
      ) {
        await snapshotExtractionContext(
          connection,
          versionId,
          sourceId,
          candidate.path,
        );
      }
    } else {
      const existingEvidence = await listEvidenceForVersion(
        connection,
        String(versionId),
      );
      const normalizedExisting = existingEvidence.map((item) => ({
        key: item.key,
        kind: item.kind,
        excerpt: item.excerpt,
        truncated: item.truncated,
        locator: item.locator,
      }));
      if (stableJson(normalizedExisting) !== stableJson(evidence)) {
        throw new Error(
          'Document processing output conflicts with the existing document version',
        );
      }
    }

    await connection.run(
      "INSERT INTO document_processing_runs (event_id, payload_hash, correlation_id, source_id, document_id, document_version_id, content_fingerprint, status, started_at, completed_at, duration_milliseconds, evidence_count) VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9, $10, $11)",
      [
        event.eventId,
        payloadHash,
        event.correlationId,
        sourceId,
        documentId,
        versionId,
        candidate.contentFingerprint,
        new Date(
          new Date(candidate.processedAt).getTime() -
            candidate.durationMilliseconds,
        ).toISOString(),
        candidate.processedAt,
        candidate.durationMilliseconds,
        evidence.length,
      ],
    );
    const authority = fingerprintIsCurrent
      ? await updateCurrentDocumentVersion(
          connection,
          documentId,
          filename,
          candidate,
          versionId,
        )
      : { advanced: false, revision: 0 };
    if (authority.advanced) {
      const outputEvent = createCatalogueEvent(
        'DocumentExtracted',
        {
          documentId,
          documentVersionId: versionId,
          contentFingerprint: candidate.contentFingerprint,
          evidenceCount: evidence.length,
        },
        sourceId,
        event.correlationId,
        `document-extracted:${documentId}:${candidate.contentFingerprint}:${candidate.processorId}:${candidate.processorVersion}:${candidate.extractionRuleId}:${candidate.extractionRuleVersion}`,
        candidate.processedAt,
      );
      await insertOutboxEvent(connection, outputEvent);
    }
    const documentVersion = await getDocumentVersion(
      connection,
      String(versionId),
    );
    const persistedEvidence = await listEvidenceForVersion(
      connection,
      String(versionId),
    );
    await connection.run('COMMIT');
    return {
      documentVersion,
      evidence: persistedEvidence,
      duplicate: !isNewVersion,
    };
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
}

type ProcessingCandidate = z.infer<typeof processingCandidateSchema>;

type DocumentProcessingAuthorityRow = {
  readonly document_version_id: string | null;
  readonly content_fingerprint: string | null;
  readonly processor_id: string | null;
  readonly processor_version: number | null;
  readonly extraction_rule_id: string | null;
  readonly extraction_rule_version: number | null;
  readonly revision: number | null;
};

async function updateCurrentDocumentVersion(
  connection: DuckDbConnection,
  documentId: string,
  filename: string,
  candidate: ProcessingCandidate,
  documentVersionId: string,
): Promise<{ readonly advanced: boolean; readonly revision: number }> {
  const rows = await connection.runAndReadAll(
    'SELECT current.document_version_id, version.content_fingerprint, version.processor_id, version.processor_version, version.extraction_rule_id, version.extraction_rule_version, current.revision FROM document_current_versions current LEFT JOIN document_versions version ON version.id = current.document_version_id WHERE current.document_id = $1',
    [documentId],
  );
  const row = rows.getRowObjectsJson()[0];
  const current: DocumentProcessingAuthorityRow | undefined =
    row === undefined
      ? undefined
      : z
          .object({
            document_version_id: z.string().nullable(),
            content_fingerprint: z.string().nullable(),
            processor_id: z.string().nullable(),
            processor_version: z.coerce.number().int().nullable(),
            extraction_rule_id: z.string().nullable(),
            extraction_rule_version: z.coerce.number().int().nullable(),
            revision: z.coerce.number().int(),
          })
          .parse(row);
  const preferred = await preferredProcessingDefinition(connection, filename);
  const candidateIsPreferred =
    preferred?.processorId === candidate.processorId &&
    preferred.extractionRuleId === candidate.extractionRuleId;
  const currentMatchesContent =
    current?.document_version_id !== null &&
    current?.document_version_id !== undefined &&
    current.content_fingerprint === candidate.contentFingerprint;

  let mayAdvance = candidateIsPreferred;
  if (mayAdvance && currentMatchesContent) {
    const currentIsPreferred =
      preferred?.processorId === current.processor_id &&
      preferred.extractionRuleId === current.extraction_rule_id;
    if (currentIsPreferred) {
      const currentProcessorVersion = current.processor_version;
      const currentRuleVersion = current.extraction_rule_version;
      if (
        currentProcessorVersion === null ||
        currentProcessorVersion === undefined ||
        currentRuleVersion === null ||
        currentRuleVersion === undefined
      ) {
        throw new Error('Current document processing authority is incomplete');
      }
      mayAdvance =
        candidate.processorVersion > currentProcessorVersion ||
        (candidate.processorVersion === currentProcessorVersion &&
          candidate.extractionRuleVersion > currentRuleVersion) ||
        current.document_version_id === documentVersionId;
    }
  }

  if (!mayAdvance) {
    return {
      advanced: false,
      revision: current?.revision ?? 0,
    };
  }
  if (current?.document_version_id === documentVersionId) {
    return { advanced: false, revision: current.revision ?? 1 };
  }

  const revision = (current?.revision ?? 0) + 1;
  await connection.run(
    'INSERT INTO document_current_versions (document_id, document_version_id, revision, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (document_id) DO UPDATE SET document_version_id = excluded.document_version_id, revision = excluded.revision, updated_at = excluded.updated_at',
    [documentId, documentVersionId, revision, candidate.processedAt],
  );
  return { advanced: true, revision };
}

async function preferredProcessingDefinition(
  connection: DuckDbConnection,
  filename: string,
): Promise<
  | { readonly processorId: string; readonly extractionRuleId: string }
  | undefined
> {
  const normalizedFilename = filename.toLocaleLowerCase('en-US');
  const rows = await connection.runAndReadAll(
    "SELECT processor_id, extraction_rule_id FROM accepted_processing_definitions WHERE (filename_match_kind = 'exact' AND filename_match = $1) OR (filename_match_kind = 'suffix' AND ends_with($1, filename_match)) LIMIT 2",
    [normalizedFilename],
  );
  const definitions = rows.getRowObjectsJson().map((row) =>
    z
      .object({
        processor_id: z.string(),
        extraction_rule_id: z.string(),
      })
      .parse(row),
  );
  if (definitions.length !== 1) {
    return undefined;
  }
  const [definition] = definitions;
  if (definition === undefined) {
    return undefined;
  }
  return {
    processorId: definition.processor_id,
    extractionRuleId: definition.extraction_rule_id,
  };
}

async function getDocumentVersion(
  connection: DuckDbConnection,
  versionId: string,
): Promise<DocumentVersion> {
  const rows = await connection.runAndReadAll(
    "SELECT id, document_id, content_hash, strftime(processed_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS processed_at, processor_id, processor_version, extraction_rule_id, extraction_rule_version, evidence_count FROM document_versions WHERE id = $1",
    [versionId],
  );
  const row = rows.getRowObjectsJson()[0];
  if (row === undefined) {
    throw new Error(`Document version ${versionId} was not found`);
  }
  const parsed = documentVersionRowSchema.parse(row);
  return {
    id: parseDocumentVersionId(parsed.id),
    documentId: parseDocumentId(parsed.document_id),
    contentHash: parsed.content_hash,
    hashAlgorithm: 'sha256',
    discoveredAt: parsed.processed_at,
    processorId: parsed.processor_id,
    processorVersion: parsed.processor_version,
    extractionRuleId: parsed.extraction_rule_id,
    extractionRuleVersion: parsed.extraction_rule_version,
    evidenceCount: parsed.evidence_count,
  };
}

async function listEvidenceForVersion(
  connection: DuckDbConnection,
  versionId: string,
): Promise<Evidence[]> {
  const rows = await connection.runAndReadAll(
    'SELECT id, document_version_id, evidence_key, evidence_kind, excerpt, truncated, CAST(locator_json AS VARCHAR) AS locator_json FROM extracted_evidence WHERE document_version_id = $1 ORDER BY evidence_key',
    [versionId],
  );
  return rows.getRowObjectsJson().map(parseEvidenceRow);
}

function parseEvidenceRow(row: unknown): Evidence {
  const parsed = evidenceRowSchema.parse(row);
  const locator = normalizeEvidenceLocator(
    evidenceLocatorSchema.parse(JSON.parse(parsed.locator_json) as unknown),
  );
  return {
    id: parseEvidenceId(parsed.id),
    documentVersionId: parseDocumentVersionId(parsed.document_version_id),
    key: parsed.evidence_key,
    kind: parsed.evidence_kind,
    excerpt: parsed.excerpt,
    truncated: parsed.truncated,
    locator,
  };
}

function normalizeEvidenceLocator(
  locator: z.infer<typeof evidenceLocatorSchema>,
): EvidenceLocator {
  if (
    locator.kind === 'markdown-lines' ||
    locator.kind === 'text-lines' ||
    locator.kind === 'yaml-lines'
  ) {
    return locator.headingPath === undefined
      ? {
          kind: locator.kind,
          lineStart: locator.lineStart,
          lineEnd: locator.lineEnd,
        }
      : {
          kind: locator.kind,
          lineStart: locator.lineStart,
          lineEnd: locator.lineEnd,
          headingPath: locator.headingPath,
        };
  }
  if ('pointer' in locator) {
    return { kind: 'json-pointer', pointer: locator.pointer };
  }
  if ('symbolKind' in locator) {
    return {
      kind: 'scala-symbol',
      packageName: locator.packageName,
      symbolKind: locator.symbolKind,
      symbolName: locator.symbolName,
      ...(locator.enclosingSymbol === undefined
        ? {}
        : { enclosingSymbol: locator.enclosingSymbol }),
      ...(locator.signature === undefined
        ? {}
        : { signature: locator.signature }),
      ...(locator.extendsType === undefined
        ? {}
        : { extendsType: locator.extendsType }),
      lineStart: locator.lineStart,
      lineEnd: locator.lineEnd,
    };
  }
  if ('targetText' in locator) {
    return {
      kind: 'scala-call-site',
      packageName: locator.packageName,
      enclosingSymbol: locator.enclosingSymbol,
      targetText: locator.targetText,
      methodName: locator.methodName,
      ...(locator.receiver === undefined ? {} : { receiver: locator.receiver }),
      ...(locator.branchContext === undefined
        ? {}
        : { branchContext: locator.branchContext }),
      ...(locator.asyncGroup === undefined
        ? {}
        : { asyncGroup: locator.asyncGroup }),
      callIndex: locator.callIndex,
      lineStart: locator.lineStart,
      lineEnd: locator.lineEnd,
    };
  }
  if ('routeSet' in locator) {
    return {
      kind: 'play-route',
      routeSet: locator.routeSet,
      ...(locator.method === undefined ? {} : { method: locator.method }),
      ...(locator.declaredPath === undefined
        ? {}
        : { declaredPath: locator.declaredPath }),
      ...(locator.handlerExpression === undefined
        ? {}
        : { handlerExpression: locator.handlerExpression }),
      ...(locator.mountPrefix === undefined
        ? {}
        : { mountPrefix: locator.mountPrefix }),
      ...(locator.includeTarget === undefined
        ? {}
        : { includeTarget: locator.includeTarget }),
      lineStart: locator.lineStart,
      lineEnd: locator.lineEnd,
    };
  }
  if ('valueKind' in locator) {
    return {
      kind: 'hocon-key',
      key: locator.key,
      valueKind: locator.valueKind,
      ...(locator.literalValue === undefined
        ? {}
        : { literalValue: locator.literalValue }),
      ...(locator.substitutions === undefined
        ? {}
        : { substitutions: locator.substitutions }),
      lineStart: locator.lineStart,
      lineEnd: locator.lineEnd,
    };
  }
  throw new Error('Unsupported evidence locator');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort(compareOrdinal)
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseWorkspaceRow(row: unknown): Workspace {
  const parsedRow = workspaceRowSchema.parse(row);
  const config = workspaceConfigurationSchema.parse(
    JSON.parse(parsedRow.config_json),
  );
  return {
    id: parseWorkspaceId(parsedRow.id),
    name: parsedRow.name,
    ...(parsedRow.description === null
      ? {}
      : { description: parsedRow.description }),
    sourceIds: config.sourceIds.map(parseSourceId),
    createdAt: parsedRow.created_at,
  };
}

function getInventoryChange(
  previous: z.infer<typeof inventoryRowSchema> | undefined,
  fingerprint: string,
): 'added' | 'modified' | 'unchanged' {
  if (previous === undefined || !previous.is_present) {
    return 'added';
  }
  return previous.fingerprint === fingerprint ? 'unchanged' : 'modified';
}

function normalizeTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error('DuckDB returned an invalid inventory timestamp');
  }
  return date.toISOString();
}

async function completeScanAndQueueEvent(
  connection: DuckDbConnection,
  sourceId: string,
  correlationId: string,
  discoveredAt: string,
  metrics: SourceScanMetrics,
): Promise<void> {
  const completedAt = new Date().toISOString();
  await connection.run(
    "INSERT INTO source_scan_runs (correlation_id, source_id, status, started_at) VALUES ($1, $2, 'started', $3) ON CONFLICT (correlation_id) DO NOTHING",
    [correlationId, sourceId, discoveredAt],
  );
  await connection.run(
    "UPDATE source_scan_runs SET status = 'completed', completed_at = $3, duration_milliseconds = $4, repository_count = $5, document_count = $6, added_count = $7, modified_count = $8, removed_count = $9, unchanged_count = $10, failure_type = NULL WHERE source_id = $1 AND correlation_id = $2 AND status != 'completed'",
    [
      sourceId,
      correlationId,
      completedAt,
      metrics.durationMilliseconds,
      metrics.repositoryCount,
      metrics.documentCount,
      metrics.addedCount,
      metrics.modifiedCount,
      metrics.removedCount,
      metrics.unchangedCount,
    ],
  );
  await assertScanRunStatus(connection, sourceId, correlationId, 'completed');
  await insertOutboxEvent(
    connection,
    createCatalogueEvent(
      'SourceScanCompleted',
      {
        sourceId,
        discoveredAt,
        ...metrics,
      },
      sourceId,
      correlationId,
      `source-scan-completed:${sourceId}:${correlationId}`,
      completedAt,
    ),
  );
}

async function assertScanRunStatus(
  connection: DuckDbConnection,
  sourceId: string,
  correlationId: string,
  expectedStatus: 'completed' | 'failed',
): Promise<void> {
  const result = await connection.runAndReadAll(
    'SELECT status FROM source_scan_runs WHERE source_id = $1 AND correlation_id = $2',
    [sourceId, correlationId],
  );
  const status = result.getRowObjectsJson()[0]?.status;
  if (status !== expectedStatus) {
    throw new Error(
      `Source scan run ${correlationId} could not be recorded as ${expectedStatus}`,
    );
  }
}

function repositoryEventType(change: 'added' | 'modified'): string {
  return change === 'added' ? 'RepositoryDiscovered' : 'RepositoryModified';
}

function documentEventType(change: 'added' | 'modified'): string {
  return change === 'added' ? 'DocumentDiscovered' : 'DocumentModified';
}

async function prepareInventoryCommit(
  connection: DuckDbConnection,
  sourceId: string,
  discoveredAt: string,
  inventoryCommit: {
    readonly scanId: string;
    readonly inventoryChecksum: string;
    readonly legacy?: boolean;
  },
): Promise<'duplicate' | 'superseded' | undefined> {
  const existingResult = await connection.runAndReadAll(
    'SELECT inventory_checksum, status FROM source_inventory_commits WHERE source_id = $1 AND scan_id = $2',
    [sourceId, inventoryCommit.scanId],
  );
  const existingRaw = existingResult.getRowObjectsJson()[0];
  if (existingRaw !== undefined) {
    const existing = z
      .object({
        inventory_checksum: z.string(),
        status: z.enum(['committed', 'superseded']),
      })
      .parse(existingRaw);
    if (existing.inventory_checksum !== inventoryCommit.inventoryChecksum) {
      throw new CatalogueIntegrityError(
        `Inventory scan ${inventoryCommit.scanId} was already recorded with different content`,
      );
    }
    await connection.run(
      'UPDATE source_inventory_assemblies SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE source_id = $1 AND scan_id = $2',
      [sourceId, inventoryCommit.scanId, existing.status],
    );
    await connection.run(
      'UPDATE source_inventory_chunks SET repositories_json = NULL, documents_json = NULL WHERE source_id = $1 AND scan_id = $2',
      [sourceId, inventoryCommit.scanId],
    );
    return existing.status === 'committed' ? 'duplicate' : 'superseded';
  }

  if (!inventoryCommit.legacy) {
    const assembly = await readInventoryAssemblyRow(
      connection,
      sourceId,
      inventoryCommit.scanId,
    );
    if (
      assembly === undefined ||
      assembly.status !== 'assembling' ||
      assembly.inventory_checksum !== inventoryCommit.inventoryChecksum
    ) {
      throw new CatalogueIntegrityError(
        `Inventory scan ${inventoryCommit.scanId} is not a validated staged assembly`,
      );
    }
  }

  const latestResult = await connection.runAndReadAll(
    "SELECT scan_id, strftime(discovered_at, '%Y-%m-%dT%H:%M:%S.%fZ') AS discovered_at FROM source_inventory_commits WHERE source_id = $1 AND status = 'committed' ORDER BY discovered_at DESC, scan_id DESC LIMIT 1",
    [sourceId],
  );
  const latestRaw = latestResult.getRowObjectsJson()[0];
  if (latestRaw !== undefined) {
    const latest = z
      .object({ scan_id: z.string(), discovered_at: z.string() })
      .parse(latestRaw);
    const candidateTime = Date.parse(discoveredAt);
    const latestTime = Date.parse(latest.discovered_at);
    if (
      candidateTime < latestTime ||
      (candidateTime === latestTime &&
        inventoryCommit.scanId.localeCompare(latest.scan_id) <= 0)
    ) {
      await connection.run(
        "INSERT INTO source_inventory_commits (source_id, scan_id, discovered_at, inventory_checksum, status) VALUES ($1, $2, $3, $4, 'superseded')",
        [
          sourceId,
          inventoryCommit.scanId,
          discoveredAt,
          inventoryCommit.inventoryChecksum,
        ],
      );
      await connection.run(
        "UPDATE source_inventory_assemblies SET status = 'superseded', updated_at = CURRENT_TIMESTAMP WHERE source_id = $1 AND scan_id = $2",
        [sourceId, inventoryCommit.scanId],
      );
      await connection.run(
        'UPDATE source_inventory_chunks SET repositories_json = NULL, documents_json = NULL WHERE source_id = $1 AND scan_id = $2',
        [sourceId, inventoryCommit.scanId],
      );
      return 'superseded';
    }
  }
  return undefined;
}

async function recordInventoryCommit(
  connection: DuckDbConnection,
  sourceId: string,
  discoveredAt: string,
  inventoryCommit: {
    readonly scanId: string;
    readonly inventoryChecksum: string;
  },
): Promise<void> {
  await connection.run(
    "INSERT INTO source_inventory_commits (source_id, scan_id, discovered_at, inventory_checksum, status) VALUES ($1, $2, $3, $4, 'committed')",
    [
      sourceId,
      inventoryCommit.scanId,
      discoveredAt,
      inventoryCommit.inventoryChecksum,
    ],
  );
  await connection.run(
    "UPDATE source_inventory_assemblies SET status = 'committed', updated_at = CURRENT_TIMESTAMP WHERE source_id = $1 AND scan_id = $2",
    [sourceId, inventoryCommit.scanId],
  );
  await connection.run(
    'UPDATE source_inventory_chunks SET repositories_json = NULL, documents_json = NULL WHERE source_id = $1 AND scan_id = $2',
    [sourceId, inventoryCommit.scanId],
  );
}

async function stageInventoryStarted(
  connection: DuckDbConnection,
  payload: Extract<
    DiscoveryEvent,
    { readonly eventType: 'SourceInventoryStarted' }
  >['payload'],
): Promise<'staged' | 'duplicate'> {
  await connection.run('BEGIN TRANSACTION');
  try {
    await ensureInventoryAssembly(connection, payload.sourceId, payload.scanId);
    const assembly = await readInventoryAssemblyRow(
      connection,
      payload.sourceId,
      payload.scanId,
    );
    if (assembly === undefined) {
      throw new Error('Inventory assembly was not created');
    }
    if (assembly.status === 'expired') {
      throw new CatalogueIntegrityError(
        `Inventory scan ${payload.scanId} has expired`,
      );
    }
    assertNullableMatch(assembly.started_at, payload.startedAt, 'startedAt');
    assertNullableMatch(
      assembly.discovered_at,
      payload.discoveredAt,
      'discoveredAt',
    );
    assertNullableMatch(
      assembly.expected_repository_count,
      payload.expectedRepositoryCount,
      'expectedRepositoryCount',
    );
    assertNullableMatch(
      assembly.expected_document_count,
      payload.expectedDocumentCount,
      'expectedDocumentCount',
    );
    assertNullableMatch(
      assembly.repository_count,
      payload.expectedRepositoryCount,
      'repositoryCount',
    );
    assertNullableMatch(
      assembly.document_count,
      payload.expectedDocumentCount,
      'documentCount',
    );
    const duplicate = assembly.started_at !== null;
    await connection.run(
      'UPDATE source_inventory_assemblies SET started_at = COALESCE(started_at, $3), discovered_at = COALESCE(discovered_at, $4), expected_repository_count = COALESCE(expected_repository_count, $5), expected_document_count = COALESCE(expected_document_count, $6), updated_at = CURRENT_TIMESTAMP WHERE source_id = $1 AND scan_id = $2',
      [
        payload.sourceId,
        payload.scanId,
        payload.startedAt,
        payload.discoveredAt,
        payload.expectedRepositoryCount,
        payload.expectedDocumentCount,
      ],
    );
    await connection.run('COMMIT');
    return duplicate ? 'duplicate' : 'staged';
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
}

async function stageInventoryChunk(
  connection: DuckDbConnection,
  payload: Extract<
    DiscoveryEvent,
    { readonly eventType: 'SourceInventoryChunk' }
  >['payload'],
): Promise<'staged' | 'duplicate'> {
  await connection.run('BEGIN TRANSACTION');
  try {
    await ensureInventoryAssembly(connection, payload.sourceId, payload.scanId);
    const assembly = await readInventoryAssemblyRow(
      connection,
      payload.sourceId,
      payload.scanId,
    );
    if (assembly === undefined) {
      throw new Error('Inventory assembly was not created');
    }
    if (assembly.status === 'expired') {
      throw new CatalogueIntegrityError(
        `Inventory scan ${payload.scanId} has expired`,
      );
    }
    if (
      assembly.expected_chunk_count !== null &&
      payload.chunkIndex >= assembly.expected_chunk_count
    ) {
      throw new CatalogueIntegrityError(
        `Inventory chunk index ${payload.chunkIndex} is outside the declared range`,
      );
    }
    const existingResult = await connection.runAndReadAll(
      'SELECT repository_count, document_count, checksum FROM source_inventory_chunks WHERE source_id = $1 AND scan_id = $2 AND chunk_index = $3',
      [payload.sourceId, payload.scanId, payload.chunkIndex],
    );
    const existing = existingResult.getRowObjectsJson()[0];
    if (existing !== undefined) {
      const parsed = z
        .object({
          repository_count: z.coerce.number(),
          document_count: z.coerce.number(),
          checksum: z.string(),
        })
        .parse(existing);
      if (
        parsed.checksum !== payload.checksum ||
        parsed.repository_count !== payload.repositoryCount ||
        parsed.document_count !== payload.documentCount
      ) {
        throw new CatalogueIntegrityError(
          `Conflicting inventory chunk ${payload.chunkIndex} for scan ${payload.scanId}`,
        );
      }
      await connection.run('COMMIT');
      return 'duplicate';
    }
    if (assembly.status !== 'assembling') {
      throw new CatalogueIntegrityError(
        `Cannot add a chunk to ${assembly.status} scan ${payload.scanId}`,
      );
    }
    await connection.run(
      'INSERT INTO source_inventory_chunks (source_id, scan_id, chunk_index, repository_count, document_count, checksum, repositories_json, documents_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        payload.sourceId,
        payload.scanId,
        payload.chunkIndex,
        payload.repositoryCount,
        payload.documentCount,
        payload.checksum,
        JSON.stringify(payload.repositories),
        JSON.stringify(payload.documents),
        payload.createdAt,
      ],
    );
    await connection.run(
      'UPDATE source_inventory_assemblies SET updated_at = CURRENT_TIMESTAMP WHERE source_id = $1 AND scan_id = $2',
      [payload.sourceId, payload.scanId],
    );
    await connection.run('COMMIT');
    return 'staged';
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
}

async function stageInventoryCompleted(
  connection: DuckDbConnection,
  payload: Extract<
    DiscoveryEvent,
    { readonly eventType: 'SourceInventoryCompleted' }
  >['payload'],
): Promise<'staged' | 'duplicate'> {
  await connection.run('BEGIN TRANSACTION');
  try {
    await ensureInventoryAssembly(connection, payload.sourceId, payload.scanId);
    const assembly = await readInventoryAssemblyRow(
      connection,
      payload.sourceId,
      payload.scanId,
    );
    if (assembly === undefined) {
      throw new Error('Inventory assembly was not created');
    }
    if (assembly.status === 'expired') {
      throw new CatalogueIntegrityError(
        `Inventory scan ${payload.scanId} has expired`,
      );
    }
    assertNullableMatch(
      assembly.expected_chunk_count,
      payload.expectedChunkCount,
      'expectedChunkCount',
    );
    assertNullableMatch(
      assembly.repository_count,
      payload.repositoryCount,
      'repositoryCount',
    );
    assertNullableMatch(
      assembly.document_count,
      payload.documentCount,
      'documentCount',
    );
    assertNullableMatch(
      assembly.inventory_checksum,
      payload.inventoryChecksum,
      'inventoryChecksum',
    );
    const unexpectedResult = await connection.runAndReadAll(
      'SELECT chunk_index FROM source_inventory_chunks WHERE source_id = $1 AND scan_id = $2 AND chunk_index >= $3 LIMIT 1',
      [payload.sourceId, payload.scanId, payload.expectedChunkCount],
    );
    if (unexpectedResult.getRowObjectsJson().length > 0) {
      throw new CatalogueIntegrityError(
        `Inventory scan ${payload.scanId} contains an unexpected chunk index`,
      );
    }
    const duplicate = assembly.inventory_checksum !== null;
    await connection.run(
      'UPDATE source_inventory_assemblies SET expected_chunk_count = COALESCE(expected_chunk_count, $3), repository_count = COALESCE(repository_count, $4), document_count = COALESCE(document_count, $5), inventory_checksum = COALESCE(inventory_checksum, $6), completed_at = COALESCE(completed_at, $7), duration_milliseconds = COALESCE(duration_milliseconds, $8), updated_at = CURRENT_TIMESTAMP WHERE source_id = $1 AND scan_id = $2',
      [
        payload.sourceId,
        payload.scanId,
        payload.expectedChunkCount,
        payload.repositoryCount,
        payload.documentCount,
        payload.inventoryChecksum,
        payload.completedAt,
        payload.durationMilliseconds,
      ],
    );
    await connection.run('COMMIT');
    return duplicate ? 'duplicate' : 'staged';
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
}

async function ensureInventoryAssembly(
  connection: DuckDbConnection,
  sourceId: string,
  scanId: string,
): Promise<void> {
  await connection.run(
    'INSERT INTO source_inventory_assemblies (source_id, scan_id) VALUES ($1, $2) ON CONFLICT (source_id, scan_id) DO NOTHING',
    [sourceId, scanId],
  );
}

async function readInventoryAssemblyRow(
  connection: DuckDbConnection,
  sourceId: string,
  scanId: string,
): Promise<z.infer<typeof inventoryAssemblyRowSchema> | undefined> {
  const rows = await connection.runAndReadAll(
    'SELECT source_id, scan_id, started_at, discovered_at, expected_repository_count, expected_document_count, expected_chunk_count, repository_count, document_count, inventory_checksum, completed_at, duration_milliseconds, status FROM source_inventory_assemblies WHERE source_id = $1 AND scan_id = $2',
    [sourceId, scanId],
  );
  const row = rows.getRowObjectsJson()[0];
  return row === undefined ? undefined : inventoryAssemblyRowSchema.parse(row);
}

function assertNullableMatch<Value extends string | number>(
  existing: Value | null,
  incoming: Value,
  field: string,
): void {
  if (existing !== null && existing !== incoming) {
    throw new CatalogueIntegrityError(
      `Conflicting inventory scan metadata for ${field}`,
    );
  }
}

async function upsertInventoryRecord(
  connection: DuckDbConnection,
  id: string,
  sourceId: string,
  path: string,
  assetType: 'repository' | 'document',
  fingerprint: string,
  discoveredAt: string,
  lastSeenAt: string,
): Promise<void> {
  await connection.run(
    'INSERT INTO inventory_records (id, source_id, path, asset_type, fingerprint, discovered_at, last_seen_at, is_present) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE) ON CONFLICT (source_id, path, asset_type) DO UPDATE SET fingerprint = excluded.fingerprint, last_seen_at = excluded.last_seen_at, is_present = TRUE',
    [id, sourceId, path, assetType, fingerprint, discoveredAt, lastSeenAt],
  );
}

async function insertDiscoveryHistory(
  connection: DuckDbConnection,
  rawEventType: string,
  record: Repository | Document | InventoryRecord,
  correlationId: string,
  occurredAt: string,
): Promise<DiscoveryEvent> {
  const event = createInventoryHistoryEvent(
    rawEventType,
    record,
    correlationId,
    occurredAt,
  );
  await connection.run(
    'INSERT INTO discovery_history (id, source_id, event_type, subject_id, path, fingerprint, occurred_at, correlation_id, payload_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [
      event.eventId,
      record.sourceId,
      event.eventType,
      record.id,
      record.path,
      record.fingerprint,
      occurredAt,
      correlationId,
      JSON.stringify(record),
    ],
  );
  await insertOutboxEvent(connection, event);
  return event;
}

function createInventoryHistoryEvent(
  rawEventType: string,
  record: Repository | Document | InventoryRecord,
  correlationId: string,
  occurredAt: string,
): DiscoveryEvent {
  const eventType = parseCatalogueEventType(rawEventType);
  const removed = eventType.endsWith('Removed');
  const payload = removed
    ? { inventoryRecord: record }
    : eventType.startsWith('Repository')
      ? { repository: record }
      : { document: record };
  const idempotencyKey = `catalogue:${eventType}:${record.sourceId}:${record.id}:${correlationId}`;
  return createCatalogueEvent(
    eventType,
    payload,
    record.sourceId,
    correlationId,
    idempotencyKey,
    occurredAt,
  );
}

async function insertBatchedRows(
  connection: DuckDbConnection,
  insert: string,
  rows: readonly (readonly (string | number | boolean)[])[],
  conflict = '',
): Promise<void> {
  // Bound statement size while keeping the complete scan in one transaction.
  for (let offset = 0; offset < rows.length; offset += 128) {
    const batch = rows.slice(offset, offset + 128);
    let parameter = 0;
    const values = batch
      .map((row) => `(${row.map(() => `$${++parameter}`).join(', ')})`)
      .join(', ');
    await connection.run(
      `${insert} VALUES ${values} ${conflict}`,
      batch.flat(),
    );
  }
}

type CatalogueEventType = Extract<
  DiscoveryEvent['eventType'],
  | 'SourceScanCompleted'
  | 'RepositoryDiscovered'
  | 'RepositoryModified'
  | 'RepositoryRemoved'
  | 'DocumentDiscovered'
  | 'DocumentModified'
  | 'DocumentRemoved'
  | 'DocumentExtracted'
  | 'KnowledgeEntityDiscovered'
  | 'KnowledgeEntitySuperseded'
  | 'KnowledgeRelationshipDiscovered'
  | 'KnowledgeRelationshipSuperseded'
  | 'KnowledgeModelPublished'
>;

function parseCatalogueEventType(value: string): CatalogueEventType {
  const eventTypes: readonly CatalogueEventType[] = [
    'SourceScanCompleted',
    'RepositoryDiscovered',
    'RepositoryModified',
    'RepositoryRemoved',
    'DocumentDiscovered',
    'DocumentModified',
    'DocumentRemoved',
    'DocumentExtracted',
    'KnowledgeEntityDiscovered',
    'KnowledgeEntitySuperseded',
    'KnowledgeRelationshipDiscovered',
    'KnowledgeRelationshipSuperseded',
    'KnowledgeModelPublished',
  ];
  if (!eventTypes.includes(value as CatalogueEventType)) {
    throw new Error(`Unsupported catalogue discovery event: ${value}`);
  }
  return value as CatalogueEventType;
}

function createCatalogueEvent(
  eventType: CatalogueEventType,
  payload: object,
  sourceId: string,
  correlationId: string,
  idempotencyKey: string,
  occurredAt: string,
): DiscoveryEvent {
  return {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    occurredAt,
    producer: 'workspace-brain-api',
    correlationId,
    idempotencyKey,
    partitionKey: sourceId,
    payload,
  } as DiscoveryEvent;
}

async function insertOutboxEvent(
  connection: DuckDbConnection,
  event: DiscoveryEvent,
): Promise<void> {
  await connection.run(
    'INSERT INTO discovery_outbox (event_id, idempotency_key, source_id, event_type, occurred_at, correlation_id, event_json) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (idempotency_key) DO NOTHING',
    [
      event.eventId,
      event.idempotencyKey,
      event.partitionKey,
      event.eventType,
      event.occurredAt,
      event.correlationId,
      JSON.stringify(event),
    ],
  );
}

function parseDiscoveryMethod(value: string): 'filesystem' {
  if (value !== 'filesystem') {
    throw new Error(`Unsupported discovery method: ${value}`);
  }
  return value;
}

async function queryPage(
  connection: DuckDbConnection,
  table: 'sources' | 'workspaces',
  request: CataloguePageRequest,
  select: string,
): Promise<Record<string, unknown>[]> {
  const filters: string[] = [];
  const parameters: (string | number)[] = [];
  if (request.afterId !== undefined) {
    parameters.push(request.afterId);
    filters.push(`id > $${parameters.length}`);
  }
  if (request.sourceId !== undefined && table === 'workspaces') {
    parameters.push(request.sourceId);
    filters.push(
      `list_contains(CAST(json_extract(config_json, '$.sourceIds') AS VARCHAR[]), $${parameters.length})`,
    );
  }
  return queryFilteredPage(
    connection,
    table,
    request.limit,
    select,
    filters,
    parameters,
  );
}

function buildFilters(
  request: CataloguePageRequest,
  allowExtension: boolean,
): { where: string[]; parameters: (string | number)[] } {
  const where: string[] = [];
  const parameters: (string | number)[] = [];
  if (request.afterId !== undefined) {
    parameters.push(request.afterId);
    where.push(`id > $${parameters.length}`);
  }
  if (request.sourceId !== undefined) {
    parameters.push(request.sourceId);
    where.push(`source_id = $${parameters.length}`);
  }
  if (allowExtension && request.extension !== undefined) {
    parameters.push(request.extension);
    where.push(`lower(extension) = lower($${parameters.length})`);
  }
  return { where, parameters };
}

async function queryFilteredPage(
  connection: DuckDbConnection,
  table: string,
  limit: number,
  select: string,
  filters: readonly string[],
  parameters: readonly (string | number)[],
): Promise<Record<string, unknown>[]> {
  const limitParameter = parameters.length + 1;
  const result = await connection.runAndReadAll(
    `${select}${filters.length === 0 ? '' : ` WHERE ${filters.join(' AND ')}`} ORDER BY id LIMIT $${limitParameter}`,
    [...parameters, limit],
  );
  return result.getRowObjectsJson().map((row) => {
    if (!row || typeof row !== 'object') {
      throw new Error(`DuckDB returned an invalid row for ${table}`);
    }
    return row;
  });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`DuckDB returned an invalid ${label}`);
  }
  return value;
}

async function listMigrationFiles(
  migrationsDirectory: string,
): Promise<string[]> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{3}-[a-z0-9-]+\.sql$/.test(file))
    .sort();
  if (files.length === 0) {
    throw new Error(
      `No valid DuckDB migrations found in ${migrationsDirectory}`,
    );
  }
  return files;
}

async function runMigrations(
  connection: DuckDbConnection,
  migrationsDirectory: string,
): Promise<void> {
  await connection.run(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
  for (const file of await listMigrationFiles(migrationsDirectory)) {
    const version = file.slice(0, -'.sql'.length);
    const applied = await connection.runAndReadAll(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [version],
    );
    if (applied.getRowObjects().length > 0) {
      continue;
    }

    const migrationSql = (
      await readFile(join(migrationsDirectory, file), 'utf8')
    ).trim();
    if (migrationSql.length === 0) {
      throw new Error(`DuckDB migration ${file} is empty`);
    }

    await connection.run('BEGIN TRANSACTION');
    try {
      await connection.run(migrationSql);
      await connection.run(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version],
      );
      await connection.run('COMMIT');
    } catch (error) {
      try {
        await connection.run('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError(
          [error],
          `Migration ${file} failed and rollback failed`,
          { cause: rollbackError },
        );
      }
      throw error;
    }
  }
}
