import type { CriticalPathMetrics, TraceInterval } from './types.ts'

function unionDuration(intervals: readonly { startedAt: number; endedAt: number }[]): number {
  if (intervals.length === 0) return 0
  const sorted = [...intervals].sort((left, right) => left.startedAt - right.startedAt || left.endedAt - right.endedAt)
  const first = sorted[0]
  if (first === undefined) return 0
  let start = first.startedAt
  let end = first.endedAt
  let total = 0
  for (const interval of sorted.slice(1)) {
    if (interval.startedAt <= end) {
      end = Math.max(end, interval.endedAt)
      continue
    }
    total += end - start
    start = interval.startedAt
    end = interval.endedAt
  }
  return total + end - start
}

/**
 * Compute wall, active-union, and longest causal DAG path metrics.
 * Containers contribute wall bounds but no active/path weight: their active time is the union of
 * their leaf intervals, which avoids charging a parent again for parallel jobs or subagents.
 * @param intervals - Complete causal interval set with unique ids.
 * @returns Wall, active, critical-path, overhead, and contributing ids.
 */
export function criticalPath(intervals: readonly TraceInterval[]): CriticalPathMetrics {
  if (intervals.length === 0) {
    return { wallMs: 0, activeMs: 0, criticalPathMs: 0, overheadMs: 0, leafIds: [], criticalPathIds: [] }
  }
  const byId = new Map<string, TraceInterval>()
  for (const interval of intervals) {
    if (interval.id.length === 0 || byId.has(interval.id)) throw new Error('trace interval ids must be unique and non-empty')
    if (!Number.isFinite(interval.startedAt) || !Number.isFinite(interval.endedAt) || interval.endedAt < interval.startedAt) {
      throw new Error(`trace interval ${interval.id} has invalid wall bounds`)
    }
    byId.set(interval.id, interval)
  }
  for (const interval of intervals) {
    for (const parentId of interval.parentIds) {
      if (!byId.has(parentId)) throw new Error(`trace interval ${interval.id} references missing parent ${parentId}`)
    }
  }

  const visiting = new Set<string>()
  const memo = new Map<string, { duration: number; ids: string[] }>()
  const visit = (id: string): { duration: number; ids: string[] } => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) throw new Error(`trace causal graph contains a cycle at ${id}`)
    visiting.add(id)
    const interval = byId.get(id)
    if (interval === undefined) throw new Error(`trace interval ${id} is missing`)
    let prior = { duration: 0, ids: [] as string[] }
    for (const parentId of interval.parentIds) {
      const candidate = visit(parentId)
      if (candidate.duration > prior.duration
        || (candidate.duration === prior.duration && candidate.ids.length > prior.ids.length)) prior = candidate
    }
    visiting.delete(id)
    const own = interval.kind === 'leaf' ? interval.endedAt - interval.startedAt : 0
    const result = { duration: prior.duration + own, ids: [...prior.ids, id] }
    memo.set(id, result)
    return result
  }

  let longest = { duration: 0, ids: [] as string[] }
  for (const interval of intervals) {
    const candidate = visit(interval.id)
    if (candidate.duration > longest.duration) longest = candidate
  }
  const leaves = intervals.filter(interval => interval.kind === 'leaf')
  const wallStart = Math.min(...intervals.map(interval => interval.startedAt))
  const wallEnd = Math.max(...intervals.map(interval => interval.endedAt))
  const wallMs = wallEnd - wallStart
  const activeMs = unionDuration(leaves)
  return {
    wallMs,
    activeMs,
    criticalPathMs: longest.duration,
    overheadMs: Math.max(0, wallMs - activeMs),
    leafIds: leaves.map(interval => interval.id),
    criticalPathIds: longest.ids,
  }
}
