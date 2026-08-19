<script setup lang="ts">
import { Snail } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import type { Entry } from '../../types'
import { clockTime, formatDuration, fullTime, urlPath } from '../lib/format'
import { TONE } from '../lib/tone'
import { useEntryDisplay } from '../lib/useEntryDisplay'
import RedirectBadge from './RedirectBadge.vue'

const props = defineProps<{
  entry: Entry
  depth: number
  selected: boolean
  batchDeferGroups: string[]
  optionId: string
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
}>()

const SLOW_REQUEST_MS = 1000

const rowRef = ref<HTMLElement | null>(null)

watch(
  () => props.selected,
  (isSelected, wasSelected) => {
    if (isSelected && !wasSelected) {
      rowRef.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  },
)

const { meta, tone, prefetchConsumption, requestTypeLabel, redirectTarget, hasErrors, deferGroups } = useEntryDisplay(
  () => props.entry,
)

const isSlow = computed(() => meta.value.serverTimingMs !== null && meta.value.serverTimingMs >= SLOW_REQUEST_MS)

const typeLabel = computed(() => {
  // Hide a lone `default` group; it only adds noise when no named groups exist.
  const isLoneDefault = props.batchDeferGroups.length <= 1 && deferGroups.value.every((group) => group === 'default')

  if (deferGroups.value.length > 0 && !isLoneDefault) {
    return `${requestTypeLabel.value} (${deferGroups.value.join(', ')})`
  }

  return requestTypeLabel.value
})

const subtitle = computed(() => {
  const component = meta.value.component
  const isNavigate = meta.value.requestType === 'navigate'
  const parts = isNavigate ? [component] : [component, typeLabel.value]

  if (prefetchConsumption.value.consumed) {
    parts.push(prefetchConsumption.value.label)
  }

  const joined = parts.filter(Boolean).join(' · ')

  return joined || '–'
})

function onClick(): void {
  emit('select', meta.value.id)
}
</script>

<template>
  <li
    :id="optionId"
    ref="rowRef"
    role="option"
    :aria-selected="selected"
    class="relative flex cursor-pointer items-center gap-2 border-b border-black/6 px-3 py-1.5 dark:border-neutral-800"
    :class="[
      selected
        ? 'bg-brand-50 group-focus-visible/list:outline-brand-500 dark:bg-brand-500/10 group-focus-visible/list:outline-2 group-focus-visible/list:-outline-offset-2'
        : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
    ]"
    @click="onClick"
  >
    <span v-if="selected" class="bg-brand-500 dark:bg-brand-400 absolute inset-y-0 left-0 w-0.5" />

    <span
      v-if="depth > 0"
      class="ml-2 flex items-center gap-2 text-neutral-300 dark:text-neutral-700"
      aria-hidden="true"
    >
      <span class="inline-block size-3 border-b border-l border-neutral-300 dark:border-neutral-700" />
    </span>

    <span class="inline-block h-3 w-0.5 rounded-sm" :class="TONE[tone].bar" />

    <span class="w-8 font-mono text-[10px] font-semibold tabular-nums" :class="TONE[tone].text">
      {{ meta.status || '–' }}
    </span>

    <span class="w-10 font-mono text-[10px] font-semibold tracking-wide text-neutral-500 dark:text-neutral-400">
      {{ meta.method }}
    </span>

    <span class="flex min-w-0 flex-1 flex-col leading-tight">
      <span class="truncate font-mono text-[11px] text-neutral-900 dark:text-neutral-100">
        {{ urlPath(meta.url) }}
      </span>
      <span
        class="flex min-w-0 items-center gap-1 truncate text-[10px]"
        :class="
          prefetchConsumption.consumed ? 'text-brand-700 dark:text-brand-300' : 'text-neutral-500 dark:text-neutral-400'
        "
        :title="prefetchConsumption.tooltip ?? undefined"
      >
        <span class="truncate">{{ subtitle }}</span>
        <span
          v-if="hasErrors"
          class="inline-flex shrink-0 items-center rounded bg-rose-100 px-1 text-[10px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300"
          title="Page has validation errors"
        >
          errors
        </span>
        <RedirectBadge
          v-if="redirectTarget"
          class="max-w-36 shrink-0 px-1 text-[10px]"
          :target="redirectTarget"
          :location="meta.redirectLocation"
        />
      </span>
    </span>

    <span class="flex w-16 flex-col items-end leading-tight text-neutral-500 dark:text-neutral-400">
      <span class="font-mono text-[10px] tabular-nums">
        <span v-if="isSlow" title="Slow request (>1s)" aria-label="slow"
          ><Snail class="mr-0.5 inline size-3 align-[-2px]" /></span
        >{{ formatDuration(meta.serverTimingMs) }}
      </span>
      <span data-testid="recorded-at" class="font-mono text-[10px] tabular-nums" :title="fullTime(meta.timestamp)">{{
        clockTime(meta.timestamp)
      }}</span>
    </span>
  </li>
</template>
