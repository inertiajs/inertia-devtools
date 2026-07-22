export type EditorOption = 'phpstorm' | 'vscode' | 'vscode-insiders' | 'cursor' | 'zed' | 'sublime' | 'textmate' | 'off'

type EditorDefinition = {
  value: EditorOption
  label: string
  buildUrl: ((file: string, line: number) => string) | null
}

function pathScheme(scheme: string): (file: string, line: number) => string {
  return (file, line) => `${scheme}://file/${encodeURI(file)}:${line}`
}

function queryScheme(scheme: string): (file: string, line: number) => string {
  return (file, line) => `${scheme}://open?url=file://${encodeURI(file)}&line=${line}`
}

function fileQueryScheme(scheme: string): (file: string, line: number) => string {
  return (file, line) => `${scheme}://open?file=${encodeURI(file)}&line=${line}`
}

export const EDITORS: readonly EditorDefinition[] = [
  { value: 'cursor', label: 'Cursor', buildUrl: pathScheme('cursor') },
  { value: 'phpstorm', label: 'PhpStorm', buildUrl: fileQueryScheme('phpstorm') },
  { value: 'sublime', label: 'Sublime Text', buildUrl: queryScheme('subl') },
  { value: 'textmate', label: 'TextMate', buildUrl: queryScheme('txmt') },
  { value: 'vscode', label: 'VS Code', buildUrl: pathScheme('vscode') },
  { value: 'vscode-insiders', label: 'VS Code Insiders', buildUrl: pathScheme('vscode-insiders') },
  { value: 'zed', label: 'Zed', buildUrl: pathScheme('zed') },
  { value: 'off', label: 'No editor links', buildUrl: null },
]

export const EDITOR_OPTIONS: readonly EditorOption[] = EDITORS.map((editor) => editor.value)

// VS Code registers its vscode:// scheme natively on install. Sublime is kept as an option
// but is not the default: it ships no URL handler, so subl:// links do nothing until the user
// installs a third-party handler app.
export const DEFAULT_EDITOR: EditorOption = 'vscode'

export function buildEditorUrl(editor: EditorOption, file: string, line: number): string | null {
  const definition = EDITORS.find((entry) => entry.value === editor)

  return definition?.buildUrl ? definition.buildUrl(file, line) : null
}
