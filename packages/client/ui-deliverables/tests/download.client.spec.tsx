// @vitest-environment jsdom
/** Original downloads preserve bytes and cannot publish partial or denied reads. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createDownloadFile } from '../src/client/download.ts'
import { type DownloadFile, DownloadButton } from '../src/client/DownloadFile.tsx'
import { en } from '../src/client/locales.ts'

const sessionId = 'download-test' as SessionId
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const file = { absolutePath: '/workspace/Отчёт 2026.docx', data: new Uint8Array([0, 1, 255, 37]), eof: true, offset: 0 }

it('saves complete bytes with the original Unicode basename and releases the URL', async () => {
  vi.useFakeTimers()
  let blob: Blob | undefined
  const create = vi.fn((value: Blob) => { blob = value; return 'blob:original' })
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe('Отчёт 2026.docx')
    expect(this.href).toBe('blob:original')
    expect(this.isConnected).toBe(true)
  })
  const readBytes = vi.fn().mockResolvedValue({ ok: true, value: file })
  await createDownloadFile({ workspaceFiles: { readBytes } } as never)(sessionId, file.absolutePath, new AbortController().signal)
  expect(readBytes).toHaveBeenCalledWith(sessionId, file.absolutePath, {}, expect.any(AbortSignal))
  expect(blob?.size).toBe(4)
  expect(click).toHaveBeenCalledOnce()
  expect(document.querySelector('a[download]')).toBeNull()
  await vi.runAllTimersAsync()
  expect(revoke).toHaveBeenCalledWith('blob:original')
})

it.each([
  { ok: false, error: new Error('access denied') },
  { ok: false, error: new Error('file too large') },
  { ok: true, value: { ...file, eof: false } },
  { ok: true, value: { ...file, offset: 1 } },
  { ok: true, value: { ...file, bytes: 100 } },
])('does not download an unsuccessful or partial response', async (result) => {
  const create = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create })
  const readBytes = vi.fn().mockResolvedValue(result)
  await expect(createDownloadFile({ workspaceFiles: { readBytes } } as never)(sessionId, '/file', new AbortController().signal)).rejects.toThrow()
  expect(create).not.toHaveBeenCalled()
})

it('shows a retriable failure and cancels a read when its control unmounts', async () => {
  let signal: AbortSignal | undefined
  const downloadFile = vi.fn<DownloadFile>().mockRejectedValueOnce(new Error('missing')).mockImplementation((_id, _path, value) => {
    signal = value
    return new Promise<void>((_resolve, reject) => { value.addEventListener('abort', () => { reject(new Error('Download aborted')) }) })
  })
  const view = render(<DownloadButton sessionId={sessionId} path="report.docx" downloadFile={downloadFile} t={makeTranslate(en)} />)
  fireEvent.click(view.getByRole('button', { name: 'Download' }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe(en['download.failed']) })
  fireEvent.click(view.getByRole('button', { name: 'Download' }))
  await waitFor(() => { expect(view.getByRole('button', { name: 'Downloading…' }).hasAttribute('disabled')).toBe(true) })
  view.unmount()
  expect(signal?.aborted).toBe(true)
})
