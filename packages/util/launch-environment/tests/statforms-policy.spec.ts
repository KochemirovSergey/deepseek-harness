/** Reviewed source operations remain closed unless the launch policy opts in. */
import { afterEach, describe, expect, it, vi } from 'vitest'

const fixture = () => ({ mode: 'restricted', workspace: '/srv/workspace', temporaryDirectory: '/srv/temp',
  protectedRoots: ['/srv/state'], readableRoots: ['/usr'], provider: 'mock', model: 'sol', agentPreset: 'default' })
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
  vi.doUnmock('node:fs')
  vi.resetModules()
})
async function policy(enabled: boolean) {
  vi.resetModules()
  vi.stubEnv('DSH_INSTANCE_POLICY', '/etc/dsh/policy.json')
  vi.stubEnv('DSH_HOME', '/srv/state')
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  vi.doMock('node:fs', async importOriginal => ({
    ...await importOriginal<typeof import('node:fs')>(),
    statSync: () => ({ uid: 0, mode: 0o755 }), realpathSync: (path: string) => path,
    openSync: () => 42, closeSync: () => undefined,
    fstatSync: () => ({ uid: 0, mode: 0o644, isFile: () => true }),
    readFileSync: () => JSON.stringify({ ...fixture(), ...(enabled ? { statforms: true } : {}) }),
  }))
  return await import('../src/instance-policy.ts')
}

describe('restricted Statforms source', () => {
  it('denies source routes and direct operation owners by default', async () => {
    const api = await policy(false)
    expect(api.instanceHttpAllowed('POST', '/statforms-data/raw/snapshot')).toBe(false)
    expect(() => { api.authorizeInstanceStatforms('raw/snapshot') }).toThrow('Instance policy denies')
  })
  it('permits only the reviewed POST methods after administrator opt-in', async () => {
    const api = await policy(true)
    for (const operation of ['raw/snapshot', 'raw/nodes', 'raw/file-sheets', 'raw/sheet', 'chat/attach-sheets']) {
      expect(api.instanceHttpAllowed('POST', `/statforms-data/${operation}`)).toBe(true)
      expect(() => { api.authorizeInstanceStatforms(operation) }).not.toThrow()
      expect(api.instanceHttpAllowed('GET', `/statforms-data/${operation}`)).toBe(false)
      expect(api.instanceHttpAllowed('POST', `/statforms-data/${operation}`, true)).toBe(false)
    }
    for (const operation of ['clean/series', 'settings/write', 'raw/sheet/extra', 'raw%2fsheet', '../api/settings/write']) {
      expect(api.instanceHttpAllowed('POST', `/statforms-data/${operation}`)).toBe(false)
      expect(() => { api.authorizeInstanceStatforms(operation) }).toThrow()
    }
    expect(api.instanceHttpAllowed('POST', '/api/settings/set')).toBe(false)
    expect(api.instanceHttpAllowed('POST', '/api/session/prompt')).toBe(true)
    expect(() => { api.authorizeInstanceRequest('session/create', { model: 'other' }) }).toThrow()
  })
})
