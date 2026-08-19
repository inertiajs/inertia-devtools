<script setup lang="ts">
import { ExternalLink } from '@lucide/vue'
import { computed } from 'vue'
import { buildEditorUrl } from '../lib/editors'
import { uiStore } from '../stores/ui'
import AppSchemeAnchor from './AppSchemeAnchor.vue'

const props = withDefaults(
  defineProps<{
    file?: string | null
    line?: number | null
    label?: string | null
    showIcon?: boolean
  }>(),
  {
    showIcon: true,
  },
)

const ui = uiStore

const url = computed(() => {
  if (!props.file) {
    return null
  }

  return buildEditorUrl(ui.editor, props.file, props.line ?? 1)
})

const displayText = computed(() => {
  if (props.label) {
    return props.label
  }

  if (!props.file) {
    return '-'
  }

  const parts = props.file.split('/')
  const name = parts[parts.length - 1] || props.file

  return props.line ? `${name}:${props.line}` : name
})

const showPlainText = computed(() => Boolean(props.file) && ui.editor === 'off')
</script>

<template>
  <AppSchemeAnchor
    v-if="url"
    :href="url"
    :title="file ?? undefined"
    class="group text-brand-600 focus-visible:outline-brand-500 dark:text-brand-400 inline-flex items-center gap-1 rounded font-mono text-[11px] no-underline focus-visible:outline-2 focus-visible:outline-offset-1"
  >
    <ExternalLink
      v-if="showIcon"
      aria-hidden="true"
      :stroke-width="1.5"
      class="size-3 shrink-0 opacity-70 group-hover:opacity-100"
    />
    <span class="truncate group-hover:underline">{{ displayText }}</span>
  </AppSchemeAnchor>
  <span
    v-else-if="showPlainText"
    :title="file ?? undefined"
    class="truncate font-mono text-[11px] text-neutral-700 dark:text-neutral-300"
  >
    {{ displayText }}
  </span>
  <span v-else class="text-[11px] text-neutral-400 dark:text-neutral-400">-</span>
</template>
