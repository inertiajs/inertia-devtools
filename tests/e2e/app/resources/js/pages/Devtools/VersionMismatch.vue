<script setup lang="ts">
import { Link } from '@inertiajs/vue3'
</script>

<template>
  <h1>Devtools Version Mismatch</h1>
  <p>Click below to trigger a 409 version mismatch reload.</p>
  <Link href="/devtools/version-mismatch" id="trigger">Trigger mismatch</Link>
</template>
