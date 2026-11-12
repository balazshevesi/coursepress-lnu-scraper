# CoursePress → Markdown

Export a Linnaeus University CoursePress course to a folder of Markdown files. Give it **any page in the course**: it finds the course root, follows course links and sitemaps, and builds a local collection you can read, search, or use in your study tools.

- Supports both `/courses/<course>/` and `/kurser/<course>/` URLs, including the Astro/Starlight and Gatsby layouts.
- Mirrors course URL paths as folders and preserves sidebar groups and order in a generated course index.
- Keeps headings, lists, tables, code blocks, heading anchors, and links. HTMLSlides lecture decks are converted too.
- Rewrites links between exported pages to relative Markdown links.
- Optionally downloads content images and linked attachments, deduplicates them, and rewrites their links.
- Respects `robots.txt`, spaces requests, retries temporary failures, and reports incomplete exports.

## Get started

Requires **Node.js 22.19 or later**, npm, and Git. Run this from the folder where you want to save your course:

```sh
npx --yes github:balazshevesi/coursepress-lnu-scraper 'https://coursepress.lnu.se/courses/web-development/'
```

Replace the URL with **any page in your course**. The command downloads and runs the scraper automatically, then saves the Markdown files and course index in `./courses/<course>/`.

To include images and attachments, add `--assets`. You can also choose where to save the export:

```sh
npx --yes github:balazshevesi/coursepress-lnu-scraper 'https://coursepress.lnu.se/kurser/mjukvarutestning/02-course-content/' --assets --output courses/software-testing
```

The destination must be a **new directory**. Choose a different `--output` path for another export; existing exports are never overwritten. The default `courses/` directory is ignored by Git. Add `--help` instead of a URL to see all options.

To add the root `courses/` directory to any repository's local `.git/info/exclude`, run this **from inside that repository**. No clone or installation is needed:

```sh
npx --yes --package=github:balazshevesi/coursepress-lnu-scraper coursepress-exclude-courses
```

It preserves existing entries and skips the rule if it is already present. This is a local Git setting; it does not change tracked ignore files or untrack files already committed. From a local checkout of this scraper, `npm run exclude:courses` also works.

## Programmatic use

After `npm run build`, import the ESM API:

```ts
import { scrapeCourse } from './dist/index.js';

// A URL is the only required argument.
const course = await scrapeCourse(
  'https://coursepress.lnu.se/courses/web-development/week-01/',
);

console.log(course.outputDir, course.pages.length, course.complete);
```

For another Node.js project, install directly from GitHub (the package is not published to npm):

```sh
npm install github:balazshevesi/coursepress-lnu-scraper
```

```ts
import { scrapeCourse } from 'coursepress-lnu-scraper';

const course = await scrapeCourse(
  'https://coursepress.lnu.se/kurser/mjukvarutestning/',
  {
    outputDir: './my-course-notes',
    assets: true,
    onProgress: ({ kind, message }) => console.log(kind, message),
  },
);

if (!course.complete) console.warn(course.errors, course.truncated);
```

## What the export looks like

```text
courses/web-development/
├── README.md                    # Course sidebar, in its original groups/order
├── manifest.json                # Source URLs, files, navigation, errors, completeness
├── index.md                     # Course home page
├── study-guide/
│   ├── index.md
│   └── about/index.md
├── week-01/index.md
├── assignment-1/index.md
├── slides/js-modern/slides.html/index.md
└── _assets/                     # Only when --assets is enabled
    ├── <url-hash>-diagram.png
    └── <url-hash>-slides.pdf
```

Each page contains a source URL comment. Page paths mirror the original URLs; the generated `README.md` records the teaching structure, including sidebar sections that have no page of their own. Pages outside the sidebar appear under “Other pages.” Filenames are made safe for local filesystems; changed or mixed-case names receive a short hash to avoid collisions.

Images remain remote by default. With `--assets`, content images and links with recognised attachment extensions (PDFs, office documents, archives, source files, and media) or a `download` attribute are saved to `_assets/`. Queries are retained for asset identity. Failed or oversized assets keep their original URLs and appear in the manifest.

## Options

| CLI                        | API                     | Default            |
| -------------------------- | ----------------------- | ------------------ |
| `-o, --output <directory>` | `outputDir`             | `courses/<course>` |
| `--assets`                 | `assets`                | `false`            |
| `--delay <milliseconds>`   | `delayMs`               | `250`              |
| `--max-pages <number>`     | `maxPages`              | `500`              |
| `--max-asset-mb <number>`  | `maxAssetBytes` (bytes) | 25 MiB             |

Requests are sequential. A site's robots crawl delay takes precedence when it is longer. Requests time out after 30 seconds, temporary network errors and HTTP 429/5xx responses are retried twice, and individual HTML/XML responses are limited to 10 MiB. At most 20 sitemap documents are read. `maxPages` limits attempted page downloads, including failures.

Exit codes: **0** for a complete export, **1** for a fatal error, and **2** for a partial export. The API returns partial results with `complete: false`; invalid inputs, an existing destination, filesystem failures, or exporting zero pages throw an error. A zero-page export still writes its error manifest. Always check `complete`, `truncated`, and `errors` before assuming you have everything.

## Scope and limitations

- “Complete” means every discovered course page was exported without errors. Pages must be linked from the course or listed in its declared sitemaps.
- Page crawling stays within the inferred course path and origin. External websites, other courses, GitLab repositories, login-only material, and Zulip discussions remain links.
- No browser or login is used. JavaScript-only content is not executed. Inline Markdown in HTMLSlides and static Reveal.js slides are supported; dynamically loaded slide content is not.
- Video players and other embeds become links. Downloaded images/documents are preserved as assets; PDF and office document contents are not converted to Markdown.
- Tracking queries are ignored for page identity. Courses that use query parameters to select different content need additional support.
- This is a CLI/library for trusted local use. It fetches supplied URLs and external asset URLs; do not expose it as a public URL-fetching service without network access controls.

Use course material according to its licence and your course's rules. The MIT licence covers this scraper, not the material you download. This project is independent of Linnaeus University.

## Development

```sh
git clone https://github.com/balazshevesi/coursepress-lnu-scraper.git
cd coursepress-lnu-scraper
npm ci
npm run check
npm test
npm run format:check
npm run build

# Run from the local checkout
npm run scrape -- https://coursepress.lnu.se/courses/web-development/
```

Tests use a local HTTP server and cover nested starting URLs, both layouts, sidebar order, sitemaps, Markdown fidelity, local links, asset deduplication, robots rules, redirect boundaries, download limits, and existing-directory protection. CI runs the checks on Node.js 22 and 24.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution notes. Licensed under [MIT](LICENSE).
