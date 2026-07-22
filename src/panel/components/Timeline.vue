<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { entryDeferGroups } from '../lib/format'
import type { BatchGroup } from '../lib/timeline'
import { entriesStore } from '../stores/entries'
import { uiStore } from '../stores/ui'
import EmptyState from './EmptyState.vue'
import TimelineEntry from './TimelineEntry.vue'

const entries = entriesStore
const ui = uiStore
const listRef = ref<HTMLElement | null>(null)

// Every defer group loaded across the batch. A lone `default` group is hidden in the
// row label (it carries no meaning), but named groups always show, `default` included.
function batchDeferGroups(group: BatchGroup): string[] {
  const groups = new Set<string>()

  for (const entry of [group.root, ...group.children]) {
    for (const deferGroup of entryDeferGroups(entry)) {
      groups.add(deferGroup)
    }
  }

  return [...groups]
}

// Flattened root-then-children order, matching the rendered rows. Drives arrow-key
// navigation and the listbox's aria-activedescendant.
const flatIds = computed(() =>
  entries.groupedByBatch.flatMap((group) => [group.root.__meta.id, ...group.children.map((child) => child.__meta.id)]),
)

function optionDomId(id: string): string {
  return `timeline-option-${id}`
}

const activeDescendant = computed(() => {
  if (entries.selectedId === null || !flatIds.value.includes(entries.selectedId)) {
    return undefined
  }

  return optionDomId(entries.selectedId)
})

/**
 * Select a timeline row and reset expansion state that belongs to the previous entry.
 */
function onSelect(id: string): void {
  if (id !== entries.selectedId) {
    ui.clearExpandedPaths()
  }

  entries.select(id)
}

function selectAt(index: number): void {
  const id = flatIds.value[index]

  if (id !== undefined) {
    onSelect(id)
  }
}

function moveSelection(delta: number): void {
  const ids = flatIds.value

  if (ids.length === 0) {
    return
  }

  const currentIndex = entries.selectedId === null ? -1 : ids.indexOf(entries.selectedId)

  if (currentIndex === -1) {
    selectAt(delta > 0 ? 0 : ids.length - 1)
    return
  }

  const nextIndex = Math.min(ids.length - 1, Math.max(0, currentIndex + delta))
  selectAt(nextIndex)
}

function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveSelection(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveSelection(-1)
      break
    case 'Home':
      event.preventDefault()
      selectAt(0)
      break
    case 'End':
      event.preventDefault()
      selectAt(flatIds.value.length - 1)
      break
  }
}

watch(
  () => entries.entries.length,
  (newLen, oldLen) => {
    if (newLen <= oldLen || !ui.autoFollow || !listRef.value) {
      return
    }

    nextTick(() => {
      listRef.value?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  },
)
</script>

<template>
  <div class="h-full">
    <EmptyState v-if="entries.error && entries.entries.length === 0" tone="error">
      <template #title>Hydration failed</template>
      <template #description>{{ entries.error }}</template>
    </EmptyState>
    <EmptyState v-else-if="entries.entries.length === 0">
      <template #title>No entries yet</template>
      <template #description>Navigate to your app to see requests.</template>
    </EmptyState>
    <EmptyState v-else-if="entries.filteredEntries.length === 0">
      <template #title>No matches</template>
      <template #description>Adjust filters to see entries.</template>
    </EmptyState>
    <ul
      ref="listRef"
      v-else
      role="listbox"
      tabindex="0"
      :aria-activedescendant="activeDescendant"
      class="group/list m-0 list-none p-0 focus:outline-none"
      @keydown="onKeydown"
    >
      <template v-for="group in entries.groupedByBatch" :key="group.root.__meta.id">
        <TimelineEntry
          :entry="group.root"
          :depth="0"
          :option-id="optionDomId(group.root.__meta.id)"
          :batch-defer-groups="batchDeferGroups(group)"
          :selected="entries.selectedId === group.root.__meta.id"
          @select="onSelect"
        />
        <TimelineEntry
          v-for="child in group.children"
          :key="child.__meta.id"
          :entry="child"
          :depth="1"
          :option-id="optionDomId(child.__meta.id)"
          :batch-defer-groups="batchDeferGroups(group)"
          :selected="entries.selectedId === child.__meta.id"
          @select="onSelect"
        />
      </template>
    </ul>
  </div>
</template>
