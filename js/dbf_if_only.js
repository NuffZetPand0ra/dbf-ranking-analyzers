const LOOKUP_CACHE_PREFIX = 'dbf_lookup_if_only_v2_';
const LOOKUP_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const ALL_PLAYERS_CACHE_KEY = 'dbf_all_players_cache_v2';
const ALL_PLAYERS_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const ACTUAL_COLOR = '#378ADD';
const ALT_COLOR = '#D85A30';

let currentPlayer = null;
let allPlayersData = null;
let chart = null;
let autocompleteIndex = -1;
let isRestoringState = false;
let currentSource = new URLSearchParams(window.location.search).get('exclude') || '';

const searchEl = document.getElementById('ifonly-search');
const dropdownEl = document.getElementById('ifonly-dropdown');
const statusEl = document.getElementById('ifonly-status');
const sourceEl = document.getElementById('ifonly-source');
const shareBtnEl = document.getElementById('ifonly-share-btn');
const emptyEl = document.getElementById('ifonly-empty');
const wrapEl = document.getElementById('ifonly-wrap');
const playerEl = document.getElementById('ifonly-player');
const playerMetaEl = document.getElementById('ifonly-player-meta');
const sourceNameEl = document.getElementById('ifonly-source-name');
const sourceDetailEl = document.getElementById('ifonly-source-detail');
const chartEl = document.getElementById('ifonly-chart');
const statsEl = document.getElementById('ifonly-stats');
const noteEl = document.getElementById('ifonly-note');

function parseNumber(value) {
  const parsed = parseFloat(String(value ?? '').replace(/\u00a0/g, '').replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function fmtDate(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

function normalizePlayers(players) {
  if (!Array.isArray(players)) return null;

  const normalized = players
    .map(player => {
      if (!player || typeof player !== 'object') return null;
      const hc = typeof player.hc === 'number' ? player.hc : parseNumber(player.hc);
      const dbfNr = String(player.dbfNr ?? '').replace(/\D/g, '');
      if (!Number.isFinite(hc) || !dbfNr) return null;
      return {
        name: typeof player.name === 'string' ? player.name : '',
        club: typeof player.club === 'string' ? player.club : '',
        dbfNr,
        hc,
      };
    })
    .filter(Boolean);

  return normalized.length ? normalized : null;
}

function normalizeLookupResponse(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.entries) || !data.entries.length) return null;

  const entries = data.entries
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || typeof entry.date !== 'string') return null;
      const hc = typeof entry.hc === 'number' ? entry.hc : parseNumber(entry.hc);
      if (!Number.isFinite(hc)) return null;
      const change = entry.change === null || entry.change === undefined || entry.change === '' ? null : parseNumber(entry.change);
      const date = new Date(entry.date + 'T12:00:00');
      if (Number.isNaN(date.getTime())) return null;
      return {
        id: entry.id || `entry-${index}`,
        seq: Number.isFinite(entry.seq) ? entry.seq : index,
        dateIso: entry.date,
        date,
        tournament: typeof entry.tournament === 'string' ? entry.tournament : '',
        club: typeof entry.club === 'string' ? entry.club : '',
        change,
        hc,
        turnId: entry.turnId ? String(entry.turnId) : null,
        status: typeof entry.status === 'string' ? entry.status : '',
        applied: entry.applied !== false,
        sourceType: typeof entry.sourceType === 'string' ? entry.sourceType : 'club',
        sourceLabel: typeof entry.sourceLabel === 'string'
          ? entry.sourceLabel.trim()
          : (typeof entry.club === 'string' ? entry.club.trim() : ''),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.seq - b.seq);

  if (!entries.length) return null;
  if (!entries.some(entry => entry.sourceLabel)) return null;

  let startHc = typeof data.startHc === 'number' ? data.startHc : parseNumber(data.startHc);
  if (!Number.isFinite(startHc)) {
    startHc = entries[0].change !== null ? round2(entries[0].hc - entries[0].change) : entries[0].hc;
  }

  return {
    name: typeof data.name === 'string' ? data.name : '',
    dbfNr: String(data.dbfNr ?? '').replace(/\D/g, ''),
    startHc: round2(startHc),
    entries,
  };
}

