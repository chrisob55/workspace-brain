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
            responses?: Record<
              string,
              {
                content?: Record<string, { schema?: { $ref?: string } }>;
              }
            >;
          };
        }
      >;
      components: { schemas: Record<string, unknown> };
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
    expect(document.components.schemas.Workspace).toBeDefined();
    expect(Object.keys(document.paths['/api/v1/sources'] ?? {})).toEqual([
      'get',
    ]);
    expect(Object.keys(document.paths['/api/v1/workspaces'] ?? {})).toEqual([
      'get',
    ]);
  });
});
