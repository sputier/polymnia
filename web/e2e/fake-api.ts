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

type Json = Record<string, unknown>;
interface Op extends Json {
  op: string;
}

/**
 * Applies the operations of an incremental save (docs/api.md, "Incremental updates") to a copy of the document,
 * like the server does: `undefined` when one cannot be applied (unknown id, inconsistent structure).
 */
function applyOps(source: Json, ops: Op[] | undefined): Json | undefined {
  if (!Array.isArray(ops) || ops.length === 0) return undefined;
  const doc = structuredClone(source) as {
    meta: unknown;
    measures: { id: string }[];
    parts: { id: string; staves: { id: string; measures: unknown[] }[] }[];
    slurs: unknown;
  };
  const staves = () => doc.parts.flatMap((p) => p.staves);
  const measureIndex = (id: unknown) => doc.measures.findIndex((m) => m.id === id);
  const partIndex = (id: unknown) => doc.parts.findIndex((p) => p.id === id);
  for (const o of ops) {
    switch (o.op) {
      case 'setMeta':
        doc.meta = o.meta;
        break;
      case 'setMeasureInfo': {
        const i = measureIndex(o.measureId);
        if (i < 0) return undefined;
        doc.measures[i] = o.value as { id: string };
        break;
      }
      case 'setStaffMeasure': {
        const i = measureIndex(o.measureId);
        const staff = staves().find((s) => s.id === o.staffId);
        if (i < 0 || !staff) return undefined;
        staff.measures[i] = o.value;
        break;
      }
      case 'insertMeasure': {
        const index = o.index as number;
        const entries = o.staffMeasures as { staffId: string; value: unknown }[];
        if (index > doc.measures.length || entries.length !== staves().length) return undefined;
        doc.measures.splice(index, 0, o.info as { id: string });
        for (const { staffId, value } of entries) {
          const staff = staves().find((s) => s.id === staffId);
          if (!staff) return undefined;
          staff.measures.splice(index, 0, value);
        }
        break;
      }
      case 'deleteMeasure': {
        const i = measureIndex(o.measureId);
        if (i < 0 || doc.measures.length === 1) return undefined;
        doc.measures.splice(i, 1);
        for (const staff of staves()) staff.measures.splice(i, 1);
        break;
      }
      case 'replacePart': {
        const i = partIndex(o.partId);
        if (i < 0) return undefined;
        doc.parts[i] = o.value as (typeof doc.parts)[number];
        break;
      }
      case 'insertPart':
        if ((o.index as number) > doc.parts.length) return undefined;
        doc.parts.splice(o.index as number, 0, o.value as (typeof doc.parts)[number]);
        break;
      case 'deletePart': {
        const i = partIndex(o.partId);
        if (i < 0 || doc.parts.length === 1) return undefined;
        doc.parts.splice(i, 1);
        break;
      }
      case 'setSlurs':
        doc.slurs = o.slurs;
        break;
      default:
        return undefined;
    }
  }
  return doc as unknown as Json;
}

export class FakeApi {
  readonly scores = new Map<string, Stored>();
  readonly requests: RecordedRequest[] = [];
  /** `true`: every score request fails like a dropped connection. */
  offline = false;
  /** Status to answer to the next write(s), `times` times (default once), for example 429 or 413. */
  failNextWrite: { status: number; headers?: Record<string, string>; times?: number } | undefined;
  /** Status the server answers to an incremental save (`PATCH .../content`) it cannot apply, until cleared. */
  rejectPatches: number | undefined;
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

  /** Full document saves (`PUT`). */
  fullSaves(): RecordedRequest[] {
    return this.writes('PUT');
  }

  /** Incremental saves (`PATCH .../content`). */
  patches(): RecordedRequest[] {
    return this.requests.filter((r) => r.method === 'PATCH' && r.path.endsWith('/content'));
  }

  /** Every request that saves the content of a score, full or incremental. */
  contentSaves(): RecordedRequest[] {
    return [...this.fullSaves(), ...this.patches()].sort(
      (a, b) => this.requests.indexOf(a) - this.requests.indexOf(b),
    );
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
    await page.route('**/api/shared', (route) => this.handleShared(route));
  }

  /** Share links (docs/sharing.md): at most one active token per score, the token is only returned on creation. */
  readonly shares = new Map<string, { token: string; createdAt: string; revoked: boolean }[]>();
  /** Requests of the public endpoint, with the cookies and referrer they carried. */
  readonly sharedRequests: { path: string; cookie: string | null; referer: string | null }[] = [];

  private activeShare(id: string) {
    return this.shares.get(id)?.find((s) => !s.revoked);
  }

  private shareAction(route: Route, id: string, method: string) {
    if (method === 'GET') {
      const active = this.activeShare(id);
      return route.fulfill({ json: { active: !!active, createdAt: active?.createdAt ?? null } });
    }
    if (method === 'POST') {
      const list = this.shares.get(id) ?? [];
      for (const s of list) s.revoked = true;
      const token = Array.from(
        { length: 43 },
        () =>
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[
            Math.floor(Math.random() * 64)
          ],
      ).join('');
      const created = { token, createdAt: this.tick(), revoked: false };
      list.push(created);
      this.shares.set(id, list);
      return route.fulfill({
        status: 201,
        json: { token, createdAt: created.createdAt },
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (method === 'DELETE') {
      for (const s of this.shares.get(id) ?? []) s.revoked = true;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 405 });
  }

  private async handleShared(route: Route): Promise<void> {
    const request = route.request();
    const headers = request.headers();
    const token = headers['x-share-token'] ?? '';
    this.sharedRequests.push({
      path: new URL(request.url()).pathname + new URL(request.url()).search,
      cookie: headers['cookie'] ?? null,
      referer: headers['referer'] ?? null,
    });
    for (const [id, list] of this.shares) {
      if (list.some((s) => s.token === token && !s.revoked)) {
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          body: JSON.stringify(this.scores.get(id)!.doc),
        });
      }
    }
    return route.fulfill({
      status: 404,
      headers: { 'Content-Type': 'application/problem+json' },
      body: JSON.stringify({ title: 'Not Found', status: 404 }),
    });
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
      const { status, headers, times = 1 } = this.failNextWrite;
      this.failNextWrite =
        times > 1 ? { status, ...(headers ? { headers } : {}), times: times - 1 } : undefined;
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

    if (action === 'share') return this.shareAction(route, id, method);
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
      if (method === 'PATCH' && action === 'content') {
        const patched = this.rejectPatches
          ? undefined
          : applyOps(stored.doc, (body as { ops?: Op[] } | undefined)?.ops);
        if (!patched) {
          return route.fulfill({
            status: this.rejectPatches ?? 400,
            json: { title: 'Invalid patch' },
          });
        }
        stored.doc = patched;
      } else if (method === 'PUT') stored.doc = body as Record<string, unknown>;
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
