<script setup lang="ts">
import { ChevronDown, ChevronRight } from '@lucide/vue'
import { computed } from 'vue'
import type { PropNode } from '../lib/props'
import { inertiaBadgeClass, propBadgeLabel } from '../lib/props'
import { usePropExpansion } from '../lib/usePropExpansion'
import { formatLeafValue, leafValueClass } from '../lib/values'
import CopyButton from './CopyButton.vue'
import EditorLink from './EditorLink.vue'
import PropsValueTree from './PropsValueTree.vue'

const INDENT_STEP_PX = 12
const ROW_BASE_PADDING_PX = 12

defineOptions({ name: 'PropsMetaTreeNode' })

const props = defineProps<{
  node: PropNode
  depth: number
  propValues?: Record<string, unknown>
}>()

const { isExpanded, toggle } = usePropExpansion()

const hasChildren = computed(() => props.node.children.length > 0)

const inertiaBadgeText = computed(() => propBadgeLabel(props.node.meta))

const inertiaBadgeTitle = computed(() => {
  const meta = props.node.meta

  if (meta?.deferGroup) {
    return `Defer group: ${meta.deferGroup}`
  }

  return meta?.inertiaType ?? ''
})

const hasValueEntry = computed(() => {
  if (!props.propValues) {
    return false
  }

  return Object.prototype.hasOwnProperty.call(props.propValues, props.node.path)
})

const rawValue = computed<unknown>(() => {
  if (!hasValueEntry.value) {
    return undefined
  }

  return props.propValues![props.node.path]
})

const valueKind = computed<'none' | 'inline' | 'tree'>(() => {
  if (!hasValueEntry.value) {
    return 'none'
  }

  const value = rawValue.value

  if (value === null) {
    return 'inline'
  }

  if (typeof value === 'object') {
    return hasChildren.value ? 'none' : 'tree'
  }

  return 'inline'
})

const inlineDisplay = computed(() => formatLeafValue(rawValue.value))

const inlineClass = computed(() => leafValueClass(rawValue.value))

const valueSummary = computed(() => {
  const value = rawValue.value

  if (Array.isArray(value)) {
    return `[${value.length}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).length}}`
  }

  return ''
})

const treePath = computed(() => `propvalue:${props.node.path}`)
const treeOpen = computed(() => isExpanded(props.node.path))

// An empty array/object keeps its `[0]` / `{0}` summary but is not expandable.
const hasTreeValue = computed(() => valueKind.value === 'tree' && childValueEntries.value.length > 0)

const source = computed(() => props.node.meta?.renderSource ?? props.node.meta?.shareSource ?? null)

const rowPaddingLeft = computed(() => `${props.depth * INDENT_STEP_PX + ROW_BASE_PADDING_PX}px`)
const nestIndentPx = computed(() => `${props.depth * INDENT_STEP_PX + ROW_BASE_PADDING_PX + 6}px`)

const childValueEntries = computed<Array<{ key: string | number; value: unknown }>>(() => {
  const value = rawValue.value

  if (Array.isArray(value)) {
    return value.map((item, index) => ({ key: index, value: item }))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => ({ key, value: item }))
  }

  return []
})

const isToggleable = computed(() => hasChildren.value || hasTreeValue.value)

function handleClick(): void {
  if (isToggleable.value) {
    toggle(props.node.path)
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (!isToggleable.value) {
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggle(props.node.path)

    return
  }

  if (event.key === 'ArrowRight' && !isExpanded(props.node.path)) {
    event.preventDefault()
    toggle(props.node.path)

    return
  }

  if (event.key === 'ArrowLeft' && isExpanded(props.node.path)) {
    event.preventDefault()
    toggle(props.node.path)
  }
}
</script>

<template>
  <li>
    <div
      :data-testid="`prop-meta-${node.path}`"
      class="group focus-visible:outline-brand-500 flex items-center gap-2 py-1 pr-3 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-1 dark:hover:bg-neutral-800/50"
      :class="isToggleable ? 'cursor-pointer' : ''"
      :style="{ paddingLeft: rowPaddingLeft }"
      :role="isToggleable ? 'button' : undefined"
      :tabindex="isToggleable ? 0 : undefined"
      :aria-expanded="isToggleable ? isExpanded(node.path) : undefined"
      @click="handleClick"
      @keydown="onKeydown"
    >
      <span
        v-if="hasChildren || hasTreeValue"
        :data-testid="`prop-meta-toggle-${node.path}`"
        class="inline-flex w-3 justify-center text-neutral-400 dark:text-neutral-400"
      >
        <component :is="isExpanded(node.path) ? ChevronDown : ChevronRight" class="size-3" aria-hidden="true" />
      </span>
      <span v-else class="inline-block w-3" />

      <span class="min-w-0 truncate text-neutral-800 dark:text-neutral-200" :title="node.path">
        {{ node.segment }}
      </span>

      <span v-if="valueKind === 'tree'" class="text-neutral-400 dark:text-neutral-400">
        {{ valueSummary }}
      </span>

      <span v-if="valueKind === 'inline'" class="min-w-0 flex-1 truncate" :class="inlineClass" :title="inlineDisplay">
        {{ inlineDisplay }}
      </span>
      <span v-else class="flex-1" />

      <span
        v-if="node.meta?.inertiaType"
        class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
        :class="inertiaBadgeClass(node.meta.inertiaType)"
        :title="inertiaBadgeTitle"
      >
        {{ inertiaBadgeText }}
      </span>

      <span
        v-if="node.meta?.reset"
        class="inline-flex items-center rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300"
        title="Merge reset this request (X-Inertia-Reset)"
      >
        Reset
      </span>

      <span
        v-if="node.meta?.rescued"
        class="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        title="Deferred prop failed to resolve and was rescued (Inertia::defer(rescue: true))"
      >
        Rescued
      </span>

      <span
        v-if="node.meta?.shared"
        class="bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
      >
        Shared
      </span>

      <EditorLink v-if="source" :file="source.file" :line="source.line" @click.stop />

      <CopyButton
        v-if="hasValueEntry"
        :value="rawValue"
        title="Copy prop as JSON"
        class="opacity-0 group-hover:opacity-100"
      />
      <!-- Reserve the copy button's footprint (size-3.5 icon + p-0.5 = 18px) on value-less rows
           so the trailing EditorLink and file path stay aligned across rows. -->
      <span v-else class="w-[18px] shrink-0" aria-hidden="true" />
    </div>

    <div
      v-if="hasTreeValue && treeOpen"
      class="border-l border-black/8 pl-2 dark:border-neutral-700"
      :style="{ marginLeft: nestIndentPx }"
    >
      <PropsValueTree
        v-for="child in childValueEntries"
        :key="child.key"
        :value="child.value"
        :path="`${treePath}.${child.key}`"
        :key-label="child.key"
      />
    </div>

    <ul v-if="hasChildren && isExpanded(node.path)" class="divide-y divide-black/8 dark:divide-neutral-800">
      <PropsMetaTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :prop-values="propValues"
      />
    </ul>
  </li>
</template>
