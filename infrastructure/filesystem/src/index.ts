import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';

import {
  type DiscoverySource,
  type DocumentCandidate,
  type RepositoryCandidate,
  type SourceRoot,
  type ScanResult,
} from '@workspace-brain/domain';

export interface SourceScanner {
  scan(source: DiscoverySource): Promise<ScanResult>;
}

export class FilesystemSourceScanner implements SourceScanner {
  async scan(source: DiscoverySource): Promise<ScanResult> {
    const discoveredAt = new Date().toISOString();
    const repositories = new Map<string, RepositoryCandidate>();
    const documents = new Map<string, DocumentCandidate>();
    const excludedDirectoryNames = new Set(source.excludedDirectoryNames);
    const includedExtensions = new Set(
      source.includeExtensions.map(normalizeExtension),
    );

    for (const root of source.roots) {
      const rootMetadata = await lstat(root.absolutePath);
      if (!rootMetadata.isDirectory()) {
        throw new Error(
          `Configured source root is not a real directory: ${root.absolutePath}`,
        );
      }
      await this.scanDirectory({
        root,
        directory: resolve(root.absolutePath),
        relativeDirectory: '',
        source,
        discoveredAt,
        repositories,
        documents,
        excludedDirectoryNames,
        includedExtensions,
      });
    }

    return {
      sourceId: source.sourceId,
      repositories: [...repositories.values()],
      documents: [...documents.values()],
      discoveredAt,
    };
  }

  private async scanDirectory(context: {
    readonly root: SourceRoot;
    readonly directory: string;
    readonly relativeDirectory: string;
    readonly source: DiscoverySource;
    readonly discoveredAt: string;
    readonly repositories: Map<string, RepositoryCandidate>;
    readonly documents: Map<string, DocumentCandidate>;
    readonly excludedDirectoryNames: ReadonlySet<string>;
    readonly includedExtensions: ReadonlySet<string>;
  }): Promise<void> {
    const entries = await readdir(context.directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );

    for (const entry of entries) {
      const absolutePath = join(context.directory, entry.name);
      const relativePath = [context.relativeDirectory, entry.name]
        .filter(Boolean)
        .join('/');

      if (entry.isDirectory()) {
        if (entry.name === '.git') {
          const repositoryPath = sourcePath(
            context.root,
            context.relativeDirectory,
          );
          if (
            matchesDiscoveryRules(
              context.relativeDirectory,
              context.source.workspaceRules,
            )
          ) {
            const fingerprint = await repositoryFingerprint(
              absolutePath,
              repositoryPath,
            );
            context.repositories.set(repositoryPath, {
              path: repositoryPath,
              repositoryType: 'git',
              fingerprint,
              discoveryMethod: 'filesystem',
            });
          }
          continue;
        }

        if (
          context.excludedDirectoryNames.has(entry.name) ||
          !matchesDiscoveryRules(relativePath, context.source.workspaceRules)
        ) {
          continue;
        }

        await this.scanDirectory({
          ...context,
          directory: absolutePath,
          relativeDirectory: relativePath,
        });
        continue;
      }

      if (
        !entry.isFile() ||
        !matchesDiscoveryRules(relativePath, context.source.workspaceRules)
      ) {
        continue;
      }

      const extension = normalizeExtension(extname(entry.name));
      if (
        context.includedExtensions.size > 0 &&
        !context.includedExtensions.has(extension)
      ) {
        continue;
      }
      const file = await entryPathMetadata(
        absolutePath,
        context.source.maxFileSizeBytes,
      );
      if (file === undefined) {
        continue;
      }

      const path = sourcePath(context.root, relativePath);
      context.documents.set(path, {
        path,
        filename: entry.name,
        extension,
        sizeBytes: file.size,
        modifiedAt: file.modifiedAt,
        fingerprint: file.fingerprint,
        discoveryMethod: 'filesystem',
      });
    }
  }
}

