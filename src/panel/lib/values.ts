export const REDACTED_VALUE = '[REDACTED]'

export function isRedacted(value: unknown): boolean {
  return value === REDACTED_VALUE
}

export function isNonEmptyContainer(value: unknown): boolean {
  if (value === null || isRedacted(value) || typeof value !== 'object') {
    return false
  }

  return (Array.isArray(value) ? value.length : Object.keys(value).length) > 0
}

export function leafValueClass(value: unknown): string {
  if (value === null) {
    return 'text-neutral-500 dark:text-neutral-400 italic'
  }

  if (isRedacted(value)) {
    return 'text-rose-700 dark:text-rose-400 italic'
  }

  switch (typeof value) {
    case 'string':
      return 'text-emerald-700 dark:text-emerald-300'
    case 'number':
      return 'text-sky-700 dark:text-sky-300'
    case 'boolean':
      return 'text-amber-700 dark:text-amber-300'
    default:
      return 'text-neutral-800 dark:text-neutral-200'
  }
}

export function formatLeafValue(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (isRedacted(value)) {
    return REDACTED_VALUE
  }

  if (typeof value === 'string') {
    return `"${value}"`
  }

  return String(value)
}
