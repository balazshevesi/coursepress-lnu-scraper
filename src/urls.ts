import { createHash } from 'node:crypto';
import path from 'node:path';

export function httpUrl(value: string, base?: string): URL | undefined {
  try {
    const url = new URL(value, base);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    return url;
  } catch {
    return;
  }
}

/** CoursePress uses both the English /courses/ and Swedish /kurser/ prefix. */
export function courseRoot(value: string): URL {
  const url = httpUrl(value);
  const match = url?.pathname.match(/^\/(?:courses|kurser)\/[^/]+(?:\/|$)/);
  if (!url || !match)
    throw new Error(
      'Expected an HTTP(S) CoursePress URL under /courses/<course>/ or /kurser/<course>/.',
    );
  return new URL(`${match[0].replace(/\/$/, '')}/`, url.origin);
}

export function inCourse(url: URL, root: URL): boolean {
  return (
    url.origin === root.origin &&
    (url.pathname === root.pathname.slice(0, -1) ||
      url.pathname.startsWith(root.pathname))
  );
}

/** Ignore tracking queries and fragments when identifying course pages. */
export function pageKey(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
}

export function isPage(url: URL): boolean {
  return (
    !/\.[^/]+$/.test(url.pathname.replace(/\/$/, '')) ||
    /\.html?\/?$/i.test(url.pathname)
  );
}

export function isAsset(url: URL): boolean {
  return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|pdf|docx?|odt|pptx?|odp|xlsx?|ods|csv|tsv|txt|md|zip|tar|gz|7z|rar|mp[34]|webm|ogg|wav|m4a|ipynb|json|xml|ya?ml|[cm]?js|tsx?|jsx|css|java|py|sql|sh|c|cpp|h)$/i.test(
    url.pathname,
  );
}

export function safeName(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  const clean = decoded.replace(/[^\p{L}\p{N}._-]/gu, '-').slice(0, 100);
  // Suffix changed, mixed-case and reserved names so distinct URLs cannot collide.
  if (
    !clean ||
    clean !== decoded ||
    clean !== clean.toLowerCase() ||
    /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean) ||
    /^\.+$/.test(clean)
  ) {
    const name = clean.replace(/^\.+/, '') || 'file';
    const extension = path.posix.extname(name);
    return `${name.slice(0, name.length - extension.length)}-${hash(value)}${extension}`;
  }
  return clean;
}

export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function pageFile(url: URL, root: URL): string {
  const suffix = url.pathname.slice(root.pathname.replace(/\/$/, '').length);
  return [...suffix.split('/').filter(Boolean).map(safeName), 'index.md'].join(
    '/',
  );
}

export function localLink(from: string, to: string): string {
  return path.posix
    .relative(path.posix.dirname(from), to)
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}
