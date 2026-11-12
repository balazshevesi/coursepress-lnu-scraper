#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { scrapeCourse } from './index.js';

const help = `Usage: coursepress-scrape <course-page-url> [options]

Export a CoursePress course as Markdown. A nested course page works too.

Options:
  -o, --output <directory>   Destination (default: courses/<course>; must be new)
  --assets                   Download content images and linked files
  --delay <milliseconds>     Minimum request interval (default: 250)
  --max-pages <number>       Page request limit (default: 500)
  --max-asset-mb <number>    Limit each asset to this many MiB (default: 25)
  -h, --help                 Show this help

Exit codes: 0 complete, 1 fatal error, 2 partial export.
`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      assets: { type: 'boolean', default: false },
      delay: { type: 'string' },
      'max-pages': { type: 'string' },
      'max-asset-mb': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) console.log(help);
  else {
    if (positionals.length !== 1) throw new Error(help);
    const result = await scrapeCourse(positionals[0]!, {
      outputDir: values.output,
      assets: values.assets,
      delayMs: values.delay === undefined ? undefined : Number(values.delay),
      maxPages:
        values['max-pages'] === undefined
          ? undefined
          : Number(values['max-pages']),
      maxAssetBytes:
        values['max-asset-mb'] === undefined
          ? undefined
          : Number(values['max-asset-mb']) * 1024 * 1024,
      onProgress: ({ kind, message, url }) =>
        console.error(
          `[${kind}] ${message}${kind === 'warning' ? ` (${url})` : ''}`,
        ),
    });
    console.log(
      `${result.pages.length} pages, ${result.assets.length} assets → ${result.outputDir}`,
    );
    if (!result.complete) {
      console.error(
        `Partial export: ${result.errors.length} errors${result.truncated ? ', page limit reached' : ''}. See manifest.json.`,
      );
      process.exitCode = 2;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
