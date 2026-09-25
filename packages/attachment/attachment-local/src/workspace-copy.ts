/** Materialize verified attachment bytes without giving the parent a user-controlled write path. */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { instanceChildEnvironment, instancePolicy } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-sandbox'

// Bytes arrive only from the content-addressed store. All path operations run under
// Landlock, including mkdir and the final rename, so a workspace symlink cannot
// turn publication into a write to the main process's state.
const publisher = String.raw`
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
const target = process.argv[1];
await mkdir(dirname(target), { recursive: true });
const temporary = target + '.' + randomUUID();
try {
  const file = await open(temporary, 'wx', 0o600);
  await pipeline(process.stdin, file.createWriteStream());
  await rename(temporary, target);
} finally { await rm(temporary, { force: true }); }
`

/**
 * Workspace path for an already validated attachment reference.
 * @param ref - Validated durable file identity.
 * @returns Absolute workspace copy path.
 */
export function workspaceAttachmentPath(ref: FileAttachmentRef): string {
  if (instancePolicy === undefined) throw new Error('workspace attachment requires restricted policy')
  return join(instancePolicy.workspace, '.dsh-attachments', String(ref.attachmentId).slice(7), ref.name)
}

/**
 * Copy verified stored bytes through a confined publisher; no state path reaches the child.
 * @param ctx - host context with the administrator's sandbox backend.
 * @param ref - validated durable file identity.
 * @param bytes - storage stream that rejects digest or size mismatches.
 * @param signal - cancellation kills the child and stops storage reads.
 * @returns completion after publication; confinement or storage errors reject.
 */
export async function publishWorkspaceAttachment(
  ctx: Context, ref: FileAttachmentRef, bytes: AsyncIterable<Uint8Array>, signal?: AbortSignal,
): Promise<void> {
  const policy = instancePolicy
  if (policy === undefined) return
  signal?.throwIfAborted()
  const sandbox = ctx.get('sandbox')
  if (sandbox === undefined) throw new Error('attachment copy requires a sandbox provider')
  const confined = await sandbox.confine([
    process.execPath, '--input-type=module', '-e', publisher, workspaceAttachmentPath(ref),
  ], { mode: 'workspace-write', workspaceRoot: policy.workspace })
  if (confined.enforcement !== 'full') throw new Error('attachment copy requires full filesystem isolation')
  const command = confined.argv[0]
  if (command === undefined) throw new Error('empty confinement command')
  const child = spawn(command, confined.argv.slice(1), {
    cwd: policy.workspace, env: instanceChildEnvironment(), stdio: ['pipe', 'ignore', 'ignore'],
  })
  let failure: Error | undefined
  const done = new Promise<void>((resolve) => {
    child.once('error', (error) => { failure = error; resolve() })
    child.once('close', (code) => {
      if (code !== 0) failure ??= new Error('confined attachment publication failed')
      resolve()
    })
  })
  const kill = (): void => { child.kill('SIGKILL') }
  signal?.addEventListener('abort', kill, { once: true })
  if (signal?.aborted === true) kill()
  try {
    await pipeline(bytes, child.stdin, { ...(signal === undefined ? {} : { signal }) })
    await done
    signal?.throwIfAborted()
    if (failure !== undefined) throw failure
  } finally {
    kill()
    await done
    signal?.removeEventListener('abort', kill)
  }
}
