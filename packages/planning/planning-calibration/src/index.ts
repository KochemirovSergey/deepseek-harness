/** Rebuildable local calibration samples, hierarchical estimates, and scheduling recommendations. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { foldPlanning } from '@deepseek-ai/dsh-planning'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { estimate, sampleFromAttempt, schedule } from './estimator.ts'
import { planningCalibrationDomainSpec } from './spec.ts'
import type {
  CalibratedEstimate,
  CalibrationEstimateRequest,
  CalibrationSample,
  ScheduleCandidate,
  ScheduleRecommendation,
} from './types.ts'

export type * from './types.ts'
export { estimate, isFirstAttemptSuccess, sampleFromAttempt, schedule } from './estimator.ts'
export { planningCalibrationDomainSpec, calibrationSampleSchema } from './spec.ts'
export { criticalPath } from './trace.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    planningCalibration: PlanningCalibrationService
  }
}

/** Storage-backed derived calibration provider. */
export class PlanningCalibrationService extends Service {
  static inject = ['storageDomain', 'sessions']
  private table?: KvTable<string, CalibrationSample>
  private readonly writes = new Set<Promise<void>>()
  private accepting = true

  constructor(ctx: Context) {
    super(ctx, 'planningCalibration')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(planningCalibrationDomainSpec)
    this.table = domain.table('samples')
    for (const session of this.ctx.sessions.list()) await this.ingestSession(session)
    this.ctx.on('session/event', (session, event) => { this.observeEvent(session, event) }, { global: true })
    this.ctx.effect(() => async () => {
      this.accepting = false
      await Promise.all(this.writes)
      await domain.close()
    }, 'planning-calibration.domainClose')
  }

  /**
   * Read current immutable samples from the derived cache.
   * @returns Detached sample snapshots.
   */
  samples(): CalibrationSample[] {
    return [...this.requireTable().entries()].map(([, sample]) => ({ ...sample, workTags: [...sample.workTags] }))
  }

  /**
   * Estimate one work cohort.
   * @param request - Work cohort and optional prior.
   * @returns Hierarchically calibrated estimate.
   */
  estimate(request: CalibrationEstimateRequest): CalibratedEstimate {
    return estimate(request, this.samples())
  }

  /**
   * Recommend work without changing candidate priority.
   * @param candidates - Priority-ordered work.
   * @param loadTarget - Fraction from 0.60 to 0.70.
   * @returns Capacity-safe recommendation.
   */
  schedule(candidates: readonly ScheduleCandidate[], loadTarget: number = 0.65): ScheduleRecommendation {
    return schedule(candidates, this.samples(), loadTarget)
  }

  /**
   * Upsert one derived calibration row.
   * @param sample - Full derived calibration row.
   * @returns Resolution after durable storage.
   */
  async record(sample: CalibrationSample): Promise<void> {
    if (!this.accepting) throw new Error('planning calibration service is closing')
    await this.requireTable().put(sample.id, { ...sample, workTags: [...sample.workTags] })
  }

  /**
   * Idempotently derive terminal attempts from one Session log.
   * @param session - Authoritative planning log.
   * @returns Number of terminal attempts upserted.
   */
  async ingestSession(session: Session): Promise<number> {
    let count = 0
    for (const attempt of foldPlanning(session.events).attempts.values()) {
      const sample = sampleFromAttempt(session.id, attempt)
      if (sample === undefined) continue
      await this.record(sample)
      count += 1
    }
    return count
  }

  private observeEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'planning/change' || event.data.operation !== 'finish' || !('attempt' in event.data)) return
    const sample = sampleFromAttempt(session.id, event.data.attempt)
    if (sample === undefined || !this.accepting) return
    const pending = this.record(sample)
      .catch((error: unknown) => { this.ctx.logger.warn(`planning calibration write failed: ${String(error)}`) })
    this.writes.add(pending)
    void pending.then(() => { this.writes.delete(pending) })
  }

  private requireTable(): KvTable<string, CalibrationSample> {
    if (this.table === undefined) throw new Error('planning calibration domain is not initialized')
    return this.table
  }
}

export default PlanningCalibrationService