async function repositoryFingerprint(
  gitDirectory: string,
  repositoryPath: string,
): Promise<string> {
  const headReference = (
    await readLocalGitMetadata(join(gitDirectory, 'HEAD'))
  )?.trim();
  let head = headReference ?? '';
  const reference = /^ref: ([A-Za-z0-9._/-]+)$/.exec(headReference ?? '')?.[1];
  if (
    reference !== undefined &&
    !isAbsolute(reference) &&
    !reference.split('/').includes('..')
  ) {
    const referencePath = resolve(gitDirectory, reference);
    if (referencePath.startsWith(`${resolve(gitDirectory)}${sep}`)) {
      head =
        (await readLocalGitMetadata(referencePath)) ??
        (await readPackedReference(gitDirectory, reference)) ??
        head;
    }
  }

  return createHash('sha256')
    .update(`${repositoryPath}\0${head}`)
    .digest('hex');
}

async function readPackedReference(
  gitDirectory: string,
  reference: string,
): Promise<string | undefined> {
  const packedReferences = await readLocalGitMetadata(
    join(gitDirectory, 'packed-refs'),
  );
  if (packedReferences === undefined) {
    return undefined;
  }
  for (const line of packedReferences.split('\n')) {
    if (line.startsWith('#') || line.startsWith('^')) {
      continue;
    }
    const [commit, name] = line.trim().split(/\s+/, 2);
    if (name === reference && commit !== undefined) {
      return commit;
    }
  }
  return undefined;
}

async function readLocalGitMetadata(path: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) {
      return undefined;
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function entryPathMetadata(
  path: string,
  maxFileSizeBytes: number | undefined,
): Promise<
  | {
      readonly size: number;
      readonly modifiedAt: string;
      readonly fingerprint: string;
    }
  | undefined
> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      (maxFileSizeBytes !== undefined && metadata.size > maxFileSizeBytes)
    ) {
      return undefined;
    }
    const contents = await handle.readFile();
    const finalMetadata = await handle.stat();
    if (
      metadata.size !== finalMetadata.size ||
      metadata.mtimeMs !== finalMetadata.mtimeMs ||
      metadata.ino !== finalMetadata.ino
    ) {
      throw new Error('File changed while being fingerprinted');
    }
    const fingerprint = createHash('sha256').update(contents).digest('hex');
    return {
      size: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
      fingerprint,
    };
  } finally {
    await handle.close();
  }
}

function sourcePath(root: SourceRoot, relativePath: string): string {
  const rootId = String(root.id);
  const normalizedRelativePath = relativePath.split(sep).join('/');
  return normalizedRelativePath.length === 0
    ? rootId
    : `${rootId}/${normalizedRelativePath}`;
}

function normalizeExtension(extension: string): string {
  return extension.toLocaleLowerCase('en-US');
}

function matchesDiscoveryRules(
  path: string,
  workspaceRules: DiscoverySource['workspaceRules'],
): boolean {
  return (
    workspaceRules.length === 0 ||
    workspaceRules.some((rule) => {
      const included =
        rule.include.length === 0 ||
        rule.include.some((pattern) => matchesPathOrAncestor(path, pattern));
      const excluded = rule.exclude.some((pattern) =>
        matchesPathOrAncestor(path, pattern),
      );
      return included && !excluded;
    })
  );
}

function matchesPathOrAncestor(path: string, pattern: string): boolean {
  const segments = path.split('/');
  return segments.some((_, index) => {
    const ancestor = segments.slice(0, index + 1).join('/');
    return (
      matchesGlob(ancestor, pattern) ||
      matchesGlob(`${ancestor}/__discovery_entry__`, pattern)
    );
  });
}

function matchesGlob(path: string, pattern: string): boolean {
  const normalizedPattern = pattern.replaceAll('\\', '/').replace(/^\.\/+/, '');
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replaceAll('\u0000', '(?:.*/)?')
    .replaceAll('\u0001', '.*');
  const expression = new RegExp(`^${escaped}$`);
  return expression.test(path);
}
