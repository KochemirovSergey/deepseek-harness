/** Child-process filesystem calls; the parent never opens user-selected paths. */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { FsError } from '@deepseek-ai/dsh-fs'
import { instanceChildEnvironment, instancePolicy } from '@deepseek-ai/dsh-launch-environment'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-sandbox'
import { filesystemWorkerSource } from './worker-source.ts'

interface Frame {
  chunk?: string
  value?: unknown
  error?: { message: string; code: FsError['code'] }
}

/** Own confined workers until they exit, including cancellation and service disposal. */
export class FilesystemWorker {
  private readonly active = new Map<AbortController, Promise<void>>()
  private disposed = false
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly ctx: Context, private readonly diffBasisMaxBytes: number) {
    ctx.effect(() => async () => {
      this.disposed = true
      for (const controller of this.active.keys()) controller.abort()
      await Promise.allSettled(this.active.values())
    }, 'fs-sandbox: confined workers')
  }

  /**
   * Execute one fixed operation; serialize mutations to retain backend stale-write semantics.
   * @param operation - Fixed worker protocol operation.
   * @param args - JSON-compatible backend arguments.
   * @param signal - Cancellation kills the child before returning.
   * @returns The backend result; confinement or backend errors reject.
   */
  async call<T>(operation: string, args: unknown[], signal?: AbortSignal): Promise<T> {
    const run = async (): Promise<T> => {
      let result: unknown
      for await (const frame of this.frames(operation, args, signal)) result = frame.value === null ? undefined : frame.value
      return result as T
    }
    if (operation !== 'writeText' && operation !== 'editText') return run()
    const pending = this.tail.then(run, run)
    this.tail = pending.catch(() => undefined)
    return pending
  }

  /**
   * Stream decoded text with cancellation to the same confined backend.
   * @param target - Workspace file identity.
   * @param signal - Cancellation kills the worker.
   * @returns Text chunks from the stock backend; disposal waits for child exit.
   */
  async *text(target: unknown, signal?: AbortSignal): AsyncGenerator<string> {
    for await (const frame of this.frames('streamText', [target], signal)) {
      if (frame.chunk !== undefined) yield frame.chunk
    }
  }

  private async *frames(operation: string, args: unknown[], signal?: AbortSignal): AsyncGenerator<Frame> {
    const policy = instancePolicy
    if (policy === undefined || this.disposed) throw new FsError('filesystem worker unavailable', 'FS_SANDBOX_DENIED')
    signal?.throwIfAborted()
    const controller = new AbortController()
    const abort = (): void => { controller.abort() }
    const confined = await this.ctx.sandbox.confine([
      process.execPath, '--input-type=module', '-e', filesystemWorkerSource,
      import.meta.resolve('@deepseek-ai/cordis'), import.meta.resolve('@deepseek-ai/dsh-fs-local'),
      JSON.stringify({ cwd: policy.workspace, diffBasisMaxBytes: this.diffBasisMaxBytes }),
    ], { mode: 'workspace-write', workspaceRoot: policy.workspace })
    signal?.throwIfAborted()
    if (this.disposed) throw new FsError('filesystem worker disposed', 'FS_SANDBOX_DENIED')
    if (confined.enforcement !== 'full') throw new FsError('full filesystem isolation unavailable', 'FS_SANDBOX_DENIED')
    const command = confined.argv[0]
    if (command === undefined) throw new Error('empty confinement command')
    const child = spawn(command, confined.argv.slice(1), {
      cwd: policy.workspace, env: instanceChildEnvironment(), stdio: ['pipe', 'pipe', 'pipe'],
    })
    let failure: Error | undefined
    const done = new Promise<void>((resolve) => {
      child.once('error', (error) => { failure = error; resolve() })
      child.once('close', (code) => {
        if (code !== 0) failure ??= new Error('confined filesystem process failed')
        resolve()
      })
    })
    this.active.set(controller, done)
    const kill = (): void => { child.kill('SIGKILL') }
    controller.signal.addEventListener('abort', kill, { once: true })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted === true) abort()
    // Diagnostics may contain user paths; do not retain them in the parent logs.
    child.stderr.resume()
    child.stdin.on('error', (error) => { failure = error })
    child.stdin.end(JSON.stringify({ operation, args }) + '\n')
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    let completed = false
    try {
      for await (const line of lines) {
        const frame = JSON.parse(line) as Frame
        if (frame.error !== undefined) throw new FsError(frame.error.message, frame.error.code)
        if (Object.hasOwn(frame, 'value')) completed = true
        yield frame
      }
      await done
      if (controller.signal.aborted) throw new FsError('filesystem operation aborted', 'FS_ABORTED')
      if (failure !== undefined) throw failure
      if (!completed) throw new FsError('filesystem worker returned no result', 'FS_SANDBOX_DENIED')
    } finally {
      lines.close()
      kill()
      await done
      this.active.delete(controller)
      signal?.removeEventListener('abort', abort)
    }
  }
}