function readLookupCache(dbfNr) {
  try {
    const raw = localStorage.getItem(LOOKUP_CACHE_PREFIX + dbfNr);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !parsed.data) return null;
    if (Date.now() - parsed.ts > LOOKUP_CACHE_MAX_AGE_MS) return null;
    const normalized = normalizeLookupResponse(parsed.data);
    if (!normalized) {
      localStorage.removeItem(LOOKUP_CACHE_PREFIX + dbfNr);
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function writeLookupCache(dbfNr, data) {
  try {
    localStorage.setItem(LOOKUP_CACHE_PREFIX + dbfNr, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

async function fetchLookupData(dbfNr) {
  const res = await fetch('/api/lookup?dbfNr=' + encodeURIComponent(dbfNr));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  return normalizeLookupResponse(json);
}

function readAllPlayersCache() {
  try {
    const raw = localStorage.getItem(ALL_PLAYERS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !Array.isArray(parsed.players)) return null;
    if (Date.now() - parsed.ts > ALL_PLAYERS_CACHE_MAX_AGE_MS) return null;
    return normalizePlayers(parsed.players);
  } catch {
    return null;
  }
}

function writeAllPlayersCache(players) {
  try {
    localStorage.setItem(ALL_PLAYERS_CACHE_KEY, JSON.stringify({ ts: Date.now(), players }));
  } catch {}
}

async function fetchAllPlayers() {
  if (allPlayersData) return allPlayersData;
  const cached = readAllPlayersCache();
  if (cached) {
    allPlayersData = cached;
    return cached;
  }
  const res = await fetch('/api/hacalle');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  allPlayersData = normalizePlayers(json.players) || [];
  writeAllPlayersCache(allPlayersData);
  return allPlayersData;
}

let statusTimer = null;
function setStatus(msg, cls) {
  statusEl.textContent = msg || '';
  statusEl.className = 'fetch-status' + (cls ? ' ' + cls : '');
  clearTimeout(statusTimer);
  if (cls === 'ok') statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2800);
}

function playerMatchesQuery(player, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = (player.name + ' ' + (player.club || '')).toLowerCase();
  return words.every(word => haystack.includes(word));
}

function showAutocomplete(matches) {
  dropdownEl.innerHTML = '';
  autocompleteIndex = -1;
  if (!matches.length) {
    dropdownEl.style.display = 'none';
    return;
  }

  matches.slice(0, 50).forEach(player => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.dataset.dbf = player.dbfNr;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'autocomplete-item-name';
    nameDiv.textContent = player.name;

    const clubDiv = document.createElement('div');
    clubDiv.className = 'autocomplete-item-club';
    clubDiv.textContent = (player.club || '') + (player.dbfNr ? ' · #' + player.dbfNr : '');

    item.append(nameDiv, clubDiv);
    dropdownEl.appendChild(item);
  });

  dropdownEl.style.display = 'block';
}

function hideAutocomplete() {
  dropdownEl.style.display = 'none';
  autocompleteIndex = -1;
}

async function handleSearchInput() {
  const query = searchEl.value.trim();
  if (!query) {
    hideAutocomplete();
    return;
  }
  try {
    const players = await fetchAllPlayers();
    showAutocomplete(players.filter(player => playerMatchesQuery(player, query)));
  } catch {}
}

function summarizeSources(entries) {
  const map = new Map();
  for (const entry of entries) {
    const label = entry.sourceLabel || entry.club;
    if (!label) continue;
    let item = map.get(label);
    if (!item) {
      item = { label, count: 0, totalChange: 0, tournamentKeys: new Set() };
      map.set(label, item);
    }
    item.count += 1;
    item.totalChange += typeof entry.change === 'number' ? entry.change : 0;
    item.tournamentKeys.add(entry.turnId || `${entry.dateIso}|${entry.tournament}`);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'da'));
}

function formatSigned(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function makeStatCard(label, value, sub, accentColor) {
  const card = document.createElement('div');
  card.className = 'stat-card';
  if (accentColor) card.style.borderTop = '3px solid ' + accentColor;

  const lbl = document.createElement('div');
  lbl.className = 'stat-label';
  lbl.textContent = label;

  const valEl = document.createElement('div');
  valEl.className = 'stat-val';
  valEl.textContent = value;

  const subEl = document.createElement('div');
  subEl.className = 'stat-sub';
  subEl.textContent = sub;

  card.append(lbl, valEl, subEl);
  return card;
}

function buildScenario(player, excludedSource) {
  let altHc = player.startHc;
  let excludedChange = 0;
  const excludedTournamentKeys = new Set();
  const actualPoints = [];
  const altPoints = [];
  let excludedCount = 0;

  for (const entry of player.entries) {
    actualPoints.push({ x: entry.date.getTime(), y: entry.hc, entry });

    const isExcluded = Boolean(excludedSource) && entry.sourceLabel === excludedSource;
    if (isExcluded) {
      excludedCount += 1;
      if (typeof entry.change === 'number') excludedChange += entry.change;
      excludedTournamentKeys.add(entry.turnId || `${entry.dateIso}|${entry.tournament}`);
    } else if (typeof entry.change === 'number') {
      altHc = round2(altHc + entry.change);
    } else {
      altHc = entry.hc;
    }

    altPoints.push({ x: entry.date.getTime(), y: round2(altHc), entry });
  }

  return {
    actualPoints,
    altPoints,
    actualCurrent: actualPoints[actualPoints.length - 1].y,
    altCurrent: altPoints[altPoints.length - 1].y,
    actualBest: Math.min(...actualPoints.map(point => point.y)),
    altBest: Math.min(...altPoints.map(point => point.y)),
    excludedCount,
    excludedChange: round2(excludedChange),
    excludedTournaments: excludedTournamentKeys.size,
  };
}

function updateSourceOptions(sources) {
  const previous = currentSource;
  sourceEl.innerHTML = '';

  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'Ingen eksklusion';
  sourceEl.appendChild(noneOption);

  for (const source of sources) {
    const option = document.createElement('option');
    option.value = source.label;
    option.textContent = `${source.label} (${source.count})`;
    sourceEl.appendChild(option);
  }

  sourceEl.disabled = !sources.length;

  const hasRequestedSource = sources.some(source => source.label === previous);
  if (hasRequestedSource) {
    currentSource = previous;
  } else if (!isRestoringState && !previous && sources.length) {
    currentSource = sources[0].label;
  } else if (!hasRequestedSource && previous) {
    currentSource = sources[0]?.label || '';
  }

  sourceEl.value = currentSource;
}

function buildStateParams() {
  const params = new URLSearchParams();
  if (currentPlayer) params.set('p', currentPlayer.dbfNr);
  if (currentSource) {
    params.set('src', 'club');
    params.set('exclude', currentSource);
  }
  return params;
}

function buildPageUrl() {
  const qs = buildStateParams().toString();
  return window.location.origin + window.location.pathname + (qs ? '?' + qs : '');
}

function syncUrl() {
  if (isRestoringState) return;
  const qs = buildStateParams().toString();
  const rel = window.location.pathname + (qs ? '?' + qs : '');
  window.history.replaceState({}, '', rel);
}

function render() {
  if (!currentPlayer) {
    emptyEl.style.display = '';
    wrapEl.style.display = 'none';
    return;
  }

  const sources = summarizeSources(currentPlayer.entries);
  updateSourceOptions(sources);
  const scenario = buildScenario(currentPlayer, currentSource);
  const deltaCurrent = round2(scenario.altCurrent - scenario.actualCurrent);
  const excludedPct = currentPlayer.entries.length ? Math.round((scenario.excludedCount / currentPlayer.entries.length) * 100) : 0;
  const deltaColor = deltaCurrent < 0 ? 'var(--fresh)' : deltaCurrent > 0 ? 'var(--danger)' : 'var(--muted)';

  playerEl.textContent = currentPlayer.name;
  playerMetaEl.textContent = [currentPlayer.club, '#' + currentPlayer.dbfNr].filter(Boolean).join(' · ');
  sourceNameEl.textContent = currentSource ? `Hvis bare uden ${currentSource}` : 'Ingen kilde ekskluderet';
  sourceDetailEl.textContent = currentSource
    ? `${scenario.excludedCount} posteringer på tværs af ${scenario.excludedTournaments} turneringer er udeladt i den alternative bane.`
    : 'Vælg en kilde for at sammenligne den faktiske kurve med en alternativ delta-bane.';

  noteEl.textContent = currentSource
    ? `Alternativ udvikling er beregnet ved at afspille historikken igen uden ${currentSource}. Modellen er baseret på relative deltas og beskriver ikke nødvendigvis, hvad der faktisk ville være sket.`
    : 'Vælg en kilde for at se en alternativ HC-bane. Analysen er bevidst formuleret som en delta-baseret model, ikke som en sikker kontrafaktisk sandhed.';

  statsEl.innerHTML = '';
  statsEl.append(
    makeStatCard('Faktisk nu', scenario.actualCurrent.toFixed(2), 'seneste registrerede HC', ACTUAL_COLOR),
    makeStatCard('Hvis bare nu', scenario.altCurrent.toFixed(2), currentSource ? 'alternativ HC uden valgt kilde' : 'samme som faktisk uden eksklusion', ALT_COLOR),
    makeStatCard('Δ nu', formatSigned(deltaCurrent), 'negativ = alternativt bedre HC', deltaColor),
    makeStatCard('Ekskl. poster', String(scenario.excludedCount), `${excludedPct}% af historikken`, 'var(--accent)'),
    makeStatCard('Ekskl. Δhc', formatSigned(scenario.excludedChange), `${scenario.excludedTournaments} turneringer`, 'var(--muted)')
  );

  if (chart) {
    chart.destroy();
    chart = null;
  }

  const rootStyle = getComputedStyle(document.documentElement);
  const mutedColor = rootStyle.getPropertyValue('--muted').trim() || '#888';
  const xMin = scenario.actualPoints[0].x;
  const xMax = scenario.actualPoints[scenario.actualPoints.length - 1].x;

  chart = new Chart(chartEl, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Faktisk HC',
          data: scenario.actualPoints,
          borderColor: ACTUAL_COLOR,
          backgroundColor: ACTUAL_COLOR + '22',
          borderWidth: 2.4,
          pointRadius: scenario.actualPoints.length > 140 ? 0 : 2.4,
          pointHoverRadius: 5,
          tension: 0.12,
          fill: false,
        },
        {
          label: 'Hvis bare',
          data: scenario.altPoints,
          borderColor: ALT_COLOR,
          backgroundColor: ALT_COLOR + '22',
          borderWidth: 2.4,
          borderDash: [7, 4],
          pointRadius: scenario.altPoints.length > 140 ? 0 : 2.2,
          pointHoverRadius: 5,
          tension: 0.08,
          fill: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => fmtDate(new Date(items[0].parsed.x)),
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}`
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: xMin,
          max: xMax,
          ticks: {
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: 12,
            font: { size: 10 },
            color: mutedColor,
            callback: value => fmtDate(new Date(value))
          },
          grid: { color: 'rgba(128,128,128,0.08)' }
        },
        y: {
          reverse: true,
          title: { display: true, text: 'Handicap', font: { size: 11 }, color: mutedColor },
          ticks: { font: { size: 10 }, color: mutedColor },
          grid: { color: 'rgba(128,128,128,0.08)' }
        }
      }
    }
  });

  emptyEl.style.display = 'none';
  wrapEl.style.display = '';
  syncUrl();
}

async function loadPlayer(dbfNr) {
  if (!dbfNr) return;
  setStatus('Henter...', '');

  try {
    const normalizedDbfNr = String(dbfNr).replace(/\D/g, '');
    let data = readLookupCache(normalizedDbfNr);
    if (!data) {
      data = await fetchLookupData(normalizedDbfNr);
      if (!data) throw new Error('Kunne ikke fortolke spillerhistorik');
      writeLookupCache(normalizedDbfNr, data);
    }

    let club = '';
    try {
      const allPlayers = await fetchAllPlayers();
      const match = allPlayers.find(player => player.dbfNr === normalizedDbfNr);
      if (match) club = match.club || '';
    } catch {}

    currentPlayer = {
      ...data,
      dbfNr: normalizedDbfNr,
      club,
    };

    setStatus('Indlæst: ' + data.name, 'ok');
    render();
  } catch (err) {
    setStatus('Fejl: ' + err.message, 'err');
  }
}

function copyShareUrl() {
  if (!currentPlayer) {
    setStatus('Vælg en spiller først', 'err');
    return;
  }

  const url = buildPageUrl();
  navigator.clipboard.writeText(url).then(() => {
    const original = shareBtnEl.textContent;
    shareBtnEl.textContent = '✓ Kopieret!';
    setTimeout(() => { shareBtnEl.textContent = original; }, 2000);
  }).catch(() => {
    prompt('Kopier dette link:', url);
  });
}

async function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.toString()) return;

  isRestoringState = true;
  try {
    currentSource = params.get('exclude') || '';
    const dbfNr = params.get('p');
    if (dbfNr) {
      await loadPlayer(dbfNr);
    }
  } finally {
    isRestoringState = false;
  }
}

dropdownEl.addEventListener('mousedown', event => event.preventDefault());
searchEl.addEventListener('focus', handleSearchInput);
searchEl.addEventListener('input', handleSearchInput);
searchEl.addEventListener('blur', hideAutocomplete);

dropdownEl.addEventListener('click', event => {
  const item = event.target.closest('.autocomplete-item');
  if (!item) return;
  const dbfNr = item.dataset.dbf;
  searchEl.value = '';
  hideAutocomplete();
  currentSource = '';
  loadPlayer(dbfNr);
});

searchEl.addEventListener('keydown', event => {
  const items = dropdownEl.querySelectorAll('.autocomplete-item');
  const isOpen = dropdownEl.style.display !== 'none' && items.length > 0;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!isOpen) return;
    autocompleteIndex = Math.min(autocompleteIndex + 1, items.length - 1);
    items.forEach((item, index) => item.classList.toggle('autocomplete-item-active', index === autocompleteIndex));
    items[autocompleteIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!isOpen) return;
    autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
    items.forEach((item, index) => item.classList.toggle('autocomplete-item-active', index === autocompleteIndex));
    items[autocompleteIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (isOpen && autocompleteIndex >= 0) {
      const selected = items[autocompleteIndex];
      searchEl.value = '';
      hideAutocomplete();
      currentSource = '';
      loadPlayer(selected.dataset.dbf);
    }
  } else if (event.key === 'Escape') {
    hideAutocomplete();
  }
});

sourceEl.addEventListener('change', () => {
  currentSource = sourceEl.value;
  render();
});

shareBtnEl.addEventListener('click', copyShareUrl);

restoreStateFromUrl().finally(() => {
  fetchAllPlayers().catch(() => {});
});