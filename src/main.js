// Spotifort main page: bootstrap and orchestration. Three states share this one page:
//   normal    the finder, "My artists" and the two result lists
//   shared    a read-only list of someone's picks, when the URL carries a valid #s=... fragment
//   callback  /callback after the Spotify login (the same page). The login's purpose rides in the OAuth state: a
//             library login runs the import, a playlist login makes the playlist (once; a reload lands on / and makes
//             nothing). The normal view shows either way.
// All decisions live in src/app/state.js (pure, tested); src/ui/* only renders. lineup.json loads up front;
// similarity.json loads on the first interaction with the search box, or at once when a saved pool exists.
// "Make a Spotify playlist" (in My artists) opens a panel: intro, then the login, then progress and the outcome.
// Nothing about a playlist is stored; whether one was made in this visit is kept in memory only.

import { log } from './log.js';
import { createStore, isValidClientId, DEFAULT_SERVICE } from './store.js';
import { loadLineup, loadSimilarity } from './data/load.js';
import { prepareLineup } from './core/lineup-index.js';
import { prepareSimilarity } from './core/similarity-index.js';
import { addBatch, clearSource, emptyPool, removeSources } from './core/pool.js';
import { playlistPlan } from './core/playlist.js';
import { listTags } from './core/recommend.js';
import { PLATFORM_LABELS } from './core/links.js';
import {
  MANUAL_SOURCES, addByName, addSuggestion, computeResults, diagnostics, formatCount, importSummaryText, libraryCount, poolChips, resolveName,
  sharePicks, shareUrl, sharedFromHash, suggestions, useRelativeBands, validExamples,
  playlistFailure, playlistIntro, playlistOutcome, playlistProgressText,
} from './app/state.js';
import { clearAuth, completeAuth, cryptoAvailable, getAccessToken, hasScopes, startAuth, CryptoNotSupportedError, PLAYLIST_SCOPE } from './auth.js';
import { createApi, spotifySource, SOURCE_ID as SPOTIFY } from './sources/spotify.js';
import { createPlaylist } from './sources/spotify-playlist.js';
import { formatDate } from './utils.js';
import { h, clear, announce } from './ui/dom.js';
import { createCombobox } from './ui/combobox.js';
import { renderResults } from './ui/results.js';
import { renderPoolChips, focusAfterRemoval } from './ui/pool.js';
import { renderGenrePanel, renderGenreResults } from './ui/genre.js';
import { copyShareLink } from './ui/share.js';
import { artistRow } from './ui/rows.js';
import { renderServicePicker } from './ui/service-picker.js';
import { renderPlaylistFailure, renderPlaylistIntro, renderPlaylistOutcome, renderPlaylistProgress } from './ui/playlist.js';

const YEAR = __FESTIVAL_YEAR__;
const EXAMPLES = __EXAMPLE_ARTISTS__;
// A Client ID from .env.local is a development convenience only; it is never part of a production build.
const ENV_CLIENT_ID = import.meta.env.DEV ? import.meta.env.VITE_SPOTIFY_CLIENT_ID || null : null;

