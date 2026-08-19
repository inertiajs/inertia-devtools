<script setup lang="ts">
import { computed } from 'vue'
import Button from './components/Button.vue'
import EditorPicker from './components/EditorPicker.vue'
import EntryDetail from './components/EntryDetail.vue'
import FilterBar from './components/FilterBar.vue'
import ThemeToggle from './components/ThemeToggle.vue'
import Timeline from './components/Timeline.vue'
import { useHostAccess } from './lib/useHostAccess'
import { useResizableSidebar } from './lib/useResizableSidebar'
import { useThemePreference } from './lib/useThemePreference'
import { entriesStore } from './stores/entries'
import { pageStateStore } from './stores/pageState'
import { uiStore } from './stores/ui'

const entries = entriesStore
const pageState = pageStateStore
const ui = uiStore

useThemePreference()

const hasHostAccess = useHostAccess()

// One dot conveys connection + activity, so a request starting or finishing never
// reflows the toolbar the way an appearing/disappearing text label did.
const status = computed(() => {
  if (entries.hasActiveRequest) {
    return { dot: 'bg-orange-500 animate-pulse', title: 'Request in progress' }
  }

  if (entries.loading) {
    return { dot: 'bg-brand-500 animate-pulse', title: 'Loading' }
  }

  if (entries.devtoolsTabId !== null) {
    return { dot: 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]', title: 'Connected' }
  }

  return { dot: 'bg-neutral-400 dark:bg-neutral-600', title: 'Not attached to a tab' }
})

const { resizing, sidebarStyle, startResize } = useResizableSidebar()

/**
 * Clear both timeline entries and paired page snapshots from the panel.
 */
async function onClear(): Promise<void> {
  await entries.clearTimeline()
  pageState.clearSnapshots()
}

function onExport(): void {
  const json = JSON.stringify(entries.entries, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `inertia-timeline-${date}.json`
  a.click()
  URL.revokeObjectURL(url)
}

async function onRetryHydration(): Promise<void> {
  await entries.retryHydration()
}
</script>

<template>
  <div
    class="flex h-full flex-col bg-white font-sans text-[12px] tracking-[-0.006em] text-neutral-800 antialiased dark:bg-neutral-900 dark:text-neutral-100"
  >
    <header
      class="flex items-center gap-2.5 border-b border-black/8 bg-neutral-50 px-3 py-1.5 dark:border-neutral-700 dark:bg-neutral-800"
    >
      <div class="flex shrink-0 items-center gap-2">
        <span class="inline-block size-1.5 rounded-full" :class="status.dot" :title="status.title" />
        <strong class="text-[12px] font-semibold tracking-tight">Inertia DevTools</strong>
        <span
          v-if="entries.evicted > 0"
          class="rounded bg-neutral-200/70 px-1 font-mono text-[10px] text-neutral-500 tabular-nums dark:bg-neutral-700 dark:text-neutral-400"
          :title="`${entries.evicted} older entries trimmed from the buffer`"
        >
          {{ entries.evicted }} trimmed
        </span>
      </div>

      <span class="h-4 w-px shrink-0 bg-black/8 dark:bg-neutral-700" />

      <div class="flex shrink-0 items-center gap-1.5">
        <Button type="button" :disabled="entries.entries.length === 0" @click="onClear"> Clear </Button>

        <Button type="button" :disabled="entries.entries.length === 0" @click="onExport"> Export </Button>

        <Button
          type="button"
          :pressed="ui.autoFollow"
          :aria-pressed="ui.autoFollow"
          title="Auto-scroll to the newest request"
          @click="ui.toggleAutoFollow"
        >
          Auto-scroll
        </Button>
      </div>

      <span class="h-4 w-px shrink-0 bg-black/8 dark:bg-neutral-700" />

      <FilterBar class="flex-1" />

      <span class="h-4 w-px shrink-0 bg-black/8 dark:bg-neutral-700" />

      <div class="flex shrink-0 items-center gap-1.5">
        <EditorPicker />
        <ThemeToggle />
      </div>
    </header>

    <div
      v-if="entries.error"
      role="alert"
      class="flex items-center gap-2 border-b border-red-300 bg-red-50 px-3 py-1.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      <span class="font-medium">Hydration failed:</span>
      <span class="flex-1 truncate font-mono">{{ entries.error }}</span>
      <button
        type="button"
        class="cursor-pointer rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] text-red-700 hover:border-red-400 dark:border-red-800 dark:bg-red-900 dark:text-red-200 dark:hover:border-red-700"
        @click="onRetryHydration"
      >
        Retry
      </button>
    </div>

    <div
      v-if="!hasHostAccess"
      role="status"
      class="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
    >
      <span class="flex-1">
        The DevTools have no access to this site, so nothing can be recorded. Grant access from the extensions button in
        the browser toolbar, then reload the page.
      </span>
    </div>

    <div
      v-if="entries.devActive === false"
      role="status"
      class="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
    >
      <span class="flex-1">
        Your app is not running in dev mode, so the DevTools can't record everything. Start the Vite development server
        (<span class="font-mono">npm run dev</span>) to fully leverage the Inertia DevTools.
      </span>
    </div>

    <div class="grid min-h-0 flex-1" :style="sidebarStyle">
      <aside class="flex min-h-0 flex-col overflow-hidden border-r border-black/8 dark:border-neutral-700">
        <div class="min-h-0 flex-1 overflow-y-auto">
          <Timeline />
        </div>
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        class="group hover:bg-brand-400 dark:hover:bg-brand-500 relative flex cursor-col-resize items-stretch justify-center bg-transparent transition-colors"
        :class="{ 'bg-brand-400! dark:bg-brand-500!': resizing }"
        @pointerdown.prevent="startResize"
      />
      <main class="overflow-hidden">
        <EntryDetail />
      </main>
    </div>
  </div>
</template>
