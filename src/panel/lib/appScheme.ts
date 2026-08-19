import { STRANDS_APP_SCHEME_TABS } from '../../browser'

/**
 * The `target` an app-scheme anchor carries.
 *
 * Chrome needs the tab. Its panel is a frame inside the devtools page, whose `frame-src *`
 * covers network schemes only, so navigating that frame to `vscode:` is blocked and the panel
 * is replaced by Chrome's blocked-content page. A tab is top-level, where the handoff is
 * allowed and Chrome discards the tab itself.
 */
export const APP_SCHEME_TARGET = STRANDS_APP_SCHEME_TABS ? undefined : '_blank'

let launcher: HTMLIFrameElement | null = null

/**
 * Launch an app-scheme url, reporting whether the click still needs its default.
 *
 * A hidden frame reaches the handler with no tab existing to strand. It is reused rather than
 * removed, because tearing it down while the launch prompt is open cancels the prompt.
 */
export function launchAppScheme(url: string): boolean {
  if (!STRANDS_APP_SCHEME_TABS) {
    return false
  }

  if (!launcher) {
    launcher = document.createElement('iframe')
    launcher.hidden = true

    document.body.append(launcher)
  }

  launcher.src = url

  return true
}
