<script setup lang="ts">
import { Link } from '@inertiajs/vue3'

const inertiaPages = [
  { href: '/devtools', label: 'Index (POST buttons: flash, validation-error, post-render)' },
  { href: '/devtools/navigate', label: 'Navigate' },
  { href: '/devtools/partial', label: 'Partial reload' },
  { href: '/devtools/deferred', label: 'Deferred prop' },
  { href: '/devtools/deferred-groups', label: 'Deferred groups' },
  { href: '/devtools/prefetch-target', label: 'Prefetch target' },
  { href: '/devtools/rescue', label: 'Rescued deferred prop' },
  { href: '/devtools/merge', label: 'Merge props' },
  { href: '/devtools/redirect-target', label: 'Redirect target' },
  { href: '/devtools/slow', label: 'Slow request (>1s)' },
  { href: '/devtools/version-mismatch', label: 'Version mismatch (409 location)' },
  { href: '/devtools/server-error', label: 'Server error (500)' },
  { href: '/devtools/bulk-entry?i=1', label: 'Bulk entry (buffer eviction)' },
]

const externalPages = [
  { href: '/devtools/api-json', label: 'API JSON (non-Inertia response, still recorded)' },
  { href: '/non-inertia', label: 'Non-Inertia page (ignored by recorder)' },
]
</script>

<template>
  <h1>DevTools test app</h1>
  <p>Open the Inertia DevTools panel, then click through the scenarios below.</p>

  <h2>Inertia pages</h2>
  <ul>
    <li v-for="page in inertiaPages" :key="page.href">
      <Link :href="page.href">{{ page.label }}</Link>
    </li>
  </ul>

  <h2>Non-Inertia (full page load)</h2>
  <ul>
    <li v-for="page in externalPages" :key="page.href">
      <a :href="page.href">{{ page.label }}</a>
    </li>
  </ul>
</template>
