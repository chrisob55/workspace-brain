import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { WorkspaceBrainClient } from '../client/workspace-brain-client.js';
import {
  callApi,
  pageShape,
  publicationIdSchema,
  readOnlyAnnotations,
} from './shared.js';

const searchText = z.string().trim().min(1).max(256);
const journeyIdSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .describe('Stable deterministic Journey ID returned by search_journeys.');

const SEARCH_PREVIEW_LIMIT = 5;
const PROVENANCE_PREVIEW_LIMIT = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Journey search response has an invalid ${field}.`);
  }
  return value;
}

function requiredArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Journey search response has an invalid ${field}.`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Journey search response has an invalid ${field}.`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  field: string,
  context: string,
): Record<string, string> {
  if (record[field] === undefined) return {};
  return { [field]: requiredString(record[field], `${context}.${field}`) };
}

function compactStep(value: unknown, index: number): Record<string, unknown> {
  const step = requiredRecord(value, `journey.steps[${index}]`);
  const preview: Record<string, unknown> = {
    id: requiredString(step.id, `journey.steps[${index}].id`),
    type: requiredString(step.type, `journey.steps[${index}].type`),
    order: requiredString(step.order, `journey.steps[${index}].order`),
  };
  if (step.subject !== undefined) {
    preview.subject = compactEntityReference(step.subject);
  }
  for (const field of [
    'route',
    'controller',
    'service',
    'component',
    'connector',
    'target',
    'targetExpression',
    'method',
    'reason',
    'evidenceBasis',
    'evidenceRef',
    'stepEntityId',
  ]) {
    if (typeof step[field] === 'string') {
      preview[field] = step[field];
    } else if (step[field] !== undefined) {
      throw new Error(
        `Journey search response has an invalid journey.steps[${index}].${field}.`,
      );
    }
  }
  const provenance = requiredArray(
    step.provenance,
    `journey.steps[${index}].provenance`,
  );
  preview.provenance = provenance.slice(0, PROVENANCE_PREVIEW_LIMIT);
  preview.provenanceReferenceCount = provenance.length;
  if (step.entityReferences !== undefined) {
    preview.entityReferences = compactEntityReferences(step.entityReferences);
  }
  return preview;
}

function compactEntityReferences(value: unknown): unknown[] {
  return requiredArray(value, 'entityReferences').map(compactEntityReference);
}

function compactEntityReference(item: unknown): unknown {
  const reference = requiredRecord(item, 'entityReference');
  if (reference.entityId === undefined) return reference;
  return {
    entityId: requiredString(reference.entityId, 'entityReference.entityId'),
    entityType: requiredString(
      reference.entityType,
      'entityReference.entityType',
    ),
    displayName: requiredString(
      reference.displayName,
      'entityReference.displayName',
    ),
    publicationId: requiredString(
      reference.publicationId,
      'entityReference.publicationId',
    ),
    role: requiredString(reference.role, 'entityReference.role'),
  };
}

function compactJourneySearchResponse(body: unknown): unknown {
  const response = requiredRecord(body, 'response');
  const items = requiredArray(response.items, 'items');
  if (response.nextCursor !== null && typeof response.nextCursor !== 'string') {
    throw new Error('Journey search response has an invalid nextCursor.');
  }

  return {
    items: items.map((value, index) => {
      const item = requiredRecord(value, `items[${index}]`);
      const journey = requiredRecord(item.journey, `items[${index}].journey`);
      const steps = requiredArray(
        journey.steps,
        `items[${index}].journey.steps`,
      );
      const provenance = requiredArray(
        journey.provenance,
        `items[${index}].journey.provenance`,
      );
      const unresolvedBoundaries = requiredArray(
        journey.unresolvedBoundaries,
        `items[${index}].journey.unresolvedBoundaries`,
      );
      const diagnostics =
        journey.diagnostics === undefined
          ? []
          : requiredArray(
              journey.diagnostics,
              `items[${index}].journey.diagnostics`,
            );
      const sourceEvidenceIds = requiredArray(
        item.sourceEvidenceIds,
        `items[${index}].sourceEvidenceIds`,
      );
      const entityReferences = requiredArray(
        journey.entityReferences,
        `items[${index}].journey.entityReferences`,
      );
      const relationshipReferences = requiredArray(
        journey.relationshipReferences,
        `items[${index}].journey.relationshipReferences`,
      );
      if (
        journey.description !== undefined &&
        typeof journey.description !== 'string'
      ) {
        throw new Error(
          `Journey search response has an invalid items[${index}].journey.description.`,
        );
      }

      return {
        publicationId: requiredString(
          item.publicationId,
          `items[${index}].publicationId`,
        ),
        journeyEntityId: requiredString(
          item.journeyEntityId,
          `items[${index}].journeyEntityId`,
        ),
        journeyId: requiredString(item.journeyId, `items[${index}].journeyId`),
        sourceEvidenceIds: sourceEvidenceIds.slice(0, PROVENANCE_PREVIEW_LIMIT),
        sourceEvidenceCount: sourceEvidenceIds.length,
        journey: {
          id: requiredString(journey.id, `items[${index}].journey.id`),
          name: requiredString(journey.name, `items[${index}].journey.name`),
          ...(journey.description !== undefined
            ? { description: journey.description }
            : {}),
          sourceServices: requiredArray(
            journey.sourceServices,
            `items[${index}].journey.sourceServices`,
          ),
          confidence: requiredString(
            journey.confidence,
            `items[${index}].journey.confidence`,
          ),
          completeness: requiredString(
            journey.completeness,
            `items[${index}].journey.completeness`,
          ),
          stepCount: steps.length,
          stepPreview: steps.slice(0, SEARCH_PREVIEW_LIMIT).map(compactStep),
          stepsTruncated: steps.length > SEARCH_PREVIEW_LIMIT,
          transitionsOmitted: true,
          provenance: provenance.slice(0, PROVENANCE_PREVIEW_LIMIT),
          provenanceReferenceCount: provenance.length,
          unresolvedBoundaries: unresolvedBoundaries.slice(
            0,
            SEARCH_PREVIEW_LIMIT,
          ),
          unresolvedBoundaryCount: unresolvedBoundaries.length,
          diagnostics: diagnostics.slice(0, SEARCH_PREVIEW_LIMIT),
          diagnosticCount: diagnostics.length,
          entityReferences: compactEntityReferences(entityReferences),
          relationshipReferences: relationshipReferences.map((item) => {
            const reference = requiredRecord(item, 'relationshipReference');
            if (reference.relationshipId === undefined) return reference;
            return {
              relationshipId: requiredString(
                reference.relationshipId,
                'relationshipReference.relationshipId',
              ),
              type: requiredString(
                reference.type,
                'relationshipReference.type',
              ),
              sourceEntityId: requiredString(
                reference.sourceEntityId,
                'relationshipReference.sourceEntityId',
              ),
              targetEntityId: requiredString(
                reference.targetEntityId,
                'relationshipReference.targetEntityId',
              ),
              ...optionalString(
                reference,
                'sourceDisplayName',
                'relationshipReference',
              ),
              ...optionalString(
                reference,
                'targetDisplayName',
                'relationshipReference',
              ),
              publicationId: requiredString(
                reference.publicationId,
                'relationshipReference.publicationId',
              ),
            };
          }),
        },
      };
    }),
    nextCursor: response.nextCursor,
  };
}

export function registerJourneyTools(
  server: McpServer,
  client: WorkspaceBrainClient,
): void {
  server.registerTool(
    'search_journeys',
    {
      title: 'Search Published Journeys',
      description:
        'Search Journey records from immutable Knowledge Publications by literal text, API-name text, or connector-name text. Results contain a compact preview where each step subject names the published entity it acts on (use subject.displayName when describing the Journey to people), completeness, unresolved boundaries, diagnostics, provenance and graph references with entityId, entityType, displayName and publicationId. Use get_published_entity and list_relationships_for_entity with those IDs for graph traversal. Use get_journey for all recorded steps and transitions. Legacy publications can contain unresolved candidate references. Text matching does not prove a binding or runtime execution. Pin publicationId for reproducible reads. Returns { items, nextCursor }.',
      inputSchema: {
        query: searchText.optional().describe('Literal Journey text search.'),
        api: searchText
          .optional()
          .describe('Searches for this literal API-name text.'),
        connector: searchText
          .optional()
          .describe('Searches for this literal connector-name text.'),
        publicationId: publicationIdSchema.optional(),
        ...pageShape,
      },
      annotations: readOnlyAnnotations,
    },
    (args) =>
      callApi(() => client.searchJourneys(args), compactJourneySearchResponse),
  );

  server.registerTool(
    'get_journey',
    {
      title: 'Get Published Journey',
      description:
        'Retrieve one Journey by its deterministic Journey ID from an immutable Knowledge Publication. Includes static steps (each with a subject naming the published entity it acts on), transitions (with fromSubject/toSubject), confidence, completeness, unresolved boundaries, provenance, and publication-pinned entity/relationship IDs with display names. Describe steps to people by subject.displayName, keeping entityId for follow-up reads. Follow entityReferences using get_published_entity and list_relationships_for_entity with the reference publicationId. Legacy publications retain unresolved candidate references. This is static source analysis, not an observed runtime trace.',
      inputSchema: {
        publicationId: publicationIdSchema,
        journeyId: journeyIdSchema,
      },
      annotations: readOnlyAnnotations,
    },
    ({ publicationId, journeyId }) =>
      callApi(() => client.getJourney(publicationId, journeyId)),
  );

  server.registerTool(
    'get_service_journeys',
    {
      title: 'Get Journeys for a Service',
      description:
        'Find published Journey records whose searchable text contains the specified service text. Results include recorded steps, completeness, unresolved boundaries, provenance and graph references with entityId, entityType, displayName and publicationId for get_published_entity and list_relationships_for_entity. Text matching is not a graph binding or runtime trace. Returns { items, nextCursor }.',
      inputSchema: {
        service: searchText.describe(
          'Literal service identity or FQN text as represented in the Journey.',
        ),
        publicationId: publicationIdSchema.optional(),
        ...pageShape,
      },
      annotations: readOnlyAnnotations,
    },
    (args) =>
      callApi(() =>
        client.searchJourneys({
          ...args,
          service: args.service,
        }),
      ),
  );
}
