// Single source of truth for the festival edition.
// Next year: change `year`, `dates` and `api.festivalId`, then run `npm run lineup`.
export default {
  year: 2027,
  name: 'Treefort Music Fest',
  dates: 'March 31 – April 4, 2027',
  // Fallback source only: the lineup page is scraped (and the festival's own performer feed read) when the API fails.
  lineupUrl: 'https://treefortmusicfest.com/lineup/',
  // Primary source: the festival app vendor's documented public API (https://dionysustickets.com/api-docs/),
  // read-only, no credentials. Performers, venues, tags and events come from <baseUrl>/festivals/<festivalId>/...
  api: {
    baseUrl: 'https://admin.dionysustickets.com/api/v1',
    festivalId: 'M9p0yHOnabubRb4AScOP',
    // A published performer is matched against music services only when it has no tags or one of these tags
    // (later waves add comedy, film and podcast acts). Titles must equal the festival's tag titles exactly.
    musicTags: ['Music'],
  },
  // "Try:" chips on the first screen. Each must be in the similarity index or on the lineup (checked by
  // tests/examples.test.js and scripts/check-dist.js); any that is not is silently skipped at run time.
  exampleArtists: ['Phoebe Bridgers', 'Turnstile', 'Zach Bryan', 'Khruangbin'],
};
