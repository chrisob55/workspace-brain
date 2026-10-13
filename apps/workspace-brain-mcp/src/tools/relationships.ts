import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

const relationshipIdSchema = idSchema('Knowledge Relationship ID (ULID).');

export function registerRelationshipTools(
  server: McpServer,
  client: WorkspaceBrainClient,
): void {
  server.registerTool(
    'get_relationship',
    {
      title: 'Get Current Knowledge Relationship',
      description: `Retrieve the current catalogue state of a Knowledge Relationship. ${CURRENT_STATE_WARNING}`,
      inputSchema: { relationshipId: relationshipIdSchema },
      annotations: readOnlyAnnotations,
    },
    ({ relationshipId }) =>
      callApi(() => client.getRelationship(relationshipId)),
  );

  server.registerTool(
    'get_published_relationship',
    {
      title: 'Get Published Knowledge Relationship',
      description: `${PUBLICATION_PINNED_NOTE} Retrieve a Knowledge Relationship as published in a publication. Returns { publicationId, relationshipVersionId, versionNumber, relationship }.`,
      inputSchema: {
        publicationId: publicationIdSchema,
        relationshipId: relationshipIdSchema,
      },
      annotations: readOnlyAnnotations,
    },
    ({ publicationId, relationshipId }) =>
      callApi(() =>
        client.getPublishedRelationship(publicationId, relationshipId),
      ),
  );

  server.registerTool(
    'get_relationship_provenance',
    {
      title: 'Get Relationship Provenance',
      description: `${PUBLICATION_PINNED_NOTE} Retrieve the evidence and provenance (source documents, paths, fingerprints, locators, processors and extraction rules) behind a relationship in a publication. Items, including evidence explanations and locators, are returned exactly as the API provides them. Returns { items, nextCursor }.`,
      inputSchema: {
        publicationId: publicationIdSchema,
        relationshipId: relationshipIdSchema,
        ...pageShape,
      },
      annotations: readOnlyAnnotations,
    },
    (args) => callApi(() => client.getRelationshipProvenance(args)),
  );
}
