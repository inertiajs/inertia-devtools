import type { PropMeta, PropType } from '../../types'
import { isNonEmptyContainer } from './values'

export type { PropMeta }

export type PropNode = {
  path: string
  segment: string
  meta: PropMeta | null
  children: PropNode[]
}

const NEUTRAL_BADGE = 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300'

const PROP_TYPE_BADGE: Record<PropType, string> = {
  always: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  defer: 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300',
  once: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  optional: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  merge: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  scroll: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
}

export function inertiaBadgeClass(type: PropType | null | undefined): string {
  return type ? PROP_TYPE_BADGE[type] : NEUTRAL_BADGE
}

export function inertiaBadgeLabel(type: PropType | null | undefined): string {
  if (!type) {
    return ''
  }

  return type.charAt(0).toUpperCase() + type.slice(1)
}

// The pill label for a prop, folding in the deep-merge kind and append/prepend direction.
// A merge prop reads "Merge (append)"; a deep merge "Deep merge (prepend)"; a scroll prop
// "Scroll (append)"; a deferred prop keeps its "Defer (group)" form.
export function propBadgeLabel(meta: PropMeta | null | undefined): string {
  const type = meta?.inertiaType

  if (!type) {
    return ''
  }

  let label = type === 'merge' && meta?.deepMerge ? 'Deep merge' : inertiaBadgeLabel(type)

  if (meta?.mergeDirection) {
    label += ` (${meta.mergeDirection})`
  } else if (meta?.deferGroup) {
    label += ` (${meta.deferGroup})`
  }

  return label
}

function compareSegments(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)

  if (aNumeric && bNumeric) {
    return Number(a) - Number(b)
  }

  return a.localeCompare(b)
}

// Order dotted prop paths so array indices sort numerically and shallower paths come first.
function comparePropPaths(a: string, b: string): number {
  const aSegments = a.split('.')
  const bSegments = b.split('.')
  const length = Math.min(aSegments.length, bSegments.length)

  for (let i = 0; i < length; i++) {
    const diff = compareSegments(aSegments[i], bSegments[i])

    if (diff !== 0) {
      return diff
    }
  }

  return aSegments.length - bSegments.length
}

// Expand a flat path -> meta map (keys like `user.tags.0`) into a nested tree,
// creating intermediate nodes for path segments that have no meta of their own.
export function buildPropTree(propsByPath: Record<string, PropMeta>): PropNode[] {
  const root: PropNode = { path: '', segment: '', meta: null, children: [] }
  const lookup = new Map<string, PropNode>()
  lookup.set('', root)

  for (const path of Object.keys(propsByPath).sort(comparePropPaths)) {
    const segments = path.split('.')
    let parentKey = ''

    segments.forEach((segment, index) => {
      const key = segments.slice(0, index + 1).join('.')

      if (!lookup.has(key)) {
        const node: PropNode = { path: key, segment, meta: null, children: [] }

        lookup.get(parentKey)!.children.push(node)
        lookup.set(key, node)
      }

      parentKey = key
    })

    lookup.get(path)!.meta = propsByPath[path] ?? null
  }

  return root.children
}

// Every toggleable container path within a value tree, mirroring how PropsValueTree
// builds child paths (`${path}.${key}`). The root container itself is always rendered
// open, so it is excluded; every nested object/array is included.
export function collectContainerPaths(value: unknown, rootPath: string): string[] {
  const paths: string[] = []

  const walk = (val: unknown, path: string, isRoot: boolean): void => {
    if (!isNonEmptyContainer(val)) {
      return
    }

    const entries = Array.isArray(val)
      ? val.map((item, index) => [index, item] as const)
      : Object.entries(val as Record<string, unknown>)

    // Empty containers are not expandable, so they are not part of the toggle set.
    if (!isRoot) {
      paths.push(path)
    }

    for (const [key, child] of entries) {
      walk(child, `${path}.${key}`, false)
    }
  }

  walk(value, rootPath, true)

  return paths
}

// Every expandable path in the props meta tree. A node expands either because it has
// meta children (`prop:` key) or because its recorded value is a non-empty container,
// whose nested containers use the `propvalue:` value-tree keys.
export function collectPropExpansionPaths(
  propsByPath: Record<string, PropMeta>,
  propValues: Record<string, unknown>,
): string[] {
  const paths: string[] = []

  const walk = (nodes: PropNode[]): void => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        paths.push(`prop:${node.path}`)
        walk(node.children)

        continue
      }

      const value = propValues[node.path]

      if (isNonEmptyContainer(value)) {
        paths.push(`prop:${node.path}`, ...collectContainerPaths(value, `propvalue:${node.path}`))
      }
    }
  }

  walk(buildPropTree(propsByPath))

  return paths
}
