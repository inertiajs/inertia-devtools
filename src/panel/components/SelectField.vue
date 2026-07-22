<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'

defineProps<{
  modelValue: string
  name: string
  ariaLabel: string
}>()

const emit = defineEmits<{
  (e: 'change', value: string): void
}>()

function onChange(event: Event): void {
  emit('change', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="inline-grid grid-cols-[1fr_auto] items-center">
    <select
      :name="name"
      :aria-label="ariaLabel"
      :value="modelValue"
      class="focus:ring-brand-500 col-span-full row-start-1 h-6 cursor-pointer appearance-none rounded-md bg-white pr-6 pl-1.5 text-[11px] text-neutral-700 shadow-xs ring-1 ring-black/8 ring-inset hover:ring-black/15 focus:ring-2 focus:outline-none dark:bg-white/5 dark:text-neutral-300 dark:shadow-none dark:ring-white/10"
      @change="onChange"
    >
      <slot />
    </select>
    <ChevronDown
      aria-hidden="true"
      class="pointer-events-none col-start-2 row-start-1 mr-2 size-3 place-self-center text-neutral-500 dark:text-neutral-400"
    />
  </div>
</template>
