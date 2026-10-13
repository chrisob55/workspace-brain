import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { WorkspaceBrainClient } from '../client/workspace-brain-client.js';
import {
  EXPORT_MIME_TYPE,
  publicationExportUri,
} from '../resources/publication-export.js';
import {
  callApi,
  guardInvalidRequest,
  idSchema,
  pageShape,
  publicationIdSchema,
  readOnlyAnnotations,
  toToolResult,
} from './shared.js';

export function registerPublicationTools(
  server: McpServer,
  client: WorkspaceBrainClient,
): void {
  server.registerTool(
    'list_publications',
    {
      title: 'List Knowledge Publications',
      description:
        'List Knowledge Publication history. Results are returned in publication-ID order. Listing can be slow on large catalogues: use small page sizes, pass nextCursor back unchanged, and never page through it to find the latest publication (use get_latest_publication). Each item includes id, knowledgeModelId, version (the publication number), schemaVersion, status, contentHash, publishedAt, entityCount and relationshipCount (version-ID membership arrays are omitted for brevity). Use this to map a known publication number (version) to a publicationId or to discover a knowledgeModelId. Returns { items, nextCursor }.',
      inputSchema: {
        knowledgeModelId: idSchema(
          'Only publications of this Knowledge Model.',
        ).optional(),
        ...pageShape,
      },
      annotations: readOnlyAnnotations,
    },
    (args) =>
      callApi(() => client.listPublications(args), compactPublicationPage),
  );

  server.registerTool(
    'get_latest_publication',
    {
      title: 'Get Latest Publication',
      description:
        'Retrieve the newest published Knowledge Publication of a Knowledge Model. This is how to resolve "latest": keep the returned concrete id and pass it as publicationId to every later search, get_published_entity, get_published_relationship, traversal, provenance and export call so the conversation stays bound to one immutable publication. Take knowledgeModelId from the modelId of any search result or from a list_publications item (list_publications { limit: 1 } suffices).',
      inputSchema: {
        knowledgeModelId: idSchema('Knowledge Model ID (ULID).'),
      },
      annotations: readOnlyAnnotations,
    },
    ({ knowledgeModelId }) =>
      callApi(() => client.getLatestPublication(knowledgeModelId)),
  );

  server.registerTool(
    'get_publication_summary',
    {
      title: 'Get Publication Summary',
      description:
        'Retrieve a Knowledge Publication with its entity and relationship counts.',
      inputSchema: { publicationId: publicationIdSchema },
      annotations: readOnlyAnnotations,
    },
    ({ publicationId }) =>
      callApi(() => client.getPublicationSummary(publicationId)),
  );

  server.registerTool(
    'get_publication_export_metadata',
    {
      title: 'Get Publication Export Metadata',
      description:
        'Retrieve bounded metadata about a publication export package without returning its content: publicationId, knowledgeModelId, publicationVersion, schemaVersion, createdAt, contentHash, entityCount, relationshipCount, provenanceCount, format, formatVersion, exportSizeBytes and the resourceUri of the full package. Entity, relationship and provenance arrays are never included. Fetches the export server-side, so it takes as long as an export.',
      inputSchema: { publicationId: publicationIdSchema },
      annotations: readOnlyAnnotations,
    },
    ({ publicationId }) =>
      guardInvalidRequest(async () => {
        const response = await client.exportPublicationText(publicationId);
        if (!response.ok) {
          return toToolResult(response);
        }
        const metadata = exportMetadata(publicationId, response.text);
        return {
          content: [
            { type: 'text', text: JSON.stringify(metadata) },
            exportResourceLink(publicationId),
          ],
        };
      }),
  );

  server.registerTool(
    'export_publication',
    {
      title: 'Export Publication',
      description:
        'Provide the complete export package of a publication as an MCP resource link (application/json) instead of inline text, because packages are often several megabytes and would overflow the model context. The package is transferred only if the MCP client reads the resource. For counts, hashes and size use get_publication_export_metadata.',
      inputSchema: { publicationId: publicationIdSchema },
      annotations: readOnlyAnnotations,
    },
    ({ publicationId }) =>
      guardInvalidRequest(async () => {
        const summary = await client.getPublicationSummary(publicationId);
        if (!summary.ok) {
          return toToolResult(summary);
        }
        const resourceUri = publicationExportUri(publicationId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                publicationId,
                contentIncluded: false,
                resourceUri,
                mimeType: EXPORT_MIME_TYPE,
                notice:
                  'The export package is not returned as tool text. Read resourceUri with an MCP client that supports resources to obtain the exact API export JSON.',
              }),
            },
            exportResourceLink(publicationId),
          ],
        };
      }),
  );

  server.registerTool(
    'get_publication_currency',
    {
      title: 'Get Publication Currency',
      description:
        'Report how current a publication is relative to the latest source document versions: counts of current, stale and unknown entities and relationships, plus a currencyBasisHash. A publication with any stale counts is stale. Use list_publication_currency_details for the individual objects.',
      inputSchema: { publicationId: publicationIdSchema },
      annotations: readOnlyAnnotations,
    },
    ({ publicationId }) =>
      callApi(() => client.getPublicationCurrency(publicationId)),
  );

  server.registerTool(
    'list_publication_currency_details',
    {
      title: 'List Publication Currency Details',
      description:
        'List the per-object currency records of a publication: which entities and relationships are CURRENT, STALE or UNKNOWN relative to the latest source document versions. Returns { publicationId, knowledgeModelId, currencyBasisHash, items, nextCursor }. Pass nextCursor back unchanged with the same filters; if the API reports "Currency Basis Changed" (409), restart from the first page.',
      inputSchema: {
        publicationId: publicationIdSchema,
        objectType: z
          .enum(['entity', 'relationship'])
          .optional()
          .describe('Only records for this knowledge object type.'),
        state: z
          .enum(['CURRENT', 'STALE', 'UNKNOWN'])
          .optional()
          .describe('Only records in this currency state.'),
        ...pageShape,
      },
      annotations: readOnlyAnnotations,
    },
    (args) => callApi(() => client.listPublicationCurrencyDetails(args)),
  );

  server.registerTool(
    'compare_publications',
    {
      title: 'Compare Publications',
      description:
        'Retrieve the Workspace Brain diff between two publications of the same Knowledge Model: added, removed and changed entities and relationships. publicationId is the "from" side, otherPublicationId the "to" side.',
      inputSchema: {
        publicationId: publicationIdSchema.describe(
          'Earlier ("from") Knowledge Publication ID.',
        ),
        otherPublicationId: publicationIdSchema.describe(
          'Later ("to") Knowledge Publication ID.',
        ),
      },
      annotations: readOnlyAnnotations,
    },
    ({ publicationId, otherPublicationId }) =>
      callApi(() =>
        client.comparePublications(publicationId, otherPublicationId),
      ),
  );
}

