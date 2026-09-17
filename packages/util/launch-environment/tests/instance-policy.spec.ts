import { describe, expect, it } from 'vitest'
import { parseInstancePolicy, pathWithin } from '../src/instance-policy.ts'

const fixture = () => ({
  mode: 'restricted', workspace: '/srv/workspace', temporaryDirectory: '/srv/temp',
  protectedRoots: ['/srv/state', '/etc/dsh'], readableRoots: ['/usr', '/lib'],
  provider: 'mock', model: 'mock-sol', agentPreset: 'default',
})

describe('administrator-owned instance policy', () => {
  it('copies and freezes nested grants so caller mutation cannot expand access', () => {
    const input = fixture()
    const policy = parseInstancePolicy(input)
    input.readableRoots.push('/')
    expect(policy.readableRoots).toEqual(['/usr', '/lib'])
    expect(Object.isFrozen(policy)).toBe(true)
    expect(() => (policy.readableRoots as string[]).push('/')).toThrow()
  })
  it.each([
    { mode: 'ordinary' }, { publicOrigin: 'http://example.org' },
    { publicOrigin: 'https://example.org/' }, { publicOrigin: 'https://user@example.org' },
    { publicOrigin: 'https://example.org/path' }, { publicOrigin: 'https://example.org?x=1' },
    { publicOrigin: 1 }, { publicOrigin: '' }, { readableRoots: ['/'] }, { readableRoots: ['/srv'] },
    { readableRoots: ['/srv/state/credentials'] }, { workspace: '/srv/state' },
    { temporaryDirectory: '/srv/workspace/tmp' }, { workspace: 'relative' },
    { workspace: '/srv/../srv/workspace' }, { admin: true }, { maxTokens: -1 },
  ])('rejects unsafe or ambiguous configuration %j', (patch) => {
    expect(() => parseInstancePolicy({ ...fixture(), ...patch })).toThrow()
  })
  it('rejects absent required fields and does not silently select a model', () => {
    const { model: _model, ...input } = fixture()
    expect(() => parseInstancePolicy(input)).toThrow()
  })
  it('retains an explicit canonical HTTPS public origin', () => {
    expect(parseInstancePolicy({ ...fixture(), publicOrigin: 'https://94.29.35.66' }).publicOrigin).toBe('https://94.29.35.66')
  })
  it('distinguishes sibling prefixes and parent traversal', () => {
    expect(pathWithin('/srv/work', '/srv/work/file')).toBe(true)
    expect(pathWithin('/srv/work', '/srv/work-other/file')).toBe(false)
    expect(pathWithin('/srv/work', '/srv/work/../state')).toBe(false)
  })
})
