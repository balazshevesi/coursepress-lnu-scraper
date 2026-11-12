import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { marked } from 'marked';
import { httpUrl, inCourse, isPage, pageKey } from './urls.js';

export interface NavigationItem {
  title: string;
  url?: string;
  children: NavigationItem[];
}

export interface CoursePage {
  url: string;
  title: string;
  html: string;
  links: string[];
  sitemaps: string[];
  navigation: NavigationItem[];
}

function navigation($: CheerioAPI, root: URL, base: string): NavigationItem[] {
  const sidebar = $(
    'nav.sidebar, aside.leftSidebar, #sidebar, .course-navigation',
  ).first();
  function items(nodes: AnyNode[]): NavigationItem[] {
    return nodes.flatMap((node): NavigationItem[] => {
      const element = $(node);
      if (element.is('li')) {
        const anchor = element.children('a').first();
        const details = element.children('details').first();
        const title =
          anchor.text().trim() || details.children('summary').text().trim();
        const url = httpUrl(anchor.attr('href') ?? '', base);
        const children = items(
          (details.length ? details : element)
            .children()
            .not('a, summary, button, svg, script, style')
            .toArray(),
        );
        if (
          title &&
          (details.length || (url && inCourse(url, root) && isPage(url)))
        )
          return [
            {
              title,
              ...(anchor.length && url ? { url: pageKey(url) } : {}),
              children,
            },
          ];
        return children;
      }
      return items(element.children().toArray());
    });
  }
  return items(sidebar.toArray());
}

export function parsePage(html: string, url: URL, root: URL): CoursePage {
  // CoursePress HTMLSlides decks contain Markdown inside custom <slide> tags.
  html = html.replace(
    /<slide\b[^>]*>([\s\S]*?)<\/slide>/gi,
    (_, source: string) =>
      `<section data-coursepress-slide>${marked.parse(source, { async: false })}</section>`,
  );
  const $ = load(html);
  const base =
    httpUrl($('base[href]').attr('href') ?? url.href, url.href)?.href ??
    url.href;
  const nav = navigation($, root, base);
  const links = new Set<string>();
  $('a[href]').each((_, element) => {
    const link = httpUrl($(element).attr('href')!, base);
    if (
      link &&
      inCourse(link, root) &&
      isPage(link) &&
      !$(element).is('[download]')
    ) {
      link.hash = '';
      link.search = '';
      links.add(link.href);
    }
  });
  const sitemaps = $('link[rel="sitemap"]')
    .toArray()
    .flatMap((element) => {
      const link = httpUrl($(element).attr('href') ?? '', base);
      return link && inCourse(link, root) ? [link.href] : [];
    });
  const main = $('main').first();
  const article = $(
    '.sl-markdown-content, .theme-doc-markdown, .entry-content',
  ).first();
  const slides = $('[data-coursepress-slide]');
  const content = slides.length
    ? $('<article>').append(slides.clone())
    : article.length
      ? article
      : main.length
        ? main
        : $('article, .reveal .slides').first();
  if (!content.length) throw new Error(`No course content found: ${url.href}`);
  const title =
    main.find('h1').first().text().trim() ||
    content.find('h1').first().text().trim() ||
    $('title').text().split('|')[0]!.trim();
  if (!title) throw new Error(`No page title found: ${url.href}`);
  content
    .find(
      'script, style, nav, aside, footer, button, .anchor-link, .sl-anchor-link, .addPaddTopBottom, .pagination-links, .pagination-nav, [aria-hidden="true"]',
    )
    .remove();
  // Gatsby's licence badges are site chrome, not course illustrations.
  content.find('img.cc, img.ccby').closest('a').remove();
  content
    .find(
      'a[href], img[src], iframe[src], video[src], audio[src], source[src], object[data]',
    )
    .each((_, element) => {
      const node = $(element);
      const attr = node.is('a') ? 'href' : node.is('object') ? 'data' : 'src';
      const value = node.attr(attr) ?? '';
      const absolute = httpUrl(value, base);
      if (absolute) node.attr(attr, absolute.href);
      else if (!/^(mailto:|tel:|data:image\/)/i.test(value))
        node.removeAttr(attr);
    });
  content.find('img').each((_, element) => {
    const node = $(element);
    const lazy = node.attr('data-src');
    if (lazy)
      node.attr('src', httpUrl(lazy, base)?.href ?? node.attr('src') ?? '');
    node.removeAttr('srcset');
  });
  // Preserve embeds as useful links; Markdown cannot render interactive players.
  content.find('iframe, video, audio, object').each((_, element) => {
    const node = $(element);
    const source =
      node.attr('src') ||
      node.attr('data') ||
      node.find('source').first().attr('src');
    if (source)
      node.replaceWith(
        $('<p>').append(
          $('<a>')
            .attr('href', source)
            .text(node.attr('title') || 'Media'),
        ),
      );
  });
  const fragment = content.clone();
  if (!fragment.find('h1').length) fragment.prepend($('<h1>').text(title));
  return {
    url: url.href,
    title,
    html: fragment.html() ?? '',
    links: [...links],
    sitemaps,
    navigation: nav,
  };
}

export function mergeNavigation(
  target: NavigationItem[],
  incoming: NavigationItem[],
): void {
  for (const item of incoming) {
    const existing = target.find((entry) =>
      item.url
        ? entry.url === item.url
        : !entry.url && entry.title === item.title,
    );
    if (existing) mergeNavigation(existing.children, item.children);
    else target.push(item);
  }
}

export function markdown(html: string): string {
  const converter = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  converter.use(gfm);
  converter.addRule('headingAnchors', {
    filter: (node) =>
      /^H[1-6]$/.test(node.nodeName) && !!node.getAttribute('id'),
    replacement: (content, node) => {
      const element = node as HTMLElement;
      const id = element
        .getAttribute('id')!
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
      return `\n\n<a id="${id}"></a>\n\n${'#'.repeat(Number(element.tagName.slice(1)))} ${content}\n\n`;
    },
  });
  converter.addRule('codeBlocks', {
    filter: 'pre',
    replacement: (_, node) => {
      const element = node as HTMLElement;
      const code = element.querySelector('code') ?? element;
      const language = (
        code.className.match(/language-([\w+-]+)/)?.[1] ??
        element.getAttribute('data-language') ??
        ''
      ).replace(/[^\w+-]/g, '');
      const text = code.textContent?.replace(/\n$/, '') ?? '';
      const longest = Math.max(
        2,
        ...[...text.matchAll(/`+/g)].map((match) => match[0].length),
      );
      const fence = '`'.repeat(longest + 1);
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    },
  });
  return `${converter.turndown(html).trim()}\n`;
}
