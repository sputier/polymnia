import type { Page, Route } from '@playwright/test';
import { gunzipSync } from 'node:zlib';

// An in-memory stand-in for /api/scores (docs/api.md): versions and If-Match, paging, search, duplicate, delete.
// The real server is exercised by the api tests; here the browser side is.

interface Stored {
  id: string;
  doc: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecordedRequest {
  method: string;
  path: string;
  ifMatch: string | null;
  contentEncoding: string | null;
  body: unknown;
}

export function emptyScoreDoc(
  title: string,
  options: { measures?: number; instruments?: string[] } = {},
): Record<string, unknown> {
  const count = options.measures ?? 4;
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const measures = Array.from({ length: count }, (_, i) =>
    i === 0 ? { id: id('m'), time: { beats: 4, beatType: 4 }, keyFifths: 0 } : { id: id('m') },
  );
  return {
    schemaVersion: 1,
    meta: { title, composer: '', tempoBpm: 100 },
    measures,
    parts: (options.instruments ?? ['piano']).map((instrument) => ({
      id: id('p'),
      name: instrument,
      instrument,
      transposition: 0,
      staves: [
        {
          id: id('s'),
          clef: 'treble',
          type: 'standard',
          measures: measures.map(() => ({
            voices: [
              {
                id: id('v'),
                events: [{ kind: 'rest', id: id('e'), duration: { base: 'whole', dots: 0 } }],
                tuplets: [],
              },
            ],
          })),
        },
      ],
    })),
    slurs: [],
  };
}

export class FakeApi {
  readonly scores = new Map<string, Stored>();
  readonly requests: RecordedRequest[] = [];
  /** `true`: every score request fails like a dropped connection. */
  offline = false;
  /** Status to answer to the next write, once (for example 429 or 413). */
  failNextWrite: { status: number; headers?: Record<string, string> } | undefined;
  private counter = 0;
  private clock = Date.parse('2026-06-01T10:00:00Z');

  private tick(): string {
    this.clock += 60_000;
    return new Date(this.clock).toISOString();
  }

  add(title: string, doc?: Record<string, unknown>): string {
    const id = `00000000-0000-4000-8000-${String(++this.counter).padStart(12, '0')}`;
    const content = doc ?? emptyScoreDoc(title);
    (content.meta as { title: string }).title = title;
    const stamp = this.tick();
    this.scores.set(id, { id, doc: content, version: 1, createdAt: stamp, updatedAt: stamp });
    return id;
  }

  /** Someone else saved the score: its version moves on. */
  bump(id: string): void {
    const s = this.scores.get(id)!;
    s.version += 1;
    s.updatedAt = this.tick();
  }

  version(id: string): number {
    return this.scores.get(id)!.version;
  }

  writes(method: string): RecordedRequest[] {
    return this.requests.filter((r) => r.method === method);
  }

  async install(page: Page): Promise<void> {
    // The antiforgery token is a cookie the API client echoes in a header (docs/authentication.md).
    await page.route('**/api/auth/antiforgery', (route) =>
      route.fulfill({
        status: 204,
        headers: { 'Set-Cookie': '__Host-XSRF-TOKEN=test-token; Path=/; Secure; SameSite=Strict' },
      }),
    );
    await page.route('**/api/scores**', (route) => this.handle(route));
  }

  private summary(s: Stored) {
    const doc = s.doc as {
      meta: { title: string };
      measures: unknown[];
      parts: { instrument: string }[];
    };
    return {
      id: s.id,
      title: doc.meta.title,
      schemaVersion: 1,
      version: s.version,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      measureCount: doc.measures.length,
      instruments: doc.parts.map((p) => p.instrument),
    };
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    let body: unknown;
    const buffer = request.postDataBuffer();
    const encoding = request.headers()['content-encoding'] ?? null;
    if (buffer) {
      const text = (encoding === 'gzip' ? gunzipSync(buffer) : buffer).toString('utf8');
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    this.requests.push({
      method,
      path: path + url.search,
      ifMatch: request.headers()['if-match'] ?? null,
      contentEncoding: encoding,
      body,
    });

    if (this.offline) return route.abort('internetdisconnected');
    if (method !== 'GET' && this.failNextWrite) {
      const { status, headers } = this.failNextWrite;
      this.failNextWrite = undefined;
      return route.fulfill({ status, headers: headers ?? {}, json: { title: 'Failed' } });
    }

    const rest = path.replace(/^\/api\/scores\/?/, '');
    const [id, action] = rest.split('/');

    if (!id) {
      if (method === 'GET') return this.list(route, url);
      if (method === 'POST') return this.create(route, body as Record<string, unknown>);
      return route.fulfill({ status: 405 });
    }
    const stored = this.scores.get(id);
    if (!stored) return route.fulfill({ status: 404, json: { title: 'Not found' } });

    if (action === 'duplicate' && method === 'POST') {
      const copy = structuredClone(stored.doc) as { meta: { title: string } };
      copy.meta.title = `${copy.meta.title} (copy)`;
      const newId = this.add(copy.meta.title, copy as unknown as Record<string, unknown>);
      const created = this.scores.get(newId)!;
      return route.fulfill({
        status: 201,
        headers: { ETag: '"1"' },
        json: this.summary(created),
      });
    }
    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        headers: { ETag: `"${stored.version}"`, 'Content-Type': 'application/json' },
        body: JSON.stringify(stored.doc),
      });
    }
    if (method === 'DELETE') {
      this.scores.delete(id);
      return route.fulfill({ status: 204 });
    }
    if (method === 'PUT' || method === 'PATCH') {
      const expected = /^"(\d+)"$/.exec(request.headers()['if-match'] ?? '')?.[1];
      if (!expected) return route.fulfill({ status: 428 });
      if (Number(expected) !== stored.version) {
        return route.fulfill({
          status: 409,
          json: { type: 'urn:polymnia:problem:version-conflict', title: 'Conflict' },
        });
      }
      if (method === 'PUT') stored.doc = body as Record<string, unknown>;
      else (stored.doc.meta as { title: string }).title = (body as { title: string }).title;
      stored.version += 1;
      stored.updatedAt = this.tick();
      const doc = stored.doc as { meta: { title: string } };
      return route.fulfill({
        status: 200,
        headers: { ETag: `"${stored.version}"` },
        json: {
          id,
          title: doc.meta.title,
          schemaVersion: 1,
          version: stored.version,
          updatedAt: stored.updatedAt,
        },
      });
    }
    return route.fulfill({ status: 405 });
  }

  private list(route: Route, url: URL) {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const all = [...this.scores.values()]
      .filter((s) => (s.doc.meta as { title: string }).title.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return route.fulfill({
      json: {
        items: all.slice((page - 1) * pageSize, page * pageSize).map((s) => this.summary(s)),
        page,
        pageSize,
        total: all.length,
      },
    });
  }

  private create(route: Route, doc: Record<string, unknown>) {
    const id = this.add((doc.meta as { title: string }).title, doc);
    return route.fulfill({
      status: 201,
      headers: { ETag: '"1"' },
      json: this.summary(this.scores.get(id)!),
    });
  }
}
