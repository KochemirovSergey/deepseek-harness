/** Dedicated RPC registration through the same sibling plugin topology as Web boot. */
import { Context } from '@deepseek-ai/cordis'
import type { WebServer, WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'
import { provideBrowserCredentials } from './browser-credentials.ts'

describe('dedicated RPC plugin ownership', () => {
  it('keeps shared registries available without a Web server and rejects dedicated channels', async () => {
    const ctx = new Context()
    provideBrowserCredentials(ctx)
    const connection = ctx.plugin({ inject: [...inject], apply })
    await connection.await()
    try {
      const service = ctx.get('connection')!
      const remove = service.rpc.intercept('/api', endpoint => endpoint === 'ping', async () => ({ ok: true, value: null }))
      expect(() => service.rpc.handle('/dedicated', async () => ({ ok: true, value: null })))
        .toThrow('connection: dedicated RPC channels require an active webServer')
      await remove()
    } finally {
      await connection.dispose()
    }
  })

  it.each([{ services: ['connection'] }, { services: ['connection', 'webServer'] }])('owns its route with declared services $services', async ({ services }) => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    provideBrowserCredentials(ctx)
    const server = ctx.plugin({ name: 'test-webserver', apply(serverCtx: Context) {
      serverCtx.provide('webServer', {
        register(route: WebRoute) {
          routes.push(route)
          return () => { routes.splice(routes.indexOf(route), 1) }
        },
      } as WebServer)
    } })
    await server.await()
    const connection = ctx.plugin({ name: 'test-connection', inject: [...inject], apply })
    await connection.await()
    const consumer = ctx.plugin({ name: 'test-statforms', inject: services, apply(owner: Context) {
      owner.connection.rpc.handle('/test-statforms', async () => ({ ok: true, value: null }))
    } })
    try {
      await consumer.await()
      expect(routes.map(route => route.path)).toEqual(['/api', '/test-statforms'])
      await consumer.dispose()
      expect(routes.map(route => route.path)).toEqual(['/api'])
    } finally {
      await consumer.dispose()
      await connection.dispose()
      await server.dispose()
    }
  })
})
