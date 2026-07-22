<script setup lang="ts">
import { Link } from '@inertiajs/vue3'

defineProps<{
  user?: { name: string; email: string }
  visitedAt?: string
}>()
</script>

<template>
  <h1>Devtools Navigate</h1>
  <p id="user-name">{{ user?.name }}</p>
  <p id="user-email">{{ user?.email }}</p>
  <p id="visited-at">{{ visitedAt }}</p>
  <Link href="/devtools">Back</Link>
</template>
