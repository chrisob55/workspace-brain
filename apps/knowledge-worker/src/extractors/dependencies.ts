import { posix } from 'node:path';
import ts from 'typescript';
import type { KnowledgeInputEvidence } from '@workspace-brain/domain';
import {
  CandidateBuilder,
  decodePointer,
  moduleName,
  moduleScope,
  stringScalar,
  type KnowledgeExtractor,
} from './framework.js';

function builder(id: string, inputs: readonly KnowledgeInputEvidence[]) {
  return inputs[0]?.documentVersion.processorVersion === 1 ||
    inputs[0]?.documentVersion.processorVersion === 2
    ? new CandidateBuilder('deterministic-knowledge-extractors', 1)
    : new CandidateBuilder(id, 1);
}

export const packageExtractor: KnowledgeExtractor = {
  id: 'package-dependencies',
  version: 1,
  supports: (inputs) =>
    inputs[0]?.document.filename.toLowerCase() === 'package.json',
  extract(inputs) {
    const output = builder(this.id, inputs);
    const owner = inputs.find(
      (input) =>
        input.evidence.key === 'json:/name' && stringScalar(input, inputs),
    );
    if (!owner?.evidence.excerpt.trim()) {
      const rejected = inputs.find(
        (input) => input.evidence.key === 'json:/name',
      );
      if (rejected)
        output.diagnose(
          rejected,
          'rejected',
          'PACKAGE_NAME_NOT_A_COMPLETE_STRING',
          rejected.evidence.excerpt,
        );
      return output.result();
    }
    const source = output.entity(
      'package',
      owner.evidence.excerpt,
      owner.document.path,
      [owner],
    );
    for (const input of inputs) {
      const match =
        /^json:\/(?:dependencies|devDependencies|optionalDependencies|peerDependencies)\/(.+)$/.exec(
          input.evidence.key,
        );
      if (!match || !stringScalar(input, inputs)) continue;
      const name = decodePointer(match[1] ?? '');
      if (!name || name === owner.evidence.excerpt) continue;
      const target = output.entity('package', name, owner.document.path, [
        input,
      ]);
      output.relationship('DEPENDS_ON', source, target, [input]);
    }
    return output.result();
  },
};

export const moduleExtractor: KnowledgeExtractor = {
  id: 'typescript-dependencies',
  version: 1,
  supports: (inputs) => inputs[0]?.document.filename.endsWith('.ts') ?? false,
  extract(inputs) {
    const output = builder(this.id, inputs);
    const complete = inputs.filter(
      (input) =>
        input.evidence.key.startsWith('typescript:') &&
        (!input.evidence.truncated ||
          /^typescript:\d+:module:\d+$/.test(input.evidence.key)),
    );
    const first = complete[0];
    if (!first) return output.result();
    const scope = moduleScope(first.document.path);
    const source = output.entity(
      'module',
      moduleName(first.document.path),
      scope,
      [first],
    );
    for (const input of complete) {
      if (!/^\s*(?:import|export)\b/.test(input.evidence.excerpt)) continue;
      const ast = ts.createSourceFile(
        'evidence.ts',
        input.evidence.excerpt,
        ts.ScriptTarget.Latest,
        false,
        ts.ScriptKind.TS,
      );
      for (const statement of ast.statements) {
        if (
          !(
            ts.isImportDeclaration(statement) ||
            ts.isExportDeclaration(statement)
          ) ||
          !statement.moduleSpecifier ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        )
          continue;
        const specifier = statement.moduleSpecifier.text;
        if (!specifier) continue;
        const targetScope = specifier.startsWith('.')
          ? moduleScope(
              posix.normalize(posix.join(posix.dirname(scope), specifier)),
            )
          : `external:${specifier}`;
        if (
          targetScope === scope ||
          (!targetScope.startsWith('external:') &&
            targetScope.split('/')[0] !== scope.split('/')[0])
        )
          continue;
        const target = output.entity(
          'module',
          targetScope.startsWith('external:')
            ? specifier
            : moduleName(targetScope),
          targetScope,
          [input],
        );
        output.relationship('DEPENDS_ON', source, target, [input]);
      }
    }
    return output.result();
  },
};

export const containerExtractor: KnowledgeExtractor = {
  id: 'container-images',
  version: 1,
  supports: (inputs) =>
    inputs[0]?.document.filename.toLowerCase() === 'dockerfile',
  extract(inputs) {
    const output = builder(this.id, inputs);
    for (const input of inputs) {
      if (input.evidence.truncated) continue;
      const match =
        /^FROM\s+(?:(?:--platform=\S+)\s+)?([^\s]+)(?:\s+AS\s+\S+)?/i.exec(
          input.evidence.excerpt,
        );
      const name = match?.[1];
      if (name && name.toLowerCase() !== 'scratch')
        output.entity('container', name, input.document.path, [input]);
    }
    return output.result();
  },
};
