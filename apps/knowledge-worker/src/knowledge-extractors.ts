import { posix } from 'node:path';

import {
  createKnowledgeEntityKey,
  parseEvidenceId,
  type KnowledgeEntityCandidate,
  type KnowledgeInputEvidence,
  type KnowledgeProvenance,
  type KnowledgeRelationshipCandidate,
} from '@workspace-brain/domain';

const extractorId = 'deterministic-knowledge-extractors';
const extractorVersion = 1;
const openApiNamePointer = /^json:\/info\/title$|^yaml:\/info\/title$/;
const packageNamePointer = 'json:/name';
const dependencyPointer =
  /^json:\/(?:dependencies|devDependencies|optionalDependencies|peerDependencies)\/(.+)$/;
const importPattern = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/;

export type KnowledgeCandidates = {
  readonly entities: readonly KnowledgeEntityCandidate[];
  readonly relationships: readonly KnowledgeRelationshipCandidate[];
};

export function extractKnowledgeCandidates(
  inputs: readonly KnowledgeInputEvidence[],
): KnowledgeCandidates {
  const entities = new Map<string, KnowledgeEntityCandidate>();
  const relationships = new Map<string, KnowledgeRelationshipCandidate>();
  const document = inputs[0]?.document;
  if (document === undefined) {
    return { entities: [], relationships: [] };
  }
  if (
    inputs.some(
      ({ document: item }) =>
        item.id !== document.id || item.path !== document.path,
    )
  ) {
    throw new Error('Knowledge extraction inputs must belong to one document');
  }

  const documentName = document.filename.toLocaleLowerCase('en-US');
  const documentScope = document.path;
  const evidenceByKey = new Map(
    inputs.map((input) => [input.evidence.key, input]),
  );

  if (documentName === 'package.json') {
    const packageName = evidenceByKey.get(packageNamePointer);
    if (packageName !== undefined) {
      addEntity(
        entities,
        'package',
        packageName.evidence.excerpt,
        documentScope,
        packageName,
      );
    }
    const ownerKey =
      packageName === undefined
        ? undefined
        : entityKey(
            'package',
            document.sourceId,
            documentScope,
            packageName.evidence.excerpt,
          );
    if (ownerKey !== undefined) {
      for (const input of inputs) {
        const dependency = dependencyPointer.exec(input.evidence.key);
        if (dependency === null) {
          continue;
        }
        const dependencyName = decodePointerSegment(dependency[1] ?? '');
        if (
          dependencyName.length === 0 ||
          dependencyName === packageName?.evidence.excerpt
        ) {
          continue;
        }
        const targetKey = entityKey(
          'package',
          document.sourceId,
          documentScope,
          dependencyName,
        );
        addEntity(entities, 'package', dependencyName, documentScope, input);
        addRelationship(
          relationships,
          'DEPENDS_ON',
          ownerKey,
          targetKey,
          input,
        );
      }
    }
  }

  if (documentName === 'dockerfile') {
    for (const input of inputs) {
      const match =
        /^FROM\s+(?:(?:--platform=\S+)\s+)?([^\s]+)(?:\s+AS\s+\S+)?/i.exec(
          input.evidence.excerpt,
        );
      if (
        match?.[1] !== undefined &&
        match[1].toLocaleLowerCase('en-US') !== 'scratch'
      ) {
        addEntity(entities, 'container', match[1], documentScope, input);
      }
    }
  }

  if (
    /(?:^|\/)(?:openapi|swagger)(?:\.[^/]*)?$/i.test(document.path) ||
    documentName.startsWith('openapi.') ||
    documentName.startsWith('swagger.')
  ) {
    const title = inputs.find(({ evidence }) =>
      openApiNamePointer.test(evidence.key),
    );
    const titleInput = title ?? inputs[0];
    if (titleInput !== undefined) {
      addEntity(
        entities,
        'api',
        title?.evidence.excerpt ?? document.filename,
        documentScope,
        titleInput,
      );
    }
  }

  if (documentName.endsWith('.ts')) {
    const moduleName = relativeDocumentPath(document.path);
    const moduleScope = moduleIdentityPath(document.path);
    const moduleInputs = inputs.filter(({ evidence }) =>
      evidence.key.startsWith('typescript:'),
    );
    const firstModuleInput = moduleInputs[0];
    if (firstModuleInput !== undefined) {
      const sourceKey = entityKey(
        'module',
        document.sourceId,
        moduleScope,
        moduleName,
      );
      addEntity(entities, 'module', moduleName, moduleScope, firstModuleInput);
      for (const input of moduleInputs) {
        const match = importPattern.exec(input.evidence.excerpt);
        const specifier = match?.[1] ?? match?.[2];
        if (specifier === undefined) {
          continue;
        }
        const target = resolveModuleName(moduleScope, specifier);
        if (target === undefined || target.identityScope === moduleScope) {
          continue;
        }
        const targetName = target.identityScope.startsWith('external:')
          ? target.name
          : relativeDocumentPath(target.identityScope);
        const targetKey = entityKey(
          'module',
          document.sourceId,
          target.identityScope,
          targetName,
        );
        addEntity(entities, 'module', targetName, target.identityScope, input);
        addRelationship(
          relationships,
          'DEPENDS_ON',
          sourceKey,
          targetKey,
          input,
        );
      }
    }
  }

  return {
    entities: [...entities.values()].sort((left, right) =>
      compareOrdinal(left.key, right.key),
    ),
    relationships: [...relationships.values()].sort((left, right) =>
      compareOrdinal(left.key, right.key),
    ),
  };
}

