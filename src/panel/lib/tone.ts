import type { EntryMeta } from '../../types'

export const TONE = {
  success: {
    bar: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  redirect: {
    bar: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  clientError: {
    bar: 'bg-orange-500',
    text: 'text-orange-700 dark:text-orange-300',
    badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  },
  serverError: {
    bar: 'bg-red-500',
    text: 'text-red-700 dark:text-red-300',
    badge: 'bg-red-500/15 text-red-700 dark:text-red-300',
  },
  unknown: {
    bar: 'bg-neutral-400 dark:bg-neutral-600',
    text: 'text-neutral-500 dark:text-neutral-400',
    badge: 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-400',
  },
} as const

export type Tone = keyof typeof TONE

function statusTone(status: number): Tone {
  if (status >= 200 && status < 300) {
    return 'success'
  }

  if (status >= 300 && status < 400) {
    return 'redirect'
  }

  if (status >= 400 && status < 500) {
    return 'clientError'
  }

  if (status >= 500 && status < 600) {
    return 'serverError'
  }

  return 'unknown'
}

export function entryTone(meta: EntryMeta): Tone {
  return statusTone(meta.status)
}
