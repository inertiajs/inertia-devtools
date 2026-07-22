import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isEntry } from '../../src/guards'
import navigateFixture from './entry.navigate.json'

// `entry.navigate.json` is a verbatim capture of the shape produced by the PHP package's
// `Inertia\DevTools\Data\IncomingEntry::toArray()`. It is the documented reference payload
// for the wire contract.
//
// The wire contract has three representations that must stay in lockstep: the spec below
// (the source of truth), the TypeScript `Entry` type (src/types.ts), and the reference PHP
// adapter's `IncomingEntry`. This file parses all three and asserts they agree, so a field
// or enum value added to one without the others fails CI.
//
// There is deliberately no runtime contract validator in production code: a forward-compatible
// server that adds fields must never have its entries dropped. The parity checks here run
// only in the test build; the shipped ingest guard (`isEntry`) stays loose on purpose.

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '../..')

const typesSource = readFileSync(resolve(pkgRoot, 'src/types.ts'), 'utf8')

// The reference PHP adapter is a sibling checkout on dev machines but absent in the JS-only
// CI checkout. When present we assert its shape too; when absent the JS-side parity still runs.
const phpRoot = [process.env.INERTIA_LARAVEL_DEVTOOLS_PATH, resolve(pkgRoot, '../inertia-laravel-devtools')].find(
  (candidate) => candidate && existsSync(resolve(candidate, 'src/DevTools/Data/IncomingEntry.php')),
)

const hasPhp = typeof phpRoot === 'string'

// ---------------------------------------------------------------------------
// The spec: the single source of truth every representation is checked against.
// ---------------------------------------------------------------------------

const META_REQUIRED = [
  'id',
  'method',
  'url',
  'status',
  'requestType',
  'component',
  'timestamp',
  'utime',
  'tabUuid',
  'batchId',
]

const META_OPTIONAL = ['serverTimingMs', 'redirectLocation', 'visitId']

const TOP_LEVEL_KEYS = ['__meta', 'http', 'props', 'propValues', 'route', 'renderSource', 'componentPath']

// Request types an adapter emits on the wire. The two synthetic client-only types
// (client-visit, cache-hit) are produced by the extension, never by an adapter, so they
// live in the TS union but must not appear in the PHP enum or the section 5 table.
const ADAPTER_REQUEST_TYPES = ['navigate', 'partial', 'deferred', 'poll', 'prefetch', 'initial', 'http', 'precognition']

const CLIENT_ONLY_REQUEST_TYPES = ['client-visit', 'cache-hit']

const PROP_TYPES = ['always', 'defer', 'optional', 'merge', 'scroll', 'once']

// ---------------------------------------------------------------------------
// Parsers: extract each representation's view of the contract from its source.
// ---------------------------------------------------------------------------

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)

  if (from === -1 || to === -1) {
    throw new Error(`Could not slice source between "${start}" and "${end}"`)
  }

  return source.slice(from + start.length, to)
}

