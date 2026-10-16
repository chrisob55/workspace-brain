import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);

describe('document reprocessing runtime command', () => {
  it('uses the running worker and Docker addresses, not a host-local build', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('package.json', root), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts['reprocess:architecture']).toBe(
      'make reprocess-architecture',
    );

    const command = execFileSync(
      'make',
      ['--dry-run', 'reprocess-architecture'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, SOURCE_ID: '' } },
    );
    expect(command).toContain(
      'docker compose -f deploy/compose/compose.yaml exec -T',
    );
    expect(command).toContain('-e API_URL=http://workspace-brain-api:3000');
    expect(command).toContain('-e NATS_SERVERS=nats://nats:4222');
    expect(command).toContain(
      'knowledge-worker node apps/knowledge-worker/dist/reprocess.js',
    );
    expect(command).not.toContain('-e SOURCE_ID');
    expect(command).not.toMatch(/\b(up|build|restart)\b/);
  });

  it('forwards an explicit source filter into the container', () => {
    const command = execFileSync(
      'make',
      [
        '--dry-run',
        'reprocess-architecture',
        'SOURCE_ID=01J00000000000000000000000',
      ],
      { cwd: root, encoding: 'utf8' },
    );
    expect(command).toContain('-e SOURCE_ID');
  });

  it('exports the source filter to Docker and propagates execution failures', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workspace-brain-runtime-'));
    try {
      writeFileSync(
        join(directory, 'docker'),
        [
          '#!/usr/bin/env node',
          'console.log(JSON.stringify({ args: process.argv.slice(2), sourceId: process.env.SOURCE_ID }));',
          'process.exit(Number(process.env.TEST_DOCKER_EXIT_CODE ?? 0));',
          '',
        ].join('\n'),
        { mode: 0o755 },
      );
      const sourceId = '01J00000000000000000000000';
      const options = {
        cwd: root,
        encoding: 'utf8' as const,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH ?? ''}`,
          SOURCE_ID: '',
          TEST_DOCKER_EXIT_CODE: '0',
        },
      };
      const args = ['reprocess-architecture', `SOURCE_ID=${sourceId}`];
      const success = spawnSync('make', args, options);
      expect(success.status).toBe(0);
      const invocation = JSON.parse(
        success.stdout.trim().split('\n').at(-1) ?? '',
      ) as {
        args: string[];
        sourceId: string;
      };
      expect(invocation.sourceId).toBe(sourceId);
      expect(invocation.args).toEqual([
        'compose',
        '-f',
        'deploy/compose/compose.yaml',
        'exec',
        '-T',
        '-e',
        'API_URL=http://workspace-brain-api:3000',
        '-e',
        'NATS_SERVERS=nats://nats:4222',
        '-e',
        'SOURCE_ID',
        'knowledge-worker',
        'node',
        'apps/knowledge-worker/dist/reprocess.js',
      ]);
      const failure = spawnSync('make', args, {
        ...options,
        env: { ...options.env, TEST_DOCKER_EXIT_CODE: '7' },
      });
      expect(failure.status).not.toBe(0);
      expect(failure.stderr).toContain('Error 7');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
