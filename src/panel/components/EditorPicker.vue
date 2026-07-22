<script setup lang="ts">
import { EDITORS, type EditorOption } from '../lib/editors'
import { uiStore } from '../stores/ui'
import SelectField from './SelectField.vue'

const ui = uiStore
</script>

<template>
  <SelectField
    name="editor"
    aria-label="Editor for file links"
    :model-value="ui.editor"
    @change="(value) => ui.setEditor(value as EditorOption)"
  >
    <option v-for="option in EDITORS" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </SelectField>
</template>
