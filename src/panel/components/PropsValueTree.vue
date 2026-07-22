<script setup lang="ts">
import { ChevronDown, ChevronRight } from '@lucide/vue'
import { computed } from 'vue'
import { copyText } from '../lib/clipboard'
import { formatLeafValue, isNonEmptyContainer, isRedacted, leafValueClass } from '../lib/values'
import { uiStore } from '../stores/ui'

defineOptions({ name: 'PropsValueTree' })

const props = defineProps<{
  value: unknown
  path: string
  keyLabel?: string | number
  expandedByDefault?: boolean
  root?: boolean
  hangCaret?: boolean
}>()

const ui = uiStore

type ValueKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'redacted' | 'unknown'

const kind = computed<ValueKind>(() => {
  if (props.value === null) {
    return 'null'
  }

  if (isRedacted(props.value)) {
    return 'redacted'
  }

  if (Array.isArray(props.value)) {
    return 'array'
  }

  switch (typeof props.value) {
    case 'object':
      return 'object'
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'unknown'
  }
})

const isContainer = computed(() => kind.value === 'object' || kind.value === 'array')

const childEntries = computed(() => {
  if (!isContainer.value) {
    return []
  }

  if (Array.isArray(props.value)) {
    return props.value.map((item, index) => ({ key: index, value: item }))
  }

  return Object.entries(props.value as Record<string, unknown>).map(([key, value]) => ({
    key,
    value,
  }))
})

// Empty containers keep their `[0]` / `{0}` label but are not expandable.
const isExpandable = computed(() => isNonEmptyContainer(props.value))

const isOpen = computed(() =>
  props.expandedByDefault ? !ui.expandedPaths.has(props.path) : ui.expandedPaths.has(props.path),
)

const summary = computed(() => {
  if (kind.value === 'array') {
    return `[${(props.value as unknown[]).length}]`
  }

  if (kind.value === 'object') {
    return `{${Object.keys(props.value as object).length}}`
  }

  return ''
})

const valueClass = computed(() => leafValueClass(props.value))

const leafDisplay = computed(() => formatLeafValue(props.value))

function toggle(): void {
  if (isExpandable.value) {
    ui.togglePath(props.path)
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (!isExpandable.value) {
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    ui.togglePath(props.path)

    return
  }

  if (event.key === 'ArrowRight' && !isOpen.value) {
    event.preventDefault()
    ui.togglePath(props.path)

    return
  }

  if (event.key === 'ArrowLeft' && isOpen.value) {
    event.preventDefault()
    ui.togglePath(props.path)
  }
}

async function copyValue(): Promise<void> {
  const text = typeof props.value === 'string' ? props.value : JSON.stringify(props.value)

  await copyText(text)
}

function childPath(key: string | number): string {
  return `${props.path}.${key}`
}
</script>

<template>
  <div v-if="root && isContainer" class="font-mono text-[11px]/7">
    <div v-if="childEntries.length === 0" class="text-neutral-400 dark:text-neutral-400">
      {{ kind === 'array' ? 'Empty array' : 'Empty object' }}
    </div>
    <PropsValueTree
      v-for="child in childEntries"
      v-else
      :key="child.key"
      :value="child.value"
      :path="childPath(child.key)"
      :key-label="child.key"
      :hang-caret="true"
    />
  </div>

  <div v-else class="font-mono text-[11px]/7">
    <div
      class="focus-visible:outline-brand-500 relative flex items-baseline gap-1 focus-visible:outline-2 focus-visible:-outline-offset-1"
      :class="isExpandable ? 'cursor-pointer select-none' : ''"
      :role="isExpandable ? 'button' : undefined"
      :tabindex="isExpandable ? 0 : undefined"
      :aria-expanded="isExpandable ? isOpen : undefined"
      @click="toggle"
      @keydown="onKeydown"
    >
      <template v-if="hangCaret">
        <span
          v-if="isExpandable"
          class="absolute top-1.5 -left-3 flex w-3 justify-center text-neutral-400 dark:text-neutral-400"
        >
          <component :is="isOpen ? ChevronDown : ChevronRight" class="size-3" aria-hidden="true" />
        </span>
      </template>
      <template v-else>
        <span v-if="isExpandable" class="inline-flex w-3 justify-center text-neutral-400 dark:text-neutral-400">
          <component :is="isOpen ? ChevronDown : ChevronRight" class="size-3" aria-hidden="true" />
        </span>
        <span v-else class="inline-block w-3" />
      </template>

      <span v-if="keyLabel !== undefined" class="text-neutral-700 dark:text-neutral-300">
        {{ keyLabel }}<span class="text-neutral-400 dark:text-neutral-400">:</span>
      </span>

      <span v-if="isContainer" class="text-neutral-400 dark:text-neutral-400">
        {{ summary }}
      </span>

      <span
        v-else
        class="focus-visible:outline-brand-500 cursor-pointer break-all focus-visible:outline-2 focus-visible:-outline-offset-1"
        :class="valueClass"
        role="button"
        tabindex="0"
        title="Copy value"
        aria-label="Copy value"
        @click.stop="copyValue"
        @keydown.enter.prevent="copyValue"
        @keydown.space.prevent="copyValue"
      >
        {{ leafDisplay }}
      </span>
    </div>

    <div v-if="isExpandable && isOpen" class="ml-1.5 border-l border-black/8 pl-2 dark:border-neutral-700">
      <PropsValueTree
        v-for="child in childEntries"
        :key="child.key"
        :value="child.value"
        :path="childPath(child.key)"
        :key-label="child.key"
      />
    </div>
  </div>
</template>
