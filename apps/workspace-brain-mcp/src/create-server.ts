import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WorkspaceBrainClient } from './client/workspace-brain-client.js';
import { registerPublicationExportResource } from './resources/publication-export.js';
import { registerTools } from './tools/index.js';

export const SERVER_NAME = 'workspace-brain';
export const SERVER_VERSION = '0.1.0';

export const SERVER_INSTRUCTIONS = [
  'Read-only access to the Workspace Brain Knowledge Model, which is the source of truth. Answer from tool results only; cite publication, entity and relationship IDs and provenance. No tool writes, ingests or modifies data.',
  'Publications: get_latest_publication resolves the current latest publication of a Knowledge Model (knowledgeModelId is the modelId of any search result, or the knowledgeModelId of list_publications { limit: 1 }). list_publications lists publication history and maps a known version number to a publication ID; never page through it to find the latest. Retain the concrete publication ID and pass it as publicationId to every later search, traversal, provenance and export call.',
  'Reads: get_published_entity and get_published_relationship return the immutable version in a publication; use them for publication analysis. get_entity and get_relationship return mutable current catalogue state; use them only when current state is explicitly required. Do not mix current-state and publication-pinned reads in one workflow unless the user explicitly asks for a comparison.',
  'Search is deterministic, case-insensitive and ordered by ID, not relevance; it is not fuzzy or semantic. Hyphens and token boundaries matter: if a phrase returns nothing, retry the hyphenated form or individual significant terms.',
  'Cursors are opaque: pass nextCursor back unchanged with the same other arguments.',
  'Provenance: get_entity_provenance and get_relationship_provenance return source documents, locators, processors and extraction rules exactly as recorded.',
  'Exports: use get_publication_export_metadata for counts, hashes and size. export_publication returns only a resource link to the multi-megabyte package; never expect the package inline.',
].join('\n\n');

export function createWorkspaceBrainMcpServer(
  client: WorkspaceBrainClient,
): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  registerTools(server, client);
  registerPublicationExportResource(server, client);
  return server;
}
