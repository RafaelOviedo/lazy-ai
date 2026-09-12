import type { ModelOption, ProviderModelGroup } from "../../../../entities/ai-model/index.js";
import type { ActiveProviderSelection } from "../../../../entities/provider/index.js";

export type ModelPickerModalPayload = {
  activeProvider: ActiveProviderSelection;
  groups: ProviderModelGroup[];
  onCancel?: () => void;
  onSelect(model: ModelOption): void;
};
