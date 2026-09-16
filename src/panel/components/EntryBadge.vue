<script setup lang="ts">
import { CornerDownRight, Layers } from '@lucide/vue'

const TONES = {
  layer: { icon: Layers, classes: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  redirect: { icon: CornerDownRight, classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
} as const

defineProps<{
  tone: keyof typeof TONES
  label: string
  title?: string | null
}>()
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded font-mono"
    :class="TONES[tone].classes"
    :title="title ?? undefined"
  >
    <component :is="TONES[tone].icon" class="size-3 shrink-0 opacity-70" aria-hidden="true" />
    <span class="truncate">{{ label }}</span>
  </span>
</template>
