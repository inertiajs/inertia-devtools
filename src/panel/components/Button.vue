<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    pressed?: boolean
  }>(),
  {
    pressed: false,
  },
)

const buttonClasses = computed(() =>
  props.pressed
    ? 'inline-flex h-6 cursor-pointer items-center justify-center rounded-md px-2 text-[11px] font-medium shadow-xs ring-1 ring-inset dark:shadow-none bg-brand-50 text-brand-700 ring-brand-300 dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800'
    : 'inline-flex h-6 cursor-pointer items-center justify-center rounded-md bg-white px-2 text-[11px] font-medium text-neutral-700 shadow-xs ring-1 ring-black/[0.08] ring-inset hover:bg-neutral-50 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/5 dark:text-neutral-300 dark:shadow-none dark:ring-white/10 dark:hover:bg-white/10 dark:hover:text-neutral-100 dark:hover:ring-white/20',
)
</script>

<template>
  <button :class="buttonClasses">
    <slot />
  </button>
</template>
