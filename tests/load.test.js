import { describe, it, expect, vi } from 'vitest';
import { createLoaders } from '../src/data/load.js';

const ok = (json) => ({ ok: true, status: 200, json: async () => json });

describe('createLoaders', () => {
  it('fetches /data/<year>/ files once each, however many callers', async () => {
    const fetch = vi.fn(async (url) => ok(url.endsWith('lineup.json') ? { artists: [] } : { names: [], edges: [] }));
    const { loadLineup, loadSimilarity } = createLoaders({ fetch, year: 2027 });
    const [a, b, c] = await Promise.all([loadLineup(), loadLineup(), loadLineup()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    await loadSimilarity();
    await loadSimilarity();
    expect(fetch.mock.calls.map((x) => x[0])).toEqual(['/data/2027/lineup.json', '/data/2027/similarity.json']);
  });
  it('reports clear errors and does not remember a failure', async () => {
    let attempt = 0;
    const fetch = vi.fn(async () => (++attempt === 1 ? { ok: false, status: 503 } : ok({ artists: [] })));
    const { loadLineup } = createLoaders({ fetch, year: 2027 });
    await expect(loadLineup()).rejects.toThrow('HTTP 503');
    await expect(loadLineup()).resolves.toEqual({ artists: [] });
  });
  it('errors on network failure, bad JSON, wrong shape and a missing year', async () => {
    await expect(createLoaders({ fetch: async () => { throw new TypeError('offline'); }, year: 1 }).loadLineup()).rejects.toThrow('network error');
    await expect(createLoaders({ fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } }), year: 1 }).loadLineup()).rejects.toThrow('not valid JSON');
    await expect(createLoaders({ fetch: async () => ok({ nope: 1 }), year: 1 }).loadSimilarity()).rejects.toThrow('unexpected shape');
    await expect(createLoaders({ fetch: async () => ok({}), year: undefined }).loadLineup()).rejects.toThrow('year');
  });
});
