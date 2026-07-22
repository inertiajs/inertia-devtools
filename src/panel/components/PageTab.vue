<script setup lang="ts">
import { computed } from 'vue'
import type { Entry } from '../../types'
import { pageStateStore } from '../stores/pageState'
import PropsValueTree from './PropsValueTree.vue'

const props = defineProps<{
  entry: Entry
}>()

const snapshot = computed(() => pageStateStore.snapshotForEntry(props.entry.__meta.id))

// The component/url are already shown in the header above; only surface them here when
// the recorded page state actually differs from this entry (so it isn't pure duplication).
const differsFromEntry = computed(
  () =>
    !!snapshot.value &&
    (snapshot.value.component !== props.entry.__meta.component || snapshot.value.url !== props.entry.__meta.url),
)

function nonEmptyFlash(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Object.keys(value).length === 0) {
    return null
  }

  return value as Record<string, unknown>
}

// Flash has two independent origins. A server response carries its flash inside the response
// body's page object, read straight from there per entry. A client-side `router.flash()` has
// no response, so it patches the live page snapshot in place; that takes precedence when set.
const flash = computed(() => {
  const fromSnapshot = nonEmptyFlash(snapshot.value?.flash)

  if (fromSnapshot) {
    return fromSnapshot
  }

  const body = props.entry.http.responseBody

  if (body.status === 'present' && body.value && typeof body.value === 'object') {
    return nonEmptyFlash((body.value as Record<string, unknown>).flash)
  }

  return null
})
</script>

<template>
  <div v-if="snapshot || flash">
    <template v-if="flash">
      <div class="border-b border-black/8 bg-neutral-50 px-3 dark:border-neutral-700 dark:bg-neutral-800">
        <div
          class="flex h-8 items-center text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
        >
          Flash
        </div>
      </div>
      <div class="px-3 py-2">
        <PropsValueTree :value="flash" path="page.flash" :expanded-by-default="true" :root="true" />
      </div>
    </template>

    <template v-if="snapshot">
      <div
        class="sticky top-0 z-10 border-b border-black/8 bg-neutral-50 px-3 dark:border-neutral-700 dark:bg-neutral-800"
      >
        <div
          class="flex h-8 items-center text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
        >
          Page state after this response
        </div>
        <div v-if="differsFromEntry" class="flex flex-col gap-0.5 pb-1.5">
          <div class="font-mono text-[11px] text-neutral-800 dark:text-neutral-200">
            {{ snapshot.component ?? 'Unknown component' }}
          </div>
          <div class="truncate font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
            {{ snapshot.url }}
          </div>
        </div>
      </div>

      <div class="px-3 py-2">
        <PropsValueTree :value="snapshot.props" path="page.snapshot" :expanded-by-default="true" :root="true" />
      </div>
    </template>
  </div>

  <div v-else class="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
    <span class="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
      No page snapshot recorded for this request
    </span>
    <span class="text-[11px] text-neutral-500 dark:text-neutral-400">
      Prefetches and entries recorded before the panel attached do not include one.
    </span>
  </div>
</template>
