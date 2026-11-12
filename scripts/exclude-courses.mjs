#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

try {
  const exclude = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  const contents = await readFile(exclude, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const pattern = '/courses/';
  if (
    contents
      .split(/\r?\n/)
      .some((line) => [pattern, '/courses'].includes(line.trimEnd()))
  ) {
    console.log(`${pattern} is already in ${exclude}`);
  } else {
    const newline = contents.includes('\r\n') ? '\r\n' : '\n';
    await mkdir(path.dirname(exclude), { recursive: true });
    await appendFile(
      exclude,
      `${contents && !contents.endsWith('\n') ? newline : ''}${pattern}${newline}`,
    );
    console.log(`Added ${pattern} to ${exclude}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
