/** Adaptive-planning bundle dependency closure and opt-in capability rows. */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import PlanningService from '@deepseek-ai/dsh-planning'
import PlanningCalibrationService from '@deepseek-ai/dsh-planning-calibration'
import * as PlanningObserver from '@deepseek-ai/dsh-planning-observer'
import PlanningReviewService from '@deepseek-ai/dsh-planning-review'
import * as ToolPlanning from '@deepseek-ai/dsh-tool-planning'

const PACKAGE_NAMES = [
  '@deepseek-ai/dsh-planning',
  '@deepseek-ai/dsh-planning-calibration',
  '@deepseek-ai/dsh-planning-observer',
  '@deepseek-ai/dsh-planning-review',
  '@deepseek-ai/dsh-tool-planning',
] as const

describe('adaptive planning bundle', () => {
  it('ships every runtime dependency named by its opt-in Cordis patch', async () => {
    expect([
      PlanningService,
      PlanningCalibrationService,
      PlanningObserver,
      PlanningReviewService,
      ToolPlanning,
    ]).toHaveLength(PACKAGE_NAMES.length)
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    for (const packageName of PACKAGE_NAMES) expect(patch).toContain(`name: '${packageName}'`)
  })

  it('does not bundle the deployment-specific governance mutation adapter', async () => {
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).not.toContain('@deepseek-ai/dsh-planning-source-governance')
  })
})
