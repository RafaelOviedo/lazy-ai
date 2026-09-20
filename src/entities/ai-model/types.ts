import type { ProviderId } from "../provider/types.js";

export type ModelOption = {
  id: string;
  providerId: ProviderId;
  label: string;
  description?: string;
  defaultEffort?: string;
  supportedEfforts?: string[];
  contextWindow?: number;
};

export type ProviderModelGroup = {
  providerId: ProviderId;
  label: string;
  models: ModelOption[];
};
