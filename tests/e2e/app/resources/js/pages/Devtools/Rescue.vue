<script setup lang="ts">
import { Deferred } from '@inertiajs/vue3'

defineProps<{
  flaky?: unknown
}>()
</script>

<template>
  <h1>Devtools Rescue</h1>
  <Deferred data="flaky">
    <template #fallback>
      <div id="flaky-fallback">Loading flaky...</div>
    </template>
    <div id="flaky-value">{{ flaky ?? 'rescued' }}</div>
  </Deferred>
</template>
