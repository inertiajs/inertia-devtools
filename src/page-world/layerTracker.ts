import type { LayerChangeTarget, LayerSnapshot, PageStateSnapshot } from '../types'

export type TrackedPage = {
  component: string | null
  url: string
  props: Record<string, unknown>
  layers: LayerSnapshot[] | undefined
}

export type LayerChange = { kind: 'open' | 'close'; layers: LayerChangeTarget[] }

// Each of these means the change already belongs to somebody else's row.
type NavigateContext = { cached: boolean; hasVisitId: boolean; requestActive: boolean }

function layerTarget(layer: LayerSnapshot): LayerChangeTarget {
  return { id: layer.id, key: layer.key, component: layer.component }
}

// A layer appearing only counts when it has no url: a routed one is opened by its own request.
function describeLayerChange(previous: LayerSnapshot[], current: LayerSnapshot[]): LayerChange | null {
  const open = new Set(current.map((layer) => layer.id))
  const closed = previous.filter((layer) => !open.has(layer.id))

  if (closed.length > 0) {
    return { kind: 'close', layers: closed.map(layerTarget) }
  }

  const known = new Set(previous.map((layer) => layer.id))
  const opened = current.filter((layer) => !known.has(layer.id) && layer.url === null)

  return opened.length > 0 ? { kind: 'open', layers: opened.map(layerTarget) } : null
}

// A dev build announces changes through core's registry (`announced`); other builds get the `navigated` diff.
export function createLayerTracker() {
  let layers: LayerSnapshot[] = []
  let page: { component: string | null; url: string; props: Record<string, unknown> } = {
    component: null,
    url: '',
    props: {},
  }
  let hookActive = false
  let booted = false
  let closePending = false

  function remember(next: TrackedPage): void {
    page = { component: next.component, url: next.url, props: next.props }
    layers = next.layers ?? []
  }

  return {
    navigated(next: TrackedPage, context: NavigateContext): LayerChange | null {
      const previous = layers

      booted = true
      remember(next)

      if (context.cached || hookActive || context.hasVisitId || context.requestActive) {
        return null
      }

      const change = describeLayerChange(previous, layers)

      if (change === null) {
        return null
      }

      if (change.kind === 'close' && closePending) {
        closePending = false

        return null
      }

      return change
    },

    announced(kind: LayerChange['kind'], layer: LayerSnapshot, requestActive: boolean): LayerChange | null {
      const without = layers.filter((existing) => existing.id !== layer.id)

      layers = kind === 'open' ? [...without, layer] : without

      // A running request owns the row for whatever its response installs.
      if (!booted || requestActive) {
        return null
      }

      // One close instruction drops a run of layers in one write; the mark covers the burst.
      if (kind === 'close' && closePending) {
        queueMicrotask(() => {
          closePending = false
        })

        return null
      }

      return { kind, layers: [layerTarget(layer)] }
    },

    // A client visit makes no request, so its tier is the layer whose props changed.
    clientVisited(next: TrackedPage): string | undefined {
      let wroteTo: string | undefined

      for (const layer of next.layers ?? []) {
        const before = layers.find((previous) => previous.id === layer.id)

        if (before && JSON.stringify(before.props) !== JSON.stringify(layer.props)) {
          wroteTo = layer.key
          break
        }
      }

      remember(next)

      return wroteTo
    },

    pageInstalled(closesALayer: boolean): void {
      closePending = closesALayer
    },

    hookRegistered(): void {
      hookActive = true
    },

    keyById(id: string): string | undefined {
      return layers.find((layer) => layer.id === id)?.key
    },

    pageState(): PageStateSnapshot {
      return {
        ...page,
        ...(layers.length > 0 ? { layers } : {}),
        timestamp: Date.now(),
      }
    },
  }
}