const $ = (id) => document.getElementById(id);
const el = {
  finderView: $('finder-view'),
  input: $('finder-input'),
  listbox: $('finder-listbox'),
  count: $('finder-count'),
  loading: $('finder-loading'),
  message: $('finder-message'),
  examples: $('examples'),
  spotifyToggle: $('spotify-toggle'),
  spotifyPanel: $('spotify-panel'),
  spotifyForm: $('spotify-form'),
  clientId: $('client-id'),
  clientIdError: $('client-id-error'),
  remember: $('remember-client-id'),
  connectBtn: $('connect-btn'),
  spotifyStatus: $('spotify-status'),
  genreToggle: $('genre-toggle'),
  genrePanel: $('genre-panel'),
  genreTags: $('genre-tags'),
  genreResults: $('genre-results'),
  pool: $('pool'),
  poolChips: $('pool-chips'),
  poolAdd: $('pool-add'),
  importStatus: $('import-status'),
  shareBtn: $('share-btn'),
  shareOutput: $('share-output'),
  shareUrl: $('share-url'),
  shareConfirm: $('share-confirm'),
  playlistBtn: $('playlist-btn'),
  playlistPanel: $('playlist-panel'),
  playlistHeading: $('playlist-heading'),
  playlistIntro: $('playlist-intro'),
  playlistSummary: $('playlist-summary'),
  playlistNotes: $('playlist-notes'),
  playlistDetails: $('playlist-details'),
  playlistForm: $('playlist-form'),
  playlistClientSaved: $('playlist-client-saved'),
  playlistClientChange: $('playlist-client-change'),
  playlistClientFields: $('playlist-client-fields'),
  playlistClientId: $('playlist-client-id'),
  playlistClientIdError: $('playlist-client-id-error'),
  playlistRemember: $('playlist-remember'),
  playlistContinue: $('playlist-continue'),
  playlistCancel: $('playlist-cancel'),
  playlistError: $('playlist-error'),
  playlistProgress: $('playlist-progress'),
  playlistResult: $('playlist-result'),
  forgetBtn: $('forget-btn'),
  forgetFooter: $('forget-footer'),
  results: $('results'),
  resultsBody: $('results-body'),
  servicePicker: $('service-picker'),
  sharedView: $('shared-view'),
  sharedList: $('shared-list'),
  findOwn: $('find-own'),
  announcer: $('announcer'),
  lineupDate: $('lineup-date'),
};

const store = createStore();
const app = {
  lineup: null,
  similarity: null,
  similarityPromise: null,
  pool: store.loadPool(),
  service: store.loadService(),
  results: null,
  expanded: new Set(),
  genreSelected: new Set(),
  importing: false,
  playlistBusy: false, // a playlist is being made: two createPlaylist calls at once would make two playlists
  playlistMade: false, // a playlist was made (or may have been) in this visit; memory only, never stored
  playlistVm: null, // the outcome on show, so a service change can redraw its listen links
};

// --- similarity (lazy) ---------------------------------------------------------------------------

/** Load similarity.json once; resolves to the prepared index, or null if it failed (a later call retries). */
function ensureSimilarity() {
  if (app.similarity) return Promise.resolve(app.similarity);
  if (!app.similarityPromise) {
    el.loading.hidden = false;
    app.similarityPromise = loadSimilarity()
      .then((json) => {
        app.similarity = prepareSimilarity(json);
        log.info(`Similarity index: ${app.similarity.size} outside artists`);
        renderExamples();
        combobox.refresh();
        recompute({ announceChange: false });
        return app.similarity;
      })
      .catch((err) => {
        log.error('Similarity load failed:', err.message);
        app.similarityPromise = null;
        showMessage("We couldn't load the full artist list, so only artists on the lineup can be found for now.", {
          action: { label: 'Try again', onClick: () => ensureSimilarity() },
        });
        recompute({ announceChange: false });
        return null;
      })
      .finally(() => {
        el.loading.hidden = true;
      });
  }
  return app.similarityPromise;
}

// --- finder messages -----------------------------------------------------------------------------

/** One inline message under the search box, optionally with a button. */
function showMessage(text, { action } = {}) {
  clear(el.message);
  if (!text) return;
  const p = h('p', { className: 'message' }, text);
  if (action) p.append(' ', h('button', { className: 'link-button', text: action.label, attrs: { type: 'button' }, on: { click: action.onClick } }));
  el.message.append(p);
}

function showNoData(name) {
  showMessage(`We don't have data for “${name}”. Nothing at Treefort this year is linked to it in our similar-artist data.`, {
    action: { label: 'Browse by genre instead', onClick: () => openGenrePanel({ focus: true }) },
  });
}

// --- pool ----------------------------------------------------------------------------------------

/** Replace the pool, save it, and redraw. */
function setPool(next, { save = true, announceChange = true } = {}) {
  app.pool = next;
  if (save) store.savePool(next);
  if (!next.entries.length && !app.playlistBusy) closePlaylistPanel();
  renderPool();
  // Recommendations need the similarity index. It is lazy, so any path that fills the pool (typing, a chip,
  // a Spotify import arriving on a fresh /callback page load) must make sure it is on its way.
  if (next.entries.length) ensureSimilarity();
  recompute({ announceChange });
}

