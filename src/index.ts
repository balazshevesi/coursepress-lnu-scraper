import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { Downloader } from './network.js';
import {
  markdown,
  mergeNavigation,
  parsePage,
  type CoursePage,
  type NavigationItem,
} from './pages.js';
import {
  courseRoot,
  hash,
  httpUrl,
  inCourse,
  isAsset,
  isPage,
  localLink,
  pageFile,
  pageKey,
  safeName,
} from './urls.js';

export type { NavigationItem } from './pages.js';

export interface ScrapeOptions {
  /** Exact destination directory. Must not already exist. Default: courses/<course>. */
  outputDir?: string;
  /** Download content images and linked files. Default: false. */
  assets?: boolean;
  /** Minimum delay between requests in milliseconds. Default: 250. */
  delayMs?: number;
  /** Maximum number of page requests. Default: 500. */
  maxPages?: number;
  /** Maximum bytes per asset. Default: 25 MiB. */
  maxAssetBytes?: number;
  onProgress?: (event: {
    kind: 'page' | 'asset' | 'warning';
    url: string;
    message: string;
  }) => void;
}

export interface ScrapeResult {
  courseUrl: string;
  startedFrom: string;
  title: string;
  outputDir: string;
  scrapedAt: string;
  complete: boolean;
  truncated: boolean;
  pages: { url: string; title: string; file: string }[];
  assets: { url: string; file: string }[];
  navigation: NavigationItem[];
  errors: {
    kind: 'page' | 'asset' | 'sitemap';
    url: string;
    message: string;
  }[];
}

