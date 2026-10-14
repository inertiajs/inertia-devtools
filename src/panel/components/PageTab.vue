<script setup lang="ts">
import { Undo2 } from '@lucide/vue'
import { computed } from 'vue'
import type { Entry } from '../../types'
import { describeEntryLayer } from '../lib/layers'
import { entriesStore } from '../stores/entries'
import { pageStateStore } from '../stores/pageState'
import PropsValueTree from './PropsValueTree.vue'

const props = defineProps<{
  entry: Entry
}>()

const snapshot = computed(() => pageStateStore.snapshotForEntry(props.entry.__meta.id))

const layers = computed(() => snapshot.value?.layers ?? [])

const landedOn = computed(() => describeEntryLayer(props.entry)?.key ?? null)

// Both sides fall back to the component before being compared.
const cards = computed(() =>
  layers.value.map((layer, index) => {
    const key = layer.key || layer.component
    const writer = key === null ? null : entriesStore.lastLayerWriter(key, props.entry.__meta.utime)

    return {
      layer,
      index,
      isLandedOn: key !== null && key === landedOn.value,
      isTop: index === layers.value.length - 1,
      writer: writer && writer.__meta.id !== props.entry.__meta.id ? writer : null,
    }
  }),
)

// The component/url are already shown in the header above; only surface them here when
// the recorded page state actually differs from this entry (so it isn't pure duplication).
const differsFromEntry = computed(
  () =>
    !!snapshot.value &&
    (snapshot.value.component !== props.entry.__meta.component || snapshot.value.url !== props.entry.__meta.url),
)

function nonEmptyFlash(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Object.keys(value).length === 0) {
    return null
  }

  return value as Record<string, unknown>
}

// Flash has two independent origins. A server response carries its flash inside the response
// body's page object, read straight from there per entry. A client-side `router.flash()` has
// no response, so it patches the live page snapshot in place; that takes precedence when set.
const flash = computed(() => {
  const fromSnapshot = nonEmptyFlash(snapshot.value?.flash)

  if (fromSnapshot) {
    return fromSnapshot
  }

  const body = props.entry.http.responseBody

  if (body.status === 'present' && body.value && typeof body.value === 'object') {
    return nonEmptyFlash((body.value as Record<string, unknown>).flash)
  }

  return null
})
</script>

<template>
  <div v-if="snapshot || flash">
    <template v-if="flash">
      <div class="border-b border-black/8 bg-neutral-50 px-3 dark:border-neutral-700 dark:bg-neutral-800">
        <div
          class="flex h-8 items-center text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
        >
          Flash
        </div>
      </div>
      <div class="px-3 py-2">
        <PropsValueTree :value="flash" path="page.flash" :expanded-by-default="true" :root="true" />
      </div>
    </template>

    <template v-if="snapshot">
      <div
        class="sticky top-0 z-10 border-b border-black/8 bg-neutral-50 px-3 dark:border-neutral-700 dark:bg-neutral-800"
      >
        <div
          class="flex h-8 items-center text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
        >
          Page state after this response
        </div>
        <div v-if="differsFromEntry" class="flex flex-col gap-0.5 pb-1.5">
          <div class="font-mono text-[11px] text-neutral-800 dark:text-neutral-200">
            {{ snapshot.component ?? 'Unknown component' }}
          </div>
          <div class="truncate font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
            {{ snapshot.url }}
          </div>
        </div>
      </div>

      <div class="px-3 py-2">
        <PropsValueTree :value="snapshot.props" path="page.snapshot" :expanded-by-default="true" :root="true" />
      </div>
    </template>

    <template v-if="layers.length > 0">
      <div class="border-y border-black/8 bg-neutral-50 px-3 dark:border-neutral-700 dark:bg-neutral-800">
        <div
          class="flex h-8 items-center text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
        >
          Layers
        </div>
      </div>
      <div class="flex flex-col gap-2 px-3 py-2">
        <div
          v-for="card in cards"
          :key="card.layer.id || card.index"
          class="rounded border px-2 py-1.5"
          :class="card.isLandedOn ? 'border-violet-500/40 bg-violet-500/5' : 'border-black/8 dark:border-neutral-700'"
        >
          <div class="flex items-center gap-2">
            <span class="font-mono text-[10px] text-neutral-400 tabular-nums dark:text-neutral-500">
              {{ card.index + 1 }}
            </span>
            <span class="truncate font-mono text-[11px] text-neutral-900 dark:text-neutral-100">
              {{ card.layer.component ?? 'Unknown component' }}
            </span>
            <span
              v-if="card.isLandedOn"
              class="shrink-0 rounded bg-violet-500/15 px-1.5 text-[10px] font-medium text-violet-700 dark:text-violet-300"
              title="The layer this entry landed on"
            >
              this entry
            </span>
            <span
              v-if="card.isTop"
              class="shrink-0 rounded bg-violet-500/15 px-1.5 text-[10px] font-medium text-violet-700 dark:text-violet-300"
              title="The topmost layer on the stack"
            >
              top
            </span>

            <button
              v-if="card.writer"
              type="button"
              title="Jump to the response that last wrote this layer, for its props, route and headers"
              class="text-brand-600 ring-brand-500/20 hover:bg-brand-50 focus-visible:ring-brand-500 dark:text-brand-400 dark:hover:bg-brand-950 ml-auto inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded bg-transparent px-1 py-0.5 text-[10px] font-medium ring-1 ring-inset focus-visible:ring-2 focus-visible:outline-none"
              @click="entriesStore.select(card.writer.__meta.id)"
            >
              <Undo2 class="size-3" aria-hidden="true" />
              View request
            </button>
          </div>

          <div class="mt-0.5 truncate font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
            {{ card.layer.url ?? 'local, no URL' }}
          </div>

          <div class="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
            <span v-if="card.layer.key">key: {{ card.layer.key }}</span>
            <span v-if="card.layer.base">base: {{ card.layer.base }}</span>
          </div>

          <div class="mt-1.5 border-t border-black/8 pt-1.5 dark:border-neutral-700">
            <div class="mb-1 text-[10px] font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500">
              Props
            </div>
            <PropsValueTree
              :value="card.layer.props"
              :path="`page.layers.${card.index}`"
              :expanded-by-default="true"
              :root="true"
            />
          </div>

          <template v-if="nonEmptyFlash(card.layer.flash)">
            <div class="mt-1.5 border-t border-black/8 pt-1.5 dark:border-neutral-700">
              <div
                class="mb-1 text-[10px] font-semibold tracking-wide text-neutral-400 uppercase dark:text-neutral-500"
              >
                Flash
              </div>
              <PropsValueTree
                :value="card.layer.flash"
                :path="`page.layers.${card.index}.flash`"
                :expanded-by-default="true"
                :root="true"
              />
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>

  <div v-else class="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
    <span class="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
      No page snapshot recorded for this request
    </span>
    <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
      Prefetches and entries recorded before the panel attached do not include one.
    </span>
  </div>
</template>
