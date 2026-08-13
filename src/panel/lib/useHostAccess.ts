import { onMounted, onUnmounted, readonly, type Ref, ref, watch } from 'vue'
import { browser } from '../../browser'
import { connectionStore } from '../stores/connection'

type PermissionsEvent = {
  addListener(callback: () => void): void
  removeListener(callback: () => void): void
}

// Firefox hands a DevTools panel a much smaller API surface than a normal extension page, so
// `tabs` and `permissions` can both be missing here. Everything below treats them as optional and
// reports access when they are, since a false alarm is worse than no banner.
type OptionalApis = {
  permissions?: {
    contains?: (permissions: { origins: string[] }) => Promise<boolean>
    onAdded?: PermissionsEvent
    onRemoved?: PermissionsEvent
  }
  tabs?: {
    get?: (tabId: number) => Promise<{ url?: string }>
  }
}

/** Track whether the extension may access the inspected tab's origin. */
export function useHostAccess(): Readonly<Ref<boolean>> {
  const hasAccess = ref(true)

  const { permissions, tabs } = browser as unknown as OptionalApis

  async function check(): Promise<void> {
    const tabId = connectionStore.getTabId()

    if (tabId === null || !tabs?.get || !permissions?.contains) {
      return
    }

    try {
      const { url } = await tabs.get(tabId)

      // Internal pages (about:, chrome://, the new tab page) can never be recorded, and a banner
      // about host access would only be noise there.
      if (!url || !/^https?:\/\//.test(url)) {
        hasAccess.value = true

        return
      }

      hasAccess.value = await permissions.contains({ origins: [`${new URL(url).origin}/*`] })
    } catch {
      hasAccess.value = true
    }
  }

  function onPermissionsChanged(): void {
    void check()
  }

  watch(connectionStore.devtoolsTabId, () => void check())

  onMounted(() => {
    void check()

    permissions?.onAdded?.addListener(onPermissionsChanged)
    permissions?.onRemoved?.addListener(onPermissionsChanged)
  })

  onUnmounted(() => {
    permissions?.onAdded?.removeListener(onPermissionsChanged)
    permissions?.onRemoved?.removeListener(onPermissionsChanged)
  })

  return readonly(hasAccess)
}
