import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const openApiPath = resolve(process.cwd(), 'openapi/openapi.json');

describe('OpenAPI contract', () => {
  it('declares the Slice 0 health and read-only catalogue routes', async () => {
    const document = JSON.parse(await readFile(openApiPath, 'utf8')) as {
      openapi: string;
      paths: Record<
        string,
        {
          get?: {
            operationId?: string;
            parameters?: { name: string }[];
            responses?: Record<
              string,
              {
                content?: Record<string, { schema?: { $ref?: string } }>;
              }
            >;
          };
        }
      >;
      components: {
        schemas: Record<
          string,
          {
            required?: string[];
            properties?: Record<string, unknown>;
          }
        >;
      };
    };

    expect(document.openapi).toBe('3.1.0');
    expect(document.paths['/health']?.get?.operationId).toBe('getHealth');
    expect(document.paths['/ready']?.get?.operationId).toBe('getReadiness');
    expect(document.paths['/api/v1/sources']?.get?.operationId).toBe(
      'listSources',
    );
    expect(document.paths['/api/v1/workspaces']?.get?.operationId).toBe(
      'listWorkspaces',
    );
    expect(document.paths['/api/v1/repositories']?.get?.operationId).toBe(
      'listRepositories',
    );
    expect(document.paths['/api/v1/documents']?.get?.operationId).toBe(
      'listDocuments',
    );
    expect(
      document.paths['/api/v1/documents/{documentId}/evidence']?.get
        ?.operationId,
    ).toBe('listDocumentEvidence');
    expect(
      document.paths['/api/v1/evidence/{evidenceId}/explanation']?.get
        ?.operationId,
    ).toBe('getEvidenceExplanation');
    const knowledgeOperations = [
      ['/api/v1/knowledge/models', 'listKnowledgeModels'],
      ['/api/v1/knowledge/models/{modelId}', 'getKnowledgeModel'],
      ['/api/v1/knowledge/entities', 'listKnowledgeEntities'],
      ['/api/v1/knowledge/entities/{entityId}', 'getKnowledgeEntity'],
      ['/api/v1/knowledge/relationships', 'listKnowledgeRelationships'],
      [
        '/api/v1/knowledge/relationships/{relationshipId}',
        'getKnowledgeRelationship',
      ],
      ['/api/v1/knowledge/publications', 'listKnowledgePublications'],
    ] as const;
    for (const [path, operationId] of knowledgeOperations) {
      expect(document.paths[path]?.get?.operationId).toBe(operationId);
      expect(Object.keys(document.paths[path] ?? {})).toEqual(['get']);
    }
    expect(
      document.paths['/api/v1/sources']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema?.$ref,
    ).toBe('#/components/schemas/SourcePage');
    expect(
      document.paths['/api/v1/workspaces']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema?.$ref,
    ).toBe('#/components/schemas/WorkspacePage');
    expect(document.components.schemas.Source).toBeDefined();
    expect(document.components.schemas.SourceRoot).toBeDefined();
    expect(document.components.schemas.Workspace).toBeDefined();
    expect(document.components.schemas.Repository).toBeDefined();
    expect(document.components.schemas.Document).toBeDefined();
    expect(document.components.schemas.Evidence).toBeDefined();
    expect(document.components.schemas.EvidenceLocator).toBeDefined();
    expect(document.components.schemas.EvidenceExplanation).toBeDefined();
    expect(document.components.schemas.KnowledgeModel).toBeDefined();
    expect(document.components.schemas.KnowledgeEntity).toBeDefined();
    expect(document.components.schemas.KnowledgeRelationship).toBeDefined();
    expect(document.components.schemas.KnowledgePublication).toBeDefined();
    expect(document.components.schemas.KnowledgeEntity?.required).toContain(
      'provenance',
    );
    expect(
      document.components.schemas.KnowledgeRelationship?.required,
    ).toContain('sourceEvidenceIds');
    expect(
      document.components.schemas.KnowledgeRelationship?.required,
    ).toContain('confidence');
    const relationshipType = document.components.schemas.KnowledgeRelationship
      ?.properties?.type as { enum?: string[] } | undefined;
    expect(relationshipType?.enum).toEqual([
      'CONTAINS',
      'BELONGS_TO',
      'REFERENCES',
      'DOCUMENTS',
      'DEPENDS_ON',
      'USES',
      'IMPLEMENTS',
      'EXPOSES',
      'CONSUMES',
      'CLASSIFIED_AS',
      'DERIVED_FROM',
    ]);
    expect(
      document.paths['/api/v1/documents/{documentId}/evidence']?.get
        ?.responses?.['200']?.content?.['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/EvidencePage');
    expect(
      document.paths['/api/v1/evidence/{evidenceId}/explanation']?.get
        ?.responses?.['404']?.content?.['application/problem+json']?.schema
        ?.$ref,
    ).toBe('#/components/schemas/ProblemDetails');
    expect(document.components.schemas.Repository?.required).toContain(
      'fingerprint',
    );
    expect(document.components.schemas.Repository?.required).toContain(
      'lastSeenAt',
    );
    expect(document.components.schemas.Document?.required).toContain(
      'fingerprint',
    );
    expect(document.components.schemas.Document?.required).toContain(
      'lastSeenAt',
    );
    expect(Object.keys(document.paths['/api/v1/sources'] ?? {})).toEqual([
      'get',
    ]);
    expect(Object.keys(document.paths['/api/v1/workspaces'] ?? {})).toEqual([
      'get',
    ]);
    expect(Object.keys(document.paths['/api/v1/repositories'] ?? {})).toEqual([
      'get',
    ]);
    expect(Object.keys(document.paths['/api/v1/documents'] ?? {})).toEqual([
      'get',
    ]);
    expect(
      Object.keys(
        document.paths['/api/v1/documents/{documentId}/evidence'] ?? {},
      ),
    ).toEqual(['get']);
    expect(
      Object.keys(
        document.paths['/api/v1/evidence/{evidenceId}/explanation'] ?? {},
      ),
    ).toEqual(['get']);
    expect(
      document.paths['/api/v1/repositories']?.get?.parameters?.map(
        (parameter) => parameter.name,
      ),
    ).toContain('sourceId');
    expect(
      document.paths['/api/v1/documents']?.get?.parameters?.map(
        (parameter) => parameter.name,
      ),
    ).toContain('extension');
  });
});
