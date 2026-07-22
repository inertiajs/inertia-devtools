<script setup lang="ts">
import { router } from '@inertiajs/vue3'

defineProps<{
  appended?: string[]
  prepended?: string[]
  matched?: { id: number }[]
}>()

function resetAppended(): void {
  router.reload({ only: ['appended'], reset: ['appended'] })
}
</script>

<template>
  <h1>Devtools Merge</h1>
  <button type="button" @click="resetAppended">Reset appended</button>
</template>
