import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(
  new URL('../scripts/exclude-courses.mjs', import.meta.url),
);

for (const separateGitDir of [false, true]) {
  test(`excludes root courses without duplicates or lost entries (separate Git directory: ${separateGitDir})`, async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'coursepress-exclude-'),
    );
    const repo = path.join(directory, 'repo');
    try {
      execFileSync('git', [
        'init',
        '--quiet',
        ...(separateGitDir
          ? ['--separate-git-dir', path.join(directory, 'metadata')]
          : []),
        repo,
      ]);
      const exclude = execFileSync(
        'git',
        ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
        { cwd: repo, encoding: 'utf8' },
      ).trim();
      await writeFile(exclude, '# Keep this comment\r\nexisting-pattern');
      const nested = path.join(repo, 'nested');
      await mkdir(nested);
      execFileSync(process.execPath, [script], { cwd: nested });
      const expected =
        '# Keep this comment\r\nexisting-pattern\r\n/courses/\r\n';
      assert.equal(await readFile(exclude, 'utf8'), expected);
      execFileSync(process.execPath, [script], { cwd: nested });
      assert.equal(await readFile(exclude, 'utf8'), expected);
      assert.equal(
        spawnSync('git', ['check-ignore', '--quiet', 'courses/notes.md'], {
          cwd: repo,
        }).status,
        0,
      );
      assert.equal(
        spawnSync(
          'git',
          ['check-ignore', '--quiet', 'nested/courses/notes.md'],
          { cwd: repo },
        ).status,
        1,
      );
      await rm(exclude);
      execFileSync(process.execPath, [script], { cwd: nested });
      assert.equal(await readFile(exclude, 'utf8'), '/courses/\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('fails outside a Git repository without creating files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'coursepress-no-git-'));
  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a git repository/i);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
