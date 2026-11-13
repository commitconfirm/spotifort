// Spotifort main page: bootstrap and orchestration. Three states share this one page:
//   normal    the finder, "My artists" and the two result lists
//   shared    a read-only list of someone's picks, when the URL carries a valid #s=... fragment
//   callback  /callback after the Spotify login (the same page; the import then runs and the normal view shows)
// All decisions live in src/app/state.js (pure, tested); src/ui/* only renders. lineup.json loads up front;
// similarity.json loads on the first interaction with the search box, or at once when a saved pool exists.

import { log } from './log.js';
import { createStore, isValidClientId, DEFAULT_SERVICE } from './store.js';
import { loadLineup, loadSimilarity } from './data/load.js';
import { prepareLineup } from './core/lineup-index.js';
import { prepareSimilarity } from './core/similarity-index.js';
import { addBatch, clearSource, emptyPool, removeSources } from './core/pool.js';
import { listTags } from './core/recommend.js';
import { PLATFORM_LABELS } from './core/links.js';
import {
  MANUAL_SOURCES, addByName, addSuggestion, computeResults, diagnostics, formatCount, importSummaryText, libraryCount, poolChips, resolveName,
  sharePicks, shareUrl, sharedFromHash, suggestions, useRelativeBands, validExamples,
} from './app/state.js';
import { clearAuth, completeAuth, CryptoNotSupportedError } from './auth.js';
import { spotifySource, SOURCE_ID as SPOTIFY } from './sources/spotify.js';
import { formatDate } from './utils.js';
import { h, clear, announce } from './ui/dom.js';
import { createCombobox } from './ui/combobox.js';
import { renderResults } from './ui/results.js';
import { renderPoolChips, focusAfterRemoval } from './ui/pool.js';
import { renderGenrePanel, renderGenreResults } from './ui/genre.js';
import { copyShareLink } from './ui/share.js';
import { artistRow } from './ui/rows.js';
import { renderServicePicker } from './ui/service-picker.js';

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
  renderPool();
  recompute({ announceChange });
}

function renderPool() {
  const chips = poolChips(app.pool);
  el.pool.hidden = !app.pool.entries.length && !app.importing && el.importStatus.hidden;
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
  try {
    const token = await completeAuth(store.loadClientId() ?? ENV_CLIENT_ID);
    if (!token) {
      showSpotifyError('The Spotify login was interrupted. Please connect again.');
      return;
    }
    await runImport();
  } catch (err) {
    log.error('Callback error:', err.message);
    showSpotifyError(err.message);
  }
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
  el.forgetBtn.addEventListener('click', forgetEverything);
  el.forgetFooter.addEventListener('click', forgetEverything);
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
