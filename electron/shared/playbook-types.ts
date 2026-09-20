export const MAX_TEMPLATE_NAME_LENGTH = 120;
export const MAX_PROMPT_LENGTH = 20_000;

export interface PromptTemplateInput {
  name: string;
  text: string;
}

export interface PromptTemplate extends PromptTemplateInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptCandidate {
  id: string;
  text: string;
  sessionCount: number;
}

export interface PromptCandidates {
  candidates: PromptCandidate[];
  scannedSessions: number;
  /** Some sessions could not be read or a resource cap stopped the scan. */
  truncated: boolean;
  skippedSessions?: number;
}
