/** Immutable, administrator-owned limits for a user-facing Harness process. */
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** Launch configuration. Paths name pre-existing directories, never browser selections. */
export interface InstancePolicy {
  readonly mode: 'restricted'
  readonly workspace: string
  readonly temporaryDirectory: string
  readonly protectedRoots: readonly string[]
  readonly readableRoots: readonly string[]
  readonly provider: string
  readonly model: string
  readonly agentPreset: string
  readonly reasoningEffort?: string
  readonly maxTokens?: number
}

/** Denial before an operation acquires resources or publishes state. */
export class InstancePolicyDenied extends Error {
  /** Stable denial marker for internal and Remote callers. */
  readonly code = 'INSTANCE_POLICY_DENIED'
  constructor(operation: string) {
    super(`Instance policy denies ${operation}; contact the administrator.`)
    this.name = 'InstancePolicyDenied'
  }
}

/**
 * Test lexical containment for already absolute paths.
 * @param root - Absolute allowed root.
 * @param path - Absolute candidate path.
 * @returns Whether the candidate is contained lexically.
 */
export function pathWithin(root: string, path: string): boolean {
  const suffix = relative(root, path)
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`))
}

/**
 * Parse strict JSON without defaults that could widen filesystem or model access.
 * @param value - Untrusted decoded configuration.
 * @returns A deeply frozen policy; invalid or overlapping grants throw.
 */
export function parseInstancePolicy(value: unknown): InstancePolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('instance policy must be an object')
  const input = value as Record<string, unknown>
  const required = ['mode', 'workspace', 'temporaryDirectory', 'protectedRoots', 'readableRoots', 'provider', 'model', 'agentPreset']
  const keys = new Set([...required, 'reasoningEffort', 'maxTokens'])
  if (required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => !keys.has(key))) throw new Error('instance policy has missing or unknown fields')
  if (input.mode !== 'restricted') throw new Error('instance policy mode must be restricted')
  for (const key of ['workspace', 'temporaryDirectory', 'provider', 'model', 'agentPreset', 'reasoningEffort']) {
    if (key === 'reasoningEffort' && input[key] === undefined) continue
    if (typeof input[key] !== 'string' || input[key].trim() === '') throw new Error(`instance policy ${key} must be non-empty`)
  }
  if (input.maxTokens !== undefined && (!Number.isSafeInteger(input.maxTokens) || (input.maxTokens as number) <= 0)) throw new Error('instance policy maxTokens must be positive')
  for (const key of ['protectedRoots', 'readableRoots']) {
    if (!Array.isArray(input[key]) || input[key].length === 0 || input[key].some((path: unknown) => typeof path !== 'string' || !isAbsolute(path))) throw new Error(`instance policy ${key} must contain absolute paths`)
  }
  const policy = input as unknown as InstancePolicy
  const grants = [policy.workspace, policy.temporaryDirectory, ...policy.readableRoots]
  if (grants.some(path => !isAbsolute(path) || resolve(path) !== path || path === '/')) {
    throw new Error('instance policy grants must be normalized absolute paths other than /')
  }
  if (pathWithin(policy.workspace, policy.temporaryDirectory) || pathWithin(policy.temporaryDirectory, policy.workspace)) {
    throw new Error('instance policy workspace and temporary directory must be separate')
  }
  if (grants.some(grant => policy.protectedRoots.some(root => pathWithin(grant, root) || pathWithin(root, grant)))) throw new Error('instance policy grants overlap protected state')
  return Object.freeze({
    ...policy,
    protectedRoots: Object.freeze([...policy.protectedRoots]),
    readableRoots: Object.freeze([...policy.readableRoots]),
  })
}

function loadPolicy(path: string | undefined): InstancePolicy | undefined {
  if (path === undefined) return undefined
  if (!isAbsolute(path) || process.platform !== 'linux') throw new Error('restricted instance policy requires Linux and an absolute configuration path')
  // Every ancestor is administrator-owned; a writable parent would permit replacement.
  for (let current = path; ; current = dirname(current)) {
    const info = statSync(current)
    if (info.uid !== 0 || (info.mode & 0o022) !== 0 || realpathSync(current) !== current) throw new Error('instance policy configuration must be root-owned, canonical and not group/world writable')
    if (current === '/') break
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022) !== 0) throw new Error('invalid instance policy file ownership')
    const policy = parseInstancePolicy(JSON.parse(readFileSync(fd, 'utf8')))
    for (const root of [policy.workspace, policy.temporaryDirectory, ...policy.protectedRoots, ...policy.readableRoots]) {
      if (realpathSync(root) !== root) throw new Error('instance policy paths must be canonical')
    }
    const home = process.env.DSH_HOME
    if (home === undefined || !isAbsolute(home) || !policy.protectedRoots.some(root => pathWithin(root, realpathSync(home)))) throw new Error('restricted policy requires an explicitly protected DSH_HOME')
    return policy
  } finally {
    closeSync(fd)
  }
}

/** Captured during module loading, before profiles or user .env files are evaluated. */
export const instancePolicy = loadPolicy(process.env.DSH_INSTANCE_POLICY)

/**
 * Reject an administrative action in the restricted instance.
 * @param operation - Administrative operation being attempted.
 */
export function denyRestricted(operation: string): void {
  if (instancePolicy !== undefined) throw new InstancePolicyDenied(operation)
}

const REMOTE_OPERATIONS = new Set([
  'session/list', 'session/search', 'session/create', 'session/rename', 'session/fork',
  'session/prompt', 'session/attachment', 'session/updateQueue', 'session/cancel',
  'session/page', 'session/follow', 'session/control', 'session/modelCatalog',
  'workspace/follow', 'workspace/archiveSession', 'session/canOpenWorkspacePath', 'session/workspaceDesktop', 'session/capabilities',
  'workspaceFiles/stat', 'workspaceFiles/read', 'workspaceFiles/readBytes',
  'workspaceFiles/readAll', 'workspaceFiles/readRelated', 'workspaceFiles/list', 'workspaceFiles/changes',
  'fileReferences/list', 'skills/list', 'fileUploads/upload', 'commands/list', 'settings/describe',
])

/**
 * Authorize a Remote operation before decoding scoped arguments or activating an Agent.
 * @param endpoint - Fully qualified Remote namespace and method.
 * @param args - Named wire arguments before decoding.
 */
export function authorizeInstanceRemote(endpoint: string, args?: Readonly<Record<string, unknown>>): void {
  if (instancePolicy === undefined) return
  if (!REMOTE_OPERATIONS.has(endpoint)) throw new InstancePolicyDenied(endpoint)
  const request = args?.request
  if (typeof request === 'object' && request !== null) authorizeInstanceRequest(endpoint, request)
}

/**
 * Refuse user-supplied execution controls at the operation owner as well as at the gateway.
 * @param operation - Owning Session operation.
 * @param request - Untrusted request controls.
 */
export function authorizeInstanceRequest(operation: string, request: object): void {
  if (instancePolicy === undefined) return
  const record = request as Record<string, unknown>
  const fields = ['provider', 'model', 'reasoningEffort', 'temperature', 'maxTokens', 'stop', 'sandboxPolicy', 'permissions', 'permissionPreset', 'config', 'options']
  if (fields.some(key => Object.hasOwn(record, key))) throw new InstancePolicyDenied(operation)
  if (operation === 'session/create') authorizeInstanceSelection(record)
  else if (['cwd', 'workspaceId', 'agentPreset'].some(key => Object.hasOwn(record, key))) throw new InstancePolicyDenied(operation)
}

/**
 * Validate user-supplied creation selectors without accepting equivalent alternate profiles.
 * @param request - Optional workspace and preset selectors.
 */
export function authorizeInstanceSelection(request: { cwd?: string; workspaceId?: string; agentPreset?: string }): void {
  const policy = instancePolicy
  if (policy === undefined) return
  if (request.workspaceId !== undefined || (request.cwd !== undefined && request.cwd !== policy.workspace) || (request.agentPreset !== undefined && request.agentPreset !== policy.agentPreset)) throw new InstancePolicyDenied('workspace or agent preset selection')
}

/**
 * Replace inherited model parameters with the administrator's complete request configuration.
 * @param config - Inherited request configuration in ordinary mode.
 * @returns The administrator configuration, or the original configuration in ordinary mode.
 */
export function instanceModelConfig<T extends { provider: string; model: string }>(config: T): T {
  const policy = instancePolicy
  if (policy === undefined) return config
  return {
    provider: policy.provider,
    model: policy.model,
    ...(policy.reasoningEffort === undefined ? {} : { reasoningEffort: policy.reasoningEffort }),
    ...(policy.maxTokens === undefined ? {} : { maxTokens: policy.maxTokens }),
  } as T
}

/**
 * Child commands receive only runtime variables; no inherited credentials or auth tokens.
 * @returns A clean child environment, or undefined in ordinary mode.
 */
export function instanceChildEnvironment(): NodeJS.ProcessEnv | undefined {
  const policy = instancePolicy
  if (policy === undefined) return undefined
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    HOME: policy.workspace, TMPDIR: policy.temporaryDirectory,
  }
}
