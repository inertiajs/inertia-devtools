<script setup lang="ts">
defineProps<{ message?: string; note?: string }>()
</script>

<template>
  <h1>Devtools Prefetch Target</h1>
  <p id="message">{{ message }}</p>
  <p id="note">{{ note ?? 'note pending' }}</p>
</template>
