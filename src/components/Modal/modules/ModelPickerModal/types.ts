import type { ModelOption, ProviderModelGroup } from "../../../../app/types/index.js";
import type { ActiveProviderSelection } from "../../../../app/store/active-provider.js";

export type ModelPickerModalPayload = {
  activeProvider: ActiveProviderSelection;
  groups: ProviderModelGroup[];
  onCancel?: () => void;
  onSelect(model: ModelOption): void;
};
