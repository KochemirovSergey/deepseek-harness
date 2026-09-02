/** Durable planning-stream invariant companion. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { applyPlanningEvent, clonePlanningState, emptyPlanningState } from './fold.ts'
import type { PlanningFoldState } from './fold.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-planning'
export const name = 'planning-invariant'
export const inject = ['invariants']

function checked(state: PlanningFoldState, event: SessionEvent, fail: InvariantFailure): void {
  try {
    applyPlanningEvent(state, event)
  } catch (error) {
    fail(`session event ${event.seq} violates the durable planning stream: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const states = new WeakMap<Session, PlanningFoldState>()
  const staged = new WeakMap<SessionEvent, { session: Session; state: PlanningFoldState }>()
  const seed = (session: Session): PlanningFoldState => {
    const state = emptyPlanningState()
    for (const event of session.events) checked(state, event, fail)
    states.set(session, state)
    return state
  }
  const current = (session: Session): PlanningFoldState => states.get(session) ?? seed(session)
  ctx.sessions.list().forEach(seed)
  const prepublish = (_mode: unknown, eventName: string, args: unknown[]): void => {
    if (eventName === 'session/event') {
      const [session, event] = args as [Session, SessionEvent]
      const candidate = clonePlanningState(current(session))
      checked(candidate, event, fail)
      staged.set(event, { session, state: candidate })
    }
  }
  const publish = (session: Session, event: SessionEvent): void => {
    const candidate = staged.get(event)
    staged.delete(event)
    if (candidate === undefined || candidate.session !== session) {
      fail('planning event published without staged validation')
      return
    }
    states.set(session, candidate.state)
  }
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', prepublish, { global: true })
  ctx.on('session/event', publish, { global: true })
}, { inject: ['sessions'] })

export const apply = (ctx: Context): Promise<() => void> => {
  const dispose = ctx.invariants.register(PACKAGE_NAME, install)
  return Promise.resolve(dispose)
}