function renderPool() {
  const chips = poolChips(app.pool);
  el.pool.hidden = !app.pool.entries.length && !app.importing && el.importStatus.hidden && el.playlistPanel.hidden;
  renderPoolChips(el.poolChips, chips, {
    busy: app.importing,
    onRemove: (key) => {
      const index = chips.manual.findIndex((c) => c.key === key) + chips.libraries.length;
      const name = chips.manual.find((c) => c.key === key)?.name ?? '';
      setPool(removeSources(app.pool, key, MANUAL_SOURCES));
      announce(el.announcer, `Removed ${name}.`);
      focusAfterRemoval(el.poolChips, index, el.input);
    },
    onRemoveLibrary: (sourceId) => {
      setPool(clearSource(app.pool, sourceId));
      el.importStatus.hidden = true;
      renderPool();
      announce(el.announcer, 'Removed your Spotify library.');
      focusAfterRemoval(el.poolChips, 0, el.input);
    },
    onRefreshLibrary: () => refreshSpotify(),
  });
}

function addAndReport(result) {
  if (result.outcome === 'already') {
    showMessage(`${result.name} is already in your artists.`);
    return;
  }
  showMessage('');
  combobox.clearInput();
  setPool(result.pool, { announceChange: false });
  const r = app.results;
  announce(el.announcer, `Added ${result.name}. ${r ? `${r.matches.length} playing Treefort, ${r.recommendations.length} recommended.` : ''}`);
}

async function addName(name) {
  let result = addByName(app.pool, name, app.lineup, app.similarity);
  if (result.outcome === 'pending') {
    await ensureSimilarity();
    result = addByName(app.pool, name, app.lineup, app.similarity);
    if (result.outcome === 'pending') return; // index failed to load; showMessage already explained
  }
  if (result.outcome === 'unknown') showNoData(result.name);
  else addAndReport(result);
}

// --- results -------------------------------------------------------------------------------------

function recompute({ announceChange = true } = {}) {
  if (!app.lineup) return;
  el.servicePicker.hidden = !app.pool.entries.length;
  if (!app.pool.entries.length) {
    app.results = null;
    renderResults(el.resultsBody, { status: 'empty' });
    refreshPlaylistIntro();
    return;
  }
  const t = import.meta.env.DEV ? performance.now() : 0;
  app.results = computeResults(app.pool, app.lineup, app.similarity);
  const relative = useRelativeBands(app.pool.entries.length, app.results.recommendations);
  renderResults(el.resultsBody, {
    status: 'ready',
    lineup: app.lineup,
    service: app.service,
    expanded: app.expanded,
    results: app.results,
    relative,
    similarityLoading: !app.similarity && Boolean(app.similarityPromise),
    onBrowseGenres: () => openGenrePanel({ focus: true }),
  });
  if (import.meta.env.DEV) {
    log.info(`recompute ${(performance.now() - t).toFixed(1)} ms`, diagnostics(app.pool, app.results));
  }
  if (announceChange) {
    announce(el.announcer, `Results updated: ${app.results.matches.length} playing Treefort, ${app.results.recommendations.length} recommended.`);
  }
  refreshPlaylistIntro();
}

// --- examples, service picker, genre panel --------------------------------------------------------

function renderExamples() {
  const list = el.examples.querySelector('ul');
  clear(list);
  const names = validExamples(EXAMPLES, app.lineup, app.similarity);
  for (const name of names) {
    list.append(h('li', {}, h('button', { className: 'chip chip--example', text: name, attrs: { type: 'button' }, on: { click: () => addName(name) } })));
  }
  el.examples.hidden = names.length === 0;
}

function renderServices() {
  renderServicePicker(el.servicePicker.querySelector('.service-options'), app.service, (service) => {
    app.service = service;
    store.saveService(service);
    rerenderLists();
    announce(el.announcer, `Listen links now open ${PLATFORM_LABELS[service]}.`);
  });
}

/** Redraw everything that shows listen links (after a service change). */
function rerenderLists() {
  recompute({ announceChange: false });
  if (!el.genrePanel.hidden) renderGenreResults(genreArgs());
  if (!el.sharedView.hidden) renderShared();
  if (app.playlistVm && !el.playlistResult.hidden) renderPlaylistOutcome(el.playlistResult, app.playlistVm, { lineup: app.lineup, service: app.service });
}

