// Parse a URL that may be absolute or relative. Recorded entry URLs and cache-hit
// messages can carry either form, so fall back to a sentinel base that keeps pathname
// and search usable without throwing on a relative input.
export function parseUrl(url: string): URL {
  try {
    return new URL(url)
  } catch {
    return new URL(url, 'http://relative-path.invalid')
  }
}