function integer(value: number, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${name} must be an integer >= ${minimum}.`);
  return value;
}

/** Export a public CoursePress course, starting at any page within it. */
export async function scrapeCourse(
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeResult> {
  const root = courseRoot(url);
  const start = httpUrl(url)!;
  if (!isPage(start))
    throw new Error('The starting URL must be a course page, not an asset.');
  const maxPages = integer(options.maxPages ?? 500, 'maxPages', 1);
  const assetLimit = integer(
    options.maxAssetBytes ?? 25 * 1024 * 1024,
    'maxAssetBytes',
    1,
  );
  const downloader = new Downloader(
    integer(options.delayMs ?? 250, 'delayMs', 0),
  );
  const outputDir = path.resolve(
    options.outputDir ??
      path.join(
        'courses',
        safeName(root.pathname.split('/').filter(Boolean).at(-1)!),
      ),
  );
  await mkdir(path.dirname(outputDir), { recursive: true });
  // Claim an empty destination before downloading; never overwrite another export.
  await mkdir(outputDir);

  const result: ScrapeResult = {
    courseUrl: root.href,
    startedFrom: start.href,
    title: root.pathname.split('/').filter(Boolean).at(-1)!,
    outputDir,
    scrapedAt: new Date().toISOString(),
    complete: false,
    truncated: false,
    pages: [],
    assets: [],
    navigation: [],
    errors: [],
  };
  const queue: URL[] = [];
  const queued = new Set<string>();
  const pages = new Map<string, CoursePage>();
  const aliases = new Map<string, string>();
  const sitemapQueue: URL[] = [];
  const sitemaps = new Set<string>();
  function enqueue(value: string) {
    const link = httpUrl(value, root.href);
    if (
      !link ||
      !inCourse(link, root) ||
      !isPage(link) ||
      queued.has(pageKey(link))
    )
      return;
    link.hash = '';
    link.search = '';
    queued.add(pageKey(link));
    queue.push(link);
  }
  function addSitemap(value: string) {
    const link = httpUrl(value, root.href);
    if (!link || !inCourse(link, root) || sitemaps.has(link.href)) return;
    sitemaps.add(link.href);
    sitemapQueue.push(link);
  }
  function failure(
    kind: 'page' | 'asset' | 'sitemap',
    url: string,
    error: unknown,
  ) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push({ kind, url, message });
    options.onProgress?.({ kind: 'warning', url, message });
  }
  enqueue(root.href);
  enqueue(start.href);
  let attempts = 0;
  let sitemapAttempts = 0;
  while (queue.length || sitemapQueue.length) {
    // Load root navigation before the sitemap so the crawl follows course order.
    if (sitemapQueue.length) {
      const location = sitemapQueue.shift()!;
      if (++sitemapAttempts > 20) {
        failure(
          'sitemap',
          location.href,
          new Error('Sitemap limit (20) reached.'),
        );
        sitemapQueue.length = 0;
        continue;
      }
      try {
        const response = await downloader.get(location, (link) =>
          inCourse(link, root),
        );
        const xml = load(response.body.toString('utf8'), { xml: true });
        if (!xml('sitemapindex, urlset').length)
          throw new Error('Invalid sitemap XML.');
        xml('sitemap > loc').each((_, node) =>
          addSitemap(xml(node).text().trim()),
        );
        xml('url > loc').each((_, node) => enqueue(xml(node).text().trim()));
      } catch (error) {
        failure('sitemap', location.href, error);
      }
      continue;
    }
    const location = queue.shift()!;
    if (pages.has(pageKey(location))) continue;
    if (attempts >= maxPages) {
      result.truncated = true;
      break;
    }
    attempts++;
    try {
      const response = await downloader.get(location, (link) =>
        inCourse(link, root),
      );
      const key = pageKey(response.url);
      aliases.set(pageKey(location), key);
      if (pages.has(key)) continue;
      if (
        !/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(
          response.headers.get('content-type') ?? '',
        )
      )
        throw new Error('Expected an HTML page.');
      const page = parsePage(
        response.body.toString('utf8'),
        response.url,
        root,
      );
      pages.set(key, page);
      if (pageKey(location) === pageKey(root)) result.title = page.title;
      mergeNavigation(result.navigation, page.navigation);
      page.links.forEach(enqueue);
      page.sitemaps.forEach(addSitemap);
      options.onProgress?.({
        kind: 'page',
        url: page.url,
        message: page.title,
      });
    } catch (error) {
      failure('page', location.href, error);
    }
  }

  const files = new Map(
    [...pages].map(([key, page]) => [key, pageFile(new URL(page.url), root)]),
  );
  for (const [alias, key] of aliases)
    if (files.has(key)) files.set(alias, files.get(key)!);
  const assets = new Map<string, string | null>();
  async function downloadAsset(url: URL): Promise<string | undefined> {
    url.hash = '';
    if (assets.has(url.href)) return assets.get(url.href) ?? undefined;
    assets.set(url.href, null);
    try {
      const response = await downloader.get(url, () => true, assetLimit);
      if (/text\/html/i.test(response.headers.get('content-type') ?? ''))
        throw new Error('Asset URL returned an HTML page.');
      const basename = safeName(url.pathname.split('/').at(-1) || 'asset');
      const file = `_assets/${hash(url.href)}-${basename}`;
      await mkdir(path.join(outputDir, '_assets'), { recursive: true });
      await writeFile(path.join(outputDir, file), response.body);
      assets.set(url.href, file);
      result.assets.push({ url: url.href, file });
      options.onProgress?.({ kind: 'asset', url: url.href, message: file });
      return file;
    } catch (error) {
      failure('asset', url.href, error);
      return;
    }
  }

  for (const [key, page] of pages) {
    const file = files.get(key)!;
    const $ = load(page.html, null, false);
    for (const element of $('a[href], img[src]').toArray()) {
      const node = $(element);
      const attr = node.is('a') ? 'href' : 'src';
      const target = httpUrl(node.attr(attr) ?? '');
      if (!target) continue;
      const local = files.get(pageKey(target));
      if (node.is('a') && local) {
        node.attr(attr, `${localLink(file, local)}${target.hash}`);
      } else if (
        options.assets &&
        (node.is('img') || isAsset(target) || node.is('[download]'))
      ) {
        const fragment = target.hash;
        const assetFile = await downloadAsset(target);
        if (assetFile)
          node.attr(attr, `${localLink(file, assetFile)}${fragment}`);
      }
    }
    await mkdir(path.dirname(path.join(outputDir, file)), { recursive: true });
    await writeFile(
      path.join(outputDir, file),
      `<!-- Source: ${page.url.replace(/--/g, '%2D%2D')} -->\n\n${markdown($.html())}`,
    );
    result.pages.push({ url: page.url, title: page.title, file });
  }
  result.complete =
    !result.truncated && result.errors.length === 0 && result.pages.length > 0;
  const included = new Set<string>();
  const label = (value: string) =>
    value.replace(/\s+/g, ' ').replace(/[\\[\]<>*_`]/g, '\\$&');
  function outline(items: NavigationItem[], depth = 0): string[] {
    return items.flatMap((item) => {
      const file = item.url ? files.get(item.url) : undefined;
      if (file) included.add(file);
      return [
        `${'  '.repeat(depth)}- ${file ? `[${label(item.title)}](${localLink('README.md', file)})` : label(item.title)}`,
        ...outline(item.children, depth + 1),
      ];
    });
  }
  const navigation = outline(result.navigation);
  const remaining = result.pages
    .filter((page) => !included.has(page.file))
    .map(
      (page) =>
        `- [${label(page.title)}](${localLink('README.md', page.file)})`,
    );
  const readme = [
    `# ${label(result.title)}`,
    '',
    `Source: <${root.href}>`,
    '',
    `Exported ${result.pages.length} pages and ${result.assets.length} assets on ${result.scrapedAt}.`,
    '',
    ...(result.complete
      ? []
      : [
          '**This export is incomplete.** See `manifest.json` for errors and crawl limits.',
          '',
        ]),
    '## Course navigation',
    '',
    ...navigation,
    '',
    ...(remaining.length ? ['## Other pages', '', ...remaining, ''] : []),
    'The folder hierarchy follows the original course URLs. The navigation above follows the course sidebar.',
    '',
  ].join('\n');
  await writeFile(path.join(outputDir, 'README.md'), readme);
  await writeFile(
    path.join(outputDir, 'manifest.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  if (!result.pages.length)
    throw new Error(
      `No pages exported. See ${path.join(outputDir, 'manifest.json')} for errors.`,
    );
  return result;
}
