<script setup lang="ts">
import { Monitor, Moon, Sun } from '@lucide/vue'
import { computed } from 'vue'
import { uiStore } from '../stores/ui'

const ui = uiStore

const themeIcon = computed(() => {
  if (ui.theme === 'light') {
    return Sun
  }

  if (ui.theme === 'dark') {
    return Moon
  }

  return Monitor
})

const label = computed(() => `Theme: ${ui.theme}`)
</script>

<template>
  <button
    type="button"
    :title="label"
    :aria-label="label"
    class="focus-visible:ring-brand-500 inline-flex h-6 cursor-pointer items-center justify-center rounded-md bg-white px-2 text-[11px] font-medium text-neutral-700 shadow-xs ring-1 ring-black/8 ring-inset hover:bg-neutral-50 hover:text-neutral-900 focus-visible:ring-2 focus-visible:outline-none dark:bg-white/5 dark:text-neutral-300 dark:shadow-none dark:hover:bg-white/10"
    @click="ui.cycleTheme()"
  >
    <component :is="themeIcon" class="size-3.5" aria-hidden="true" />
  </button>
</template>
