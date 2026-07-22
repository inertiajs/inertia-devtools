import { uiStore } from '../stores/ui'

// Expansion state for the props tree lives in the UI store under a `prop:` namespace.
// Exposing it as a composable lets each recursive node read and toggle it directly,
// instead of threading isExpanded/toggle callbacks down through every level.
export function usePropExpansion() {
  const key = (path: string) => `prop:${path}`

  return {
    isExpanded: (path: string) => uiStore.expandedPaths.has(key(path)),
    toggle: (path: string) => uiStore.togglePath(key(path)),
  }
}
