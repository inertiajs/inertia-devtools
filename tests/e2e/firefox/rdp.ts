import { connect, createServer, type Socket } from 'node:net'

type Packet = Record<string, unknown> & { from?: string; type?: string }

type Predicate = (packet: Packet) => boolean

/**
 * Firefox's Remote Debugging Protocol, enough of it to inspect the add-on.
 *
 * This is the Firefox stand-in for `serviceWorker.evaluate`: geckodriver drives pages but exposes
 * nothing of an extension's background page, so background state is read here instead. It is also
 * what opens the panel, because neither driver may navigate to a `moz-extension://` URL and only a
 * tab the extension opened itself can be driven. Frames are length-prefixed JSON:
 * `<byteLength>:<json>`.
 */
export class Rdp {
  private socket: Socket
  private buffer = Buffer.alloc(0)
  private listeners = new Set<(packet: Packet) => void>()

  // Packets are kept until something claims them. A reply and the notification it triggers often
  // arrive in one TCP chunk, and the code that waits for the notification only gets to register its
  // listener after awaiting the reply, so a listener-only client drops the notification.
  private unclaimed: Packet[] = []

  private constructor(socket: Socket) {
    this.socket = socket
    this.socket.on('data', (chunk) => this.consume(chunk))
  }

  static async connect(port: number): Promise<Rdp> {
    const socket = connect(port, '127.0.0.1')

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })

    const client = new Rdp(socket)
    await client.waitFor((packet) => packet.from === 'root' && 'applicationType' in packet, 'root greeting')

    return client
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])

    for (;;) {
      const colon = this.buffer.indexOf(0x3a)

      if (colon === -1) {
        return
      }

      const length = Number(this.buffer.subarray(0, colon).toString())

      if (this.buffer.length < colon + 1 + length) {
        return
      }

      const packet = JSON.parse(this.buffer.subarray(colon + 1, colon + 1 + length).toString()) as Packet
      this.buffer = this.buffer.subarray(colon + 1 + length)
      this.unclaimed.push(packet)

      // Copied because a listener that claims a packet removes itself from the set while iterating.
      for (const listener of Array.from(this.listeners)) {
        listener(packet)
      }
    }
  }

  waitFor(predicate: Predicate, label: string, timeout = 20_000): Promise<Packet> {
    const alreadyHere = this.claim(predicate)

    if (alreadyHere) {
      return Promise.resolve(alreadyHere)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener)
        reject(new Error(`Timed out waiting for ${label} over RDP`))
      }, timeout)

      const listener = (): void => {
        const packet = this.claim(predicate)

        if (!packet) {
          return
        }

        clearTimeout(timer)
        this.listeners.delete(listener)
        resolve(packet)
      }

      this.listeners.add(listener)
    })
  }

  /** Take the oldest packet matching `predicate`, so no two waiters resolve on the same one. */
  private claim(predicate: Predicate): Packet | undefined {
    const index = this.unclaimed.findIndex(predicate)

    if (index === -1) {
      return undefined
    }

    const [packet] = this.unclaimed.splice(index, 1)

    return packet
  }

  /**
   * Send a request and wait for the addressed actor's reply.
   *
   * Replies carry no `type`, which is what separates them from the notifications the server pushes
   * on the same socket.
   */
  async request(message: Packet & { to: string; type: string }, label = message.type): Promise<Packet> {
    const reply = this.waitFor((packet) => packet.from === message.to && !packet.type, label)
    const json = JSON.stringify(message)

    this.socket.write(`${Buffer.byteLength(json)}:${json}`)

    return await reply
  }

  close(): void {
    this.socket.end()
  }
}

/** A JS evaluation channel into one extension page. */
export type ConsoleEval = (expression: string) => Promise<unknown>

