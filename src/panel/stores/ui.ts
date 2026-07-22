import { reactive, readonly, toRef, watch } from 'vue'
import { browser } from '../../browser'
import type { DetailTab, Theme } from '../../types'
import { DEFAULT_EDITOR, EDITOR_OPTIONS, type EditorOption } from '../lib/editors'

export type { DetailTab, Theme } from '../../types'
export { DEFAULT_EDITOR, EDITOR_OPTIONS } from '../lib/editors'
export type { EditorOption } from '../lib/editors'

type UiState = {
  theme: Theme
  activeTab: DetailTab
  expandedPaths: Set<string>
  sidebarWidth: number
  editor: EditorOption
  autoFollow: boolean
}

type PersistedUi = {
  theme: Theme
  activeTab: DetailTab
  expandedPaths: string[]
  sidebarWidth: number
  editor: EditorOption
  autoFollow: boolean
}

type PersistedGlobalUi = Pick<PersistedUi, 'theme' | 'sidebarWidth' | 'editor' | 'autoFollow'>
type PersistedTabUi = Pick<PersistedUi, 'activeTab' | 'expandedPaths'>

const DEFAULT_SIDEBAR_WIDTH = 360
const MIN_SIDEBAR_WIDTH = 240
const MAX_SIDEBAR_WIDTH = 900
const DEFAULT_STORAGE_KEY = 'ui-prefs'
const GLOBAL_STORAGE_KEY = 'ui-global-prefs'

function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark'
}

function isDetailTab(value: unknown): value is DetailTab {
  return value === 'props' || value === 'http' || value === 'route' || value === 'page'
}

function isEditorOption(value: unknown): value is EditorOption {
  return typeof value === 'string' && (EDITOR_OPTIONS as readonly string[]).includes(value)
}

const state = reactive<UiState>({
  theme: 'system',
  activeTab: 'props',
  expandedPaths: new Set<string>(),
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  editor: DEFAULT_EDITOR,
  autoFollow: true,
})

let storageKey = DEFAULT_STORAGE_KEY
let unwatch: Array<() => void> = []

function applyStoredGlobal(raw: Partial<PersistedGlobalUi> | undefined): void {
  if (!raw) {
    return
  }

  if (isTheme(raw.theme)) {
    state.theme = raw.theme
  }

  if (typeof raw.sidebarWidth === 'number' && raw.sidebarWidth > 0) {
    state.sidebarWidth = clampSidebarWidth(raw.sidebarWidth)
  }

  if (isEditorOption(raw.editor)) {
    state.editor = raw.editor
  }

  if (typeof raw.autoFollow === 'boolean') {
    state.autoFollow = raw.autoFollow
  }
}

function applyStoredTab(raw: Partial<PersistedTabUi> | undefined): void {
  state.activeTab = 'props'
  state.expandedPaths = new Set()

  if (!raw) {
    return
  }

  if (isDetailTab(raw.activeTab)) {
    state.activeTab = raw.activeTab
  }

  if (Array.isArray(raw.expandedPaths)) {
    state.expandedPaths = new Set(raw.expandedPaths.filter((p): p is string => typeof p === 'string'))
  }
}

function globalSnapshot(): PersistedGlobalUi {
  return {
    theme: state.theme,
    sidebarWidth: state.sidebarWidth,
    editor: state.editor,
    autoFollow: state.autoFollow,
  }
}

function tabSnapshot(): PersistedTabUi {
  return {
    activeTab: state.activeTab,
    expandedPaths: [...state.expandedPaths],
  }
}

/**
 * Load global and tab-scoped preferences before installing storage watchers.
 */
async function loadPreferences(tabUuid: string | null): Promise<void> {
  unwatch.forEach((stop) => {
    stop()
  })
  unwatch = []

  storageKey = tabUuid ? `${DEFAULT_STORAGE_KEY}-${tabUuid}` : DEFAULT_STORAGE_KEY

  const storedGlobal = await browser.storage.local.get(GLOBAL_STORAGE_KEY)
  applyStoredGlobal(storedGlobal[GLOBAL_STORAGE_KEY] as Partial<PersistedGlobalUi> | undefined)

  const storedTab = await browser.storage.local.get(storageKey)
  applyStoredTab(storedTab[storageKey] as Partial<PersistedTabUi> | undefined)

  unwatch = [
    watch([() => state.theme, () => state.editor, () => state.sidebarWidth, () => state.autoFollow], () => {
      void browser.storage.local.set({
        [GLOBAL_STORAGE_KEY]: globalSnapshot(),
      })
    }),
    watch(
      [() => state.activeTab, () => [...state.expandedPaths]],
      () => {
        void browser.storage.local.set({ [storageKey]: tabSnapshot() })
      },
      { deep: true },
    ),
  ]
}

function cycleTheme(): void {
  const order: Theme[] = ['system', 'light', 'dark']
  state.theme = order[(order.indexOf(state.theme) + 1) % order.length]
}

function setTab(tab: DetailTab): void {
  state.activeTab = tab
}

function togglePath(path: string): void {
  if (state.expandedPaths.has(path)) {
    state.expandedPaths.delete(path)
  } else {
    state.expandedPaths.add(path)
  }
}

function clearExpandedPaths(): void {
  state.expandedPaths = new Set()
}

function addExpandedPaths(paths: string[]): void {
  paths.forEach((path) => state.expandedPaths.add(path))
}

function removeExpandedPaths(paths: string[]): void {
  paths.forEach((path) => state.expandedPaths.delete(path))
}

function setEditor(editor: EditorOption): void {
  state.editor = editor
}

function toggleAutoFollow(): void {
  state.autoFollow = !state.autoFollow
}

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

function setSidebarWidth(width: number): void {
  state.sidebarWidth = clampSidebarWidth(width)
}

export const uiStore = reactive({
  theme: readonly(toRef(state, 'theme')),
  activeTab: readonly(toRef(state, 'activeTab')),
  expandedPaths: readonly(toRef(state, 'expandedPaths')),
  sidebarWidth: readonly(toRef(state, 'sidebarWidth')),
  editor: readonly(toRef(state, 'editor')),
  autoFollow: readonly(toRef(state, 'autoFollow')),
  loadPreferences,
  cycleTheme,
  setTab,
  togglePath,
  clearExpandedPaths,
  addExpandedPaths,
  removeExpandedPaths,
  setEditor,
  setSidebarWidth,
  toggleAutoFollow,
})
