<script setup lang="ts">
import { Link } from '@inertiajs/vue3'

defineProps<{
  report?: string
  remember?: boolean
  user?: { name: string; email: string }
}>()
</script>

<template>
  <h1>Devtools Post Render Result</h1>
  <p id="report">{{ report }}</p>
  <p id="remember">{{ remember }}</p>
  <p id="user-name">{{ user?.name }}</p>
  <p id="user-email">{{ user?.email }}</p>
  <Link href="/devtools">Back</Link>
</template>
