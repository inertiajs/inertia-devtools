<script setup lang="ts">
import { router } from '@inertiajs/vue3'

defineProps<{
  always?: string
  heavy?: { rows: { id: number; label: string }[] }
  summary?: { total: number }
}>()

const reloadOnly = () => router.reload({ only: ['summary'] })
const reloadExcept = () => router.reload({ except: ['heavy'] })
const restoreCurrentHistoryUrl = () => {
  setTimeout(() => {
    if (window.history.state) {
      window.history.replaceState(window.history.state, '', window.location.href)
    }
  }, 0)
}

const reloadRapidlyWithHistoryRestores = () => {
  for (let index = 0; index < 3; index++) {
    setTimeout(() => {
      router.reload({
        only: ['summary'],
        onSuccess: restoreCurrentHistoryUrl,
      })
    }, index * 10)
  }
}
</script>

<template>
  <h1>Devtools Partial</h1>
  <p id="always">{{ always }}</p>
  <p id="summary-total">{{ summary?.total }}</p>
  <ul id="heavy-rows">
    <li v-for="row in heavy?.rows" :key="row.id">{{ row.label }}</li>
  </ul>
  <button type="button" id="reload-only" @click="reloadOnly">Reload only summary</button>
  <button type="button" id="reload-except" @click="reloadExcept">Reload except heavy</button>
  <button type="button" id="reload-rapid-history-restores" @click="reloadRapidlyWithHistoryRestores">
    Reload rapidly with history restores
  </button>
</template>
