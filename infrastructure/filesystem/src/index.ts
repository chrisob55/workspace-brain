import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, readdir, type FileHandle } from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  sep,
} from 'node:path';

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

export type DocumentContentChunk = {
  readonly contentBase64: string;
  readonly sizeBytes: number;
  readonly done: boolean;
};

export async function readDocumentContentChunk(
  source: DiscoverySource,
  repositoryRelativePath: string,
  offset: number,
  requestedBytes: number,
): Promise<DocumentContentChunk> {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(requestedBytes) ||
    requestedBytes < 1 ||
    requestedBytes > 256 * 1024
  ) {
    throw new Error('Invalid document content range');
  }
  const [rootId, ...segments] = repositoryRelativePath.split('/');
  const root = source.roots.find(({ id }) => id === rootId);
  if (
    root === undefined ||
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('\\') ||
        segment.includes('\0'),
    )
  ) {
    throw new Error('Document path is outside the registered source root');
  }

  const openedRoot = await openRootDirectory(root.absolutePath);
  let currentPath = openedRoot.path;
  const directories: FileHandle[] = [];
  try {
    directories.push(openedRoot.handle);
    for (const segment of segments.slice(0, -1)) {
      const parent = directories.at(-1);
      if (parent === undefined) {
        throw new Error('Document source root is unavailable');
      }
      const child = await openDirectoryAt(parent, currentPath, segment);
      directories.push(child);
      currentPath = join(currentPath, segment);
    }

    const parent = directories.at(-1);
    if (parent === undefined) {
      throw new Error('Document source root is unavailable');
    }
    const handle = await openFileAt(parent, currentPath, segments.at(-1) ?? '');
    try {
      const metadata = await handle.stat();
      if (
        !metadata.isFile() ||
        metadata.size > source.maxFileSizeBytes ||
        offset > metadata.size
      ) {
        throw new Error('Document is unavailable for read-only processing');
      }
      const buffer = Buffer.alloc(
        Math.min(requestedBytes, metadata.size - offset),
      );
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const finalMetadata = await handle.stat();
      if (
        finalMetadata.size !== metadata.size ||
        finalMetadata.mtimeMs !== metadata.mtimeMs ||
        finalMetadata.ino !== metadata.ino
      ) {
        throw new Error('Document changed while being processed');
      }
      return {
        contentBase64: buffer.subarray(0, bytesRead).toString('base64'),
        sizeBytes: metadata.size,
        done: offset + bytesRead >= metadata.size,
      };
    } finally {
      await handle.close();
    }
  } finally {
    await closeHandles(directories);
  }
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
      const openedRoot = await openRootDirectory(root.absolutePath);
      try {
        await this.scanDirectory({
          root,
          directory: openedRoot.path,
          directoryHandle: openedRoot.handle,
          relativeDirectory: '',
          source,
          discoveredAt,
          repositories,
          documents,
          excludedDirectoryNames,
          includedExtensions,
        });
      } finally {
        await openedRoot.handle.close();
      }
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
    readonly directoryHandle: FileHandle;
    readonly relativeDirectory: string;
    readonly source: DiscoverySource;
    readonly discoveredAt: string;
    readonly repositories: Map<string, RepositoryCandidate>;
    readonly documents: Map<string, DocumentCandidate>;
    readonly excludedDirectoryNames: ReadonlySet<string>;
    readonly includedExtensions: ReadonlySet<string>;
  }): Promise<void> {
    const entries = await readdir(
      descriptorPath(context.directoryHandle, context.directory),
      { withFileTypes: true },
    );
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );

    for (const entry of entries) {
      const absolutePath = join(context.directory, entry.name);
      const relativePath = [context.relativeDirectory, entry.name]
        .filter(Boolean)
        .join('/');

      if (entry.isDirectory()) {
        let childHandle: FileHandle;
        try {
          childHandle = await openDirectoryAt(
            context.directoryHandle,
            context.directory,
            entry.name,
          );
        } catch (error) {
          if (isDisappearedEntry(error)) {
            continue;
          }
          throw error;
        }
        try {
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
                childHandle,
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
            directoryHandle: childHandle,
            relativeDirectory: relativePath,
          });
        } finally {
          await childHandle.close();
        }
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
        context.directoryHandle,
        context.directory,
        entry.name,
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

function descriptorPath(handle: FileHandle, fallbackPath: string): string {
  return process.platform === 'linux'
    ? `/proc/self/fd/${handle.fd}`
    : fallbackPath;
}

