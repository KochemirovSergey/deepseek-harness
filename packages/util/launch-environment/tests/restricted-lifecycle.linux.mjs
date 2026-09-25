// Keyless cold-session, queue and cancellation checks through the shipped profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

export async function runLifecycle({ ctx, mode, root, calls }) {
  const id = 'restricted-legacy-acceptance';
  const prefixPath = path.join(root, 'state', 'legacy-prefix.json');
  if (mode === 'seed') {
    const session = ctx.sessions.create(id, { meta: { cwd: path.join(root, 'old-workspace'), agentPreset: 'cordis', delegationDepth: 0 } });
    session.append('request/header', { header: { config: { provider: 'retired-provider', model: 'retired-model', temperature: 0.9, maxTokens: 1 } }, reason: 'initial' });
    session.append('sandbox/mode', { mode: 'danger-full-access' });
    const handle = await ctx.sessionPersistence.create(session.header);
    try { await handle.append(session.snapshotEvents()); await handle.flush(); } finally { await handle.close(); }
    await fs.writeFile(prefixPath, JSON.stringify({ header: session.header, events: session.snapshotEvents() }));
    console.log(JSON.stringify({ passed: 'legacy session persisted with retired model and full-access history' }));
    return;
  }
  const until = async (predicate, name) => {
    const deadline = Date.now() + 20000;
    while (!predicate()) { assert(Date.now() < deadline, `Timed out: ${name}; ${JSON.stringify({ calls, events: ctx.agents.get(id)?.session.snapshotEvents().slice(-5) })}`); await setTimeout(25); }
  };
  const prompt = text => ctx.sessionController.prompt({ sessionId: id, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal);
  const before = JSON.parse(await fs.readFile(prefixPath, 'utf8'));
  before.header = { delegationDepth: 0, ...before.header };
  const stored = await ctx.sessionController.inspect(id);
  assert.deepEqual(stored.meta, before.header);
  assert.deepEqual(stored.events.slice(0, before.events.length), before.events);
  await prompt('LIFECYCLE_RESUME');
  await until(() => calls.some(call => call.prompt === 'LIFECYCLE_RESUME'), 'old session reaches fixed model');
  const agent = ctx.agents.get(id);
  await until(() => agent.status === 'idle', 'old session settles');
  assert.equal(agent.session.requestHeader().config.provider, 'mock');
  assert.equal(agent.session.requestHeader().config.model, 'mock-sol');
  assert.equal(agent.session.requestHeader().config.maxTokens, undefined);
  assert.equal(agent.session.requestHeader().config.temperature, undefined);
  assert.deepEqual(agent.session.header, before.header);
  assert.deepEqual(agent.session.snapshotEvents().slice(0, before.events.length), before.events);
  assert.equal(ctx.sandboxPolicy.resolve({ session: agent.session }).mode, 'workspace-write');
  assert.equal(ctx.sandboxPolicy.resolve({ session: agent.session }).workspaceRoot, path.join(root, 'workspace'));
  console.log(JSON.stringify({ passed: 'cold legacy session continues under fixed model and workspace cap without rewriting history' }));
  await assert.rejects(() => ctx.commands.execute(agent, '/model other', [], new AbortController().signal), /Instance policy denies/);
  await assert.rejects(() => ctx.subagents.start('forbidden', {}), /Instance policy denies/);
  assert.throws(() => ctx.permissionPresets.set(agent.session, 'danger-full-access'), /Instance policy denies/);
  const login = await fetch(ctx.connection.authenticatedUrl('http://127.0.0.1:13083'), { redirect: 'manual' });
  assert.equal(login.status, 303);
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert(cookie);
  const request = { type: 'client-request', rpcId: crypto.randomUUID(), method: 'credentials/set', payload: { args: { ref: 'SHELL_FAKE', value: 'SHOULD_NOT_WRITE' } } };
  const code = `const response = await fetch('http://127.0.0.1:13083/api/credentials/set', {method:'POST', headers:{'content-type':'application/json',origin:'http://127.0.0.1:13083',cookie:${JSON.stringify(cookie)}}, body:${JSON.stringify(JSON.stringify(request))}}); console.log(JSON.stringify({status:response.status,body:await response.text()}));`;
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const outcome = await (await ctx.shell.execute(ctx.shell.resolve({ command: `${quote(process.execPath)} --input-type=module -e ${quote(code)}` }))).result();
  assert.equal(outcome.exitCode, 0);
  const response = JSON.parse(outcome.stdout.text);
  assert.equal(response.status, 403);
  assert.match(response.body, /Instance policy denies/);
  assert.equal(await ctx.credentials.resolve('SHELL_FAKE'), undefined);
  console.log(JSON.stringify({ passed: 'action owners deny commands, subagents and escalation; authenticated local API from confined shell is denied' }));
  await prompt('LIFECYCLE_HOLD');
  await until(() => calls.some(call => call.prompt === 'LIFECYCLE_HOLD'), 'active request starts');
  await prompt('QUEUE_ORIGINAL');
  await prompt('QUEUE_REMOVE');
  assert.equal(agent.inbox.nextTurn.length, 2);
  const [keep, remove] = agent.inbox.nextTurn;
  assert.throws(() => ctx.sessionController.updateQueue({ sessionId: id, itemId: keep.id, action: { kind: 'remove' }, model: 'other' }), /Instance policy denies/);
  assert.equal(agent.inbox.nextTurn.length, 2);
  ctx.sessionController.updateQueue({ sessionId: id, itemId: keep.id, action: { kind: 'edit', content: [{ type: 'text', text: 'QUEUE_EDITED' }] } });
  ctx.sessionController.updateQueue({ sessionId: id, itemId: remove.id, action: { kind: 'remove' } });
  assert.equal(agent.inbox.nextTurn.length, 1);
  ctx.sessionController.cancel({ sessionId: id });
  await until(() => agent.status === 'idle', 'active request cancellation settles');
  assert.equal(agent.inbox.nextTurn.length, 1);
  assert.equal(agent.inbox.nextTurn[0].content[0].text, 'QUEUE_EDITED');
  await prompt('AFTER_CANCEL');
  await until(() => calls.some(call => call.userTexts.includes('AFTER_CANCEL')) && agent.status === 'idle', 'next request after cancellation');
  assert(calls.at(-1).userTexts.includes('QUEUE_EDITED'));
  assert(!calls.some(call => call.userTexts.includes('QUEUE_REMOVE') || call.userTexts.includes('QUEUE_ORIGINAL')));
  assert.equal(agent.inbox.nextTurn.length, 0);
  console.log(JSON.stringify({ passed: 'queue edit/remove, rejected override, active cancellation and next request', modelRequests: calls.length, externalModelRequests: 0 }));
}