function quotedTokens(block: string): string[] {
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

function tsUnionValues(typeName: string): string[] {
  const marker = `export type ${typeName} =`
  const start = typesSource.indexOf(marker)

  if (start === -1) {
    throw new Error(`Type ${typeName} not found in types.ts`)
  }

  // A union runs until the next top-level `export type` declaration.
  const rest = typesSource.slice(start + marker.length)
  const nextExport = rest.indexOf('\nexport ')
  const block = nextExport === -1 ? rest : rest.slice(0, nextExport)

  return quotedTokens(block)
}

function tsObjectFieldNames(typeName: string): string[] {
  const block = sliceBetween(typesSource, `export type ${typeName} = {`, '\n}')

  return [...block.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((match) => match[1])
}

function phpEnumValues(file: string): string[] {
  const contents = readFileSync(resolve(phpRoot!, 'src/DevTools/Data', file), 'utf8')

  return [...contents.matchAll(/case\s+\w+\s*=\s*'([^']+)'/g)].map((match) => match[1])
}

function phpArrayKeys(block: string): string[] {
  return [...block.matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'\s*=>/g)].map((match) => match[1])
}

// ---------------------------------------------------------------------------
// 1. Positive parity: all four representations agree with the spec.
// ---------------------------------------------------------------------------

describe('entry wire contract parity', () => {
  it('the reference server payload passes the ingest guard', () => {
    expect(isEntry(navigateFixture)).toBe(true)
  })

  it('the reference fixture has exactly the spec top-level keys and __meta fields', () => {
    const fixture = navigateFixture as Record<string, unknown>

    expect(Object.keys(fixture).sort()).toEqual([...TOP_LEVEL_KEYS].sort())

    const meta = fixture.__meta as Record<string, unknown>

    for (const field of META_REQUIRED) {
      expect(meta, `__meta.${field} missing from fixture`).toHaveProperty(field)
    }

    const allowed = new Set([...META_REQUIRED, ...META_OPTIONAL, 'consumedAt', 'clientVisitMode'])

    for (const key of Object.keys(meta)) {
      expect(allowed.has(key), `__meta.${key} in fixture is not in the spec`).toBe(true)
    }
  })

  it('the TypeScript EntryMeta type declares every spec field', () => {
    const fields = tsObjectFieldNames('EntryMeta')

    for (const field of [...META_REQUIRED, ...META_OPTIONAL]) {
      expect(fields, `EntryMeta.${field} missing from types.ts`).toContain(field)
    }
  })

  it('the TypeScript Entry type declares every spec top-level key', () => {
    const fields = tsObjectFieldNames('Entry')

    for (const key of TOP_LEVEL_KEYS) {
      expect(fields, `Entry.${key} missing from types.ts`).toContain(key)
    }
  })

  it('the TypeScript RequestType union is the adapter types plus the client-only synthetics', () => {
    expect(tsUnionValues('RequestType').sort()).toEqual([...ADAPTER_REQUEST_TYPES, ...CLIENT_ONLY_REQUEST_TYPES].sort())
  })

  it('the TypeScript PropType union matches the spec', () => {
    expect(tsUnionValues('PropType').sort()).toEqual([...PROP_TYPES].sort())
  })

  it.skipIf(!hasPhp)('the PHP IncomingEntry::toArray() emits exactly the spec keys', () => {
    const php = readFileSync(resolve(phpRoot!, 'src/DevTools/Data/IncomingEntry.php'), 'utf8')

    const toArray = sliceBetween(php, 'public function toArray(): array', '\n    }')
    const metaBlock = sliceBetween(toArray, "'__meta' => [", '],')

    const metaKeys = phpArrayKeys(metaBlock)

    for (const field of [...META_REQUIRED, ...META_OPTIONAL]) {
      expect(metaKeys, `PHP __meta.${field} missing`).toContain(field)
    }

    const topLevelBlock = toArray.slice(toArray.indexOf('],', toArray.indexOf("'__meta'")) + 2)
    const topLevelKeys = phpArrayKeys(topLevelBlock)

    for (const key of TOP_LEVEL_KEYS.filter((key) => key !== '__meta')) {
      expect(topLevelKeys, `PHP top-level ${key} missing`).toContain(key)
    }
  })

  it.skipIf(!hasPhp)('the PHP RequestType enum matches the adapter request types', () => {
    expect(phpEnumValues('RequestType.php').sort()).toEqual([...ADAPTER_REQUEST_TYPES].sort())
  })

  it.skipIf(!hasPhp)('the PHP PropType enum matches the spec prop types', () => {
    expect(phpEnumValues('PropType.php').sort()).toEqual([...PROP_TYPES].sort())
  })
})

// ---------------------------------------------------------------------------
// 2. Negative + drift: the loose ingest guard must accept forward-compatible
//    payloads and reject only structurally broken ones.
// ---------------------------------------------------------------------------

describe('entry ingest guard drift tolerance', () => {
  function clone(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(navigateFixture))
  }

  it('rejects a payload missing a required structural block', () => {
    for (const block of ['__meta', 'props', 'route']) {
      const broken = clone()
      delete broken[block]

      expect(isEntry(broken), `guard should reject entry missing "${block}"`).toBe(false)
    }
  })

  it('rejects non-object payloads', () => {
    expect(isEntry(null)).toBe(false)
    expect(isEntry('entry')).toBe(false)
    expect(isEntry(42)).toBe(false)
    expect(isEntry([])).toBe(false)
  })

  it('accepts a new-PHP / old-extension payload carrying an unknown extra field', () => {
    const forward = clone()
    forward.__meta = { ...(forward.__meta as object), somethingNewInV2: 'value' }
    forward.brandNewTopLevelSection = { anything: true }

    expect(isEntry(forward), 'guard must not drop entries from a newer forward-compatible server').toBe(true)
  })

  it('accepts an old-PHP / new-extension payload missing a newer optional field', () => {
    const backward = clone()
    const meta = backward.__meta as Record<string, unknown>

    for (const optional of META_OPTIONAL) {
      delete meta[optional]
    }

    delete backward.propValues

    expect(isEntry(backward), 'guard must accept entries from an older server lacking optional fields').toBe(true)
  })

  it('accepts an unknown requestType enum value (panel maps unknowns to a fallback)', () => {
    const drifted = clone()
    ;(drifted.__meta as Record<string, unknown>).requestType = 'some-future-type'

    expect(isEntry(drifted)).toBe(true)
  })

  it('accepts an unknown PropType enum value on a prop', () => {
    const drifted = clone()
    ;(drifted.props as Record<string, unknown>).name = { inertiaType: 'future-prop-type', shared: false }

    expect(isEntry(drifted)).toBe(true)
  })
})
