import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Entry } from '../../types'
import { displayRequestType, entryDeferGroups, formatCache, urlPath } from './format'
import { entryTone } from './tone'

// Shared display model for an entry, used by both the timeline row and the detail
// header so they differ only in layout, not in how they derive what they show.
export function useEntryDisplay(entry: MaybeRefOrGetter<Entry>) {
  const meta = computed(() => toValue(entry).__meta)
  const tone = computed(() => entryTone(meta.value))
  const prefetchConsumption = computed(() => formatCache(meta.value))
  const requestTypeLabel = computed(() => displayRequestType(meta.value))
  const redirectTarget = computed(() => (meta.value.redirectLocation ? urlPath(meta.value.redirectLocation) : null))

  // A deferred request loads one defer group; surface its name (e.g. `deferred (failed)`).
  const deferGroups = computed(() => entryDeferGroups(toValue(entry)))

  // The page carried validation errors when its `errors` prop is a non-empty object or array.
  const hasErrors = computed(() => {
    const errors = toValue(entry).propValues?.errors

    if (errors === null || typeof errors !== 'object') {
      return false
    }

    return Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0
  })

  return { meta, tone, prefetchConsumption, requestTypeLabel, redirectTarget, hasErrors, deferGroups }
}
