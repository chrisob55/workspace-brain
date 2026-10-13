#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClientFromEnv } from './client/workspace-brain-client.js';
import { createWorkspaceBrainMcpServer } from './create-server.js';

// stdout carries the MCP protocol; diagnostics must go to stderr.
async function main(): Promise<void> {
  const client = createClientFromEnv();
  const server = createWorkspaceBrainMcpServer(client);
  await server.connect(new StdioServerTransport());
  console.error(
    `workspace-brain MCP server running on stdio (API: ${client.baseUrl})`,
  );

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('workspace-brain MCP server failed to start:', error);
  process.exit(1);
});
