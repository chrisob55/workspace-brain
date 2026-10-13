#!/usr/bin/env node
/**
 * MCP protocol smoke test for the Workspace Brain MCP server.
 *
 *   node dist/smoke/cli.js [--scenario happy|bad-input|api-down]
 *                          [--server <path to dist/server.js>]
 *                          [--librechat-config <librechat.yaml>]
 *                          [--api-url <url>]
 *
 * With --librechat-config the spawn command, args and env come from the
 * workspace-brain entry of that file, exactly as LibreChat launches it.
 * Exit codes: 0 pass, 1 test failure, 2 usage error.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  runSmoke,
  SmokeFailure,
  type Connection,
  type SmokeScenario,
} from './smoke.js';

const scenarios: readonly SmokeScenario[] = ['happy', 'bad-input', 'api-down'];
const DEFAULT_API_URL = 'http://localhost:3000';

interface ServerSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface Args {
  scenario: SmokeScenario;
  server?: string;
  librechatConfig?: string;
  apiUrl?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { scenario: 'happy' };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      usage(`Missing value for ${flag}`);
    }
    if (flag === '--scenario') {
      if (!scenarios.includes(value as SmokeScenario)) {
        usage(`Unknown scenario ${value}`);
      }
      args.scenario = value as SmokeScenario;
    } else if (flag === '--server') {
      args.server = value;
    } else if (flag === '--librechat-config') {
      args.librechatConfig = value;
    } else if (flag === '--api-url') {
      args.apiUrl = value;
    } else {
      usage(`Unknown option ${flag}`);
    }
  }
  return args;
}

function usage(message: string): never {
  console.error(`${message}\nSee the header of smoke/cli.ts for usage.`);
  process.exit(2);
}

function loadYaml(): (text: string) => unknown {
  // The LibreChat image ships js-yaml; the bundle does not.
  for (const base of [import.meta.url, 'file:///app/package.json']) {
    try {
      const mod = createRequire(base)('js-yaml') as {
        load: (text: string) => unknown;
      };
      return mod.load;
    } catch {
      // try the next location
    }
  }
  throw new SmokeFailure(
    'bundle',
    'js-yaml is not resolvable; --librechat-config must run in the LibreChat image.',
  );
}

function specFromLibreChat(file: string): ServerSpec {
  if (!existsSync(file)) {
    throw new SmokeFailure('bundle', `LibreChat config not found: ${file}`);
  }
  const config = loadYaml()(readFileSync(file, 'utf8')) as {
    mcpServers?: Record<
      string,
      { command?: string; args?: string[]; env?: Record<string, string> }
    >;
  };
  const entry = config.mcpServers?.['workspace-brain'];
  if (entry?.command === undefined) {
    throw new SmokeFailure(
      'bundle',
      `${file} has no mcpServers.workspace-brain.command`,
    );
  }
  return {
    command: entry.command,
    args: entry.args ?? [],
    env: entry.env ?? {},
  };
}

function buildSpec(args: Args): ServerSpec {
  if (args.librechatConfig !== undefined) {
    return specFromLibreChat(args.librechatConfig);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    command: process.execPath,
    args: [args.server ?? path.resolve(here, '..', 'server.js')],
    env: {
      WORKSPACE_BRAIN_API_URL:
        process.env.WORKSPACE_BRAIN_API_URL || DEFAULT_API_URL,
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const spec = buildSpec(args);
  if (args.server !== undefined && args.librechatConfig === undefined) {
    spec.args = [args.server];
  }

  const canary = `canary-${randomUUID()}`;
  const env: Record<string, string> = { ...spec.env };
  if (args.apiUrl !== undefined) {
    env.WORKSPACE_BRAIN_API_URL = args.apiUrl;
  }
  if (args.scenario === 'api-down') {
    env.WORKSPACE_BRAIN_API_TIMEOUT_MS = '3000';
    env.WORKSPACE_BRAIN_SMOKE_CANARY = canary;
  }

  const entry = spec.args.find((arg) => arg.endsWith('.js'));
  if (entry !== undefined && !existsSync(entry)) {
    throw new SmokeFailure(
      'bundle',
      `MCP entry point not found: ${entry} (build the package or recreate the bundle).`,
    );
  }

  const apiUrl = env.WORKSPACE_BRAIN_API_URL ?? DEFAULT_API_URL;
  console.log(
    `MCP server: ${spec.command} ${spec.args.join(' ')}\nAPI URL: ${apiUrl}\nScenario: ${args.scenario}`,
  );

  let stderrText = '';
  const connect = (): Connection => {
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env,
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString();
    });
    return { transport, stderr: () => stderrText };
  };

  const report = await runSmoke({
    scenario: args.scenario,
    connect,
    apiUrl,
    secrets: [canary],
    log: (line) => console.log(line),
  });

  if (!stderrText.includes(apiUrl)) {
    throw new SmokeFailure(
      'initialisation',
      `MCP process did not report API ${apiUrl} in its startup output; WORKSPACE_BRAIN_API_URL did not reach it. stderr: ${stderrText.trim()}`,
    );
  }
  console.log(`[PASS] environment: MCP process reports API ${apiUrl}`);
  console.log(
    `PASS ${args.scenario}: ${report.serverName} ${report.serverVersion}, ${report.toolCount} tools. ${report.evidence}`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof SmokeFailure) {
    console.error(`FAIL [${error.stage}] ${error.message}`);
  } else {
    console.error(
      `FAIL [unexpected] ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  process.exit(1);
});
