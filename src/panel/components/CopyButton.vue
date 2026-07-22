<script setup lang="ts">
import { Check, Copy } from '@lucide/vue'
import { shallowRef } from 'vue'
import { copyJson, copyText } from '../lib/clipboard'
import IconButton from './IconButton.vue'

const COPY_FEEDBACK_MS = 1200

const props = defineProps<{
  text?: string
  value?: unknown
  title?: string
}>()

const copied = shallowRef(false)

async function copy(): Promise<void> {
  const ok = props.value !== undefined ? await copyJson(props.value) : await copyText(props.text ?? '')

  if (!ok) {
    copied.value = false

    return
  }

  copied.value = true
  setTimeout(() => (copied.value = false), COPY_FEEDBACK_MS)
}
</script>

<template>
  <IconButton type="button" :title="title ?? 'Copy'" :aria-label="title ?? 'Copy'" @click.stop="copy">
    <Check v-if="copied" aria-hidden="true" class="size-3.5 text-emerald-600 dark:text-emerald-400" />
    <Copy v-else aria-hidden="true" class="size-3.5" />
  </IconButton>
</template>
