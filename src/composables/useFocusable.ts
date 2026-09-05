
export type FocusableState = {
  readonly hasFocus: boolean;
  onBlur: () => void;
  onFocus: () => void;
};

export function useFocusable(onFocusChange: () => void): FocusableState {
  let hasFocus = false;

  function setHasFocus(nextHasFocus: boolean): void {
    if (hasFocus === nextHasFocus) return;

    hasFocus = nextHasFocus;
    onFocusChange();
  }

  return {
    get hasFocus() {
      return hasFocus;
    },
    onBlur: () => setHasFocus(false),
    onFocus: () => setHasFocus(true),
  };
}