function exportResourceLink(publicationId: string): ContentBlock {
  return {
    type: 'resource_link',
    uri: publicationExportUri(publicationId),
    name: `publication-${publicationId}-export.json`,
    title: `Workspace Brain publication ${publicationId} export`,
    mimeType: EXPORT_MIME_TYPE,
  };
}

/**
 * Bounded facts about an export package. Only the API's own metadata block,
 * the package format markers and array lengths are kept; the arrays never are.
 */
export function exportMetadata(
  publicationId: string,
  text: string,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  const body = isRecord(parsed) ? parsed : {};
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  return {
    ...metadata,
    publicationId: metadata.publicationId ?? publicationId,
    format: body.format,
    formatVersion: body.formatVersion,
    provenanceCount: Array.isArray(body.provenance)
      ? body.provenance.length
      : undefined,
    exportSizeBytes: Buffer.byteLength(text, 'utf8'),
    resourceUri: publicationExportUri(publicationId),
    mimeType: EXPORT_MIME_TYPE,
  };
}

/**
 * Replaces a publication's version-ID membership arrays with their lengths.
 * Values that are not the expected shape are returned as-is.
 */
export function compactPublication(item: unknown): unknown {
  if (
    !isRecord(item) ||
    !Array.isArray(item.entityVersionIds) ||
    !Array.isArray(item.relationshipVersionIds)
  ) {
    return item;
  }
  const { entityVersionIds, relationshipVersionIds, ...rest } = item;
  return {
    ...rest,
    entityCount: entityVersionIds.length,
    relationshipCount: relationshipVersionIds.length,
  };
}

export function compactPublicationPage(body: unknown): unknown {
  if (!isRecord(body) || !Array.isArray(body.items)) {
    return body;
  }
  return { ...body, items: body.items.map(compactPublication) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
