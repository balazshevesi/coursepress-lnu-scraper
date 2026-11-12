import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { scrapeCourse } from '../src/index.js';
import { markdown, parsePage } from '../src/pages.js';
import { courseRoot, pageFile, safeName } from '../src/urls.js';

async function fixture(
  handler: RequestListener,
  run: (origin: string, destination: string) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'coursepress-test-'));
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(
      `http://127.0.0.1:${address.port}`,
      path.join(directory, 'export'),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
}

const root = '/courses/demo/';
const sidebar = `<nav class="sidebar"><ul><li><details><summary>Week one</summary><ul>
  <li><a href="${root}week-1/lesson/">Lesson</a></li>
  <li><a href="${root}week-1/lab/">Lab</a></li>
</ul></details></li></ul></nav>`;
const page = (
  title: string,
  body = '',
) => `<!doctype html><html><head><title>${title}</title>
<link rel="sitemap" href="${root}sitemap-index.xml"></head><body><header>Site chrome</header>${sidebar}
<main><h1>${title}</h1><div class="sl-markdown-content">${body}</div><nav>Next page</nav></main></body></html>`;

test('exports a complete course from a nested URL, preserving links, order, assets and sitemap-only pages', async () => {
  const requested: string[] = [];
  await fixture(
    (req, res) => {
      requested.push(req.url!);
      res.setHeader('Content-Type', 'text/html');
      switch (req.url) {
        case '/robots.txt':
          res.writeHead(404).end();
          break;
        case root:
          res.end(
            page(
              'Demo',
              `<a href="${root}week-1/lesson/?tracking=1#intro">Start</a><a href="/courses/other/">Other course</a>`,
            ),
          );
          break;
        case `${root}week-1/lesson/`:
          res.end(
            page(
              'Lesson',
              `<h2 id="intro">Intro<a class="sl-anchor-link" href="#intro">Anchor</a></h2>
          <p>Lesson text <a href="#intro">Jump</a> <a href="../lab/">Lab</a>.</p>
          <pre><code class="language-ts">const x = 1;\n</code></pre>
          <table><thead><tr><th>Topic</th><th>Day</th></tr></thead><tbody><tr><td>Types</td><td>Monday</td></tr></tbody></table>
          <img src="/static/picture.png" alt="A picture"><img src="/static/picture.png" alt="Again">
          <a href="/static/slides.pdf#page=2">Slides</a><a href="/people/jane.doe">Contact</a><iframe src="https://video.example/watch/1" title="Lecture"></iframe>`,
            ),
          );
          break;
        case `${root}week-1/lab/`:
          res.end(page('Lab', '<p>Lab text</p>'));
          break;
        case `${root}hidden/`:
          res.end(page('Hidden', '<p>Only in sitemap</p>'));
          break;
        case `${root}sitemap-index.xml`:
          res.setHeader('Content-Type', 'application/xml');
          res.end(
            `<sitemapindex><sitemap><loc>${root}sitemap-0.xml</loc></sitemap></sitemapindex>`,
          );
          break;
        case `${root}sitemap-0.xml`:
          res.setHeader('Content-Type', 'application/xml');
          res.end(
            `<urlset><url><loc>${root}hidden/</loc></url><url><loc>/courses/other/</loc></url></urlset>`,
          );
          break;
        case '/static/picture.png':
          res.setHeader('Content-Type', 'image/png');
          res.end('image bytes');
          break;
        case '/static/slides.pdf':
          res.setHeader('Content-Type', 'application/pdf');
          res.end('pdf bytes');
          break;
        default:
          res.writeHead(404).end();
      }
    },
    async (origin, destination) => {
      const result = await scrapeCourse(
        `${origin}${root}week-1/lesson/?tracking=1#intro`,
        { outputDir: destination, assets: true, delayMs: 0 },
      );
      assert.equal(result.complete, true);
      assert.equal(result.pages.length, 4);
      assert.equal(result.assets.length, 2);
      assert.equal(result.navigation[0]?.title, 'Week one');
      const lesson = await readFile(
        path.join(destination, 'week-1/lesson/index.md'),
        'utf8',
      );
      assert.match(lesson, /# Lesson/);
      assert.match(lesson, /<a id="intro"><\/a>/);
      assert.match(lesson, /\[Jump\]\(index\.md#intro\)/);
      assert.match(lesson, /\[Lab\]\(\.\.\/lab\/index\.md\)/);
      assert.match(lesson, /```ts\nconst x = 1;/);
      assert.match(lesson, /\| Topic \| Day \|/);
      assert.match(lesson, /!\[A picture\]\(\.\.\/\.\.\/_assets\//);
      assert.match(lesson, /slides\.pdf#page=2/);
      assert.match(lesson, /\[Lecture\]\(https:\/\/video.example\/watch\/1\)/);
      assert.doesNotMatch(lesson, /Site chrome|Next page|Anchor/);
      const index = await readFile(path.join(destination, 'README.md'), 'utf8');
      assert.ok(index.indexOf('[Lesson]') < index.indexOf('[Lab]'));
      assert.match(index, /Week one/);
      assert.match(index, /hidden\/index\.md/);
      const manifest = JSON.parse(
        await readFile(path.join(destination, 'manifest.json'), 'utf8'),
      );
      assert.equal(manifest.complete, true);
      assert.equal(
        requested.filter((url) => url === '/static/picture.png').length,
        1,
      );
      assert.ok(!requested.some((url) => url.startsWith('/courses/other/')));
      assert.ok(!requested.some((url) => url.includes('?')));
      assert.ok(!requested.includes('/people/jane.doe'));
      await assert.rejects(
        scrapeCourse(`${origin}${root}`, { outputDir: destination }),
        /EEXIST/,
      );
      assert.equal(
        await readFile(path.join(destination, 'README.md'), 'utf8'),
        index,
      );
    },
  );
});

test('plain Markdown mode keeps remote assets and marks a page limit as incomplete', async () => {
  const requested: string[] = [];
  await fixture(
    (req, res) => {
      requested.push(req.url!);
      if (req.url === '/robots.txt') return void res.writeHead(404).end();
      res.setHeader('Content-Type', 'text/html');
      res.end(page('Demo', '<img src="/image.png" alt="Remote">'));
    },
    async (origin, destination) => {
      const result = await scrapeCourse(`${origin}${root}`, {
        outputDir: destination,
        maxPages: 1,
        delayMs: 0,
      });
      assert.equal(result.complete, false);
      assert.equal(result.truncated, true);
      assert.equal(result.pages.length, 1);
      assert.equal(result.assets.length, 0);
      assert.match(
        await readFile(path.join(destination, 'index.md'), 'utf8'),
        new RegExp(`${origin}/image.png`),
      );
      assert.ok(!requested.includes('/image.png'));
    },
  );
});

test('robots blocks are reported without requesting forbidden pages, and other pages still export', async () => {
  const requested: string[] = [];
  await fixture(
    (req, res) => {
      requested.push(req.url!);
      if (req.url === '/robots.txt')
        return void res.end(`User-agent: *\nDisallow: ${root}private/`);
      if (req.url === root) {
        res.setHeader('Content-Type', 'text/html');
        return void res.end(
          `<main><h1>Demo</h1><a href="${root}private/">Private</a><a href="${root}missing/">Missing</a></main>`,
        );
      }
      res.writeHead(404).end();
    },
    async (origin, destination) => {
      const result = await scrapeCourse(`${origin}${root}`, {
        outputDir: destination,
        delayMs: 0,
      });
      assert.equal(result.complete, false);
      assert.equal(result.errors.length, 2);
      assert.match(
        result.errors.map((error) => error.message).join(' '),
        /robots.txt/,
      );
      assert.ok(!requested.includes(`${root}private/`));
      assert.equal(
        requested.filter((url) => url === `${root}missing/`).length,
        1,
      );
      assert.match(
        await readFile(path.join(destination, 'index.md'), 'utf8'),
        new RegExp(`${origin}${root}private/`),
      );
    },
  );
});

test('redirects cannot escape the course, and oversized assets stay remote with an error', async () => {
  const requested: string[] = [];
  await fixture(
    (req, res) => {
      requested.push(req.url!);
      if (req.url === '/robots.txt') return void res.writeHead(404).end();
      if (req.url === root) {
        res.setHeader('Content-Type', 'text/html');
        return void res.end(
          `<main><h1>Demo</h1><img src="/large.png" alt="large"><a href="${root}escape/">Escape</a></main>`,
        );
      }
      if (req.url === `${root}escape/`)
        return void res.writeHead(302, { location: '/outside/' }).end();
      if (req.url === '/large.png') {
        res.setHeader('Content-Type', 'image/png');
        return void res.end('too much data');
      }
      res.writeHead(404).end();
    },
    async (origin, destination) => {
      const result = await scrapeCourse(`${origin}${root}`, {
        outputDir: destination,
        delayMs: 0,
        assets: true,
        maxAssetBytes: 3,
      });
      assert.equal(result.errors.length, 2);
      assert.equal(result.assets.length, 0);
      assert.ok(
        result.errors.some((error) => error.message.includes('allowed scope')),
      );
      assert.ok(
        result.errors.some((error) => error.message.includes('exceeds')),
      );
      assert.ok(!requested.includes('/outside/'));
      assert.match(
        await readFile(path.join(destination, 'index.md'), 'utf8'),
        new RegExp(`${origin}/large.png`),
      );
    },
  );
});

test('validates URL and limits before creating an export', async () => {
  assert.throws(() => courseRoot('file:///courses/demo/'), /CoursePress/);
  assert.throws(
    () => courseRoot('https://example.com/courses/'),
    /CoursePress/,
  );
  assert.equal(
    courseRoot('https://example.com/kurser/demo/01-guide/subpage?x=1').href,
    'https://example.com/kurser/demo/',
  );
  const directory = await mkdtemp(path.join(tmpdir(), 'coursepress-invalid-'));
  try {
    await assert.rejects(
      scrapeCourse('https://example.com/courses/demo/', {
        outputDir: path.join(directory, 'export'),
        maxPages: 0,
      }),
      /maxPages/,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Gatsby content and nested sidebar groups survive without styling or site chrome', () => {
  const origin = new URL('https://example.com/kurser/demo/');
  const parsed = parsePage(
    `<title>Gatsby</title><aside class="leftSidebar"><ul><li><a href="/kurser/demo/01-guide">Study guide</a><ul><li><a href="/kurser/demo/01-guide/plan">Plan</a></li></ul></li></ul></aside>
    <main><style>.foo{color:red}</style><div><h1>Study guide</h1></div><div><h2 id="plan!">Plan</h2><p>Read this.</p></div><div class="addPaddTopBottom">Previous Next</div><a href="licence"><img class="cc" src="badge.png"></a></main>`,
    origin,
    origin,
  );
  assert.equal(parsed.navigation[0]?.children[0]?.title, 'Plan');
  const output = markdown(parsed.html);
  assert.match(output, /# Study guide/);
  assert.match(output, /Read this/);
  assert.doesNotMatch(output, /color:red|Previous Next|badge.png/);
});

test('safe filenames cannot traverse directories or collide on common case-insensitive filesystems', () => {
  const rootUrl = courseRoot('https://example.com/courses/demo/');
  assert.equal(
    pageFile(new URL('week-1/lesson/', rootUrl), rootUrl),
    'week-1/lesson/index.md',
  );
  assert.notEqual(safeName('Lesson'), safeName('lesson'));
  assert.notEqual(safeName('a:b'), safeName('a?b'));
  assert.notEqual(safeName('CON'), 'CON');
  const file = pageFile(
    new URL('https://example.com/courses/demo/%2F..%2Fescape/'),
    rootUrl,
  );
  assert.ok(!file.split('/').includes('..'));
  assert.ok(!path.isAbsolute(file));
});

test('code fences cannot be terminated by backticks in the source', () => {
  const result = markdown(
    '<pre><code class="language-md">```js\nexample\n```\n</code></pre>',
  );
  assert.match(result, /^````md\n```js/);
  assert.match(result, /\n````\n$/);
});

test('HTMLSlides Markdown decks include every slide, code block, image and link', () => {
  const rootUrl = courseRoot('https://example.com/courses/demo/');
  const url = new URL('slides/intro/slides.html', rootUrl);
  const parsed = parsePage(
    `<title>Lecture</title><slide title>\n# First slide\n</slide><slide>\n# Second slide\n\n\`\`\`ts\nconst x = '<example>';\n\`\`\`\n\n![Diagram](diagram.png)\n\n[Lab](../../lab/)\n</slide>`,
    url,
    rootUrl,
  );
  const output = markdown(parsed.html);
  assert.match(output, /# First slide/);
  assert.match(output, /# Second slide/);
  assert.match(output, /```ts\nconst x = '<example>';/);
  assert.match(
    output,
    /!\[Diagram\]\(https:\/\/example.com\/courses\/demo\/slides\/intro\/diagram.png\)/,
  );
  assert.ok(parsed.links.includes('https://example.com/courses/demo/lab/'));
  assert.match(safeName('Course.PDF'), /\.PDF$/);
});

test('follows robots redirects and retries temporary server failures', async () => {
  let attempts = 0;
  await fixture(
    (req, res) => {
      if (req.url === '/robots.txt')
        return void res
          .writeHead(302, { location: '/robots-policy.txt' })
          .end();
      if (req.url === '/robots-policy.txt')
        return void res.end('User-agent: *\nAllow: /');
      if (attempts++ === 0) return void res.writeHead(503).end();
      res.setHeader('Content-Type', 'text/html');
      res.end('<main><h1>Recovered</h1><p>Available after retry.</p></main>');
    },
    async (origin, destination) => {
      const result = await scrapeCourse(`${origin}${root}`, {
        outputDir: destination,
        delayMs: 0,
      });
      assert.equal(result.complete, true);
      assert.equal(result.title, 'Recovered');
      assert.equal(attempts, 2);
    },
  );
});
