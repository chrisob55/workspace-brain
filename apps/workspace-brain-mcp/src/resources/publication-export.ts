import {
  ResourceTemplate,
  type McpServer,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  McpError,
  type ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { WorkspaceBrainClient } from '../client/workspace-brain-client.js';
import { errorEnvelope } from '../tools/shared.js';

export const EXPORT_MIME_TYPE = 'application/json';

const EXPORT_URI_PREFIX = 'workspace-brain://publications/';
const EXPORT_URI_SUFFIX = '/export';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function publicationExportUri(publicationId: string): string {
  return `${EXPORT_URI_PREFIX}${encodeURIComponent(publicationId)}${EXPORT_URI_SUFFIX}`;
}

/**
 * Serves a publication export package as an MCP resource so the multi-megabyte
 * package is fetched only when a client explicitly reads the resource, never as
 * tool text. The text is the exact JSON the API returned. Resources are not
 * enumerated; the URI comes from export_publication or
 * get_publication_export_metadata.
 */
export function registerPublicationExportResource(
  server: McpServer,
  client: WorkspaceBrainClient,
): void {
  server.registerResource(
    'publication-export',
    new ResourceTemplate(
      `${EXPORT_URI_PREFIX}{publicationId}${EXPORT_URI_SUFFIX}`,
      { list: undefined },
    ),
    {
      title: 'Workspace Brain Publication Export',
      description:
        'Complete export package of one immutable Knowledge Publication (every entity, relationship and provenance record), exactly as returned by the Workspace Brain API. Often several megabytes.',
      mimeType: EXPORT_MIME_TYPE,
    },
    async (uri, variables): Promise<ReadResourceResult> => {
      const publicationId = variables.publicationId;
      if (
        typeof publicationId !== 'string' ||
        !ID_PATTERN.test(publicationId)
      ) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Invalid publication ID in resource URI.',
        );
      }
      const response = await client.exportPublicationText(publicationId);
      if (!response.ok) {
        const envelope = errorEnvelope(response);
        throw new McpError(
          response.kind === 'http' && response.status === 404
            ? ErrorCode.InvalidParams
            : ErrorCode.InternalError,
          JSON.stringify(envelope),
          envelope,
        );
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: EXPORT_MIME_TYPE,
            text: response.text,
          },
        ],
      };
    },
  );
}
