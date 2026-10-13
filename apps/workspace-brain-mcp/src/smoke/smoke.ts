import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';

export type SmokeStage =
  | 'bundle'
  | 'process-start'
  | 'initialisation'
  | 'tool-discovery'
  | 'api-connectivity'
  | 'tool-invocation'
  | 'response-validation';

export type SmokeScenario = 'happy' | 'bad-input' | 'api-down';

/** Stable tools that must stay available; the total tool count may change. */
export const EXPECTED_TOOLS = [
  'search_entities',
  'get_entity',
  'list_publications',
  'get_latest_publication',
  'get_publication_summary',
  'export_publication',
] as const;

export class SmokeFailure extends Error {
  constructor(
    readonly stage: SmokeStage,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SmokeFailure';
  }
}

export interface Connection {
  transport: Transport;
  /** Stderr captured from the MCP process, if it is a child process. */
  stderr?: () => string;
}

export interface SmokeOptions {
  scenario: SmokeScenario;
  connect: () => Connection;
  /** Base URL the MCP server was configured with; used for API checks. */
  apiUrl: string;
  /** Values that must never appear in any output (credentials, canaries). */
  secrets?: readonly string[];
  log?: (line: string) => void;
  initTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** Upper bound for a tool call when the API is unreachable. */
  failureBoundMs?: number;
}

export interface SmokeReport {
  serverName: string;
  serverVersion: string;
  toolCount: number;
  evidence: string;
}

type ToolResult = {
  isError?: boolean;
  content?: { type: string; text?: string }[];
};

type Log = (line: string) => void;

