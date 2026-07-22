<script setup lang="ts">
import { computed } from 'vue'
import type { Entry } from '../../types'
import { describeBody } from '../lib/bodies'
import { collectContainerPaths } from '../lib/props'
import CopyButton from './CopyButton.vue'
import KeyValueTable from './KeyValueTable.vue'
import PropsValueTree from './PropsValueTree.vue'
import TreeControls from './TreeControls.vue'

const props = defineProps<{
  entry: Entry
}>()

const requestBody = computed(() => describeBody(props.entry.http.requestBody))
const responseBody = computed(() => describeBody(props.entry.http.responseBody))

const requestBodyPaths = computed(() =>
  requestBody.value.kind === 'tree' ? collectContainerPaths(requestBody.value.value, 'http.requestBody') : [],
)

const responseBodyPaths = computed(() =>
  responseBody.value.kind === 'tree' ? collectContainerPaths(responseBody.value.value, 'http.responseBody') : [],
)

function sortByKey(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)))
}

const requestHeaders = computed(() => sortByKey(props.entry.http.requestHeaders ?? {}))
const responseHeaders = computed(() => sortByKey(props.entry.http.responseHeaders ?? {}))
</script>

<template>
  <div class="flex flex-col">
    <section>
      <h3
        class="sticky top-0 z-10 flex h-8 items-center justify-between border-b border-black/8 bg-neutral-50 px-3 py-1.5 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
      >
        <span>Request headers</span>
        <CopyButton :value="requestHeaders" title="Copy request headers" />
      </h3>
      <div>
        <KeyValueTable :entries="requestHeaders" empty-label="No request headers." />
      </div>
    </section>

    <section v-if="requestBody.kind !== 'none'">
      <h3
        class="sticky top-0 z-10 flex h-8 items-center justify-between border-y border-black/8 bg-neutral-50 px-3 py-1.5 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
      >
        <span>Request body</span>
        <div class="inline-flex items-center gap-1">
          <TreeControls v-if="requestBody.kind === 'tree'" :paths="requestBodyPaths" />
          <CopyButton v-if="requestBody.kind === 'tree'" :value="requestBody.value" title="Copy request body" />
          <CopyButton v-else-if="requestBody.kind === 'string'" :text="requestBody.value" title="Copy request body" />
        </div>
      </h3>
      <div class="px-3 py-1.5">
        <p v-if="requestBody.kind === 'notice'" class="m-0 text-[11px] text-neutral-400 italic dark:text-neutral-400">
          {{ requestBody.message }}
        </p>
        <pre
          v-else-if="requestBody.kind === 'string'"
          v-text="requestBody.value"
          class="m-0 font-mono text-[11px] break-all whitespace-pre-wrap text-neutral-800 dark:text-neutral-200"
        />
        <PropsValueTree
          v-else
          :value="requestBody.value"
          path="http.requestBody"
          :expanded-by-default="true"
          :root="true"
        />
      </div>
    </section>

    <section>
      <h3
        class="sticky top-0 z-10 flex h-8 items-center justify-between border-y border-black/8 bg-neutral-50 px-3 py-1.5 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
      >
        <span>Response headers</span>
        <CopyButton :value="responseHeaders" title="Copy response headers" />
      </h3>
      <div>
        <KeyValueTable :entries="responseHeaders" empty-label="No response headers." />
      </div>
    </section>

    <section v-if="responseBody.kind !== 'none'">
      <h3
        class="sticky top-0 z-10 flex h-8 items-center justify-between border-y border-black/8 bg-neutral-50 px-3 py-1.5 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
      >
        <span>Response body</span>
        <div class="inline-flex items-center gap-1">
          <TreeControls v-if="responseBody.kind === 'tree'" :paths="responseBodyPaths" />
          <CopyButton v-if="responseBody.kind === 'tree'" :value="responseBody.value" title="Copy response body" />
          <CopyButton
            v-else-if="responseBody.kind === 'string'"
            :text="responseBody.value"
            title="Copy response body"
          />
        </div>
      </h3>
      <div class="px-3 py-1.5">
        <p v-if="responseBody.kind === 'notice'" class="m-0 text-[11px] text-neutral-400 italic dark:text-neutral-400">
          {{ responseBody.message }}
        </p>
        <pre
          v-else-if="responseBody.kind === 'string'"
          v-text="responseBody.value"
          class="m-0 font-mono text-[11px] break-all whitespace-pre-wrap text-neutral-800 dark:text-neutral-200"
        />
        <PropsValueTree
          v-else
          :value="responseBody.value"
          path="http.responseBody"
          :expanded-by-default="true"
          :root="true"
        />
      </div>
    </section>
  </div>
</template>
