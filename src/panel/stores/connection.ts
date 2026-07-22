import { reactive, readonly, type Ref, toRef } from 'vue'
import { browser } from '../../browser'
import { isRuntimeBroadcast } from '../../guards'
import type { RuntimeBroadcast } from '../../types'

// Single owner of the inspected tab id and the sole browser.runtime.onMessage listener for the
// panel. Stores register a handler here instead of attaching their own listener, so every
// broadcast is filtered by tab id exactly once and fans out to whoever cares.
type BroadcastHandler = (message: RuntimeBroadcast) => void

type ConnectionState = {
  devtoolsTabId: number | null
}

const state = reactive<ConnectionState>({
  devtoolsTabId: null,
})

const handlers = new Set<BroadcastHandler>()

let dispatcher: ((message: unknown) => void) | null = null

function attachToTab(tabId: number | null): void {
  state.devtoolsTabId = tabId
}

function getTabId(): number | null {
  return state.devtoolsTabId
}

function registerBroadcastHandler(handler: BroadcastHandler): () => void {
  handlers.add(handler)

  return () => {
    handlers.delete(handler)
  }
}

function stopDispatcher(): void {
  if (dispatcher === null) {
    return
  }

  browser.runtime.onMessage.removeListener(dispatcher)
  dispatcher = null
}

function startDispatcher(): () => void {
  if (dispatcher !== null) {
    return stopDispatcher
  }

  dispatcher = (message: unknown): void => {
    if (!isRuntimeBroadcast(message) || message.tabId !== state.devtoolsTabId) {
      return
    }

    handlers.forEach((handler) => {
      handler(message)
    })
  }

  browser.runtime.onMessage.addListener(dispatcher)

  return stopDispatcher
}

const devtoolsTabId: Readonly<Ref<number | null>> = readonly(toRef(state, 'devtoolsTabId'))

export const connectionStore = {
  devtoolsTabId,
  attachToTab,
  getTabId,
  registerBroadcastHandler,
  startDispatcher,
}
