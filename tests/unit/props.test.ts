import { describe, expect, it } from 'vitest'
import {
  buildPropTree,
  collectContainerPaths,
  collectPropExpansionPaths,
  inertiaBadgeClass,
  inertiaBadgeLabel,
  propBadgeLabel,
} from '../../src/panel/lib/props'
import type { PropMeta } from '../../src/types'

describe('inertia badges', () => {
  it('maps known types and falls back to neutral', () => {
    expect(inertiaBadgeClass('defer')).toContain('brand')
    expect(inertiaBadgeClass(null)).toContain('neutral')
    expect(inertiaBadgeLabel('optional')).toBe('Optional')
    expect(inertiaBadgeLabel(null)).toBe('')
  })

  it('folds merge direction and deep-merge into the prop label', () => {
    expect(propBadgeLabel({ inertiaType: 'merge', mergeDirection: 'append' })).toBe('Merge (append)')
    expect(propBadgeLabel({ inertiaType: 'merge', mergeDirection: 'prepend' })).toBe('Merge (prepend)')
    expect(propBadgeLabel({ inertiaType: 'merge', deepMerge: true, mergeDirection: 'append' })).toBe(
      'Deep merge (append)',
    )
    expect(propBadgeLabel({ inertiaType: 'merge', deepMerge: true, mergeDirection: 'prepend' })).toBe(
      'Deep merge (prepend)',
    )
    expect(propBadgeLabel({ inertiaType: 'scroll', mergeDirection: 'append' })).toBe('Scroll (append)')
    expect(propBadgeLabel({ inertiaType: 'defer', deferGroup: 'heavy' })).toBe('Defer (heavy)')
    expect(propBadgeLabel({ inertiaType: 'merge' })).toBe('Merge')
    expect(propBadgeLabel(null)).toBe('')
  })
})

describe('buildPropTree', () => {
  it('nests dotted paths and creates intermediate nodes without meta', () => {
    const tree = buildPropTree({
      'user.name': { shared: false },
      'user.tags.0': {},
      'user.tags.1': {},
    })

    expect(tree).toHaveLength(1)
    expect(tree[0].segment).toBe('user')
    expect(tree[0].meta).toBeNull()

    const tags = tree[0].children.find((node) => node.segment === 'tags')!
    expect(tags.meta).toBeNull()
    expect(tags.children.map((node) => node.segment)).toEqual(['0', '1'])
  })

  it('orders array indices numerically, not lexically', () => {
    const tree = buildPropTree({
      'list.2': {},
      'list.10': {},
      'list.1': {},
    })

    expect(tree[0].children.map((node) => node.segment)).toEqual(['1', '2', '10'])
  })
})

describe('collectContainerPaths', () => {
  it('collects nested non-empty containers, excluding the root and empties', () => {
    const value = {
      user: { name: 'Alice', roles: ['admin'] },
      empty: {},
      scalar: 1,
    }

    const paths = collectContainerPaths(value, 'root')

    expect(paths).toContain('root.user')
    expect(paths).toContain('root.user.roles')
    expect(paths).not.toContain('root')
    expect(paths).not.toContain('root.empty')
    expect(paths).not.toContain('root.scalar')
  })
})

describe('collectPropExpansionPaths', () => {
  it('expands meta children and value containers with the right key prefixes', () => {
    const props: Record<string, PropMeta> = {
      'user.name': { shared: false },
      list: {},
    }
    const values = {
      list: [{ id: 1 }, { id: 2 }],
    }

    const paths = collectPropExpansionPaths(props, values)

    expect(paths).toContain('prop:user')
    expect(paths).toContain('prop:list')
    expect(paths).toContain('propvalue:list.0')
    expect(paths).toContain('propvalue:list.1')
  })
})
