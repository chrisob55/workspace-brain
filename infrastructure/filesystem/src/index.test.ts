import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createSourceId,
  createSourceRootId,
  type DiscoverySource,
} from '@workspace-brain/domain';
import { afterEach, describe, expect, it } from 'vitest';

import { FilesystemSourceScanner, readDocumentContentChunk } from './index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('FilesystemSourceScanner', () => {
  it('discovers .git directories and matching file metadata without reading content', async () => {
    const root = await createFixture();
    await mkdir(join(root, 'agent-one', '.git'), { recursive: true });
    await mkdir(join(root, 'agent-one', 'node_modules'), { recursive: true });
    await writeFile(join(root, 'agent-one', 'README.md'), '# Content');
    await writeFile(join(root, 'agent-one', 'package.json'), '{}');
    await writeFile(join(root, 'agent-one', 'node_modules', 'ignored.md'), '');
    await writeFile(join(root, 'not-a-repo.ts'), 'const x = 1;');

    const source = createSource(root, [
      {
        include: ['agent-*'],
        exclude: ['**/node_modules/**', '**/.git/**'],
      },
    ]);
    const result = await new FilesystemSourceScanner().scan(source);

    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]).toMatchObject({
      repositoryType: 'git',
      discoveryMethod: 'filesystem',
    });
    expect(result.repositories[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.documents.map((document) => document.filename)).toEqual([
      'README.md',
    ]);
    expect(result.documents[0]).toMatchObject({
      extension: '.md',
      sizeBytes: 9,
      fingerprint: createHash('sha256').update('# Content').digest('hex'),
      discoveryMethod: 'filesystem',
    });
    expect(result.sourceId).toBe(source.sourceId);
    expect(result.repositories[0]).not.toHaveProperty('id');
    expect(result.documents[0]?.modifiedAt).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,
    );
    expect(result.discoveredAt).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,
    );
  });

  it('includes extensionless Dockerfiles when configured as .dockerfile', async () => {
    const root = await createFixture();
    await writeFile(join(root, 'Dockerfile'), 'FROM node:22');
    const source = createSource(root);
    const configuredSource = {
      ...source,
      includeExtensions: [...source.includeExtensions, '.dockerfile'],
    };

    const result = await new FilesystemSourceScanner().scan(configuredSource);

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      filename: 'Dockerfile',
      extension: '.dockerfile',
    });
  });

  it('does not follow symbolic links and recognizes only a .git directory', async () => {
    const root = await createFixture();
    const outside = await createFixture();
    await writeFile(join(root, '.git'), 'gitdir: elsewhere');
    await writeFile(join(root, 'local.txt'), 'local');
    await writeFile(join(outside, 'linked.txt'), 'linked');
    await symlink(outside, join(root, 'linked-directory'));

    const result = await new FilesystemSourceScanner().scan(createSource(root));

    expect(result.repositories).toEqual([]);
    expect(result.documents.map((document) => document.filename)).toEqual([
      'local.txt',
    ]);
  });

  it('applies include and exclude rules independently for each workspace', async () => {
    const root = await createFixture();
    await mkdir(join(root, 'shared'));
    await writeFile(join(root, 'shared', 'notes.txt'), 'shared');
    const source = createSource(root, [
      { include: ['alpha/**'], exclude: ['**/shared/**'] },
      { include: ['shared/**'], exclude: [] },
    ]);

    const result = await new FilesystemSourceScanner().scan(source);

    expect(result.documents.map(({ path }) => path)).toEqual([
      `${source.roots[0]?.id}/shared/notes.txt`,
    ]);
  });

  it('orders filesystem entries by locale-independent code-point order', async () => {
    const root = await createFixture();
    await writeFile(join(root, 'z.md'), 'letter');
    await writeFile(join(root, '!x.md'), 'punctuation');
    await writeFile(join(root, '_x.md'), 'punctuation');

    const result = await new FilesystemSourceScanner().scan(createSource(root));

    expect(result.documents.map(({ filename }) => filename)).toEqual([
      '!x.md',
      '_x.md',
      'z.md',
    ]);
  });

  it('changes the fingerprint when file content changes without parsing it', async () => {
    const root = await createFixture();
    const filePath = join(root, 'notes.txt');
    await writeFile(filePath, 'before');
    const scanner = new FilesystemSourceScanner();
    const source = createSource(root);

    const first = await scanner.scan(source);
    await writeFile(filePath, 'after');
    const second = await scanner.scan(source);

    expect(first.documents[0]?.fingerprint).not.toBe(
      second.documents[0]?.fingerprint,
    );
  });

  it('fingerprints a repository from its path and current HEAD reference', async () => {
    const root = await createFixture();
    const gitDirectory = join(root, '.git');
    const branchReference = join(gitDirectory, 'refs', 'heads', 'main');
    await mkdir(join(gitDirectory, 'refs', 'heads'), { recursive: true });
    await writeFile(join(gitDirectory, 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(branchReference, `${'a'.repeat(40)}\n`);

    const scanner = new FilesystemSourceScanner();
    const source = createSource(root);
    const first = await scanner.scan(source);
    await writeFile(branchReference, `${'b'.repeat(40)}\n`);
    const second = await scanner.scan(source);

    expect(first.repositories[0]?.fingerprint).not.toBe(
      second.repositories[0]?.fingerprint,
    );
  });

  it('reads bounded content chunks through registered roots without following symlinks', async () => {
    const root = await createFixture();
    const outside = await createFixture();
    await mkdir(join(root, 'docs'));
    await mkdir(join(outside, 'private'));
    await writeFile(join(root, 'docs', 'notes.txt'), 'read-only content');
    await writeFile(join(outside, 'secret.txt'), 'outside');
    await writeFile(join(outside, 'private', 'notes.txt'), 'outside parent');
    await symlink(join(outside, 'secret.txt'), join(root, 'linked.txt'));
    await symlink(join(outside, 'private'), join(root, 'linked-directory'));
    const source = createSource(root);
    const rootId = source.roots[0]?.id;
    if (rootId === undefined) {
      throw new Error('Fixture source root was not created');
    }

    const firstChunk = await readDocumentContentChunk(
      source,
      `${rootId}/docs/notes.txt`,
      0,
      4,
    );
    const rest = await readDocumentContentChunk(
      source,
      `${rootId}/docs/notes.txt`,
      4,
      256,
    );

    expect(Buffer.from(firstChunk.contentBase64, 'base64').toString()).toBe(
      'read',
    );
    expect(rest.done).toBe(true);
    expect(Buffer.from(rest.contentBase64, 'base64').toString()).toBe(
      '-only content',
    );
    await expect(
      readDocumentContentChunk(source, `${rootId}/linked.txt`, 0, 256),
    ).rejects.toThrow();
    await expect(
      readDocumentContentChunk(
        source,
        `${rootId}/linked-directory/notes.txt`,
        0,
        256,
      ),
    ).rejects.toThrow();
    await expect(
      readDocumentContentChunk(source, `${rootId}/../secret.txt`, 0, 256),
    ).rejects.toThrow('Document path is outside the registered source root');
  });
});

async function createFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-brain-scan-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createSource(
  root: string,
  rules?: readonly {
    readonly include: readonly string[];
    readonly exclude: readonly string[];
  }[],
): DiscoverySource {
  const id = createSourceId();
  return {
    sourceId: id,
    roots: [{ id: createSourceRootId(), sourceId: id, absolutePath: root }],
    workspaceRules: rules ?? [],
    excludedDirectoryNames: ['.git', 'node_modules'],
    includeExtensions: ['.md', '.txt', '.ts'],
    maxFileSizeBytes: 1024,
  };
}
