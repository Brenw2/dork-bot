import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = 'hermes-plugin/dork-bot-push';

// Temp HOME holds a fake ~/.hermes with one profile, plus a fake `hermes` on PATH.
function setup(doctorExit: number) {
  const home = mkdtempSync(join(tmpdir(), 'dork-install-'));
  const profile = join(home, '.hermes', 'profiles', 'bot1');
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'config.yaml'), '');
  const bin = join(home, 'bin');
  mkdirSync(bin);
  // `hermes -p bot1 plugins doctor X`: $3 is the subcommand. Doctor exits doctorExit, the rest succeed.
  writeFileSync(join(bin, 'hermes'), `#!/usr/bin/env bash\n[[ "$4" == doctor ]] && exit ${doctorExit}\nexit 0\n`);
  chmodSync(join(bin, 'hermes'), 0o755);
  const dest = join(profile, 'plugins', 'dork-bot-push');
  const run = () =>
    spawnSync('bash', ['scripts/install-push-plugin.sh', 'bot1'], {
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
    });
  return { dest, run };
}

describe('install-push-plugin.sh', () => {
  it('installs every module __init__.py imports, drops stale .py, passes when doctor passes', () => {
    const { dest, run } = setup(0);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'old_module.py'), '');
    const r = run();
    expect(r.status).toBe(0);
    const imported = [...readFileSync(join(SRC, '__init__.py'), 'utf8').matchAll(/^from \.(\w+) import/gm)].map((m) => m[1]);
    expect(imported).toEqual(expect.arrayContaining(['push', 'room_push', 'work_push']));
    for (const m of imported) expect(existsSync(join(dest, `${m}.py`))).toBe(true);
    for (const f of readdirSync(SRC).filter((f) => f.endsWith('.py'))) expect(existsSync(join(dest, f))).toBe(true);
    expect(existsSync(join(dest, 'plugin.yaml'))).toBe(true);
    expect(existsSync(join(dest, 'old_module.py'))).toBe(false);
  });

  it('exits non-zero when plugins doctor fails', () => {
    expect(setup(1).run().status).not.toBe(0);
  });
});
