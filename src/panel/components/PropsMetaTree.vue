<script setup lang="ts">
import { computed } from 'vue'
import { buildPropTree, type PropMeta } from '../lib/props'
import PropsMetaTreeNode from './PropsMetaTreeNode.vue'

const props = defineProps<{
  value: Record<string, PropMeta>
  propValues?: Record<string, unknown>
}>()

const tree = computed(() => buildPropTree(props.value ?? {}))
</script>

<template>
  <div v-if="tree.length === 0" class="px-2 py-4 text-center text-[11px] text-neutral-500 dark:text-neutral-400">
    No props recorded.
  </div>

  <ul v-else class="divide-y divide-black/8 font-mono text-[11px] dark:divide-neutral-800">
    <PropsMetaTreeNode v-for="node in tree" :key="node.path" :node="node" :depth="0" :prop-values="propValues" />
  </ul>
</template>
