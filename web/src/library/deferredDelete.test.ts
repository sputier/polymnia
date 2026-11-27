import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCookieJar, removeCookieJar } from '../test-cookies';
import { XSRF_COOKIE } from '../api/client';
import {
  cancelDelete,
  flushDeletes,
  forgetDeletes,
  hasPendingDeletes,
  scheduleDelete,
} from './deferredDelete';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  installCookieJar();
  document.cookie = `${XSRF_COOKIE}=tok; path=/`;
});

afterEach(() => {
  forgetDeletes();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  removeCookieJar();
});

describe('deferred delete', () => {
  it('sends nothing until the undo window ends', async () => {
    const done = vi.fn();
    scheduleDelete('a', done, 8000);
    await vi.advanceTimersByTimeAsync(7999);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hasPendingDeletes()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/scores/a');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
    expect(done).toHaveBeenCalledWith();
    expect(hasPendingDeletes()).toBe(false);
  });

  it('undo cancels the request: the score is never touched', async () => {
    scheduleDelete('a', vi.fn(), 8000);
    expect(cancelDelete('a')).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cancelDelete('a')).toBe(false);
  });

  it('reports a failure so the card can come back', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const done = vi.fn();
    scheduleDelete('a', done, 10);
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
  });

  it('sends the pending deletions with keepalive when the page goes away', async () => {
    scheduleDelete('a', vi.fn(), 8000);
    scheduleDelete('b', vi.fn(), 8000);
    flushDeletes();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).keepalive).toBe(true);
    }
  });
});
