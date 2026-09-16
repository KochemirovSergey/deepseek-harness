/** Fixed filesystem protocol executed only in the confined child process. */
export const filesystemWorkerSource = String.raw`
import { createInterface } from 'node:readline';
import { isAbsolute, relative, resolve, sep } from 'node:path';
const { Context } = await import(process.argv[1]);
const { LocalFileSystem } = await import(process.argv[2]);
const config = JSON.parse(process.argv[3]);
const ctx = new Context();
const backend = new LocalFileSystem(ctx, config);
const inside = path => {
  const suffix = relative(config.cwd, path);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep));
};
const check = path => {
  if (typeof path !== 'string' || !inside(resolve(config.cwd, path))) throw Object.assign(new Error('File access is limited to the workspace'), { code: 'FS_SANDBOX_DENIED' });
};
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
try {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const { operation, args } = JSON.parse(line);
    if (!Array.isArray(args)) throw new Error('Invalid filesystem arguments');
    let target;
    if (operation === 'resolve' || operation === 'lstat') {
      check(args[0]);
      if (args[1]?.cwd !== undefined && args[1].cwd !== config.cwd) throw new Error('Workspace selection denied');
    } else {
      check(args[0]?.displayPath);
      check(args[0]?.targetKey);
      target = await backend.resolve(args[0].displayPath);
      check(target.targetKey);
      args[0] = target;
    }
    let value;
    switch (operation) {
      case 'resolve': value = await backend.resolve(args[0], { cwd: config.cwd }); check(value.targetKey); break;
      case 'lstat': value = await backend.lstat(args[0], { cwd: config.cwd }); break;
      case 'stat': value = await backend.stat(target); break;
      case 'readText': value = await backend.readText(target); break;
      case 'streamText':
        for await (const chunk of await backend.streamText(target)) send({ chunk });
        value = null; break;
      case 'readBytes': value = { bytes: Buffer.from(await backend.readBytes(target, undefined, args[1])).toString('base64') }; break;
      case 'readByteRange': value = { bytes: Buffer.from(await backend.readByteRange(target, args[1])).toString('base64') }; break;
      case 'listDir': value = await backend.listDir(target); break;
      case 'writeText': value = await backend.writeText(target, args[1], args[2] ?? undefined); break;
      case 'editText': value = await backend.editText(target, args[1], args[2] ?? undefined); break;
      default: throw new Error('Unknown filesystem operation');
    }
    send({ value: value === undefined ? null : value });
    break;
  }
} catch (error) {
  send({ error: { message: error.message, code: error.code ?? 'FS_PERMISSION_DENIED' } });
} finally {
  await ctx.fiber.dispose();
}
`
