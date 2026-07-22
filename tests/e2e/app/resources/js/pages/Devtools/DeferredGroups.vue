<script setup lang="ts">
import { Deferred } from '@inertiajs/vue3'

defineProps<{
  quickStat?: string
  slowStats?: { total: number }
  heavyData?: { id: number; name: string }[]
}>()
</script>

<template>
  <h1>Devtools Deferred Groups</h1>
  <p id="quick-stat">{{ quickStat }}</p>
  <Deferred data="slowStats">
    <template #fallback>
      <div id="slow-fallback">Loading slowStats...</div>
    </template>
    <div id="slow-total">{{ slowStats?.total }}</div>
  </Deferred>
  <Deferred data="heavyData">
    <template #fallback>
      <div id="heavy-fallback">Loading heavyData...</div>
    </template>
    <div id="heavy-name">{{ heavyData?.[0]?.name }}</div>
  </Deferred>
</template>
