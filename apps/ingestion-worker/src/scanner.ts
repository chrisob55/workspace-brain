import type { Source } from '@workspace-brain/domain';

export type ScanResult = {
  readonly discoveredRepositories: number;
  readonly discoveredDocuments: number;
};

export interface SourceScanner {
  scan(source: Source, correlationId: string): Promise<ScanResult>;
}
