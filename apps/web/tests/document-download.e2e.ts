/** Browser download and real Office conversion through the shipped Web composition. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { expect, it } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'
import { realOfficeBytes } from './office-fixture.ts'

function russianOffice(extension: 'docx' | 'xlsx' | 'pptx'): Uint8Array {
  const parts = unzipSync(realOfficeBytes(extension))
  for (const name of Object.keys(parts)) {
    if (name.endsWith('.xml')) parts[name] = strToU8(strFromU8(parts[name]!).replaceAll('Office preview 中文文档', 'Office preview Отчёт 2026'))
  }
  return zipSync(parts)
}

it('previews Office and downloads original bytes even when a preview is unavailable', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url)),
    compareReplaySession: false, paceMs: 5,
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill('Reply with the single word LIGHTHOUSE and stop.')
    await input.press('Enter')
    const sessionId = await settled
    const cwd = scaffold.ctx.agents.get(sessionId)?.session.header.cwd
    if (cwd === undefined) throw new Error('Missing Session workspace')
    const fixtures = new Map<string, Uint8Array>([
      ...(['docx', 'xlsx', 'pptx'] as const).map(ext => [`Отчёт 2026.${ext}`, russianOffice(ext)] as const),
      ['broken.docx', new TextEncoder().encode('invalid office container')],
    ])
    for (const [name, bytes] of fixtures) await writeFile(join(cwd, name), bytes)
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()
    await page.locator('[data-sidebar-right-expand]').click()
    const column = page.locator('[data-rightbar-col]')
    await column.locator('[data-sidebar-right-guide-entry="files"]').click()
    const filesTab = column.locator('[data-dockkit-tab]').filter({ has: page.getByText('Files', { exact: true }) })
    for (const [name, bytes] of fixtures) {
      await filesTab.click()
      await column.locator('[data-files-entry="file"]').getByRole('button', { name, exact: true }).click()
      const preview = column.locator('[data-textpreview-url]').last()
      if (name.endsWith('.xlsx')) await preview.locator('[data-excel-preview]').waitFor()
      else if (name !== 'broken.docx') {
        await preview.locator('[data-pdf-page]').first().waitFor({ timeout: 60000 })
        await preview.locator('[data-pdf-text]').getByText('Office preview Отчёт 2026', { exact: true }).waitFor()
      } else {
        await preview.getByText(/cannot be previewed|conversion did not produce/i).waitFor({ timeout: 60000 })
      }
      const transfer = page.waitForEvent('download')
      await preview.getByRole('button', { name: 'Download', exact: true }).click()
      const download = await transfer
      expect(download.suggestedFilename()).toBe(name)
      const downloadedPath = await download.path()
      expect(downloadedPath).not.toBeNull()
      expect(await readFile(downloadedPath)).toEqual(Buffer.from(bytes))
      await mkdir('.artifacts/office-download', { recursive: true })
      await page.screenshot({ path: `.artifacts/office-download/${name}.png` })
    }
  } finally {
    await browser?.close()
    await scaffold.close()
  }
})
