import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const name = join(dir, entry.name);
    return entry.isDirectory() ? testFiles(name) : entry.name.endsWith('.test.mjs') ? [name] : [];
  });
}
const files = testFiles('src/features');
if (files.length) {
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
