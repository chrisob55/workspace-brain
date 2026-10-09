import { posix } from 'node:path';
import type { KnowledgeExtractor } from './framework.js';
import {
  CandidateBuilder,
  owningRepository,
  moduleScope,
  moduleName,
  resolveDocument,
  stringScalar,
} from './framework.js';

export const repositoryExtractor: KnowledgeExtractor = {
  id: 'repository-structure',
  version: 1,
  stage: 1,
  supports: (inputs) => inputs[0]?.extractionContext !== undefined,
  extract(inputs, candidates) {
    const output = new CandidateBuilder(this.id, this.version);
    const first = inputs.find((input) => !input.evidence.truncated);
    if (!first) return output.result();
    const boundary = owningRepository(first);
    if (!boundary) return output.result();
    const ownModule = candidates?.entities.find(
      (entity) =>
        entity.type === 'module' &&
        entity.identityScope === moduleScope(first.document.path),
    );
    const moduleInput = inputs.find(
      (input) =>
        ownModule?.sourceEvidenceIds.includes(input.evidence.id) &&
        !input.evidence.truncated,
    );
    const packageInput = inputs.find(
      (input) =>
        input.evidence.key === 'json:/name' &&
        stringScalar(input, inputs) &&
        input.evidence.excerpt.trim() &&
        candidates?.entities.some(
          (entity) =>
            entity.type === 'package' &&
            entity.identityScope === input.document.path &&
            entity.sourceEvidenceIds.includes(input.evidence.id),
        ),
    );
    const support = moduleInput ?? packageInput ?? first;
    const repository = output.entity(
      'repository',
      boundary.name ?? posix.basename(boundary.path),
      boundary.path,
      [support],
      { repositoryBoundary: boundary },
    );
    if (moduleInput) {
      const own = candidates?.entities.find(
        (entity) =>
          entity.type === 'module' &&
          entity.identityScope === moduleScope(first.document.path),
      );
      if (own)
        output.relationship('CONTAINS', repository, own.key, [moduleInput], {
          repositoryBoundary: boundary,
        });
    }
    if (packageInput) {
      const own = candidates?.entities.find(
        (entity) =>
          entity.type === 'package' &&
          entity.name === packageInput.evidence.excerpt.trim() &&
          entity.identityScope === packageInput.document.path &&
          entity.sourceEvidenceIds.includes(packageInput.evidence.id),
      );
      if (!own)
        throw new Error(
          'Package extractor did not produce its declared package',
        );
      output.relationship('CONTAINS', repository, own.key, [packageInput], {
        repositoryBoundary: boundary,
      });
      for (const input of inputs) {
        if (
          !/^json:\/(?:main|module|types|typings|files\/\d+|exports(?:\/.*)?)$/.test(
            input.evidence.key,
          ) ||
          !stringScalar(input, inputs)
        )
          continue;
        const target = resolveDocument(
          input,
          input.evidence.excerpt,
          'manifest',
        );
        if (
          !target?.filename.endsWith('.ts') ||
          owningRepository(input, target.path)?.id !== boundary.id
        ) {
          output.diagnose(
            input,
            'rejected',
            'MANIFEST_TARGET_NOT_A_DISCOVERED_OWNED_MODULE',
            input.evidence.excerpt,
          );
          continue;
        }
        const module = output.entity(
          'module',
          moduleName(target.path),
          moduleScope(target.path),
          [input],
          {
            repositoryBoundary: boundary,
            resolvedDocument: target,
          },
        );
        output.relationship('CONTAINS', own.key, module, [input], {
          repositoryBoundary: boundary,
          resolvedDocument: target,
        });
      }
    }
    return output.result();
  },
};
