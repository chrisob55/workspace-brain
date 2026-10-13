#!/usr/bin/env node
// Verifies a running LibreChat stack: container health, HTTP, logs, and that
// LibreChat's own MCP manager started and loaded the Workspace Brain server.
/* global fetch, AbortSignal */
import console from 'node:console';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeArgs = [
  'compose',
  '-f',
  path.join(root, 'deploy/compose/compose.yaml'),
  '--profile',
  'librechat',
];
let failures = 0;

function compose(...args) {
  const result = spawnSync('docker', [...composeArgs, ...args], {
    encoding: 'utf8',
  });
  return { ok: result.status === 0, out: `${result.stdout}${result.stderr}` };
}

function check(name, ok, detail = '') {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`,
  );
  if (!ok) failures += 1;
}

// 1. Containers running and healthy.
const ps = compose('ps', '--format', 'json', '-a');
const containers = ps.out
  .split('\n')
  .filter((line) => line.startsWith('{'))
  .map((line) => JSON.parse(line));
for (const service of ['workspace-brain-api', 'librechat-mongo', 'librechat']) {
  const found = containers.find((c) => c.Service === service);
  check(
    `${service} running and healthy`,
    found?.State === 'running' && found?.Health === 'healthy',
    found ? `${found.State}/${found.Health}` : 'not found',
  );
}

// 2. LibreChat answers over HTTP on its published port.
const portOutput = compose('port', 'librechat', '3080').out.trim();
const port = portOutput.split(':').pop();
const base = `http://127.0.0.1:${port}`;
let response;
try {
  response = await fetch(`${base}/health`, {
    signal: AbortSignal.timeout(10_000),
  });
} catch (error) {
  console.log(`  ${error.message}`);
}
check(
  `LibreChat HTTP ${base}/health`,
  response?.status === 200,
  String(response?.status),
);
const home = await fetch(base).catch(() => undefined);
check(
  'LibreChat serves the web app',
  home?.status === 200,
  String(home?.status),
);

// 3. Logs: MCP configured and initialised, none of the known failure modes.
const logs = compose('logs', '--no-color', 'librechat').out;
check(
  'logs: workspace-brain MCP server initialised',
  /\[MCP\]\[workspace-brain\].*Initialized in/.test(logs),
);
const problems = logs
  .split('\n')
  .filter((line) =>
    /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|ENOTFOUND|EAI_AGAIN|spawn .* ENOENT|\[MCP\].*(error|failed|timed out)/i.test(
      line,
    ),
  );
check(
  'logs: no MCP startup, module or DNS errors',
  problems.length === 0,
  problems[0],
);

// 4. LibreChat's own API reports the server and its tools (authenticated).
const email = `verify-${randomBytes(4).toString('hex')}@example.test`;
const password = randomBytes(12).toString('hex');
const post = (url, body) =>
  fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
await post('/api/auth/register', {
  name: 'mcp verify',
  username: `v${randomBytes(3).toString('hex')}`,
  email,
  password,
  confirm_password: password,
});
const login = await post('/api/auth/login', { email, password });
const token = login.ok ? (await login.json()).token : undefined;
if (token === undefined) {
  console.log(
    'SKIP: could not log in a throwaway user (registration disabled?)',
  );
} else {
  const servers = await fetch(`${base}/api/mcp/tools`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const tools = (servers.servers?.['workspace-brain']?.tools ?? []).map(
    (tool) => tool.name,
  );
  check(
    'LibreChat API lists workspace-brain tools',
    tools.includes('list_publications') && tools.includes('search_entities'),
    `${tools.length} tools`,
  );
}

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All checks passed');