const genreArgs = () => ({
  tagsEl: el.genreTags,
  resultsEl: el.genreResults,
  lineup: app.lineup,
  tags: listTags(app.lineup),
  selected: app.genreSelected,
  service: app.service,
  expanded: app.expanded,
  onChange: () => renderGenreResults(genreArgs()),
});

function togglePanel(button, panel, open) {
  button.setAttribute('aria-expanded', String(open));
  panel.hidden = !open;
}

function openGenrePanel({ focus = false } = {}) {
  if (!app.lineup) return;
  if (el.genrePanel.hidden) {
    togglePanel(el.genreToggle, el.genrePanel, true);
    renderGenrePanel(genreArgs());
  }
  if (focus) {
    el.genrePanel.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    el.genreTags.querySelector('button')?.focus({ preventScroll: true });
  }
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// --- Spotify -------------------------------------------------------------------------------------

function openSpotifyPanel({ focus = false } = {}) {
  togglePanel(el.spotifyToggle, el.spotifyPanel, true);
  if (!el.clientId.value) el.clientId.value = store.loadClientId() ?? ENV_CLIENT_ID ?? '';
  if (focus) el.clientId.focus();
}

function showSpotifyError(message) {
  openSpotifyPanel();
  el.spotifyStatus.textContent = message;
  el.spotifyStatus.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

async function connectSpotify(clientId) {
  if (!spotifySource.isAvailable()) {
    showSpotifyError(new CryptoNotSupportedError().message);
    return;
  }
  el.connectBtn.disabled = true;
  el.connectBtn.textContent = 'Connecting…';
  try {
    await spotifySource.connect(clientId); // navigates away
  } catch (err) {
    log.error('Could not start the Spotify login:', err.message);
    el.connectBtn.disabled = false;
    el.connectBtn.textContent = 'Connect Spotify';
    showSpotifyError(err.message);
  }
}

function onSpotifySubmit(e) {
  e.preventDefault();
  el.clientIdError.textContent = '';
  el.spotifyStatus.textContent = '';
  const id = el.clientId.value.trim() || ENV_CLIENT_ID || '';
  if (!isValidClientId(id)) {
    el.clientIdError.textContent = id ? 'That does not look like a Client ID. It is 32 letters and numbers (not the Client Secret).' : 'Paste your Client ID first.';
    el.clientId.setAttribute('aria-invalid', 'true');
    el.clientId.focus();
    return;
  }
  el.clientId.removeAttribute('aria-invalid');
  store.saveClientId(id, { remember: el.remember.checked });
  store.savePool(app.pool); // make sure the pool survives the round trip
  connectSpotify(id);
}

/** "Refresh from Spotify": re-read with the token in memory, or log in again (no token is ever stored). */
function refreshSpotify() {
  if (spotifySource.isConnected()) {
    runImport();
    return;
  }
  const id = store.loadClientId() ?? ENV_CLIENT_ID;
  if (id) connectSpotify(id);
  else {
    openSpotifyPanel({ focus: true });
    el.spotifyStatus.textContent = 'Enter your Client ID to refresh your library.';
  }
}

function setImportStatus(text, progress) {
  el.importStatus.hidden = false;
  clear(el.importStatus);
  el.importStatus.append(h('p', { text }));
  if (progress) el.importStatus.append(h('progress', { attrs: { max: progress.total || 1, value: progress.done, 'aria-hidden': 'true' } }));
  el.pool.hidden = false;
}

async function runImport() {
  app.importing = true;
  // Start loading the similarity index alongside the library, so results are complete when the import ends.
  ensureSimilarity();
  renderPool();
  setImportStatus('Connecting to Spotify…');
  try {
    const { items, songs, missing } = await spotifySource.fetchArtists((p) => {
      if (p.phase === 'liked') setImportStatus(`Reading your library… ${formatCount(p.done)} of ${formatCount(p.total)} songs`, p);
      else setImportStatus('Reading your top and followed artists…');
    });
    app.importing = false;
    setPool(addBatch(clearSource(app.pool, SPOTIFY), SPOTIFY, items));
    setImportStatus(importSummaryText({ count: libraryCount(app.pool, SPOTIFY), songs, missing }));
  } catch (err) {
    app.importing = false;
    log.error('Spotify import failed:', err.message);
    renderPool();
    setImportStatus(err.kind === 'auth' ? 'Your Spotify login has expired. Use Refresh to connect again.' : err.message || 'Reading your Spotify library failed. Please try again.');
  }
}

async function handleCallback() {
  let done;
  try {
    done = await completeAuth(store.loadClientId() ?? ENV_CLIENT_ID);
  } catch (err) {
    log.error('Callback error:', err.message);
    // err.purpose only decides which panel shows the message; it never starts anything.
    if (err.purpose === 'playlist') showPlaylistError(err.message);
    else showSpotifyError(err.message);
    return;
  }
  if (!done) {
    showSpotifyError('The Spotify login was interrupted. Please connect again.');
    return;
  }
  // completeAuth removed the state and cleaned the URL, so this runs once per login: a reload creates nothing.
  if (done.purpose === 'playlist') await runPlaylistAfterLogin();
  else await runImport();
}

// --- playlist ------------------------------------------------------------------------------------

/** The Treefort picks in page order (matches, then recommendations), as the playlist engine wants them. */
const currentPlan = () => playlistPlan(app.results ?? {}, app.lineup);

/** A valid Client ID this device already has, or null. */
const savedClientId = () => {
  const id = store.loadClientId() ?? ENV_CLIENT_ID;
  return isValidClientId(id) ? id : null;
};

const playlistIntroOpen = () => !el.playlistPanel.hidden && !el.playlistIntro.hidden && !app.playlistBusy;

/** Show or hide the panel, keeping the button's aria-expanded in sync. The pool section must be visible to show it. */
function setPlaylistPanel(open) {
  el.playlistBtn.setAttribute('aria-expanded', String(open));
  el.playlistPanel.hidden = !open;
  if (open) el.pool.hidden = false;
}

function closePlaylistPanel() {
  setPlaylistPanel(false);
  renderPool();
}

/** Re-render the intro's numbers and button from the current results; returns whether a playlist login is in memory. */
function renderIntroNumbers() {
  const tokenReady = hasScopes(PLAYLIST_SCOPE);
  const intro = playlistIntro(currentPlan(), { tokenReady, madeBefore: app.playlistMade });
  renderPlaylistIntro({ summary: el.playlistSummary, notes: el.playlistNotes, details: el.playlistDetails, button: el.playlistContinue }, intro);
  return tokenReady;
}

/** Results changed while the intro is showing: update its numbers without moving focus. */
function refreshPlaylistIntro() {
  if (playlistIntroOpen()) renderIntroNumbers();
}

/** The Client ID area: nothing when a playlist login is in memory, a "saved" line when one is stored, else the fields. */
function showPlaylistClient({ tokenReady, fields = false }) {
  const saved = savedClientId();
  const showFields = !tokenReady && (fields || !saved);
  el.playlistClientSaved.hidden = tokenReady || showFields;
  el.playlistClientFields.hidden = !showFields;
  if (showFields && !el.playlistClientId.value) el.playlistClientId.value = saved ?? '';
}

/** Open the panel on its intro (what will happen and what Spotify will ask). */
function openPlaylistIntro({ focus = true } = {}) {
  setPlaylistPanel(true);
  el.playlistIntro.hidden = false;
  el.playlistProgress.hidden = true;
  clear(el.playlistProgress);
  el.playlistResult.hidden = true;
  clear(el.playlistResult);
  app.playlistVm = null;
  el.playlistError.textContent = '';
  const tokenReady = renderIntroNumbers();
  showPlaylistClient({ tokenReady });
  if (focus) el.playlistHeading.focus();
}

function onPlaylistButton() {
  if (app.playlistBusy) return;
  if (playlistIntroOpen()) closePlaylistPanel();
  else openPlaylistIntro({ focus: true });
}

/** A login for a playlist failed on /callback: show the message in the playlist panel. */
function showPlaylistError(message) {
  openPlaylistIntro({ focus: false });
  el.playlistError.textContent = message;
  el.playlistError.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

async function onPlaylistSubmit(e) {
  e.preventDefault();
  if (app.playlistBusy) return;
  el.playlistError.textContent = '';
  el.playlistClientIdError.textContent = '';
  const plan = currentPlan();
  if (!plan.artists.length) {
    renderIntroNumbers();
    return;
  }
  if (hasScopes(PLAYLIST_SCOPE)) {
    runPlaylist(plan);
    return;
  }
  let id;
  if (!el.playlistClientFields.hidden) {
    id = el.playlistClientId.value.trim() || ENV_CLIENT_ID || '';
    if (!isValidClientId(id)) {
      el.playlistClientIdError.textContent = id ? 'That does not look like a Client ID. It is 32 letters and numbers (not the Client Secret).' : 'Paste your Client ID first.';
      el.playlistClientId.setAttribute('aria-invalid', 'true');
      el.playlistClientId.focus();
      return;
    }
    el.playlistClientId.removeAttribute('aria-invalid');
    store.saveClientId(id, { remember: el.playlistRemember.checked });
  } else {
    id = savedClientId();
    if (!id) {
      showPlaylistClient({ tokenReady: false, fields: true });
      el.playlistClientId.focus();
      return;
    }
  }
  store.savePool(app.pool); // make sure the picks survive the round trip
  if (!cryptoAvailable()) {
    el.playlistError.textContent = new CryptoNotSupportedError().message;
    return;
  }
  const label = el.playlistContinue.textContent;
  el.playlistContinue.disabled = true;
  el.playlistContinue.textContent = 'Connecting…';
  try {
    await startAuth(id, 'playlist'); // navigates away
  } catch (err) {
    log.error('Could not start the Spotify login:', err.message);
    el.playlistContinue.disabled = false;
    el.playlistContinue.textContent = label;
    el.playlistError.textContent = err.message;
  }
}

/** Show the panel in progress mode (intro and outcome hidden). */
function showPlaylistProgress(text) {
  setPlaylistPanel(true);
  el.playlistIntro.hidden = true;
  el.playlistResult.hidden = true;
  clear(el.playlistResult);
  app.playlistVm = null;
  renderPlaylistProgress(el.playlistProgress, text);
  el.playlistPanel.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function showPlaylistFailure(err) {
  el.playlistProgress.hidden = true;
  const vm = playlistFailure(err);
  const heading = renderPlaylistFailure(el.playlistResult, vm);
  announce(el.announcer, vm.announce);
  heading.focus();
}

/** Make the playlist with the token in memory. Never two at once. */
async function runPlaylist(plan) {
  if (app.playlistBusy) return;
  app.playlistBusy = true; // first, before any await
  el.playlistBtn.disabled = true;
  el.playlistContinue.disabled = true;
  showPlaylistProgress(playlistProgressText({}));
  el.playlistHeading.focus({ preventScroll: true }); // the control that started this is now hidden
  let phase = null;
  const onProgress = (p) => {
    const text = playlistProgressText(p);
    renderPlaylistProgress(el.playlistProgress, text, p);
    if (p?.phase !== phase) { // speak phase changes only, not every artist
      phase = p?.phase;
      announce(el.announcer, text);
    }
  };
  try {
    const result = await createPlaylist({ api: createApi({ token: getAccessToken() }), plan, year: YEAR, now: new Date(), onProgress });
    const vm = playlistOutcome(result);
    if (vm.status === 'created' || vm.status === 'incomplete' || vm.status === 'unconfirmed') app.playlistMade = true;
    app.playlistVm = vm;
    el.playlistProgress.hidden = true;
    const heading = renderPlaylistOutcome(el.playlistResult, vm, { lineup: app.lineup, service: app.service });
    announce(el.announcer, vm.announce);
    heading.focus();
  } catch (err) {
    log.error('Playlist failed:', err?.message);
    if (err?.kind === 'auth') clearAuth();
    showPlaylistFailure(err);
  } finally {
    app.playlistBusy = false;
    el.playlistBtn.disabled = false;
    el.playlistContinue.disabled = false;
    el.playlistProgress.hidden = true;
    clear(el.playlistProgress);
  }
}

/** Back from a playlist login on /callback: make the playlist straight away, once. */
async function runPlaylistAfterLogin() {
  showPlaylistProgress(playlistProgressText({}));
  el.playlistBtn.disabled = true; // runPlaylist takes over; every other path below re-enables it
  if (!hasScopes(PLAYLIST_SCOPE)) {
    el.playlistBtn.disabled = false;
    showPlaylistFailure({ kind: 'scope' });
    return;
  }
  const sim = await ensureSimilarity();
  if (!sim) {
    el.playlistBtn.disabled = false;
    showPlaylistFailure({ kind: 'data' });
    return;
  }
  recompute({ announceChange: false });
  const plan = currentPlan();
  el.playlistBtn.disabled = false;
  if (!plan.artists.length) {
    el.playlistProgress.hidden = true;
    openPlaylistIntro({ focus: true }); // it explains why there is nothing to make
    return;
  }
  await runPlaylist(plan);
}

// --- share ---------------------------------------------------------------------------------------

function onShare() {
  const picks = app.results ? sharePicks(app.results.matches, app.results.recommendations) : [];
  el.shareOutput.hidden = false;
  if (!picks.length) {
    el.shareUrl.value = '';
    el.shareConfirm.textContent = 'Nothing to share yet. Add artists until something appears in your lists.';
    return;
  }
  copyShareLink(shareUrl(window.location.origin, YEAR, picks), { output: el.shareOutput, field: el.shareUrl, confirm: el.shareConfirm });
}

function renderShared() {
  const shared = sharedFromHash(window.location.hash, app.lineup);
  if (!shared) return false;
  clear(el.sharedList);
  for (const artist of shared.artists) {
    el.sharedList.append(artistRow({ artist, lineup: app.lineup, service: app.service, idBase: `shared-${artist.n}`, expanded: app.expanded }));
  }
  return true;
}

/** Show the shared view if the hash holds a valid share; returns whether it did. Invalid fragments are ignored. */
function showSharedIfAny() {
  if (!app.lineup || !renderShared()) return false;
  el.sharedView.hidden = false;
  el.finderView.hidden = true;
  return true;
}

function showNormal({ focus = false } = {}) {
  const wasShared = !el.sharedView.hidden;
  el.sharedView.hidden = true;
  el.finderView.hidden = false;
  if (wasShared && app.lineup) {
    if (app.pool.entries.length) ensureSimilarity();
    recompute({ announceChange: false });
  }
  if (focus) el.input.focus();
}

// --- forget --------------------------------------------------------------------------------------

function forgetEverything() {
  if (!app.playlistBusy) {
    setPlaylistPanel(false);
    el.playlistIntro.hidden = false;
    clear(el.playlistProgress);
    el.playlistProgress.hidden = true;
    clear(el.playlistResult);
    el.playlistResult.hidden = true;
    app.playlistVm = null;
    el.playlistClientId.value = '';
    el.playlistClientId.removeAttribute('aria-invalid');
    el.playlistClientIdError.textContent = '';
    el.playlistError.textContent = '';
    el.playlistRemember.checked = true;
    app.playlistMade = false;
  }
  store.forgetAll();
  clearAuth();
  app.service = DEFAULT_SERVICE;
  app.expanded.clear();
  app.genreSelected.clear();
  el.clientId.value = '';
  el.clientId.removeAttribute('aria-invalid');
  el.clientIdError.textContent = '';
  el.remember.checked = true;
  el.importStatus.hidden = true;
  el.shareOutput.hidden = true;
  el.spotifyStatus.textContent = '';
  combobox.clearInput();
  renderServices();
  if (!el.genrePanel.hidden) renderGenrePanel(genreArgs());
  if (window.location.hash) window.history.replaceState(null, document.title, window.location.pathname);
  showNormal();
  setPool(emptyPool(), { save: false, announceChange: false });
  showMessage('Done. Everything this site remembered on this device has been cleared.');
  el.input.focus();
}

// --- combobox ------------------------------------------------------------------------------------

const combobox = createCombobox({
  input: el.input,
  listbox: el.listbox,
  countEl: el.count,
  getSuggestions: (q) => (app.lineup ? suggestions(q, app.lineup, app.similarity) : []),
  renderOption: (s) => [h('span', { className: 'option-name', text: s.name }), s.kind === 'lineup' ? h('span', { className: 'option-tag', text: 'Playing Treefort' }) : null].filter(Boolean),
  onSelect: (s) => addAndReport(addSuggestion(app.pool, s)),
  onSubmit: async (text, hasSuggestions) => {
    if (!app.lineup) return;
    let r = resolveName(text, app.lineup, app.similarity);
    if (r.kind === 'pending') {
      await ensureSimilarity();
      r = resolveName(text, app.lineup, app.similarity);
    }
    if (r.kind === 'lineup' || r.kind === 'outside') addAndReport(addByName(app.pool, text, app.lineup, app.similarity));
    else if (r.kind === 'unknown' && hasSuggestions) showMessage('Choose one of the suggestions with the arrow keys or by tapping it.');
    else if (r.kind === 'unknown') showNoData(text);
  },
  onFirstInteraction: () => ensureSimilarity(),
  onInput: () => showMessage(''),
});

// --- bootstrap -----------------------------------------------------------------------------------

function wireStaticControls() {
  el.spotifyToggle.addEventListener('click', () => {
    const open = el.spotifyToggle.getAttribute('aria-expanded') !== 'true';
    if (open) openSpotifyPanel({ focus: true });
    else togglePanel(el.spotifyToggle, el.spotifyPanel, false);
  });
  el.genreToggle.addEventListener('click', () => {
    if (el.genreToggle.getAttribute('aria-expanded') === 'true') togglePanel(el.genreToggle, el.genrePanel, false);
    else openGenrePanel({ focus: true });
  });
  el.spotifyForm.addEventListener('submit', onSpotifySubmit);
  el.poolAdd.addEventListener('click', () => {
    el.input.focus();
    el.input.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
  el.shareBtn.addEventListener('click', onShare);
  el.playlistBtn.addEventListener('click', onPlaylistButton);
  el.playlistForm.addEventListener('submit', onPlaylistSubmit);
  el.playlistCancel.addEventListener('click', () => {
    closePlaylistPanel();
    el.playlistBtn.focus();
  });
  el.playlistClientChange.addEventListener('click', () => {
    showPlaylistClient({ tokenReady: false, fields: true });
    el.playlistClientId.focus();
  });
  el.forgetBtn.addEventListener('click', forgetEverything);
  el.forgetFooter.addEventListener('click', forgetEverything);
  // Back from Spotify's login screen without logging in: the browser may restore this page as it was left, with the
  // button that started the login still disabled.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    el.connectBtn.disabled = false;
    el.connectBtn.textContent = 'Connect Spotify';
    if (!app.playlistBusy) {
      el.playlistContinue.disabled = false;
      el.playlistContinue.textContent = playlistIntro(currentPlan(), { tokenReady: hasScopes(PLAYLIST_SCOPE) }).buttonText;
    }
  });
  el.findOwn.addEventListener('click', () => {
    window.history.replaceState(null, document.title, window.location.pathname);
    showNormal({ focus: true });
  });
  window.addEventListener('hashchange', () => {
    if (showSharedIfAny()) {
      window.scrollTo(0, 0);
      $('shared-heading').focus();
    } else showNormal();
  });
}

async function loadData() {
  renderResults(el.resultsBody, { status: 'loading' });
  try {
    app.lineup = prepareLineup(await loadLineup());
    log.info(`Lineup: ${app.lineup.artists.length} artists, updated ${app.lineup.lastUpdated}`);
  } catch (err) {
    log.error('Lineup load failed:', err.message);
    renderResults(el.resultsBody, {
      status: 'error',
      error: "We couldn't load the Treefort lineup. Check your connection and try again.",
      onRetry: () => start(),
    });
    return false;
  }
  if (app.lineup.lastUpdated) el.lineupDate.textContent = `Lineup data last updated: ${formatDate(app.lineup.lastUpdated)}.`;
  return true;
}

async function start() {
  if (!(await loadData())) return;
  renderExamples();
  renderPool();
  const isCallback = window.location.pathname.replace(/\/$/, '') === '/callback';
  if (!isCallback && showSharedIfAny()) return;
  if (app.pool.entries.length) ensureSimilarity();
  recompute({ announceChange: false });
  if (isCallback) await handleCallback();
}

wireStaticControls();
renderServices();
renderPool();
start();
