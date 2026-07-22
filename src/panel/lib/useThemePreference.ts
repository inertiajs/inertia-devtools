import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { uiStore } from '../stores/ui'

// Keep the document's `dark` class in sync with the chosen theme, following the OS
// preference while the theme is set to `system`.
export function useThemePreference(): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')
  const systemPrefersDark = ref(prefersDark.matches)

  const isDark = computed(() => {
    if (uiStore.theme === 'dark') {
      return true
    }

    if (uiStore.theme === 'light') {
      return false
    }

    return systemPrefersDark.value
  })

  function applyTheme(): void {
    document.documentElement.classList.toggle('dark', isDark.value)
  }

  function onSystemChange(): void {
    systemPrefersDark.value = prefersDark.matches

    if (uiStore.theme === 'system') {
      applyTheme()
    }
  }

  watch(() => uiStore.theme, applyTheme)

  onMounted(() => {
    applyTheme()
    prefersDark.addEventListener('change', onSystemChange)
  })

  onUnmounted(() => {
    prefersDark.removeEventListener('change', onSystemChange)
  })
}
