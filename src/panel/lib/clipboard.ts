export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)

    return true
  } catch {
    return false
  }
}

export async function copyJson(value: unknown): Promise<boolean> {
  const json = JSON.stringify(value, null, 2)

  if (json === undefined) {
    return false
  }

  return copyText(json)
}
