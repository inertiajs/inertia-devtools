<script setup lang="ts">
import { Link, router } from '@inertiajs/vue3'

const trigger = () =>
  router.visit('/devtools/server-error', {
    onError: () => {},
    onHttpException: () => false,
  })
</script>

<template>
  <h1>Devtools Server Error</h1>
  <p>Click below to trigger a 500 response.</p>
  <button type="button" id="trigger" @click="trigger">Trigger 500</button>
  <Link href="/devtools">Back</Link>
</template>