export async function runSmoke(options: SmokeOptions): Promise<SmokeReport> {
  const log = options.log ?? (() => undefined);
  const requestTimeout = options.requestTimeoutMs ?? 30_000;
  const connection = options.connect();
  const client = new Client({
    name: 'workspace-brain-mcp-smoke',
    version: '1',
  });

  try {
    await withTimeout(
      client.connect(connection.transport),
      options.initTimeoutMs ?? 30_000,
      'MCP initialise handshake',
    ).catch((error: unknown) => {
      throw classifyConnectError(error, connection);
    });

    const info = client.getServerVersion();
    if (info?.name !== 'workspace-brain') {
      throw new SmokeFailure(
        'initialisation',
        `Unexpected server identity: ${JSON.stringify(info)}`,
      );
    }
    log(`[PASS] initialisation: ${info.name} ${info.version}`);

    const tools = await stage('tool-discovery', 'tools/list', async () => {
      const listed = await client.listTools(undefined, {
        timeout: requestTimeout,
      });
      return listed.tools;
    });
    if (tools.length === 0) {
      throw new SmokeFailure('tool-discovery', 'tools/list returned no tools.');
    }
    const names = new Set(tools.map((tool) => tool.name));
    const missing = EXPECTED_TOOLS.filter((name) => !names.has(name));
    if (missing.length > 0) {
      throw new SmokeFailure(
        'tool-discovery',
        `Missing expected tools: ${missing.join(', ')}`,
      );
    }
    log(
      `[PASS] tool-discovery: ${tools.length} tools; expected present: ${EXPECTED_TOOLS.join(', ')}`,
    );

    let evidence: string;
    if (options.scenario === 'happy') {
      evidence = await happyPath(client, options, log, requestTimeout);
    } else if (options.scenario === 'bad-input') {
      evidence = await badInput(client, log, requestTimeout);
    } else {
      evidence = await apiDown(client, options, log);
    }

    const leaked = (options.secrets ?? []).some(
      (secret) =>
        secret !== '' &&
        [connection.stderr?.() ?? '', evidence].some((out) =>
          out.includes(secret),
        ),
    );
    if (leaked) {
      throw new SmokeFailure(
        'response-validation',
        'A sensitive environment value leaked into MCP output.',
      );
    }

    return {
      serverName: info.name,
      serverVersion: info.version,
      toolCount: tools.length,
      evidence,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function happyPath(
  client: Client,
  options: SmokeOptions,
  log: Log,
  timeout: number,
): Promise<string> {
  await stage('api-connectivity', 'GET /ready', async () => {
    const response = await fetch(new URL('/ready', options.apiUrl), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`/ready returned HTTP ${response.status}`);
    }
  });
  log(`[PASS] api-connectivity: ${options.apiUrl} /ready is ready`);

  const page = parseToolJson(
    await stage('tool-invocation', 'list_publications', () =>
      client.callTool(
        { name: 'list_publications', arguments: { limit: 1 } },
        undefined,
        { timeout },
      ),
    ),
  ) as { items?: unknown; nextCursor?: unknown };
  if (!Array.isArray(page.items) || !('nextCursor' in page)) {
    throw new SmokeFailure(
      'response-validation',
      `list_publications did not return the API page shape { items, nextCursor }: ${truncate(JSON.stringify(page))}`,
    );
  }

  const first = page.items[0] as { id?: unknown } | undefined;
  if (first === undefined) {
    const evidence = 'list_publications returned an empty page from the API';
    log(`[PASS] tool-invocation: ${evidence} (catalogue has no publications)`);
    return evidence;
  }
  if (typeof first.id !== 'string') {
    throw new SmokeFailure(
      'response-validation',
      'Publication item has no string id.',
    );
  }

  // An id-keyed re-read shows the data came from the API, not a static stub.
  const summary = parseToolJson(
    await stage('tool-invocation', 'get_publication_summary', () =>
      client.callTool(
        {
          name: 'get_publication_summary',
          arguments: { publicationId: first.id },
        },
        undefined,
        { timeout },
      ),
    ),
  ) as { publication?: { id?: unknown } };
  if (summary.publication?.id !== first.id) {
    throw new SmokeFailure(
      'response-validation',
      `get_publication_summary returned publication ${String(summary.publication?.id)}, expected ${first.id}`,
    );
  }
  const evidence = `publication ${first.id} listed and re-read through the API`;
  log(`[PASS] tool-invocation: ${evidence}`);
  return evidence;
}

async function badInput(
  client: Client,
  log: Log,
  timeout: number,
): Promise<string> {
  const message = await stage(
    'tool-invocation',
    'invalid input call',
    async () => {
      try {
        const result = (await client.callTool(
          {
            name: 'get_publication_summary',
            arguments: { publicationId: '../../etc/passwd' },
          },
          undefined,
          { timeout },
        )) as ToolResult;
        if (result.isError !== true) {
          throw new SmokeFailure(
            'response-validation',
            'Invalid input was not reported as an MCP error.',
          );
        }
        return result.content?.[0]?.text ?? '';
      } catch (error) {
        if (error instanceof McpError) {
          return error.message;
        }
        throw error;
      }
    },
  );
  if (message.trim() === '') {
    throw new SmokeFailure(
      'response-validation',
      'Invalid input produced an empty error.',
    );
  }
  log(`[PASS] bad-input: structured error (${truncate(message, 120)})`);

  // The server must stay usable after a rejected call.
  await stage('tool-discovery', 'tools/list after error', () =>
    client.listTools(undefined, { timeout }),
  );
  log('[PASS] bad-input: server still answers tools/list');
  return message;
}

async function apiDown(
  client: Client,
  options: SmokeOptions,
  log: Log,
): Promise<string> {
  const bound = options.failureBoundMs ?? 20_000;
  const started = Date.now();
  const result = (await stage(
    'tool-invocation',
    'list_publications (API down)',
    () =>
      withTimeout(
        client.callTool({ name: 'list_publications', arguments: { limit: 1 } }),
        bound,
        'list_publications',
      ),
  )) as ToolResult;
  const elapsed = Date.now() - started;
  const text = result.content?.[0]?.text ?? '';
  if (result.isError !== true) {
    throw new SmokeFailure(
      'response-validation',
      `Tool reported success although the API is unreachable: ${truncate(text)}`,
    );
  }
  let envelope: { error?: { kind?: unknown } };
  try {
    envelope = JSON.parse(text) as typeof envelope;
  } catch {
    throw new SmokeFailure(
      'response-validation',
      `Error result is not the structured envelope: ${truncate(text)}`,
    );
  }
  if (typeof envelope.error?.kind !== 'string') {
    throw new SmokeFailure(
      'response-validation',
      `Error envelope has no error.kind: ${truncate(text)}`,
    );
  }
  log(
    `[PASS] api-down: error kind "${envelope.error.kind}" after ${elapsed} ms (bound ${bound} ms)`,
  );
  return text;
}

function parseToolJson(result: unknown): unknown {
  const { isError, content } = result as ToolResult;
  if (isError === true) {
    throw new SmokeFailure(
      'tool-invocation',
      `Tool returned an MCP error: ${truncate(content?.[0]?.text ?? '')}`,
    );
  }
  const block = content?.[0];
  if (block?.type !== 'text' || typeof block.text !== 'string') {
    throw new SmokeFailure(
      'response-validation',
      'Tool result has no text content block.',
    );
  }
  try {
    return JSON.parse(block.text) as unknown;
  } catch {
    throw new SmokeFailure(
      'response-validation',
      `Tool result is not JSON: ${truncate(block.text)}`,
    );
  }
}

function classifyConnectError(error: unknown, connection: Connection): Error {
  const stderr = connection.stderr?.().trim() ?? '';
  const detail = `${errorMessage(error)}${stderr === '' ? '' : `\nMCP stderr: ${truncate(stderr, 800)}`}`;
  return new SmokeFailure(
    /timed out/.test(detail) ? 'initialisation' : 'process-start',
    detail,
    { cause: error },
  );
}

async function stage<T>(
  name: SmokeStage,
  what: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SmokeFailure) {
      throw error;
    }
    throw new SmokeFailure(name, `${what}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${what} timed out after ${ms} ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
