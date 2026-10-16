import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WorkspaceBrainClient } from '../client/workspace-brain-client.js';
import {
  callApi,
  idSchema,
  pageShape,
  publicationIdSchema,
  readOnlyAnnotations,
} from './shared.js';

const searchText = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .describe(
    'Literal search text, matched case-insensitively according to `match` and `field`. Prefer single significant terms.',
  );

// Enumerations mirror openapi/openapi.json; tests assert they stay identical.
export const ENTITY_TYPES = [
  'package',
  'container',
  'api',
  'module',
  'journey',
  'repository',
  'architectural-decision',
  'document',
  'operation',
] as const;

export const RELATIONSHIP_TYPES = [
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
] as const;

export const LIFECYCLE_STATUSES = [
  'observed',
  'verified',
  'established',
  'rejected',
  'superseded',
] as const;

export const SEARCH_MATCHES = ['contains', 'prefix', 'exact'] as const;
export const ENTITY_SEARCH_FIELDS = ['name', 'text'] as const;
export const RELATIONSHIP_SEARCH_FIELDS = ['type', 'text'] as const;

const matchSchema = z
  .enum(SEARCH_MATCHES)
  .optional()
  .describe(
    'Comparison mode; when omitted the API uses "contains". With field "text", "contains" matches anywhere in the indexed text, while "prefix" and "exact" compare against individual indexed terms split on non-alphanumeric characters (so exact "subscription" matches "agent-subscription").',
  );

const searchBehaviour =
  'Matching is deterministic and case-insensitive. Results are ordered by ID. This MCP server provides no fuzzy, stemmed or semantic search. A phrase containing spaces will not necessarily match a hyphenated name ("agent subscription" does not match "agent-subscription"); after an empty phrase result, retry with the hyphenated form or with each significant term individually (e.g. "subscription" with match "exact" and field "text"). Pass the concrete publicationId bound to the conversation; without it the API searches the latest publication of each Knowledge Model, which can change between calls.';

export function registerSearchTools(
  server: McpServer,
  client: WorkspaceBrainClient,
): void {
  server.registerTool(
    'search_entities',
    {
      title: 'Search Knowledge Entities',
      description: `Search published Knowledge Entities by name (default) or indexed text. ${searchBehaviour} Returns { items, nextCursor } where each item includes entityId, publicationId, type, name, lifecycleStatus, sourceEvidenceIds and relationshipCount.`,
      inputSchema: {
        query: searchText,
        publicationId: publicationIdSchema.optional(),
        type: z.enum(ENTITY_TYPES).optional().describe('Entity type filter.'),
        lifecycleStatus: z
          .enum(LIFECYCLE_STATUSES)
          .optional()
          .describe('Lifecycle status filter.'),
        match: matchSchema,
        field: z
          .enum(ENTITY_SEARCH_FIELDS)
          .optional()
          .describe(
            'Field to search: "name" or "text" (the indexed search text for the entity); when omitted the API uses "name".',
          ),
        ...pageShape,
      },
      annotations: readOnlyAnnotations,
    },
    (args) => callApi(() => client.searchEntities(args)),
  );

  server.registerTool(
    'search_relationships',
    {
      title: 'Search Knowledge Relationships',
      description: `Search published Knowledge Relationships by type (default) or indexed text. ${searchBehaviour} Returns { items, nextCursor } where each item includes relationshipId, type, sourceEntityId, targetEntityId, lifecycleStatus and sourceEvidenceIds.`,
      inputSchema: {
        query: searchText,
        publicationId: publicationIdSchema.optional(),
        relationshipType: z
          .enum(RELATIONSHIP_TYPES)
          .optional()
          .describe('Relationship type filter (sent to the API as `type`).'),
        entityId: idSchema(
          'Only relationships where this entity is source or target.',
        ).optional(),
        match: matchSchema,
        field: z
          .enum(RELATIONSHIP_SEARCH_FIELDS)
          .optional()
          .describe(
            'Field to search: "type" or "text" (the indexed search text for the relationship); when omitted the API uses "type".',
          ),
        ...pageShape,
      },
      annotations: readOnlyAnnotations,
    },
    (args) => callApi(() => client.searchRelationships(args)),
  );
}