function consoleEval(client: Rdp, consoleActor: string): ConsoleEval {
  return async (expression) => {
    const started = await client.request({ to: consoleActor, type: 'evaluateJSAsync', text: expression }, 'evaluateJS')
    const result = await client.waitFor(
      (packet) => packet.type === 'evaluationResult' && packet.resultID === started.resultID,
      `evaluationResult of \`${expression.slice(0, 60)}\``,
    )

    if (result.exception) {
      throw new Error(`Evaluation failed: ${JSON.stringify(result.exception).slice(0, 300)}`)
    }

    return result.result
  }
}

/**
 * Resolve a promise inside an extension page.
 *
 * The console actor's top-level-await mapping rejects an `await` nested in call arguments, so the
 * promise parks its JSON on a global that this polls for.
 */
export async function evalAsync(evaluate: ConsoleEval, expression: string): Promise<string> {
  await evaluate(`globalThis.__e2e = null; Promise.resolve(${expression}).then(
    (value) => { globalThis.__e2e = JSON.stringify(value ?? null) },
    (error) => { globalThis.__e2e = 'ERROR:' + error },
  ); 'started'`)

  for (let attempt = 0; attempt < 100; attempt++) {
    const parked = await evaluate('typeof globalThis.__e2e === "string" ? globalThis.__e2e : ""')

    if (typeof parked === 'string' && parked !== '') {
      if (parked.startsWith('ERROR:')) {
        throw new Error(`Promise rejected in the extension: ${parked}`)
      }

      return parked
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Promise never settled in the extension: ${expression.slice(0, 80)}`)
}

/** Open an evaluation channel to the background page of an installed add-on. */
export async function attachToBackground(client: Rdp, addonId: string): Promise<ConsoleEval> {
  const { addons } = (await client.request({ to: 'root', type: 'listAddons' })) as {
    addons: Array<{ id: string; actor: string }>
  }

  const addon = addons.find((candidate) => candidate.id === addonId)

  if (!addon) {
    throw new Error(`Add-on ${addonId} is not installed`)
  }

  const watcher = (await client.request({ to: addon.actor, type: 'getWatcher' })) as { actor: string }

  // The first target to arrive is the DevTools fallback page, so wait for the generated background
  // page specifically. Both target types are watched because the background page of an event-page
  // add-on is reported under the extension process, not the toolbox frame.
  const background = client.waitFor(
    (packet) => packet.type === 'target-available-form' && isExtensionPage(packet, '_generated_background_page.html'),
    'background page target',
  )

  await client.request({ to: watcher.actor, type: 'watchTargets', targetType: 'frame' }, 'watch frames')
  await client.request({ to: watcher.actor, type: 'watchTargets', targetType: 'process' }, 'watch processes')

  return consoleEval(client, targetConsoleActor(await background))
}

function isExtensionPage(packet: Packet, path: string): boolean {
  const target = packet.target as { url?: string; consoleActor?: string } | undefined

  return (
    !!target?.consoleActor &&
    String(target.url ?? '').startsWith('moz-extension://') &&
    String(target.url).includes(path)
  )
}

function targetConsoleActor(packet: Packet): string {
  return (packet.target as { consoleActor: string }).consoleActor
}

const PORT_BASE = 6100
const PORTS_PER_WORKER = 10

/**
 * Pick ports for one Playwright worker.
 *
 * Both the driver and the debugger server have to be told their port up front, so an ephemeral port
 * cannot be reserved and handed over: two workers asking the OS for a free port can be given the
 * same one before either binds it, and the loser then drives the winner's browser. Each worker
 * searches its own disjoint slot instead, which makes that impossible.
 */
export async function freePorts(parallelIndex: number, count: number): Promise<number[]> {
  const first = PORT_BASE + parallelIndex * PORTS_PER_WORKER
  const found: number[] = []

  for (let port = first; port < first + PORTS_PER_WORKER && found.length < count; port++) {
    if (await isFree(port)) {
      found.push(port)
    }
  }

  if (found.length < count) {
    throw new Error(`Only ${found.length} of ${count} ports free for worker ${parallelIndex} from ${first}`)
  }

  return found
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}
