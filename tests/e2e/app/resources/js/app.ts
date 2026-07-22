import { createInertiaApp } from '@inertiajs/vue3'

createInertiaApp({
  dev: typeof window === 'undefined' || !window.location.search.includes('noDevtools'),
})
