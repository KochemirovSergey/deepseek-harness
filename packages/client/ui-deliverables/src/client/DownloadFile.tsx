/** Browser downloads of complete authorized files, independent of document rendering. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { NS } from './locales.ts'

/** Read and deliver an original through the current Session's authorized file service. */
export type DownloadFile = (sessionId: SessionId, path: string, signal: AbortSignal) => Promise<void>

/**
 * Offer a retriable browser download without depending on preview or native applications.
 * @param props - file identity, authorized download operation, and copy.
 * @returns a button and accessible failure feedback.
 */
export function DownloadButton({ sessionId, path, downloadFile, t }: {
  sessionId: SessionId
  path: string
  downloadFile: DownloadFile
} & PropsLocale<typeof NS>) {
  const active = useRef<AbortController>()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    active.current = undefined
    setPending(false)
    setFailed(false)
    return () => { active.current?.abort() }
  }, [sessionId, path])
  const download = async () => {
    if (active.current !== undefined && !active.current.signal.aborted) return
    const controller = new AbortController()
    active.current = controller
    setPending(true)
    setFailed(false)
    try { await downloadFile(sessionId, path, controller.signal) }
    catch { if (!controller.signal.aborted) setFailed(true) }
    finally {
      if (active.current === controller) {
        active.current = undefined
        if (!controller.signal.aborted) setPending(false)
      }
    }
  }
  return <span>
    <Button size="sm" disabled={pending} onClick={() => { void download() }}>
      {t(pending ? 'download.pending' : 'download.action')}
    </Button>
    {failed && <span role="alert">{t('download.failed')}</span>}
  </span>
}

/**
 * Bind the preview header's authorized path to the same download button as file cards.
 * @param props - document path, Session identity, reader, and copy.
 * @returns the browser download control, including when the preview failed.
 */
export function DocumentDownload(props: PropsRuntime<'sidebar.right.tab.document.actions'> & PropsLocale<typeof NS> & {
  downloadFile: DownloadFile
}) {
  return <DownloadButton {...props} path={props.absolutePath} />
}
