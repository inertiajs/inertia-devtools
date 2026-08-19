<script setup lang="ts">
import { ExternalLink, Undo2 } from '@lucide/vue'
import { computed } from 'vue'
import type { Entry } from '../../types'
import { buildEditorUrl } from '../lib/editors'
import { formatDuration, formatUrl } from '../lib/format'
import { navigateInspectedWindow } from '../lib/navigate'
import { TONE } from '../lib/tone'
import { useEntryDisplay } from '../lib/useEntryDisplay'
import { entriesStore } from '../stores/entries'
import { uiStore } from '../stores/ui'
import AppSchemeAnchor from './AppSchemeAnchor.vue'
import CopyButton from './CopyButton.vue'
import EditorLink from './EditorLink.vue'
import RedirectBadge from './RedirectBadge.vue'

const props = defineProps<{
  entry: Entry
}>()

const ui = uiStore
const { meta, tone, prefetchConsumption, requestTypeLabel, redirectTarget } = useEntryDisplay(() => props.entry)

const displayUrl = computed(() => formatUrl(meta.value.url))

// A cache-hit stamps the consumed prefetch's id as its batchId, so it can jump back to it.
const consumedPrefetch = computed(() => {
  if (meta.value.requestType !== 'cache-hit') {
    return null
  }

  const parent = entriesStore.entryById(meta.value.batchId)

  return parent?.__meta.requestType === 'prefetch' ? parent : null
})

const actionSourceUrl = computed(() => {
  const src = props.entry.route.actionSource

  if (!src?.file) {
    return null
  }

  return buildEditorUrl(ui.editor, src.file, src.line ?? 1)
})

function navigate(): void {
  navigateInspectedWindow(meta.value.url)
}
</script>

<template>
  <div class="border-b border-black/8 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800">
    <div class="flex items-center gap-2">
      <span
        class="inline-flex h-5 min-w-9 items-center justify-center rounded px-1.5 font-mono text-[10px] font-semibold"
        :class="TONE[tone].badge"
      >
        {{ meta.status || '–' }}
      </span>

      <span class="font-mono text-[10px] font-semibold tracking-wide text-neutral-700 dark:text-neutral-300">
        {{ meta.method }}
      </span>

      <EditorLink
        v-if="meta.component && entry.componentPath"
        :file="entry.componentPath"
        :label="meta.component"
        :show-icon="false"
      />

      <span v-else-if="meta.component" class="truncate font-mono text-[11px] text-neutral-900 dark:text-neutral-100">
        {{ meta.component }}
      </span>

      <span class="ml-auto flex items-center gap-3 text-[10px] text-neutral-500 dark:text-neutral-400">
        <span>{{ requestTypeLabel }}</span>
        <button
          v-if="consumedPrefetch"
          type="button"
          title="Jump to the prefetch this cache hit consumed"
          class="text-brand-600 ring-brand-500/20 hover:bg-brand-50 focus-visible:ring-brand-500 dark:text-brand-400 dark:hover:bg-brand-950 inline-flex cursor-pointer items-center gap-0.5 rounded bg-transparent px-1 py-0.5 font-medium ring-1 ring-inset focus-visible:ring-2 focus-visible:outline-none"
          @click="entriesStore.select(consumedPrefetch.__meta.id)"
        >
          <Undo2 class="size-3" aria-hidden="true" />
          View prefetch
        </button>
        <RedirectBadge
          v-if="redirectTarget"
          class="max-w-48 px-1.5"
          :target="redirectTarget"
          :location="meta.redirectLocation"
        />
        <span
          v-if="prefetchConsumption.consumed"
          class="bg-brand-500/15 text-brand-700 dark:text-brand-300 rounded px-1.5"
          :title="prefetchConsumption.tooltip ?? undefined"
        >
          {{ prefetchConsumption.label }}
        </span>
        <span v-if="meta.serverTimingMs !== null" class="font-mono">
          {{ formatDuration(meta.serverTimingMs) }}
        </span>
      </span>
    </div>

    <div class="mt-1.5 flex items-center gap-2">
      <AppSchemeAnchor
        v-if="actionSourceUrl"
        :href="actionSourceUrl"
        :title="displayUrl"
        class="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-600 no-underline hover:underline dark:text-neutral-400"
      >
        {{ displayUrl }}
      </AppSchemeAnchor>
      <span
        v-else
        class="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-600 dark:text-neutral-400"
        :title="displayUrl"
      >
        {{ displayUrl }}
      </span>
      <CopyButton :text="meta.url" title="Copy URL" />
      <button
        type="button"
        title="Navigate to this URL"
        aria-label="Navigate to this URL"
        class="focus-visible:outline-brand-500 inline-flex cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0.5 text-neutral-400 hover:text-neutral-700 focus-visible:outline-2 dark:text-neutral-400 dark:hover:text-neutral-200"
        @click="navigate"
      >
        <ExternalLink class="size-3.5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
