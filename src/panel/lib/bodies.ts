import type { BodyCapture, OmittedReason } from '../../types'

export type BodyView =
  | { kind: 'none' }
  | { kind: 'notice'; message: string }
  | { kind: 'string'; value: string }
  | { kind: 'tree'; value: unknown }

const OMITTED_MESSAGES: Record<OmittedReason, string> = {
  'non-inertia-response': 'Non-Inertia response. Body not captured.',
  'non-inertia-request': 'Non-Inertia request. Body not captured.',
  'non-textual': 'Non-textual response. Body not captured.',
  streamed: 'Streamed response. Body not captured.',
  'too-large': 'Response too large. Body not captured.',
  unserializable: 'Body could not be serialized.',
  binary: 'Binary body. Not captured.',
}

export function describeBody(body: BodyCapture | undefined | null): BodyView {
  if (!body || body.status === 'empty') {
    return { kind: 'none' }
  }

  if (body.status === 'omitted') {
    return { kind: 'notice', message: OMITTED_MESSAGES[body.reason] ?? 'Body not captured.' }
  }

  if (typeof body.value === 'string') {
    return { kind: 'string', value: body.value }
  }

  return { kind: 'tree', value: body.value }
}
