/** Complete-file downloads reuse bounded, authorized workspace reads. */
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { DownloadFile } from './DownloadFile.tsx'

/**
 * Create a browser download operation for original bytes; no conversion or partial reads.
 * @param remote - the authenticated workspace-file service.
 * @returns an operation that rejects before creating a download on read failure.
 */
export function createDownloadFile(remote: Pick<ClientRemote, 'workspaceFiles'>): DownloadFile {
  return async (sessionId, path, signal) => {
    const result = await remote.workspaceFiles.readBytes(sessionId, path, {}, signal)
    signal.throwIfAborted()
    if (!result.ok) throw result.error
    const file = result.value
    if (!file.eof || file.offset !== 0 || (file.bytes !== undefined && file.bytes !== file.data.byteLength)) {
      throw new Error('Incomplete file download')
    }
    const name = file.absolutePath.slice(Math.max(file.absolutePath.lastIndexOf('/'), file.absolutePath.lastIndexOf('\\')) + 1)
    const url = URL.createObjectURL(new Blob([Uint8Array.from(file.data)], { type: 'application/octet-stream' }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.append(link)
    try { link.click() }
    finally {
      link.remove()
      // The browser must consume the click before its temporary URL is released.
      setTimeout(() => { URL.revokeObjectURL(url) }, 0)
    }
  }
}
