import openApiSource from '../../../../openapi/openapi.json?raw';

/** A JSON Schema fragment as published in `openapi/openapi.json`. */
export type JsonSchema = {
  $ref?: string;
  type?: string | string[];
  format?: string;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  minItems?: number;
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
};

interface OpenApiParameter {
  $ref?: string;
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: JsonSchema }> }
  >;
}

interface OpenApiDocument {
  info: { title: string; version: string };
  paths: Record<string, Record<string, OpenApiOperation | unknown>>;
  components: {
    schemas: Record<string, JsonSchema>;
    parameters?: Record<string, OpenApiParameter>;
  };
}

export interface ApiParameter {
  name: string;
  in: string;
  required: boolean;
  description?: string;
  schema?: JsonSchema;
}

export interface ApiOperation {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  parameters: ApiParameter[];
  /** Success response schema name, when the response references a component. */
  responseSchema?: string;
}

const HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'head',
  'options',
]);

export function parseOpenApi(source: string) {
  const document = JSON.parse(source) as OpenApiDocument;
  const parameterRefs = document.components.parameters ?? {};
  const operations: ApiOperation[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    const shared = ((item as { parameters?: OpenApiParameter[] }).parameters ??
      []) as OpenApiParameter[];
    for (const [method, raw] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method)) continue;
      const operation = raw as OpenApiOperation;
      if (!operation.operationId) continue;
      const parameters = [...shared, ...(operation.parameters ?? [])]
        .map((parameter) =>
          parameter.$ref
            ? parameterRefs[parameter.$ref.split('/').pop() ?? '']
            : parameter,
        )
        .filter(
          (parameter): parameter is OpenApiParameter =>
            parameter?.name !== undefined,
        )
        .map((parameter) => ({
          name: parameter.name!,
          in: parameter.in ?? 'query',
          required: parameter.required ?? false,
          ...(parameter.description
            ? { description: parameter.description }
            : {}),
          ...(parameter.schema ? { schema: parameter.schema } : {}),
        }));
      const success = Object.entries(operation.responses ?? {}).find(
        ([status]) => status.startsWith('2'),
      )?.[1];
      const schema = Object.values(success?.content ?? {})[0]?.schema;
      const responseSchema = schema?.$ref?.split('/').pop();
      operations.push({
        operationId: operation.operationId,
        method: method.toUpperCase(),
        path,
        ...(operation.summary ? { summary: operation.summary } : {}),
        ...(operation.description
          ? { description: operation.description }
          : {}),
        parameters,
        ...(responseSchema ? { responseSchema } : {}),
      });
    }
  }
  return {
    title: document.info.title,
    version: document.info.version,
    operations,
    schemas: document.components.schemas,
  };
}

export const OPENAPI = parseOpenApi(openApiSource);
export const OPENAPI_PATH = 'openapi/openapi.json';

const operationById = new Map(
  OPENAPI.operations.map((operation) => [operation.operationId, operation]),
);

export function apiOperation(operationId: string): ApiOperation | undefined {
  return operationById.get(operationId);
}

export function apiSchema(name: string): JsonSchema | undefined {
  return OPENAPI.schemas[name];
}

export function schemaRefName(schema: JsonSchema): string | undefined {
  return schema.$ref?.startsWith('#/components/schemas/')
    ? schema.$ref.slice('#/components/schemas/'.length)
    : undefined;
}

/** Fastify registers `/a/:id`; OpenAPI documents `/a/{id}`. */
export function routeHandlerSymbol(operation: ApiOperation): string {
  return `text:'${operation.path.replace(/\{(\w+)\}/g, ':$1')}'`;
}

export function describeSchemaType(schema: JsonSchema): string {
  const ref = schemaRefName(schema);
  if (ref) return ref;
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (schema.oneOf || schema.anyOf)
    return (schema.oneOf ?? schema.anyOf ?? [])
      .map(describeSchemaType)
      .join(' | ');
  if (schema.allOf) return schema.allOf.map(describeSchemaType).join(' & ');
  const type = Array.isArray(schema.type)
    ? schema.type.join(' | ')
    : schema.type;
  if (type === 'array' && schema.items)
    return `${describeSchemaType(schema.items)}[]`;
  if (type) return schema.format ? `${type} (${schema.format})` : type;
  if (schema.properties) return 'object';
  return 'any';
}
