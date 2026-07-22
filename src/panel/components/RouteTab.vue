<script setup lang="ts">
import { computed } from 'vue'
import type { Entry } from '../../types'
import EditorLink from './EditorLink.vue'

const props = defineProps<{
  entry: Entry
}>()

const routeFields = computed(() => [
  { label: 'Name', value: props.entry.route.name ?? null },
  { label: 'URI', value: props.entry.route.uri ?? null },
  { label: 'Action', value: props.entry.route.action ?? null },
  { label: 'Component', value: props.entry.__meta.component ?? null },
])

const hasActionSource = computed(() => Boolean(props.entry.route.actionSource?.file))
const hasComponentPath = computed(() => Boolean(props.entry.componentPath))
const hasRenderSource = computed(() => Boolean(props.entry.renderSource?.file))
</script>

<template>
  <div class="p-3">
    <dl class="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 gap-y-2 text-[11px]/5">
      <template v-for="field in routeFields" :key="field.label">
        <dt class="text-neutral-500 dark:text-neutral-400">{{ field.label }}</dt>
        <dd class="min-w-0 font-mono break-all text-neutral-900 dark:text-neutral-100">
          <span v-if="field.value">{{ field.value }}</span>
          <span v-else class="text-neutral-400 dark:text-neutral-400">-</span>
        </dd>
      </template>

      <template v-if="hasActionSource">
        <dt class="text-neutral-500 dark:text-neutral-400">Source</dt>
        <dd class="min-w-0">
          <EditorLink :file="props.entry.route.actionSource?.file" :line="props.entry.route.actionSource?.line" />
        </dd>
      </template>

      <template v-if="hasComponentPath">
        <dt class="text-neutral-500 dark:text-neutral-400">Component file</dt>
        <dd class="min-w-0">
          <EditorLink :file="props.entry.componentPath" />
        </dd>
      </template>

      <template v-if="hasRenderSource">
        <dt class="text-neutral-500 dark:text-neutral-400">Render call</dt>
        <dd class="min-w-0">
          <EditorLink :file="props.entry.renderSource?.file" :line="props.entry.renderSource?.line" />
        </dd>
      </template>
    </dl>
  </div>
</template>