async function openDirectory(path: string): Promise<FileHandle> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    if (!(await handle.stat()).isDirectory()) {
      throw new Error('Configured source root is not a real directory');
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function openRootDirectory(
  configuredPath: string,
): Promise<{ readonly handle: FileHandle; readonly path: string }> {
  const absolutePath = resolve(configuredPath);
  if (absolutePath === sep) {
    return { handle: await openDirectory(absolutePath), path: absolutePath };
  }
  const parentPath = await realpath(dirname(absolutePath));
  const path = join(parentPath, basename(absolutePath));
  const parent = await openAbsoluteDirectory(parentPath);
  try {
    return {
      handle: await openDirectoryAt(parent.handle, parent.path, basename(path)),
      path,
    };
  } finally {
    await parent.handle.close();
  }
}

async function openAbsoluteDirectory(
  absolutePath: string,
): Promise<{ readonly handle: FileHandle; readonly path: string }> {
  const targetPath = resolve(absolutePath);
  let path: string = sep;
  let current = await openDirectory(path);
  for (const segment of targetPath.split(sep).filter(Boolean)) {
    const nextPath = join(path, segment);
    let next: FileHandle;
    try {
      next = await openDirectoryAt(current, path, segment);
    } catch (error) {
      await current.close();
      throw error;
    }
    await current.close();
    current = next;
    path = nextPath;
  }
  return { handle: current, path };
}

async function openDirectoryAt(
  parent: FileHandle,
  parentPath: string,
  name: string,
): Promise<FileHandle> {
  const child = await open(
    join(descriptorPath(parent, parentPath), name),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    if (!(await child.stat()).isDirectory()) {
      throw new Error('Filesystem entry is not a real directory');
    }
    return child;
  } catch (error) {
    await child.close();
    throw error;
  }
}

async function openFileAt(
  parent: FileHandle,
  parentPath: string,
  name: string,
): Promise<FileHandle> {
  return open(
    join(descriptorPath(parent, parentPath), name),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
}

async function closeHandles(handles: readonly FileHandle[]): Promise<void> {
  const errors: unknown[] = [];
  for (const handle of [...handles].reverse()) {
    try {
      await handle.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Could not close filesystem handles');
  }
}

function isDisappearedEntry(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' ||
      error.code === 'ENOTDIR' ||
      error.code === 'ELOOP')
  );
}

async function repositoryFingerprint(
  gitDirectory: FileHandle,
  gitDirectoryPath: string,
  repositoryPath: string,
): Promise<string> {
  const headReference = (
    await readLocalGitMetadataAt(gitDirectory, gitDirectoryPath, ['HEAD'])
  )?.trim();
  let head = headReference ?? '';
  const reference = /^ref: ([A-Za-z0-9._/-]+)$/.exec(headReference ?? '')?.[1];
  if (
    reference !== undefined &&
    !isAbsolute(reference) &&
    !reference.split('/').includes('..')
  ) {
    if (reference.split('/').every((segment) => segment.length > 0)) {
      head =
        (await readLocalGitMetadataAt(
          gitDirectory,
          gitDirectoryPath,
          reference.split('/'),
        )) ??
        (await readPackedReference(
          gitDirectory,
          gitDirectoryPath,
          reference,
        )) ??
        head;
    }
  }

  return createHash('sha256')
    .update(`${repositoryPath}\0${head}`)
    .digest('hex');
}

async function readPackedReference(
  gitDirectory: FileHandle,
  gitDirectoryPath: string,
  reference: string,
): Promise<string | undefined> {
  const packedReferences = await readLocalGitMetadataAt(
    gitDirectory,
    gitDirectoryPath,
    ['packed-refs'],
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

async function readLocalGitMetadataAt(
  root: FileHandle,
  rootPath: string,
  segments: readonly string[],
): Promise<string | undefined> {
  const directories: FileHandle[] = [];
  try {
    directories.push(root);
    let directoryPath = rootPath;
    for (const segment of segments.slice(0, -1)) {
      const parent = directories.at(-1);
      if (parent === undefined) {
        return undefined;
      }
      const child = await openDirectoryAt(parent, directoryPath, segment);
      directories.push(child);
      directoryPath = join(directoryPath, segment);
    }
    const parent = directories.at(-1);
    const name = segments.at(-1);
    if (parent === undefined || name === undefined) {
      return undefined;
    }
    const handle = await openFileAt(parent, directoryPath, name);
    try {
      if (!(await handle.stat()).isFile()) {
        return undefined;
      }
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isDisappearedEntry(error)) {
      return undefined;
    }
    throw error;
  } finally {
    await closeHandles(directories.slice(1));
  }
}

async function entryPathMetadata(
  parent: FileHandle,
  parentPath: string,
  name: string,
  maxFileSizeBytes: number | undefined,
): Promise<
  | {
      readonly size: number;
      readonly modifiedAt: string;
      readonly fingerprint: string;
    }
  | undefined
> {
  let handle: FileHandle;
  try {
    handle = await openFileAt(parent, parentPath, name);
  } catch (error) {
    if (isDisappearedEntry(error)) {
      return undefined;
    }
    throw error;
  }
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
