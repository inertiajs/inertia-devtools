<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'error'
    gap?: string
  }>(),
  {
    tone: 'neutral',
    gap: 'gap-1',
  },
)
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center px-4 text-center" :class="gap">
    <span
      class="text-[11px] font-medium"
      :class="tone === 'error' ? 'text-red-700 dark:text-red-300' : 'text-neutral-700 dark:text-neutral-300'"
    >
      <slot name="title" />
    </span>
    <span
      class="text-[11px]"
      :class="tone === 'error' ? 'font-mono text-red-600 dark:text-red-400' : 'text-neutral-500 dark:text-neutral-400'"
    >
      <slot name="description" />
    </span>
  </div>
</template>
