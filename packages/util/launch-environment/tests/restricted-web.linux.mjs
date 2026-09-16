// Keyless full-composition acceptance. Launch only through the isolated test driver.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const build = process.env.DSH_ACCESS_BUILD;
const root = process.env.DSH_ACCESS_TEST_ROOT;
const mode = process.env.DSH_ACCESS_MODE ?? 'web';
const port = mode === 'maintenance' ? 13084 : 13083;
assert(build?.startsWith('/opt/dsh-user-access-test/'));
assert(root?.startsWith('/var/lib/dsh-user-access-test/'));
const moduleAt = rel => import(pathToFileURL(path.join(build, rel)).href);
const { loadLayeredEnv } = await moduleAt('packages/boot/app-boot/lib/index.js');
const bin = await fs.readFile(path.join(build, 'apps/cli/lib/bin.js'), 'utf8');
const chunk = /import\("(\.\/profile-boot-[^"]+\.js)"\)/.exec(bin)?.[1];
assert(chunk);
const { runProfile } = await moduleAt('apps/cli/lib/' + chunk);
const { LlmAdapter } = await moduleAt('packages/llm/llm/lib/index.js');
const patchFile = path.join(root, 'state', 'acceptance.patch.json');
await fs.writeFile(path.join(root, 'workspace', '.env'), 'ACCESS_PROJECT_CANARY=SHOULD_NOT_LOAD\n');
const environment = loadLayeredEnv('restricted-acceptance');
if (mode !== 'maintenance') assert.equal(environment.get('ACCESS_PROJECT_CANARY'), undefined);
await fs.writeFile(patchFile, JSON.stringify([
  { id: 'llm-deepseek', disabled: true },
  { id: 'llm-pi-ai', disabled: true },
  { id: 'session-telemetry-otel', disabled: true },
  { id: 'session-title-llm', disabled: true },
  { id: 'agent-default-model', config: { provider: 'mock', model: 'mock-sol' } },
  { id: 'webserver', config: { host: '127.0.0.1', port } },
  { id: 'web-runtime', config: { openBrowser: false, printUrl: false } },
]));
const { ctx, shutdown } = await runProfile({ environment, profile: 'web', patchFiles: [patchFile], args: [] });
const calls = [];
class MockAdapter extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: provider }; }
  async listModels(provider) { return [{ provider, id: 'mock-sol', name: 'mock-sol' }]; }
  async resolveModel(provider, model) { return { provider, id: model, name: model, inputModalities: ['text'] }; }
  async *stream(options) {
    assert.equal(options.provider, 'mock'); assert.equal(options.model, 'mock-sol');
    assert.equal(options.temperature, undefined);
    const last = options.messages.filter(message => message.role === 'user' && message.source?.kind === 'user').at(-1);
    const prompt = last?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '';
    calls.push({ prompt, userTexts: options.messages.filter(message => message.role === 'user').flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text)), provider: options.provider, model: options.model, maxTokens: options.maxTokens });
    if (prompt === 'LIFECYCLE_HOLD') {
      const { setTimeout } = await import('node:timers/promises');
      await setTimeout(60000, undefined, { signal: options.signal });
    }
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'RESTRICTED_MOCK_OK' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'RESTRICTED_MOCK_OK' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
ctx.llm.registerAdapter(['mock'], new MockAdapter());
if (mode === 'seed' || mode === 'lifecycle') {
  const { runLifecycle } = await import('./restricted-lifecycle.linux.mjs');
  try { await runLifecycle({ ctx, mode, root, calls }); }
  catch (error) { console.error(error); await shutdown.shutdown(1); throw error; }
  await shutdown.shutdown(0);
} else {
const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${port}`);
await fs.writeFile(path.join(root, 'state', 'browser-url'), url, { mode: 0o600 });
console.log(JSON.stringify({ ready: true, port, mode, realSecretsUsed: false }));
// The transient service has its own deadline; SIGTERM follows the product teardown.
await new Promise(resolve => process.once('SIGTERM', resolve));
console.log(JSON.stringify({ calls, realSecretsUsed: false }));
await shutdown.shutdown(0);
}