function addEntity(
  entities: Map<string, KnowledgeEntityCandidate>,
  type: KnowledgeEntityCandidate['type'],
  name: string,
  identityScope: string,
  input: KnowledgeInputEvidence,
): void {
  const normalizedName = name.trim();
  if (normalizedName.length === 0) {
    return;
  }
  const key = entityKey(
    type,
    input.document.sourceId,
    identityScope,
    normalizedName,
  );
  const provenance = createProvenance(input);
  const existing = entities.get(key);
  entities.set(key, {
    key,
    type,
    identityScope,
    name: normalizedName,
    sourceEvidenceIds: union(existing?.sourceEvidenceIds ?? [], [
      parseEvidenceId(input.evidence.id),
    ]),
    provenance: unionProvenance(existing?.provenance ?? [], [provenance]),
    lifecycleStatus: 'observed',
  });
}

function addRelationship(
  relationships: Map<string, KnowledgeRelationshipCandidate>,
  type: KnowledgeRelationshipCandidate['type'],
  sourceEntityKey: string,
  targetEntityKey: string,
  input: KnowledgeInputEvidence,
): void {
  const key = `${type}:${sourceEntityKey}->${targetEntityKey}`;
  const provenance = createProvenance(input);
  const existing = relationships.get(key);
  relationships.set(key, {
    key,
    type,
    sourceEntityKey,
    targetEntityKey,
    sourceEvidenceIds: union(existing?.sourceEvidenceIds ?? [], [
      parseEvidenceId(input.evidence.id),
    ]),
    provenance: unionProvenance(existing?.provenance ?? [], [provenance]),
    confidence: 1,
    lifecycleStatus: 'related',
  });
}

function createProvenance(input: KnowledgeInputEvidence): KnowledgeProvenance {
  return {
    evidenceId: parseEvidenceId(input.evidence.id),
    documentVersionId: input.documentVersion.id,
    documentId: input.document.id,
    sourceId: input.document.sourceId,
    documentPath: input.document.path,
    contentFingerprint: input.provenance.contentFingerprint,
    locator: input.evidence.locator,
    processorId: input.provenance.processorId,
    processorVersion: input.provenance.processorVersion,
    extractionRuleId: input.provenance.extractionRuleId,
    extractionRuleVersion: input.provenance.extractionRuleVersion,
    knowledgeExtractorId: extractorId,
    knowledgeExtractorVersion: extractorVersion,
  };
}

function entityKey(
  type: KnowledgeEntityCandidate['type'],
  sourceId: string,
  identityScope: string,
  name: string,
): string {
  return createKnowledgeEntityKey(type, sourceId, identityScope, name);
}

function relativeDocumentPath(path: string): string {
  const [, ...segments] = path.split('/');
  const sourceRelativePath = segments.length > 0 ? segments.join('/') : path;
  return sourceRelativePath.replace(/\.ts$/i, '');
}

function moduleIdentityPath(path: string): string {
  return path.replace(/\.(?:tsx?|jsx?)$/i, '');
}

function resolveModuleName(
  currentScope: string,
  specifier: string,
): { readonly name: string; readonly identityScope: string } | undefined {
  if (specifier.startsWith('.')) {
    const resolved = posix
      .normalize(posix.join(posix.dirname(currentScope), specifier))
      .replace(/\.(?:tsx?|jsx?)$/i, '');
    if (resolved.split('/')[0] !== currentScope.split('/')[0]) {
      return undefined;
    }
    return { name: relativeDocumentPath(resolved), identityScope: resolved };
  }
  return { name: specifier, identityScope: `external:${specifier}` };
}

function decodePointerSegment(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function union<T>(left: readonly T[], right: readonly T[]): T[] {
  return [...new Set([...left, ...right])];
}

function unionProvenance(
  left: readonly KnowledgeProvenance[],
  right: readonly KnowledgeProvenance[],
): KnowledgeProvenance[] {
  const byEvidenceId = new Map(
    [...left, ...right].map((item) => [item.evidenceId, item]),
  );
  return [...byEvidenceId.values()].sort((a, b) =>
    compareOrdinal(a.evidenceId, b.evidenceId),
  );
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
