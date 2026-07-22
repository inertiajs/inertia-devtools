<script setup lang="ts">
import { CornerDownRight } from '@lucide/vue'

defineProps<{
  target: string
  location?: string | null
}>()
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded bg-amber-500/15 font-mono text-amber-700 dark:text-amber-300"
    :title="location ?? undefined"
  >
    <CornerDownRight class="size-3 shrink-0 opacity-70" aria-hidden="true" />
    <span class="truncate">{{ target }}</span>
  </span>
</template>
