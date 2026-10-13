import type { ReactNode } from 'react';

import {
  apiSchema,
  describeSchemaType,
  OPENAPI_PATH,
  schemaRefName,
  type JsonSchema,
} from '@/lib/openapi-contract';

import { CodeRefLink } from './code-ref-link';
import { useInspector } from './inspector-context';

function referencedNames(schema: JsonSchema): string[] {
  const names: string[] = [];
  const visit = (node: JsonSchema | undefined) => {
    if (!node) return;
    const ref = schemaRefName(node);
    if (ref) names.push(ref);
    if (node.items) visit(node.items);
    for (const list of [node.oneOf, node.anyOf, node.allOf])
      list?.forEach(visit);
  };
  visit(schema);
  return names;
}

function TypeCell({ schema }: { schema: JsonSchema }) {
  const inspector = useInspector();
  const text = describeSchemaType(schema);
  const refs = referencedNames(schema);
  if (refs.length === 0)
    return (
      <code className="break-words text-xs text-muted-foreground">{text}</code>
    );
  const parts: ReactNode[] = [];
  let rest = text;
  refs.forEach((name, index) => {
    const at = rest.indexOf(name);
    if (at === -1) return;
    if (at > 0) parts.push(rest.slice(0, at));
    parts.push(
      <button
        key={`${name}-${index}`}
        type="button"
        className="text-primary hover:underline"
        onClick={() => inspector.open({ kind: 'schema', name })}
      >
        {name}
      </button>,
    );
    rest = rest.slice(at + name.length);
  });
  if (rest) parts.push(rest);
  return (
    <code className="break-words text-xs text-muted-foreground">{parts}</code>
  );
}

function PropertiesTable({ schema }: { schema: JsonSchema }) {
  const required = new Set(schema.required ?? []);
  const properties = Object.entries(schema.properties ?? {});
  if (properties.length === 0) return null;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="py-1.5 pr-3 font-medium">Field</th>
          <th className="py-1.5 font-medium">Type</th>
        </tr>
      </thead>
      <tbody>
        {properties.map(([name, property]) => (
          <tr key={name} className="border-t align-top">
            <td className="py-1.5 pr-3 font-mono text-[13px]">
              {name}
              {required.has(name) && <span className="text-rose-500">*</span>}
            </td>
            <td className="py-1.5">
              <TypeCell schema={property} />
              {property.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {property.description}
                </p>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SchemaBody({ schema }: { schema: JsonSchema }) {
  const variants = schema.oneOf ?? schema.anyOf;
  return (
    <div className="space-y-3">
      {schema.description && (
        <p className="text-sm text-muted-foreground">{schema.description}</p>
      )}
      {!schema.properties && !variants && (
        <p className="text-sm">
          Type: <TypeCell schema={schema} />
        </p>
      )}
      <PropertiesTable schema={schema} />
      {schema.allOf?.map((part, index) => (
        <div key={index} className="rounded-md border p-2">
          <SchemaBody schema={part} />
        </div>
      ))}
      {variants && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            One of {variants.length} variants
          </p>
          {variants.map((variant, index) => {
            const kind = variant.properties?.kind;
            const title =
              schemaRefName(variant) ??
              (kind ? describeSchemaType(kind) : `Variant ${index + 1}`);
            return (
              <details
                key={index}
                className="rounded-md border px-3 py-2"
                open={index === 0}
              >
                <summary className="cursor-pointer font-mono text-sm">
                  {title}
                </summary>
                <div className="mt-2">
                  <SchemaBody schema={variant} />
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SchemaViewer({ name }: { name: string }) {
  const schema = apiSchema(name);
  if (!schema)
    return (
      <p className="text-sm text-amber-600">
        Schema {name} is not in the OpenAPI contract.
      </p>
    );
  return (
    <div className="space-y-4">
      <CodeRefLink
        codeRef={{
          path: OPENAPI_PATH,
          symbol: name,
          kind: 'config',
          label: `components.schemas.${name}`,
          description: 'Defined in the OpenAPI contract',
        }}
        className="border"
      />
      <SchemaBody schema={schema} />
    </div>
  );
}
