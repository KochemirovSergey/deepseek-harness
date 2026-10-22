/** Restricted instances report page denial and retain direct-operation enforcement. */
import { afterEach, expect, it, vi } from 'vitest'

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
  vi.doUnmock('node:fs')
  vi.resetModules()
})

it('reports restricted access and rejects direct settings and credential writes', async () => {
  vi.resetModules()
  vi.stubEnv('DSH_INSTANCE_POLICY', '/etc/dsh/settings-test-policy.json')
  vi.stubEnv('DSH_HOME', '/srv/settings-test-state')
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  vi.doMock('node:fs', async importOriginal => ({
    ...await importOriginal<typeof import('node:fs')>(),
    statSync: () => ({ uid: 0, mode: 0o755 }), realpathSync: (path: string) => path,
    openSync: () => 42, closeSync: () => undefined,
    fstatSync: () => ({ uid: 0, mode: 0o644, isFile: () => true }),
    readFileSync: () => JSON.stringify({
      mode: 'restricted', workspace: '/srv/workspace', temporaryDirectory: '/srv/temp',
      protectedRoots: ['/srv/settings-test-state'], readableRoots: ['/usr'],
      provider: 'mock', model: 'mock', agentPreset: 'default',
    }),
  }))
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: SettingsController } = await import('../src/index.ts')
  const { CredentialsController } = await import('../src/credentials.ts')
  const { authorizeInstanceRemote } = await import('@deepseek-ai/dsh-launch-environment')
  const ctx = new Context()
  try {
    const settings = new SettingsController(ctx)
    const credentials = new CredentialsController(ctx)
    expect(settings.access()).toEqual({ canRead: false, canWrite: false, reason: 'restricted' })
    expect(() => { authorizeInstanceRemote('settings/access') }).not.toThrow()
    for (const operation of ['settings/update', 'settings/replace', 'settings/mutate', 'credentials/set', 'credentials/unset']) {
      expect(() => { authorizeInstanceRemote(operation) }).toThrow('Instance policy denies')
    }
    expect(() => settings.update('test', {}, undefined)).toThrow('Instance policy denies')
    expect(() => settings.replace('test', {}, undefined)).toThrow('Instance policy denies')
    await expect(settings.mutate('test', [], undefined)).rejects.toThrow('Instance policy denies')
    await expect(credentials.set('TEST_KEY', 'test-only')).rejects.toThrow('Instance policy denies')
    await expect(credentials.unset('TEST_KEY')).rejects.toThrow('Instance policy denies')
  } finally {
    await ctx.fiber.dispose()
  }
})
