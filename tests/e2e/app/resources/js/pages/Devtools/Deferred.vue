<script setup lang="ts">
import { Deferred, router } from '@inertiajs/vue3'

defineProps<{
  eagerProp?: string
  lazyProp?: { value: string }
}>()

function reloadLazy(): void {
  router.reload({ only: ['lazyProp'] })
}
</script>

<template>
  <h1>Devtools Deferred</h1>
  <p id="eager">{{ eagerProp }}</p>
  <Deferred data="lazyProp">
    <template #fallback>
      <div id="lazy-fallback">Loading lazyProp...</div>
    </template>
    <div id="lazy-value">{{ lazyProp?.value }}</div>
  </Deferred>
  <button type="button" @click="reloadLazy">Reload lazyProp</button>
</template>
