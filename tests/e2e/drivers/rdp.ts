import { connect, createServer, type Socket } from 'node:net'

type Packet = Record<string, unknown> & { error?: string; from?: string; message?: string; type?: string }

type Predicate = (packet: Packet) => boolean

type BufferedPacket = { expiresAt: number; packet: Packet }

type Waiter = {
  predicate: Predicate
  reject: (error: Error) => void
  resolve: (packet: Packet) => void
  timer: ReturnType<typeof setTimeout>
}

const CONNECT_TIMEOUT = 20_000
const CONNECT_RETRY_INTERVAL = 100
const CONNECT_ATTEMPT_TIMEOUT = 1_000
const UNCLAIMED_PACKET_TTL = 5_000
const UNCLAIMED_PACKET_LIMIT = 100

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
  private waiters = new Set<Waiter>()
  private closed = false
  private closeReason: Error | null = null

  // Replies and selected notifications are kept briefly until something claims them. A reply and
  // the notification it triggers often arrive in one TCP chunk, and the code that waits for the
  // notification only gets to register its listener after awaiting the reply.
  private unclaimed: BufferedPacket[] = []

  private constructor(socket: Socket) {
    this.socket = socket
    this.socket.on('data', (chunk) => this.consume(chunk))
    this.socket.on('error', (error) => this.close(toError(error)))
    this.socket.on('close', () => this.close(new Error('RDP socket closed')))
  }

  static async connect(port: number): Promise<Rdp> {
    const deadline = Date.now() + CONNECT_TIMEOUT
    let lastError: Error | null = null

    while (Date.now() < deadline) {
      try {
        const socket = await openSocket(port, Math.max(1, Math.min(CONNECT_ATTEMPT_TIMEOUT, deadline - Date.now())))
        const client = new Rdp(socket)

        await client.waitFor(
          (packet) => packet.from === 'root' && 'applicationType' in packet,
          'root greeting',
          Math.max(1, deadline - Date.now()),
        )

        return client
      } catch (error) {
        lastError = toError(error)

        if (Date.now() >= deadline) {
          break
        }

        await sleep(CONNECT_RETRY_INTERVAL)
      }
    }

    throw new Error(`Timed out connecting to Firefox RDP on port ${port}: ${lastError?.message ?? 'no response'}`)
  }

  private consume(chunk: Buffer): void {
    if (this.closed) {
      return
    }

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

      let packet: Packet

      try {
        packet = JSON.parse(this.buffer.subarray(colon + 1, colon + 1 + length).toString()) as Packet
      } catch (error) {
        this.close(new Error(`Invalid RDP packet: ${toError(error).message}`))

        return
      }

      this.buffer = this.buffer.subarray(colon + 1 + length)

      if (!this.resolveWaiting(packet)) {
        this.remember(packet)
      }
    }
  }

  waitFor(predicate: Predicate, label: string, timeout = 20_000): Promise<Packet> {
    if (this.closed) {
      return rejected(this.closeReason ?? new Error('RDP connection closed'))
    }

    const alreadyHere = this.claim(predicate)

    if (alreadyHere) {
      return Promise.resolve(alreadyHere)
    }

    let waiter: Waiter

    const promise = new Promise<Packet>((resolve, reject) => {
      waiter = {
        predicate,
        reject,
        resolve,
        timer: setTimeout(
          () => this.rejectWaiter(waiter, new Error(`Timed out waiting for ${label} over RDP`)),
          timeout,
        ),
      }

      this.waiters.add(waiter)
    })

    promise.catch(() => {})

    return promise
  }

  /** Take the oldest packet matching `predicate`, so no two waiters resolve on the same one. */
  private claim(predicate: Predicate): Packet | undefined {
    this.pruneUnclaimed()

    const index = this.unclaimed.findIndex(({ packet }) => predicate(packet))

    if (index === -1) {
      return undefined
    }

    const [{ packet }] = this.unclaimed.splice(index, 1)

    return packet
  }

  private resolveWaiting(packet: Packet): boolean {
    for (const waiter of Array.from(this.waiters)) {
      if (!this.waiters.has(waiter) || !waiter.predicate(packet)) {
        continue
      }

      this.resolveWaiter(waiter, packet)

      return true
    }

    return false
  }

  private resolveWaiter(waiter: Waiter, packet: Packet): void {
    clearTimeout(waiter.timer)
    this.waiters.delete(waiter)
    waiter.resolve(packet)
  }

  private rejectWaiter(waiter: Waiter, error: Error): void {
    clearTimeout(waiter.timer)
    this.waiters.delete(waiter)
    waiter.reject(error)
  }

  private remember(packet: Packet): void {
    if (!shouldBuffer(packet)) {
      return
    }

    this.pruneUnclaimed()
    this.unclaimed.push({ expiresAt: Date.now() + UNCLAIMED_PACKET_TTL, packet })

    if (this.unclaimed.length > UNCLAIMED_PACKET_LIMIT) {
      this.unclaimed.splice(0, this.unclaimed.length - UNCLAIMED_PACKET_LIMIT)
    }
  }

  private pruneUnclaimed(): void {
    const now = Date.now()

    this.unclaimed = this.unclaimed.filter(({ expiresAt }) => expiresAt > now)
  }

  private assertOpen(): void {
    if (this.closed) {
      throw this.closeReason ?? new Error('RDP connection closed')
    }
  }

  /**
   * Send a request and wait for the addressed actor's reply.
   *
   * Replies carry no `type`, which is what separates them from the notifications the server pushes
   * on the same socket.
   */
  async request(message: Packet & { to: string; type: string }, label = message.type): Promise<Packet> {
    this.assertOpen()

    const reply = this.waitFor((packet) => packet.from === message.to && !packet.type, label)
    const json = JSON.stringify(message)

    try {
      this.assertOpen()
      this.socket.write(`${Buffer.byteLength(json)}:${json}`)
    } catch (error) {
      this.close(toError(error))

      throw error
    }

    const packet = await reply

    if ('error' in packet) {
      throw new Error(formatPacketError(packet, label))
    }

    return packet
  }

  close(reason = new Error('RDP connection closed')): void {
    if (this.closed) {
      return
    }

    this.closed = true
    this.closeReason = reason
    this.buffer = Buffer.alloc(0)
    this.unclaimed = []

    for (const waiter of Array.from(this.waiters)) {
      this.rejectWaiter(waiter, reason)
    }

    this.waiters.clear()
    this.socket.destroy()
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
 * promise parks its JSON on a per-call global that this polls for.
 */
export async function evalAsync(evaluate: ConsoleEval, expression: string): Promise<string> {
  const key = `__e2e_${Date.now()}_${evalAsyncId++}`
  const slot = `globalThis[${JSON.stringify(key)}]`

  await evaluate(`${slot} = null; Promise.resolve(${expression}).then(
    (value) => { ${slot} = JSON.stringify(value ?? null) },
    (error) => { ${slot} = 'ERROR:' + error },
  ); 'started'`)

  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const parked = await evaluate(`typeof ${slot} === "string" ? ${slot} : ""`)

      if (typeof parked === 'string' && parked !== '') {
        if (parked.startsWith('ERROR:')) {
          throw new Error(`Promise rejected in the extension: ${parked}`)
        }

        return parked
      }

      await sleep(100)
    }
  } finally {
    await evaluate(`delete ${slot}; 'deleted'`).catch(() => {})
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

type ConsoleMessage = { message: { level: string; arguments: unknown[] } }
type ConsoleTab = { actor: string; url?: string }

/**
 * Read what a content tab logged to the console, which geckodriver exposes nowhere.
 *
 * The tab descriptors are resolved on every call rather than kept: a navigation replaces the window
 * global and with it the console actor, so a handle taken earlier reads a document that is gone. All
 * matching tabs are read in a stable order, so opening a second app tab cannot change which cache is
 * observed.
 */
export async function tabConsoleMessages(
  client: Rdp,
  urlPrefix: string,
): Promise<Array<{ key: string; level: string; text: string }>> {
  const { tabs } = (await client.request({ to: 'root', type: 'listTabs' })) as {
    tabs: ConsoleTab[]
  }

  const descriptors = tabs
    .filter((tab) => String(tab.url ?? '').startsWith(urlPrefix))
    .sort((left, right) => compareConsoleTabs(left, right))

  if (descriptors.length === 0) {
    throw new Error(`No tab is on ${urlPrefix}: ${tabs.map((tab) => tab.url).join(', ')}`)
  }

  const messages: Array<{ key: string; level: string; text: string }> = []

  for (const descriptor of descriptors) {
    const target = (await client.request({ to: descriptor.actor, type: 'getTarget' }, 'getTarget')) as {
      frame: { consoleActor: string }
    }

    const consoleActor = target.frame.consoleActor

    await client.request({ to: consoleActor, type: 'startListeners', listeners: ['ConsoleAPI'] }, 'startListeners')

    const cached = (await client.request(
      { to: consoleActor, type: 'getCachedMessages', messageTypes: ['ConsoleAPI'] },
      'getCachedMessages',
    )) as { messages: ConsoleMessage[] }

    messages.push(
      ...cached.messages.map(({ message }) => ({
        key: `${descriptor.actor}:${JSON.stringify(message)}`,
        level: message.level,
        text: message.arguments.map((argument) => String(argument)).join(' '),
      })),
    )
  }

  return messages
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

function shouldBuffer(packet: Packet): boolean {
  return !packet.type || packet.type === 'evaluationResult' || packet.type === 'target-available-form'
}

function formatPacketError(packet: Packet, label: string): string {
  const code = String(packet.error ?? 'unknownError')
  const message = typeof packet.message === 'string' ? packet.message : ''

  return message ? `RDP ${label} failed with ${code}: ${message}` : `RDP ${label} failed with ${code}`
}

function compareConsoleTabs(left: ConsoleTab, right: ConsoleTab): number {
  return (
    String(left.url ?? '').localeCompare(String(right.url ?? '')) ||
    String(left.actor).localeCompare(String(right.actor))
  )
}

function openSocket(port: number, timeout: number): Promise<Socket> {
  const socket = connect(port, '127.0.0.1')

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>

    function cleanup(): void {
      clearTimeout(timer)
      socket.off('connect', onConnect)
      socket.off('error', onError)
    }

    function onConnect(): void {
      cleanup()
      resolve(socket)
    }

    function onError(error: Error): void {
      cleanup()
      socket.destroy()
      reject(error)
    }

    timer = setTimeout(() => {
      cleanup()
      socket.destroy()
      reject(new Error(`Timed out opening Firefox RDP socket on port ${port}`))
    }, timeout)

    socket.once('connect', onConnect)
    socket.once('error', onError)
  })
}

function rejected(error: Error): Promise<never> {
  const promise = Promise.reject(error)

  promise.catch(() => {})

  return promise
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const PORT_BASE = 6100
const PORTS_PER_WORKER = 10
let evalAsyncId = 0

/**
 * Pick ports for one session.
 *
 * A driver and a debugger server have to be told their port up front, so an ephemeral port cannot be
 * reserved and handed over: two sessions asking the OS for a free port can be given the same one
 * before either binds it, and the loser then drives the winner's browser. Each session searches its
 * own disjoint slot instead, which makes that impossible. `slot` has to be unique across everything
 * running at once, so it counts browser projects as well as workers.
 */
export async function freePorts(slot: number, count: number): Promise<number[]> {
  const first = PORT_BASE + slot * PORTS_PER_WORKER
  const found: number[] = []

  for (let port = first; port < first + PORTS_PER_WORKER && found.length < count; port++) {
    if (await isFree(port)) {
      found.push(port)
    }
  }

  if (found.length < count) {
    throw new Error(`Only ${found.length} of ${count} ports free for slot ${slot} from ${first}`)
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
