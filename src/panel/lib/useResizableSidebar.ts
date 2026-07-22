import { computed, type ComputedRef, ref, type Ref } from 'vue'
import { uiStore } from '../stores/ui'

type ResizableSidebar = {
  resizing: Ref<boolean>
  sidebarStyle: ComputedRef<{ gridTemplateColumns: string }>
  startResize: (event: PointerEvent) => void
}

// Drive the sidebar/detail grid width from a pointer drag on the divider,
// persisting the result through the UI store.
export function useResizableSidebar(): ResizableSidebar {
  const resizing = ref(false)

  const sidebarStyle = computed(() => ({
    gridTemplateColumns: `${uiStore.sidebarWidth}px 6px 1fr`,
  }))

  function startResize(event: PointerEvent): void {
    resizing.value = true

    const startX = event.clientX
    const startWidth = uiStore.sidebarWidth

    const onMove = (moveEvent: PointerEvent): void => {
      uiStore.setSidebarWidth(startWidth + (moveEvent.clientX - startX))
    }

    const stopResize = (): void => {
      resizing.value = false
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }

    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
  }

  return { resizing, sidebarStyle, startResize }
}
