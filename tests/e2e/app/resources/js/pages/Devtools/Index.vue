<script setup lang="ts">
import { Link, router } from '@inertiajs/vue3'
import { ref } from 'vue'

defineProps<{
  greeting?: string
  submittedName?: string | null
  errors?: Record<string, string>
}>()

const precognitionStatus = ref('idle')

function submitValidationError(): void {
  router.post('/devtools/validation-error', { name: '' })
}

function reloadGreeting(): void {
  router.reload({ only: ['greeting'] })
}

function reloadFull(): void {
  router.reload()
}

function visitSameUrl(): void {
  router.visit('/devtools')
}

const jsonStatus = ref('idle')

async function fetchJson(): Promise<void> {
  jsonStatus.value = 'pending'

  const response = await fetch('/devtools/api-json?tags=alpha%2Cbeta', {
    headers: { Accept: 'application/json' },
  })

  jsonStatus.value = String(response.status)
}

async function triggerPrecognition(): Promise<void> {
  precognitionStatus.value = 'pending'

  const response = await fetch('/devtools/precognition', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Precognition: 'true',
      'X-Inertia': 'true',
    },
    body: JSON.stringify({
      email: 'precog@example.com',
      remember: false,
    }),
  })

  precognitionStatus.value = String(response.status)
}

function submitPostRender(): void {
  router.post('/devtools/post-render', {
    report: 'quarterly',
    remember: true,
    user: {
      name: 'John',
      email: 'john@example.com',
    },
  })
}

let clientPushCount = 0

function clientPushVisit(): void {
  clientPushCount++
  router.push({
    url: `/devtools?client-pushed=${clientPushCount}`,
    props: (current: Record<string, unknown>) => ({
      ...current,
      clientCounter: clientPushCount,
    }),
  })
}

function clientReplaceVisit(): void {
  router.replace({
    url: `/devtools?client-replaced=${Date.now()}`,
    props: (current: Record<string, unknown>) => ({
      ...current,
      clientReplacedAt: new Date().toISOString(),
    }),
  })
}

function serverFlash(): void {
  router.post('/devtools/flash', {}, { preserveScroll: true })
}

function clientFlash(): void {
  router.flash({ message: 'Client flash!', type: 'success' })
}
</script>

<template>
  <h1>Devtools Index</h1>
  <p id="greeting">{{ greeting }}</p>
  <p id="precognition-status">{{ precognitionStatus }}</p>
  <p id="json-status">{{ jsonStatus }}</p>
  <p id="submitted-name">{{ submittedName }}</p>
  <p id="name-error">{{ errors?.name }}</p>
  <nav>
    <Link href="/devtools/navigate">Navigate</Link>
    <Link href="/devtools/slow">Slow</Link>
    <Link href="/devtools/partial">Partial</Link>
    <Link href="/devtools/deferred">Deferred</Link>
    <Link href="/devtools/rescue">Rescue</Link>
    <Link href="/devtools/deferred-groups">Deferred groups</Link>
    <Link href="/devtools/prefetch-target" prefetch>Prefetch</Link>
    <Link href="/devtools/redirect-source" method="post" as="button">Redirect</Link>
    <Link href="/devtools/version-mismatch">Version mismatch</Link>
    <Link href="/devtools/server-error">Server error</Link>
    <Link href="/devtools/network-error">Network error</Link>
    <button type="button" @click="reloadGreeting">Reload greeting</button>
    <button type="button" @click="reloadFull">Reload full</button>
    <button type="button" @click="visitSameUrl">Visit same URL</button>
    <button type="button" @click="triggerPrecognition">Precognition</button>
    <button type="button" @click="fetchJson">Fetch JSON</button>
    <button type="button" @click="submitPostRender">Submit post render</button>
    <button type="button" @click="submitValidationError">Submit validation error</button>
    <button type="button" @click="clientPushVisit">Client push</button>
    <button type="button" @click="clientReplaceVisit">Client replace</button>
    <button type="button" @click="serverFlash">Server flash</button>
    <button type="button" @click="clientFlash">Client flash</button>
  </nav>
</template>
