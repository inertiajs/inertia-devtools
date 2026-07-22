<script setup lang="ts">
import { computed, ref } from 'vue'
import { collectContainerPaths, collectPropExpansionPaths } from '../lib/props'
import { entriesStore } from '../stores/entries'
import { pageStateStore } from '../stores/pageState'
import type { DetailTab } from '../stores/ui'
import { uiStore } from '../stores/ui'
import CopyButton from './CopyButton.vue'
import EmptyState from './EmptyState.vue'
import HttpTab from './HttpTab.vue'
import MetaBar from './MetaBar.vue'
import PageTab from './PageTab.vue'
import PropsTab from './PropsTab.vue'
import RouteTab from './RouteTab.vue'
import TreeControls from './TreeControls.vue'

const entries = entriesStore
const ui = uiStore

const entry = computed(() => entries.selectedEntry)

const tabs: { id: DetailTab; label: string }[] = [
  { id: 'props', label: 'Props' },
  { id: 'http', label: 'HTTP' },
  { id: 'route', label: 'Route' },
  { id: 'page', label: 'Page' },
]

const tabRefs = ref<HTMLButtonElement[]>([])

function setTabRef(el: unknown, index: number): void {
  if (el) {
    tabRefs.value[index] = el as HTMLButtonElement
  }
}

/**
 * Preserve tablist keyboard navigation while storing the selected detail tab globally.
 */
function onTabKeydown(event: KeyboardEvent, index: number): void {
  let nextIndex: number | null = null

  switch (event.key) {
    case 'ArrowRight':
      nextIndex = (index + 1) % tabs.length
      break
    case 'ArrowLeft':
      nextIndex = (index - 1 + tabs.length) % tabs.length
      break
    case 'Home':
      nextIndex = 0
      break
    case 'End':
      nextIndex = tabs.length - 1
      break
  }

  if (nextIndex === null) {
    return
  }

  event.preventDefault()
  ui.setTab(tabs[nextIndex].id)
  tabRefs.value[nextIndex]?.focus()
}

const propsPaths = computed(() =>
  entry.value ? collectPropExpansionPaths(entry.value.props, entry.value.propValues ?? {}) : [],
)

const topLevelProps = computed(() =>
  entry.value
    ? Object.fromEntries(Object.entries(entry.value.propValues ?? {}).filter(([key]) => !key.includes('.')))
    : {},
)

const pageSnapshot = computed(() => (entry.value ? pageStateStore.snapshotForEntry(entry.value.__meta.id) : null))

const pagePaths = computed(() =>
  pageSnapshot.value ? collectContainerPaths(pageSnapshot.value.props, 'page.snapshot') : [],
)
</script>

<template>
  <div class="flex h-full flex-col">
    <MetaBar v-if="entry" :entry="entry" />

    <nav class="flex items-center justify-between border-b border-black/8 px-2 dark:border-neutral-700">
      <div class="flex" role="tablist">
        <button
          v-for="(tab, index) in tabs"
          :key="tab.id"
          :ref="(el) => setTabRef(el, index)"
          :id="`detail-tab-${tab.id}`"
          type="button"
          role="tab"
          aria-controls="detail-tabpanel"
          :aria-selected="ui.activeTab === tab.id"
          :tabindex="ui.activeTab === tab.id ? 0 : -1"
          class="focus-visible:outline-brand-500 -mb-px cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-3 py-2 text-[11px] font-medium text-neutral-500 hover:text-neutral-900 focus-visible:outline-2 focus-visible:-outline-offset-2 dark:text-neutral-400 dark:hover:text-neutral-100"
          :class="{
            'border-brand-500! text-neutral-900! dark:text-neutral-50!': ui.activeTab === tab.id,
          }"
          @click="ui.setTab(tab.id)"
          @keydown="onTabKeydown($event, index)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div v-if="entry" class="flex items-center gap-2 pr-1">
        <template v-if="ui.activeTab === 'props'">
          <TreeControls :paths="propsPaths" />
          <CopyButton :value="topLevelProps" title="Copy all props" />
        </template>
        <template v-else-if="ui.activeTab === 'page' && pageSnapshot">
          <TreeControls :paths="pagePaths" />
          <CopyButton :value="pageSnapshot.props" title="Copy all page props" />
        </template>
      </div>
    </nav>

    <section
      id="detail-tabpanel"
      role="tabpanel"
      :aria-labelledby="`detail-tab-${ui.activeTab}`"
      class="flex-1 overflow-y-auto"
    >
      <template v-if="entry">
        <PropsTab v-if="ui.activeTab === 'props'" :entry="entry" />
        <HttpTab v-else-if="ui.activeTab === 'http'" :entry="entry" />
        <RouteTab v-else-if="ui.activeTab === 'route'" :entry="entry" />
        <PageTab v-else-if="ui.activeTab === 'page'" :entry="entry" />
      </template>
      <EmptyState v-else gap="gap-2">
        <template #title>No entry selected</template>
        <template #description>Pick an entry from the timeline to inspect it.</template>
      </EmptyState>
    </section>
  </div>
</template>
