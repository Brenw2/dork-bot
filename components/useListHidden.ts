import { useSyncExternalStore } from 'react';

// Whether the two-pane view has its bot list tucked away. Kept for the life of the app, so it
// survives opening a pop-up or rotating, and it's per device (a layout choice, not a bot setting).
let hidden = false;
const listeners = new Set<() => void>();

export function setListHidden(next: boolean): void {
  if (next === hidden) return;
  hidden = next;
  for (const l of listeners) l();
}

export function useListHidden(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hidden,
  );
}
