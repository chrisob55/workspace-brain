import type { KnowledgeExtractor } from './framework.js';
import {
  CandidateBuilder,
  decodePointer,
  scalarKey,
  stringScalar,
} from './framework.js';

export const openApiExtractor: KnowledgeExtractor = {
  id: 'openapi-operations',
  version: 1,
  supports: (inputs) =>
    inputs.some((input) => scalarKey(input) === '/openapi') ||
    ((inputs[0]?.documentVersion.processorVersion ?? 3) < 3 &&
      /(?:openapi|swagger)(?:\.|$)/i.test(inputs[0]?.document.filename ?? '')),
  extract(inputs) {
    const first = inputs[0];
    const legacy = (first?.documentVersion.processorVersion ?? 3) < 3;
    const output = new CandidateBuilder(
      legacy ? 'deterministic-knowledge-extractors' : this.id,
      1,
    );
    const scalars = new Map(
      inputs
        .filter(
          (input) =>
            /^(?:json|yaml):/.test(input.evidence.key) &&
            stringScalar(input, inputs),
        )
        .map((input) => [scalarKey(input), input]),
    );
    const title = scalars.get('/info/title');
    const version = scalars.get('/info/version');
    const marker = scalars.get('/openapi');
    if (legacy && title) {
      output.entity('api', title.evidence.excerpt, title.document.path, [
        title,
      ]);
      return output.result();
    }
    if (
      !title?.evidence.excerpt.trim() ||
      !version?.evidence.excerpt.trim() ||
      !marker ||
      !/^3\.\d+\.\d+(?:[-+].*)?$/.test(marker.evidence.excerpt)
    ) {
      const rejected = inputs.find((input) => scalarKey(input) === '/openapi');
      if (rejected)
        output.diagnose(
          rejected,
          'rejected',
          'OPENAPI_3_TITLE_AND_VERSION_REQUIRED',
          rejected.evidence.excerpt,
        );
      return output.result();
    }
    const api = output.entity(
      'api',
      title.evidence.excerpt,
      title.document.path,
      [title, version, marker],
    );
    const operationIds = new Map<string, number>();
    for (const [key, input] of scalars) {
      if (
        /^\/paths\/[^/]+\/(?:get|put|post|delete|options|head|patch|trace)\/operationId$/.test(
          key,
        )
      ) {
        operationIds.set(
          input.evidence.excerpt,
          (operationIds.get(input.evidence.excerpt) ?? 0) + 1,
        );
      }
    }
    for (const [key, input] of scalars) {
      const match =
        /^\/paths\/([^/]+)\/(get|put|post|delete|options|head|patch|trace)\/operationId$/.exec(
          key,
        );
      if (!match) continue;
      if (
        !input.evidence.excerpt.trim() ||
        operationIds.get(input.evidence.excerpt) !== 1
      ) {
        output.diagnose(
          input,
          'rejected',
          'OPERATION_ID_EMPTY_OR_AMBIGUOUS',
          input.evidence.excerpt,
        );
        continue;
      }
      const path = decodePointer(match[1] ?? '');
      if (!path.startsWith('/')) continue;
      const method = (match[2] ?? '').toUpperCase();
      const facts = {
        operationId: input.evidence.excerpt,
        path,
        method,
        version: version.evidence.excerpt,
      };
      const operation = output.entity(
        'operation',
        input.evidence.excerpt,
        `${input.document.path}/operations/${encodeURIComponent(method + ':' + path)}`,
        [input, marker, version],
        { facts },
      );
      output.relationship('EXPOSES', api, operation, [input, marker, version], {
        facts,
      });
    }
    return output.result();
  },
};
