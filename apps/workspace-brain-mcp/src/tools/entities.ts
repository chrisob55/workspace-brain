import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { WorkspaceBrainClient } from '../client/workspace-brain-client.js';
import {
  CURRENT_STATE_WARNING,
  PUBLICATION_PINNED_NOTE,
  callApi,
  idSchema,
  pageShape,
  publicationIdSchema,
  readOnlyAnnotations,
} from './shared.js';
import { RELATIONSHIP_TYPES } from './search.js';

const entityIdSchema = idSchema('Knowledge Entity ID (ULID).');

export function registerEntityTools(
  server: McpServer,
  client: WorkspaceBrainClient,
): void {
  server.registerTool(
    'get_entity',
    {
      title: 'Get Current Knowledge Entity',
      description: `Retrieve the current catalogue state of a Knowledge Entity. ${CURRENT_STATE_WARNING}`,
      inputSchema: { entityId: entityIdSchema },
      annotations: readOnlyAnnotations,
    },
    ({ entityId }) => callApi(() => client.getEntity(entityId)),
  );

  server.registerTool(
    'get_published_entity',
    {
      title: 'Get Published Knowledge Entity',
      description: `${PUBLICATION_PINNED_NOTE} Retrieve a Knowledge Entity as published in a publication. Returns { publicationId, entityVersionId, versionNumber, entity }.`,
      inputSchema: {
        publicationId: publicationIdSchema,
        entityId: entityIdSchema,
      },
      annotations: readOnlyAnnotations,
    },
    ({ publicationId, entityId }) =>
      callApi(() => client.getPublishedEntity(publicationId, entityId)),
  );

  server.registerTool(
    'list_relationships_for_entity',
    {
      title: 'List Relationships for Entity',
      description:
        'PUBLICATION-PINNED: list the relationships connected to an entity within a publication. Use direction "incoming" to find what depends on / uses the entity, "outgoing" for what the entity depends on / uses. Returns { publicationId, items, nextCursor }.',
      inputSchema: {
        publicationId: publicationIdSchema,
        entityId: entityIdSchema,
        direction: z
          .enum(['incoming', 'outgoing', 'both'])
          .optional()
          .describe(
            'Relationship direction relative to the entity (API default: both).',
          ),
        relationshipType: z
          .enum(RELATIONSHIP_TYPES)
          .optional()
          .describe('Relationship type filter.'),
        ...pageShape,
      },
      annotations: readOnlyAnnotations,
    },
    (args) => callApi(() => client.listRelationshipsForEntity(args)),
  );

  server.registerTool(
    'get_entity_provenance',
    {
      title: 'Get Entity Provenance',
      description: `${PUBLICATION_PINNED_NOTE} Retrieve the evidence and provenance (source documents, paths, fingerprints, locators, processors and extraction rules) behind an entity in a publication. Items, including evidence explanations and locators, are returned exactly as the API provides them. Returns { items, nextCursor }.`,
      inputSchema: {
        publicationId: publicationIdSchema,
        entityId: entityIdSchema,
        ...pageShape,
      },
      annotations: readOnlyAnnotations,
    },
    (args) => callApi(() => client.getEntityProvenance(args)),
  );
}
