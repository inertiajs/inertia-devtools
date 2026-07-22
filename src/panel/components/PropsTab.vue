<script setup lang="ts">
import type { Entry } from '../../types'
import PropsMetaTree from './PropsMetaTree.vue'

defineProps<{
  entry: Entry
}>()
</script>

<template>
  <div>
    <PropsMetaTree :value="entry.props" :prop-values="entry.propValues" />
  </div>
</template>
