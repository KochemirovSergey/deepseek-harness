// Full shipped Web composition; fake credentials and mock model only.
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runPublicWeb({ ctx, port, root }) {
  const host = '94.29.35.66';
  const origin = `https://${host}`;
  const request = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: url, method, headers: { host, ...headers } }, res => {
      const parts = [];
      res.on('data', part => parts.push(part));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts).toString() }));
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: '' }); });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('public HTTP probe timed out')));
    req.end(body);
  });
  const login = await request('/');
  assert.equal(login.status, 200);
  assert.match(login.body, /__DSH_BOOT__/);
  const navigation = await request('/', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
  assert.equal(navigation.status, 200);
  assert(navigation.headers['set-cookie']);
  const issued = login.headers['set-cookie'][0];
  assert.match(issued, /; Secure/);
  assert.match(issued, /; HttpOnly; SameSite=Strict/);
  const cookie = issued.split(';')[0];
  const headers = { cookie, origin, 'content-type': 'application/json' };
  const rpc = (method, args = {}, extra = {}) => request(`/api/${method}`, {
    method: 'POST', headers: { ...headers, ...extra },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }),
  });
  const index = await request('/', { headers: { cookie } });
  assert.equal(index.status, 200);
  assert.match(index.body, /__DSH_BOOT__/);
  assert.equal((await request('/', { headers: { host: 'localhost:13083' } })).status, 401);
  assert.equal((await request('/api/session/list', { method: 'POST', body: '{}' })).status, 401);
  const value = async (method, args = {}) => {
    const response = await rpc(method, args);
    assert.equal(response.status, 200, method);
    const result = JSON.parse(response.body).result;
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.value;
  };
  await value('session/list', { _request: {} });
  const caps = await value('session/capabilities');
  assert.equal(caps.restricted, true);
  assert.equal(caps.model, 'mock-sol');
  const created = await value('session/create', { request: {} });
  const sessionId = created.sessionId;
  await value('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'PUBLIC_WEB_MOCK' }] } });
  const deadline = Date.now() + 20000;
  while (true) {
    const agent = ctx.agents.get(sessionId);
    if (agent?.status === 'idle' && JSON.stringify(agent.session.snapshotEvents()).includes('RESTRICTED_MOCK_OK')) break;
    assert(Date.now() < deadline, 'mock response missing');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  for (const [method, request] of [
    ['session/create', { model: 'other' }], ['session/create', { cwd: root }],
    ['session/prompt', { sessionId, model: 'other' }],
    ['session/fork', { sessionId, agentPreset: 'other' }],
    ['session/updateQueue', { sessionId, maxTokens: 1 }],
  ]) {
    const response = await rpc(method, { request });
    assert(response.status === 403 || JSON.parse(response.body).result.ok === false);
  }
  const bytes = Buffer.from('PUBLIC_FILE_OK');
  const upload = await request(`/api/session/uploadFileBinary?sessionId=${sessionId}&name=public.txt`, {
    method: 'POST', headers: { cookie, origin, 'content-type': 'application/octet-stream' }, body: bytes,
  });
  assert.equal(upload.status, 200);
  const file = JSON.parse(upload.body).value.file;
  const digest = file.attachmentId.replace('sha256:', '');
  const downloaded = await request(`/api/file?path=${encodeURIComponent(path.join(root, 'workspace', '.dsh-attachments', digest, 'public.txt'))}`, { headers: { cookie } });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.body, bytes.toString());
  const forbidden = await request(`/api/file?path=${encodeURIComponent(path.join(root, 'state', '.credentials.yaml'))}`, { headers: { cookie } });
  assert.equal(forbidden.status, 403);
  await value('session/rename', { request: { sessionId, title: 'Public mock acceptance' } });
  await value('session/fork', { request: { sessionId } });
  for (const extra of [
    { origin: 'null' }, { origin: `http://${host}` }, { origin: 'https://evil.example' },
    { 'sec-fetch-site': 'cross-site' }, { host: `${host}:444` },
    { host: 'evil.example', 'x-forwarded-host': host, 'x-forwarded-proto': 'https' },
  ]) {
    assert.equal((await rpc('session/list', {}, extra)).status, 403);
    assert.equal((await request('/', { headers: extra })).status, 403);
  }
  for (const method of ['settings/update', 'credentials/set', 'plugins/install', 'unknown/method']) {
    assert.equal((await rpc(method)).status, 403);
  }
  const ws = { ...headers, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' };
  assert.equal((await request('/api/remote.mux', { headers: ws })).status, 101);
  assert.equal((await request('/api/remote.mux', { headers: { ...ws, cookie: '' } })).status, 401);
  assert.equal((await request('/api/remote.mux', { headers: { ...ws, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/unknown-upgrade', { headers: ws })).status, 403);
  const localUrl = new URL(ctx.connection.authenticatedUrl(`http://localhost:${port}`));
  assert.equal((await request(localUrl.pathname + localUrl.search, { headers: { host: `localhost:${port}` } })).status, 303);
  await fs.writeFile(path.join(root, 'state', 'public-cookie'), cookie, { mode: 0o600 });
  // A second run over this isolated state proves the durable signing secret survives restart.
  const retainedPath = path.join(root, 'state', 'public-cookie-first');
  try {
    const retained = await fs.readFile(retainedPath, 'utf8');
    assert.equal((await request('/', { headers: { cookie: retained } })).status, 200);
    console.log(JSON.stringify({ passed: 'public cookie survives full application restart' }));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(retainedPath, cookie, { mode: 0o600 });
  }
  console.log(JSON.stringify({ passed: 'anonymous index, authenticated RPC and WebSocket, mock dialogue, files, denied overrides and unknown routes, SSH token access', realSecretsUsed: false, externalModelRequests: 0 }));
}
