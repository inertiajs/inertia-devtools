<script setup lang="ts">
defineProps<{ from?: string }>()
</script>

<template>
  <h1>Devtools Redirect Target</h1>
  <p id="from">{{ from }}</p>
</template>
