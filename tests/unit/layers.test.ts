import { describe, expect, it } from 'vitest'
import { describeEntryLayer } from '../../src/panel/lib/layers'
import type { Entry, EntryMeta } from '../../src/types'
import { makeEntry } from '../support'

function entryFor(body: unknown, requestHeaders: Record<string, string> = {}, meta: Partial<EntryMeta> = {}): Entry {
  const entry = makeEntry(meta)

  return {
    ...entry,
    http: { ...entry.http, requestHeaders, responseBody: { status: 'present', value: body } },
  }
}

const LAYER_BODY = { component: 'Users/Create', layer: { key: 'user-form', base: '/users' } }

describe('describeEntryLayer', () => {
  it('leaves an entry that never left the page beneath the layers alone', () => {
    expect(describeEntryLayer(makeEntry())).toBeNull()
    expect(describeEntryLayer(entryFor({ component: 'Users/Index', props: {} }))).toBeNull()
    expect(describeEntryLayer(entryFor('plain text'))).toBeNull()
  })

  it('reads a layer being opened, keyed by the response or the component it defaults to', () => {
    expect(describeEntryLayer(entryFor(LAYER_BODY))).toMatchObject({
      kind: 'opened',
      key: 'user-form',
      label: 'opened user-form',
      title: 'Opened user-form, over /users',
    })

    expect(describeEntryLayer(entryFor({ component: 'Users/Create', layer: {} }))?.key).toBe('Users/Create')
  })

  it('reads a layer being written where it stands, from the header the visit stamped', () => {
    const stamped = entryFor(LAYER_BODY, { 'X-Inertia-Devtools-Layer': 'user-form' })

    expect(describeEntryLayer(stamped)).toMatchObject({ kind: 'updated', label: 'updated user-form' })

    // Laravel stores request headers lowercased.
    expect(describeEntryLayer(entryFor(LAYER_BODY, { 'x-inertia-devtools-layer': 'user-form' }))?.kind).toBe('updated')

    expect(describeEntryLayer(entryFor(LAYER_BODY, { 'x-inertia-devtools-layer-owner': '1' }))?.kind).toBe('opened')
  })

  it('reads a link inside a layer as opening a layer of its own, over the one it came from', () => {
    // Aimed at the layer the link was rendered in; the key defaults to the component.
    const stacked = entryFor(
      { component: 'Features/Layers/StackedContact', layer: { base: '/features/layers/stacked/11' } },
      { 'x-inertia-devtools-layer': 'Features/Layers/Organization' },
    )

    expect(describeEntryLayer(stacked)).toMatchObject({
      kind: 'opened',
      key: 'Features/Layers/StackedContact',
      label: 'opened Features/Layers/StackedContact',
    })
  })

  it('falls back to the partial component when no registry stamped the visit', () => {
    const reloaded = entryFor(LAYER_BODY, { 'x-inertia-partial-component': 'Users/Create' })

    expect(describeEntryLayer(reloaded)).toMatchObject({ kind: 'updated', key: 'user-form' })
  })

  it('reads a close, naming the layer only when the wire named it', () => {
    expect(describeEntryLayer(entryFor({ component: '', props: {}, close: true }))).toMatchObject({
      kind: 'closed',
      key: null,
      label: 'closed layer',
    })

    expect(describeEntryLayer(entryFor({ close: true }, { 'x-inertia-devtools-layer': 'user-form' }))?.label).toBe(
      'closed user-form',
    )
  })

  it('leaves the key out of the badge when the row already names it', () => {
    const body = { component: 'Users/Create', layer: {} }

    expect(describeEntryLayer(entryFor(body, {}, { component: 'Users/Create' }))).toMatchObject({
      key: 'Users/Create',
      label: 'opened',
      title: 'Opened Users/Create',
    })

    // A key of the server's own is worth the room, since nothing else on the row says it.
    expect(
      describeEntryLayer(entryFor({ ...body, layer: { key: 'wizard' } }, {}, { component: 'Users/Create' }))?.label,
    ).toBe('opened wizard')

    expect(describeEntryLayer(entryFor({ close: true }))?.label).toBe('closed layer')
  })

  it('reads a detour, and names the sender of a request that landed on neither', () => {
    expect(describeEntryLayer(entryFor({ component: 'Auth/Confirm', interstitial: true }))).toMatchObject({
      kind: 'detour',
      label: 'detour',
    })

    expect(
      describeEntryLayer(entryFor({ component: 'Users/Index', props: {} }, { 'x-inertia-devtools-layer': 'wizard' })),
    ).toMatchObject({ kind: 'sent-by', key: 'wizard', label: 'sent by wizard' })
  })

  it('takes a client-only entry at its meta, which is the only place its tier is recorded', () => {
    expect(describeEntryLayer(makeEntry({ requestType: 'layer-open', layerKey: 'confirm' }))).toMatchObject({
      kind: 'opened',
      key: 'confirm',
    })

    expect(describeEntryLayer(makeEntry({ requestType: 'layer-close', component: 'Confirm' }))?.label).toBe('closed')

    expect(describeEntryLayer(makeEntry({ requestType: 'client-visit', layerKey: 'wizard' }))).toMatchObject({
      kind: 'updated',
      key: 'wizard',
    })

    expect(describeEntryLayer(makeEntry({ requestType: 'client-visit' }))).toBeNull()
  })

  it('reads an emitted event by name, and says who it reached', () => {
    expect(
      describeEntryLayer(
        makeEntry({ requestType: 'layer-event', layerKey: 'Confirm', layerEvent: { name: 'saved', to: 'Users/Edit' } }),
      ),
    ).toMatchObject({
      kind: 'event',
      key: 'Confirm',
      label: 'emitted saved',
      title: 'Confirm emitted saved to Users/Edit',
    })

    expect(
      describeEntryLayer(
        makeEntry({ requestType: 'layer-event', layerKey: 'Confirm', layerEvent: { name: 'saved', to: 'page' } }),
      )?.title,
    ).toBe('Confirm emitted saved to the page beneath it')

    expect(
      describeEntryLayer(
        makeEntry({ requestType: 'layer-event', layerKey: 'Confirm', layerEvent: { name: 'saved', to: null } }),
      )?.title,
    ).toBe('Confirm emitted saved to nobody')
  })
})
