<script setup lang="ts">
import { SquareMinus, SquarePlus } from '@lucide/vue'
import { computed } from 'vue'
import { uiStore } from '../stores/ui'
import IconButton from './IconButton.vue'

// One toggle for expanding/collapsing a whole tree. `paths` is the full list of
// toggleable container paths (already namespaced by the caller). Both the value trees
// and the props meta tree are collapsed by default, so a path in the expanded set means
// open: the tree counts as fully expanded when every path is present.
const props = defineProps<{
  paths: string[]
}>()

const allExpanded = computed(
  () => props.paths.length > 0 && props.paths.every((path) => uiStore.expandedPaths.has(path)),
)

function toggle(): void {
  if (allExpanded.value) {
    uiStore.removeExpandedPaths(props.paths)
  } else {
    uiStore.addExpandedPaths(props.paths)
  }
}
</script>

<template>
  <IconButton
    v-if="paths.length > 0"
    type="button"
    :title="allExpanded ? 'Collapse all' : 'Expand all'"
    :aria-label="allExpanded ? 'Collapse all' : 'Expand all'"
    @click.stop="toggle"
  >
    <SquareMinus v-if="allExpanded" aria-hidden="true" class="size-3.5" />
    <SquarePlus v-else aria-hidden="true" class="size-3.5" />
  </IconButton>
</template>
