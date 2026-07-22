<script setup lang="ts">
import { computed, ref } from 'vue'
import CopyButton from './CopyButton.vue'

const props = defineProps<{
  entries: Record<string, unknown> | null | undefined
  emptyLabel?: string
}>()

const TRUNCATE_VALUE_AT = 140

const rows = computed(() => {
  if (!props.entries) {
    return []
  }

  return Object.entries(props.entries).map(([key, value]) => ({
    key: key.toLowerCase(),
    rawKey: key,
    value: stringify(value),
  }))
})

function stringify(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(stringify).join(', ')
  }

  return String(value)
}

const expanded = ref<Set<string>>(new Set())

function toggle(key: string, value: string): void {
  if (value.length <= TRUNCATE_VALUE_AT) {
    return
  }

  if (expanded.value.has(key)) {
    expanded.value.delete(key)
  } else {
    expanded.value.add(key)
  }
}

function displayValue(key: string, value: string): string {
  if (value.length <= TRUNCATE_VALUE_AT || expanded.value.has(key)) {
    return value
  }

  return value.slice(0, TRUNCATE_VALUE_AT) + '…'
}

function isTruncated(value: string): boolean {
  return value.length > TRUNCATE_VALUE_AT
}
</script>

<template>
  <div v-if="rows.length === 0" class="px-2 py-4 text-center text-[11px] text-neutral-500 dark:text-neutral-400">
    {{ emptyLabel ?? 'No entries.' }}
  </div>
  <table v-else class="w-full border-collapse font-mono text-[11px]">
    <tbody>
      <tr
        v-for="row in rows"
        :key="row.rawKey"
        class="group border-b border-black/6 align-top last:border-b-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
      >
        <td class="w-44 max-w-48 px-3 py-1 break-all text-neutral-600 select-all dark:text-neutral-400">
          {{ row.key }}
        </td>
        <td
          class="py-1 pr-2 break-all text-neutral-900 dark:text-neutral-100"
          :class="isTruncated(row.value) ? 'cursor-pointer' : ''"
          @click="toggle(row.rawKey, row.value)"
        >
          <span>{{ displayValue(row.rawKey, row.value) }}</span>
          <button
            v-if="isTruncated(row.value)"
            type="button"
            class="text-brand-600 focus-visible:outline-brand-500 dark:text-brand-400 ml-1 cursor-pointer rounded border-0 bg-transparent p-0 text-[10px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-1"
            @click.stop="toggle(row.rawKey, row.value)"
          >
            {{ expanded.has(row.rawKey) ? 'show less' : 'show full' }}
          </button>
        </td>
        <td class="w-8 py-1 pr-2 text-right">
          <CopyButton
            :text="`${row.rawKey}: ${row.value}`"
            title="Copy header"
            class="opacity-0 group-hover:opacity-100"
          />
        </td>
      </tr>
    </tbody>
  </table>
</template>
