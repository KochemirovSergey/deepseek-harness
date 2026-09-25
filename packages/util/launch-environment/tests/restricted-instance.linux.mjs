// Run only with an administrator-owned policy and disposable state, never a real profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const build = process.env.DSH_ACCESS_BUILD;
const root = process.env.DSH_ACCESS_TEST_ROOT;
assert(build?.startsWith('/opt/dsh-user-access-test/'));
assert(root?.startsWith('/var/lib/dsh-user-access-test/'));
const moduleAt = rel => import(pathToFileURL(path.join(build, rel, 'lib/index.js')).href);
const { Context } = await moduleAt('vendor/cordis');
const { instancePolicy, authorizeInstanceRequest } = await moduleAt('packages/util/launch-environment');
const workspace = path.join(root, 'workspace');
const state = path.join(root, 'state');
assert.equal(instancePolicy.workspace, workspace);
await fs.mkdir(workspace, { recursive: true });
await fs.mkdir(state, { recursive: true });
const canary = path.join(state, 'credentials-canary.txt');
await fs.writeFile(canary, 'FAKE_CREDENTIAL_CONTENT');
process.env.ACCESS_AUDIT_VALUE = 'FAKE_ENV_CONTENT';
const ctx = new Context();
const passed = [];
const check = async (name, run) => { await run(); passed.push(name); console.log(JSON.stringify({ passed: name })); };
try {
  for (const [rel, config] of [
    ['packages/session/session-projection', undefined],
    ['packages/sandbox/sandbox-policy', { mode: 'danger-full-access', workspaceRoot: state }],
    ['packages/sandbox/sandbox-local', {}],
    ['packages/fs/fs-sandbox', { cwd: workspace }],
    ['packages/subprocess/subprocess-local', undefined],
    ['packages/shell/bash-sandbox', { cwd: workspace, timeoutMs: 10000 }],
  ]) await ctx.plugin((await moduleAt(rel)).default, config);
  await check('custom HTTP and upgrade routes are denied before plugin side effects', async () => {
    await ctx.plugin((await moduleAt('packages/host/webserver')).WebServer, { host: '127.0.0.1', port: 0, compression: 'none' });
    let effects = 0;
    const paths = ['/open-in-app/open', '/openai-codex/auth/login', '/api/custom-admin', '/future-admin'];
    const disposers = paths.map(path => ctx.webServer.register({ kind: 'exact', path, handler: (_req, res) => { effects++; res.end('unsafe'); } }));
    disposers.push(ctx.webServer.registerUpgrade({ path: '/future-upgrade', handler: (_req, socket) => { effects++; socket.destroy(); } }));
    disposers.push(ctx.webServer.registerFallback((_req, res) => { effects++; res.end('fallback'); }));
    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    try {
      for (const path of paths) for (const method of ['GET', 'POST']) {
        const response = await fetch(base + path, { method });
        assert.equal(response.status, 403); await response.text();
      }
      const { request } = await import('node:http');
      await new Promise((resolve, reject) => {
        const req = request(base + '/future-upgrade', { headers: { Connection: 'Upgrade', Upgrade: 'websocket' } }, res => {
          try { assert.equal(res.statusCode, 403); res.resume(); resolve(); } catch (error) { reject(error); }
        });
        req.on('error', reject); req.end();
      });
      assert.equal(effects, 0);
      const index = await fetch(base + '/'); assert.equal(index.status, 200); await index.text();
      assert.equal(effects, 1);
    } finally { for (const dispose of disposers.reverse()) dispose(); }
  });
  await check('explicit policy overrides cannot widen rights', async () => {
    assert.equal(ctx.sandboxPolicy.resolve({ mode: 'danger-full-access' }).mode, 'workspace-write');
    assert.equal(ctx.sandboxPolicy.resolve().workspaceRoot, workspace);
  });
  await check('filesystem normal writes, reads, bytes, streaming and listing', async () => {
    const target = await ctx.fs.resolve('hello.txt');
    await ctx.fs.writeText(target, 'hello\nworld\n');
    assert.equal(await ctx.fs.readText(target), 'hello\nworld\n');
    assert.equal(Buffer.from(await ctx.fs.readBytes(target, undefined, 1024)).toString(), 'hello\nworld\n');
    assert.equal(Buffer.from(await ctx.fs.readByteRange(target, { offset: 0, length: 5 })).toString(), 'hello');
    let text = ''; for await (const chunk of await ctx.fs.streamText(target)) text += chunk;
    assert.equal(text, 'hello\nworld\n');
    assert((await ctx.fs.listDir(await ctx.fs.resolve('.'))).some(entry => entry.name === 'hello.txt'));
    assert.equal(await ctx.fs.stat(await ctx.fs.resolve('absent.txt')), undefined);
  });
  await check('main process retains state while user file operations cannot access it', async () => {
    assert.equal(await fs.readFile(canary, 'utf8'), 'FAKE_CREDENTIAL_CONTENT');
    await assert.rejects(() => ctx.fs.resolve(canary));
    const forged = { displayPath: canary, targetKey: canary };
    for (const operation of [
      () => ctx.fs.readText(forged), () => ctx.fs.readBytes(forged, undefined, 1024),
      () => ctx.fs.writeText(forged, 'changed'), () => ctx.fs.stat(forged),
    ]) await assert.rejects(operation);
    assert.equal(await fs.readFile(canary, 'utf8'), 'FAKE_CREDENTIAL_CONTENT');
  });
  await check('symlink and rename substitution cannot read protected state', async () => {
    const link = path.join(workspace, 'link.txt');
    await fs.symlink(canary, link);
    await assert.rejects(() => ctx.fs.resolve(link));
    const race = path.join(workspace, 'race.txt');
    await fs.writeFile(race, 'safe');
    const target = await ctx.fs.resolve(race);
    await fs.rename(race, path.join(workspace, 'moved.txt'));
    await fs.symlink(canary, race);
    await assert.rejects(() => ctx.fs.readText(target));
    await assert.rejects(() => ctx.fs.writeText(target, 'changed'));
    assert.equal(await fs.readFile(canary, 'utf8'), 'FAKE_CREDENTIAL_CONTENT');
  });
  await check('concurrent symlink replacement never exposes or changes the secret', async () => {
    const rotating = path.join(workspace, 'rotating.txt');
    const swap = path.join(workspace, 'rotating-next');
    const safe = path.join(workspace, 'hello.txt');
    await fs.symlink(safe, rotating);
    let running = true;
    const churn = (async () => {
      let count = 0;
      while (running) {
        await fs.symlink(count++ % 2 === 0 ? canary : safe, swap);
        await fs.rename(swap, rotating);
      }
    })();
    try {
      const forged = { displayPath: rotating, targetKey: rotating };
      for (let i = 0; i < 12; i++) {
        let text;
        try { text = await ctx.fs.readText(forged); } catch {}
        if (text !== undefined) assert.equal(text, 'hello\nworld\n');
      }
    } finally { running = false; await churn; }
    assert.equal(await fs.readFile(canary, 'utf8'), 'FAKE_CREDENTIAL_CONTENT');
  });
  await check('shell is confined with scrubbed environment even for forged full-access spec', async () => {
    const spec = ctx.shell.resolve({ command: `if cat '${canary}' >/dev/null 2>&1; then exit 21; fi; test -z "$ACCESS_AUDIT_VALUE" && printf safe > shell.txt`, sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: state } });
    const result = await (await ctx.shell.execute(spec)).result();
    assert.equal(result.exitCode, 0);
    assert.equal(result.sandbox.enforcement, 'full');
    assert.equal(result.sandbox.mode, 'workspace-write');
    assert.equal(await fs.readFile(path.join(workspace, 'shell.txt'), 'utf8'), 'safe');
  });
  await ctx.plugin((await moduleAt('packages/attachment/attachment-local')).default, { dshHome: state });
  await check('binary attachment IDs produce confined workspace copies and preserve originals', async () => {
    const data = Uint8Array.from([0, 255, 10, 128, 42]);
    const ref = await ctx.attachments.saveFile({ data, name: 'binary.dat' });
    const copy = ctx.attachments.fileHostPath(ref);
    assert(copy.startsWith(workspace + '/'));
    assert.deepEqual(new Uint8Array(await ctx.fs.readBytes(await ctx.fs.resolve(copy), undefined, 1024)), data);
    await fs.writeFile(copy, 'user edit');
    await ctx.attachments.prepareFile(ref);
    assert.deepEqual(new Uint8Array(await fs.readFile(copy)), data);
    await assert.rejects(() => ctx.attachments.prepareFile({ ...ref, name: '../credentials.json' }));
    const directory = path.join(workspace, '.dsh-attachments');
    await fs.rename(directory, directory + '-saved');
    await fs.symlink(state, directory);
    await assert.rejects(() => ctx.attachments.prepareFile(ref));
    assert.equal(await fs.readFile(canary, 'utf8'), 'FAKE_CREDENTIAL_CONTENT');
    await fs.unlink(directory);
    await fs.rename(directory + '-saved', directory);
  });
  await check('cancelled filesystem calls fail closed', async () => {
    const abort = new AbortController(); abort.abort();
    await assert.rejects(() => ctx.fs.resolve('hello.txt', { signal: abort.signal }));
  });
  for (const [rel, config] of [
    ['packages/credentials/credentials-local', { path: path.join(state, 'credentials.json'), watch: false }],
    ['packages/api/settings-controller', undefined],
    ['packages/typert/registry', undefined],
    ['packages/api/gateway', undefined],
  ]) await ctx.plugin((await moduleAt(rel)).default, config);
  await check('Remote unary, streams and unknown operations fail before side effects', async () => {
    for (const request of [
      { namespace: 'settings', method: 'update', args: { ns: 'audit', patch: { value: 'changed' }, expectedRevision: 0 } },
      { namespace: 'credentials', method: 'set', args: { ref: 'AUDIT_FAKE', value: 'FAKE_KEY' } },
      { namespace: 'session', method: 'selectModel', args: { request: {} } },
      { namespace: 'futureAdmin', method: 'execute', args: {} },
    ]) {
      await assert.rejects(() => ctx.typertGateway.invoke(request), /Instance policy denies/);
      await assert.rejects(() => ctx.typertGateway.stream(request), /Instance policy denies/);
    }
    assert(ctx.credentialsController);
    await assert.rejects(() => ctx.credentialsController.set('AUDIT_FAKE', 'FAKE_KEY'), /Instance policy denies/);
    assert.equal(await fs.readFile(canary, 'utf8'), 'FAKE_CREDENTIAL_CONTENT');
  });
  await check('creation, continuation, fork and queue selectors cannot override policy', async () => {
    for (const operation of ['session/create', 'session/prompt', 'session/fork', 'session/updateQueue']) {
      for (const payload of [{ model: 'other' }, { maxTokens: 1 }, { cwd: state }, { agentPreset: 'cordis' }, { workspaceId: 'other' }]) {
        assert.throws(() => authorizeInstanceRequest(operation, payload), /Instance policy denies/);
      }
    }
  });
  await check('internal credential storage remains writable', async () => {
    await ctx.credentials.set('AUDIT_FAKE_INTERNAL', 'FAKE_REFRESHED_VALUE');
    const saved = await fs.readFile(path.join(state, 'credentials.json'), 'utf8');
    assert(saved.includes('FAKE_REFRESHED_VALUE'));
  });
  console.log(JSON.stringify({ complete: true, passed, realSecretsUsed: false, modelRequests: 0 }));
} finally { await ctx.fiber.dispose(); }
