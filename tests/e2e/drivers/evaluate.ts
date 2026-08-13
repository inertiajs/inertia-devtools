import type { WebDriver } from 'selenium-webdriver'

export async function evaluate<T>(
  driver: WebDriver,
  failureMessage: string,
  preamble: string,
  script: string,
  ...args: unknown[]
): Promise<T> {
  const outcome = (await driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1]
     ${preamble}
     Promise.resolve((async () => { ${script} })()).then(
       (value) => done({ ok: true, value: value ?? null }),
       (error) => done({ ok: false, error: String(error) }),
     )`,
    ...args,
  )) as { ok: true; value: T } | { ok: false; error: string }

  if (!outcome.ok) {
    throw new Error(`${failureMessage}: ${outcome.error}`)
  }

  return outcome.value
}
