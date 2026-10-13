import { Loader2, Play } from 'lucide-react';
import { useState } from 'react';

import { useKnowledgeState } from '@/app-context';
import { api } from '@/lib/api';
import { exampleRequestPath, isRunnable } from '@/lib/how-it-works/requests';
import {
  apiOperation,
  describeSchemaType,
  routeHandlerSymbol,
} from '@/lib/openapi-contract';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { CodeRefLink } from './code-ref-link';
import { useInspector } from './inspector-context';
import { JsonViewer } from './json-viewer';

export const API_SERVER_PATH = 'apps/workspace-brain-api/src/server.ts';

export function ApiOperationView({
  operationId,
  entityId,
}: {
  operationId: string;
  entityId?: string;
}) {
  const { graph, source } = useKnowledgeState();
  const inspector = useInspector();
  const [result, setResult] = useState<
    | { status: 'loading' }
    | { status: 'done'; value: unknown }
    | { status: 'error'; message: string }
  >();
  const operation = apiOperation(operationId);
  if (!operation)
    return (
      <p className="text-sm text-amber-600">
        Operation {operationId} is not in the OpenAPI contract.
      </p>
    );
  const path = exampleRequestPath(operation, graph, entityId);
  const run = async () => {
    setResult({ status: 'loading' });
    try {
      setResult({ status: 'done', value: await api.request(path) });
    } catch (error) {
      setResult({ status: 'error', message: (error as Error).message });
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="font-mono">{operation.method}</Badge>
        <code className="break-all font-mono text-sm">{operation.path}</code>
      </div>
      {operation.summary && <p className="text-sm">{operation.summary}</p>}
      {operation.description && (
        <p className="text-sm text-muted-foreground">{operation.description}</p>
      )}
      <div className="grid gap-1">
        <CodeRefLink
          codeRef={{
            path: API_SERVER_PATH,
            symbol: routeHandlerSymbol(operation),
            kind: 'function',
            label: `Route handler · ${operation.operationId}`,
            description: API_SERVER_PATH,
          }}
          className="border"
        />
        <CodeRefLink
          codeRef={{
            path: 'openapi/openapi.json',
            symbol: `text:"operationId": "${operation.operationId}"`,
            kind: 'config',
            label: `OpenAPI · ${operation.operationId}`,
            description: 'openapi/openapi.json',
          }}
          className="border"
        />
      </div>
      {operation.parameters.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Parameters
          </h4>
          <ul className="divide-y rounded-md border text-sm">
            {operation.parameters.map((parameter) => (
              <li
                key={`${parameter.in}-${parameter.name}`}
                className="px-3 py-1.5"
              >
                <span className="font-mono">{parameter.name}</span>
                {parameter.required && (
                  <span className="text-rose-500">*</span>
                )}{' '}
                <span className="text-xs text-muted-foreground">
                  {parameter.in}
                  {parameter.schema
                    ? ` · ${describeSchemaType(parameter.schema)}`
                    : ''}
                </span>
                {parameter.description && (
                  <p className="text-xs text-muted-foreground">
                    {parameter.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {operation.responseSchema && (
        <p className="text-sm">
          Responds with{' '}
          <button
            type="button"
            className="font-mono text-primary hover:underline"
            onClick={() =>
              inspector.open({
                kind: 'schema',
                name: operation.responseSchema!,
              })
            }
          >
            {operation.responseSchema}
          </button>
        </p>
      )}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Example request (from the loaded publication)
        </h4>
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
          curl http://localhost:3000{path}
        </pre>
        {source === 'live' && isRunnable(path) ? (
          <Button
            size="sm"
            onClick={() => void run()}
            disabled={result?.status === 'loading'}
          >
            {result?.status === 'loading' ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Play />
            )}
            Run request
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            {source === 'live'
              ? 'This request needs identifiers that are not in the loaded publication.'
              : 'Start the platform (pnpm dev) to run this request live; the explorer is showing the bundled snapshot.'}
          </p>
        )}
        {result?.status === 'error' && (
          <p className="text-sm text-rose-600">{result.message}</p>
        )}
        {result?.status === 'done' && (
          <JsonViewer value={result.value} expandDepth={1} />
        )}
      </div>
    </div>
  );
}
