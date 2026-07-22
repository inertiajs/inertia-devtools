<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import type { EntryFilters, StatusRange } from '../../types'
import { METHOD_OPTIONS, REQUEST_TYPE_OPTIONS, STATUS_RANGE_OPTIONS, entriesStore } from '../stores/entries'
import SelectField from './SelectField.vue'

const entries = entriesStore

const search = shallowRef(entries.filters.search)

watch(
  () => entries.filters.search,
  (value) => {
    if (value !== search.value) {
      search.value = value
    }
  },
)

function onSearchInput(event: Event): void {
  entries.setSearch((event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <SelectField
      name="method"
      aria-label="Filter by HTTP method"
      :model-value="entries.filters.method"
      @change="(value) => entries.setFilter('method', value)"
    >
      <option v-for="m in METHOD_OPTIONS" :key="m" :value="m">
        {{ m === 'all' ? 'Method: all' : m }}
      </option>
    </SelectField>

    <SelectField
      name="requestType"
      aria-label="Filter by request type"
      :model-value="entries.filters.requestType"
      @change="(value) => entries.setFilter('requestType', value as EntryFilters['requestType'])"
    >
      <option v-for="t in REQUEST_TYPE_OPTIONS" :key="t" :value="t">
        {{ t === 'all' ? 'Type: all' : t }}
      </option>
    </SelectField>

    <SelectField
      name="statusRange"
      aria-label="Filter by status range"
      :model-value="entries.filters.statusRange"
      @change="(value) => entries.setFilter('statusRange', value as StatusRange)"
    >
      <option v-for="s in STATUS_RANGE_OPTIONS" :key="s" :value="s">
        {{ s === 'all' ? 'Status: all' : s }}
      </option>
    </SelectField>

    <input
      v-model="search"
      type="search"
      name="search"
      aria-label="Search requests by URL or component"
      placeholder="Search URL or component…"
      class="focus:ring-brand-500 h-6 min-w-0 flex-1 rounded-md bg-white px-2 text-[11px] text-neutral-800 shadow-xs ring-1 ring-black/8 ring-inset placeholder:text-neutral-400 focus:ring-2 focus:outline-none dark:bg-white/5 dark:text-neutral-200 dark:shadow-none dark:ring-white/10 dark:placeholder:text-neutral-600"
      @input="onSearchInput"
    />
  </div>
</template>
