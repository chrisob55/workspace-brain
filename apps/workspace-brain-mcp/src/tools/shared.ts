import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  InvalidPathSegmentError,
  type ApiResponse,
} from '../client/workspace-brain-client.js';

export const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// Identifiers are opaque to this server; Workspace Brain validates them.
export const idSchema = (description: string) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/, 'Identifier contains invalid characters.')
    .describe(description);

export const publicationIdSchema = idSchema(
  'Concrete Knowledge Publication ID (ULID), e.g. from get_latest_publication or a search result.',
);

export const pageShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum items to return (1-100, API default 50).'),
  cursor: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Opaque nextCursor from the previous page of the same request. Pass it back unchanged with the same other arguments; never construct or edit it.',
    ),
};

type ApiFailure = Extract<ApiResponse, { readonly ok: false }>;

export function errorEnvelope(response: ApiFailure): {
  error: { kind: string; status: number | null; body: unknown };
} {
  return {
    error: {
      kind: response.kind,
      status: response.status,
      body: response.body,
    },
  };
}

export function toToolResult(response: ApiResponse): CallToolResult {
  if (response.ok) {
    return { content: [{ type: 'text', text: JSON.stringify(response.body) }] };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(errorEnvelope(response)) }],
  };
}

export async function callApi(
  request: () => Promise<ApiResponse>,
  transform: (body: unknown) => unknown = (body) => body,
): Promise<CallToolResult> {
  return guardInvalidRequest(async () => {
    const response = await request();
    return toToolResult(
      response.ok ? { ...response, body: transform(response.body) } : response,
    );
  });
}

/** Converts a rejected path segment into a structured tool error. */
export async function guardInvalidRequest(
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InvalidPathSegmentError) {
      return toToolResult({
        ok: false,
        kind: 'invalid-request',
        status: null,
        body: { title: 'Invalid Request', detail: error.message },
      });
    }
    throw error;
  }
}

export const CURRENT_STATE_WARNING =
  'CURRENT STATE: reads the mutable catalogue record, which can change after any ingestion and may differ from every publication. Use only when current catalogue state is explicitly required; for publication analysis use the publication-pinned tool instead. Do not mix with publication-pinned reads in one workflow unless the user explicitly asks for a comparison.';

export const PUBLICATION_PINNED_NOTE =
  'PUBLICATION-PINNED: reads the immutable version recorded in the given publication.';
