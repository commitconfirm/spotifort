// Single source of truth for the festival edition.
// Next year: edit this file, then run `npm run lineup`.
export default {
  year: 2027,
  name: 'Treefort Music Fest',
  dates: 'March 31 – April 4, 2027',
  lineupUrl: 'https://treefortmusicfest.com/lineup/',
  // "Try:" chips on the first screen. Each must be in the similarity index or on the lineup (checked by
  // tests/examples.test.js and scripts/check-dist.js); any that is not is silently skipped at run time.
  exampleArtists: ['Phoebe Bridgers', 'Turnstile', 'Zach Bryan', 'Khruangbin'],
};
