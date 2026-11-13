// Lazy loaders for the two public data files, memoised: one request each however many callers ask.
// Returns the parsed JSON; pass it to prepareLineup / prepareSimilarity.

const year = typeof __FESTIVAL_YEAR__ !== 'undefined' ? __FESTIVAL_YEAR__ : undefined;

/**
 * @param {{ fetch?: typeof fetch, year?: number }} [options] injectable for tests
 * @returns {{ loadLineup: () => Promise<object>, loadSimilarity: () => Promise<object> }}
 */
export function createLoaders({ fetch: fetchFn = (...a) => globalThis.fetch(...a), year: y = year } = {}) {
  const memo = new Map();

  function load(name, valid) {
    if (!memo.has(name)) {
      const promise = (async () => {
        if (y === undefined) throw new Error(`Cannot load ${name}: festival year is not set`);
        let response;
        try {
          response = await fetchFn(`/data/${y}/${name}.json`);
        } catch (err) {
          throw new Error(`Could not load ${name} data (network error)`, { cause: err });
        }
        if (!response.ok) throw new Error(`Could not load ${name} data (HTTP ${response.status})`);
        let json;
        try {
          json = await response.json();
        } catch (err) {
          throw new Error(`Could not read ${name} data (not valid JSON)`, { cause: err });
        }
        if (!valid(json)) throw new Error(`Could not use ${name} data (unexpected shape)`);
        return json;
      })();
      // A failed load is not remembered, so a retry can succeed.
      promise.catch(() => memo.delete(name));
      memo.set(name, promise);
    }
    return memo.get(name);
  }

  return {
    loadLineup: () => load('lineup', (j) => j && Array.isArray(j.artists)),
    loadSimilarity: () => load('similarity', (j) => j && Array.isArray(j.names) && Array.isArray(j.edges)),
  };
}

const shared = createLoaders();

/** @returns {Promise<object>} lineup.json for the build's festival year (memoised) */
export const loadLineup = () => shared.loadLineup();

/** @returns {Promise<object>} similarity.json for the build's festival year (memoised) */
export const loadSimilarity = () => shared.loadSimilarity();
