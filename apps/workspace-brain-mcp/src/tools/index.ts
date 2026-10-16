import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WorkspaceBrainClient } from '../client/workspace-brain-client.js';
import { registerEntityTools } from './entities.js';
import { registerJourneyTools } from './journeys.js';
import { registerPublicationTools } from './publications.js';
import { registerRelationshipTools } from './relationships.js';
import { registerSearchTools } from './search.js';

export function registerTools(
  server: McpServer,
  client: WorkspaceBrainClient,
): void {
  registerSearchTools(server, client);
  registerJourneyTools(server, client);
  registerEntityTools(server, client);
  registerRelationshipTools(server, client);
  registerPublicationTools(server, client);
}
