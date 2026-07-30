import { exposeInterceptors } from '@inertiajs/core'
import { createInertiaApp } from '@inertiajs/vue3'

const search = typeof window === 'undefined' ? '' : window.location.search

// `?devDelay=N` exposes the interceptor registry N ms after load instead of during boot, the
// way a code-split entry or a cold dev server would.
const devDelay = Number(new URLSearchParams(search).get('devDelay'))
const delayedDev = Number.isInteger(devDelay) && devDelay > 0

createInertiaApp({
  dev: !search.includes('noDevtools') && !delayedDev,
})

if (delayedDev) {
  window.setTimeout(exposeInterceptors, devDelay)
}
