<script setup lang="ts">
import { APP_SCHEME_TARGET, launchAppScheme } from '../lib/appScheme'

const props = defineProps<{ href: string }>()

function open(event: MouseEvent): void {
  if (launchAppScheme(props.href)) {
    event.preventDefault()
  }
}
</script>

<template>
  <a :href="href" :target="APP_SCHEME_TARGET" rel="noopener" @click="open">
    <slot />
  </a>
</template>
