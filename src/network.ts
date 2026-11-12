import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { httpUrl } from './urls.js';

const agent = 'coursepress-scraper';
const userAgent = `${agent}/0.1 (+https://github.com/balazshevesi/coursepress-lnu-scraper)`;
interface Robots {
  isAllowed(url: string, agent: string): boolean | undefined;
  getCrawlDelay(agent: string): number | undefined;
}
// robots-parser's bundled declarations do not support NodeNext default imports.
const robotsParser: (url: string, text: string) => Robots = createRequire(
  import.meta.url,
)('robots-parser');

export class HttpError extends Error {
  constructor(
    public status: number,
    url: string,
  ) {
    super(`HTTP ${status}: ${url}`);
  }
}

export class Downloader {
  private robots = new Map<string, Robots>();
  private lastRequest = 0;

  constructor(private delayMs: number) {}

  private async raw(url: URL, limit: number, delayMs: number) {
    for (let attempt = 0; ; attempt++) {
      await sleep(Math.max(0, this.lastRequest + delayMs - Date.now()));
      this.lastRequest = Date.now();
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': userAgent },
          redirect: 'manual',
          signal: AbortSignal.timeout(30_000),
        });
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < 2
        ) {
          const header = response.headers.get('retry-after') ?? '';
          const seconds = Number(header);
          const wait = header
            ? Number.isFinite(seconds)
              ? seconds * 1000
              : Date.parse(header) - Date.now()
            : 1000 * 2 ** attempt;
          await response.body?.cancel();
          await sleep(Math.min(30_000, Math.max(1000, wait || 1000)));
          continue;
        }
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          return {
            status: response.status,
            headers: response.headers,
            body: Buffer.alloc(0),
          };
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new HttpError(response.status, url.href);
        }
        if (Number(response.headers.get('content-length')) > limit) {
          await response.body?.cancel();
          throw new Error(`Response exceeds ${limit} bytes: ${url.href}`);
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > limit) {
              await reader.cancel();
              throw new Error(`Response exceeds ${limit} bytes: ${url.href}`);
            }
            chunks.push(chunk.value);
          }
        }
        return {
          status: response.status,
          headers: response.headers,
          body: Buffer.concat(chunks),
        };
      } catch (error) {
        if (
          error instanceof HttpError ||
          !(
            error instanceof TypeError ||
            (error instanceof Error && error.name === 'TimeoutError')
          ) ||
          attempt >= 2
        )
          throw error;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  private async policy(url: URL): Promise<Robots> {
    const cached = this.robots.get(url.origin);
    if (cached) return cached;
    const location = new URL('/robots.txt', url.origin);
    let text = '';
    try {
      let current = location;
      for (let redirects = 0; ; redirects++) {
        const response = await this.raw(current, 512_000, this.delayMs);
        if (response.status < 300) {
          text = response.body.toString('utf8');
          break;
        }
        const next = httpUrl(
          response.headers.get('location') ?? '',
          current.href,
        );
        if (!next || redirects >= 5)
          throw new Error(`Cannot read robots.txt: ${location.href}`);
        current = next;
      }
    } catch (error) {
      if (error instanceof HttpError && [404, 410].includes(error.status))
        text = '';
      else if (error instanceof HttpError && [401, 403].includes(error.status))
        text = 'User-agent: *\nDisallow: /';
      else throw error;
    }
    const policy = robotsParser(location.href, text);
    this.robots.set(url.origin, policy);
    return policy;
  }

  async get(
    url: URL,
    allowed: (url: URL) => boolean,
    limit = 10 * 1024 * 1024,
  ) {
    let current = new URL(url);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!allowed(current))
        throw new Error(`Redirect leaves allowed scope: ${current.href}`);
      const policy = await this.policy(current);
      if (policy.isAllowed(current.href, agent) === false)
        throw new Error(`Blocked by robots.txt: ${current.href}`);
      const delay = Math.max(
        this.delayMs,
        (policy.getCrawlDelay(agent) ?? 0) * 1000,
      );
      const result = await this.raw(current, limit, delay);
      if (result.status >= 300 && result.status < 400) {
        const next = httpUrl(
          result.headers.get('location') ?? '',
          current.href,
        );
        if (!next) throw new Error(`Invalid redirect: ${current.href}`);
        current = next;
        continue;
      }
      return { ...result, url: current };
    }
    throw new Error(`Too many redirects: ${url.href}`);
  }
}
