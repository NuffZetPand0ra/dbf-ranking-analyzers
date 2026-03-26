// ── Constants ─────────────────────────────────────────────────────────────────
const LOOKUP_CACHE_PREFIX        = 'dbf_lookup_';
const LOOKUP_CACHE_MAX_AGE_MS    = 12 * 60 * 60 * 1000;
const ALL_PLAYERS_CACHE_KEY      = 'dbf_all_players_cache_v2';
const ALL_PLAYERS_CACHE_MAX_AGE  = 12 * 60 * 60 * 1000;
const BADGE_COLOR                = '#378ADD';
const PRED_COLOR                 = '#f59e0b';
const EMBED_IFRAME_HEIGHT        = 640;

const initialParams = new URLSearchParams(window.location.search);
const isEmbedMode = initialParams.get('embed') === '1' || initialParams.get('widget') === '1';

// ── State ─────────────────────────────────────────────────────────────────────
let currentPlayer    = null;   // { name, dbfNr, club, entries:[{date:Date, hc}] }
let allPlayersData   = null;   // players[] from /api/hacalle
let chart            = null;
let autocompleteIndex = -1;
let isRestoringState = false;
let showHover       = true;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const searchEl      = document.getElementById('badge-search');
const dropdownEl    = document.getElementById('badge-dropdown');
const statusEl      = document.getElementById('badge-status');
const fromEl        = document.getElementById('badge-from');
const toEl          = document.getElementById('badge-to');
const predMonthsEl  = document.getElementById('badge-pred-months');
const regMonthsEl   = document.getElementById('badge-reg-months');
const optimismEl    = document.getElementById('badge-optimism');
const optValEl      = document.getElementById('badge-opt-val');
const hoverBtnEl    = document.getElementById('badge-toggle-hover');
const embedUrlBtnEl = document.getElementById('badge-embed-url-btn');
const embedBtnEl    = document.getElementById('badge-embed-btn');
const shareBtnEl    = document.getElementById('badge-share-btn');
const exportBtnEl   = document.getElementById('badge-export-btn');
const emptyEl       = document.getElementById('badge-empty');
const wrapEl        = document.getElementById('badge-wrap');
const badgeChartEl  = document.getElementById('badge-chart');
const statsEl       = document.getElementById('badge-stats');
const pctEl         = document.getElementById('badge-percentile');

// ── Lookup cache ──────────────────────────────────────────────────────────────
function readLookupCache(dbfNr) {
  try {
    const raw = localStorage.getItem(LOOKUP_CACHE_PREFIX + dbfNr);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !parsed.data) return null;
    if (Date.now() - parsed.ts > LOOKUP_CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch { return null; }
}

function writeLookupCache(dbfNr, data) {
  try {
    localStorage.setItem(LOOKUP_CACHE_PREFIX + dbfNr,
      JSON.stringify({ ts: Date.now(), data }));
  } catch { /* ignore quota errors */ }
}

async function fetchLookupData(dbfNr) {
  const res = await fetch('/api/lookup?dbfNr=' + encodeURIComponent(dbfNr));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ── All-players cache (shared key with comparison tool) ───────────────────────
function readAllPlayersCache() {
  try {
    const raw = localStorage.getItem(ALL_PLAYERS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !Array.isArray(parsed.players)) return null;
    if (Date.now() - parsed.ts > ALL_PLAYERS_CACHE_MAX_AGE) return null;
    return normalizePlayers(parsed.players);
  } catch { return null; }
}

function writeAllPlayersCache(players) {
  try {
    localStorage.setItem(ALL_PLAYERS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), players }));
  } catch { /* ignore */ }
}

function normalizePlayers(players) {
  if (!Array.isArray(players)) return null;

  const normalized = players
    .map(player => {
      if (!player || typeof player !== 'object') return null;
      const hc = typeof player.hc === 'number' ? player.hc : parseFloat(String(player.hc ?? '').replace(',', '.'));
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

async function fetchAllPlayers() {
  if (allPlayersData) return allPlayersData;
  const cached = readAllPlayersCache();
  if (cached) { allPlayersData = cached; return allPlayersData; }
  const res = await fetch('/api/hacalle');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  allPlayersData = normalizePlayers(json.players) || [];
  writeAllPlayersCache(allPlayersData);
  return allPlayersData;
}

// ── Status helper ─────────────────────────────────────────────────────────────
let _statusTimer = null;
function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = 'fetch-status' + (cls ? ' ' + cls : '');
  clearTimeout(_statusTimer);
  if (cls === 'ok') _statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 3000);
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
function playerMatchesQuery(p, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay   = (p.name + ' ' + (p.club || '')).toLowerCase();
  return words.every(w => hay.includes(w));
}

function showAutocomplete(matches) {
  dropdownEl.innerHTML = '';
  autocompleteIndex = -1;
  if (!matches.length) { dropdownEl.style.display = 'none'; return; }

  matches.slice(0, 50).forEach(p => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.dataset.dbf = p.dbfNr;

    const nameDiv = document.createElement('div');
    nameDiv.className = 'autocomplete-item-name';
    nameDiv.textContent = p.name;

    const clubDiv = document.createElement('div');
    clubDiv.className = 'autocomplete-item-club';
    clubDiv.textContent = (p.club || '') + (p.dbfNr ? ' · #' + p.dbfNr : '');

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
  const q = searchEl.value.trim();
  if (!q) { hideAutocomplete(); return; }
  try {
    const players = await fetchAllPlayers();
    showAutocomplete(players.filter(p => playerMatchesQuery(p, q)));
  } catch { /* silently ignore during typing */ }
}

// Blur-race fix: prevent mousedown on dropdown stealing focus
dropdownEl.addEventListener('mousedown', e => e.preventDefault());

searchEl.addEventListener('focus', handleSearchInput);
searchEl.addEventListener('input', handleSearchInput);
searchEl.addEventListener('blur', hideAutocomplete);

dropdownEl.addEventListener('click', e => {
  const item = e.target.closest('.autocomplete-item');
  if (!item) return;
  const dbfNr = item.dataset.dbf;
  searchEl.value = '';
  hideAutocomplete();
  loadPlayer(dbfNr);
});

searchEl.addEventListener('keydown', e => {
  const items = dropdownEl.querySelectorAll('.autocomplete-item');
  const isOpen = dropdownEl.style.display !== 'none' && items.length > 0;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!isOpen) return;
    autocompleteIndex = Math.min(autocompleteIndex + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('autocomplete-item-active', i === autocompleteIndex));
    items[autocompleteIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!isOpen) return;
    autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
    items.forEach((el, i) => el.classList.toggle('autocomplete-item-active', i === autocompleteIndex));
    items[autocompleteIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (isOpen && autocompleteIndex >= 0) {
      const selected = items[autocompleteIndex];
      searchEl.value = '';
      hideAutocomplete();
      loadPlayer(selected.dataset.dbf);
    }
  } else if (e.key === 'Escape') {
    hideAutocomplete();
  }
});

// ── Load player ───────────────────────────────────────────────────────────────
async function loadPlayer(dbfNr) {
  if (!dbfNr) return;
  setStatus('Henter...', '');
  try {
    // Lookup data (cache-shared with comparison tool)
    let data;
    const cached = readLookupCache(dbfNr);
    if (cached) {
      data = cached.data;
    } else {
      data = await fetchLookupData(dbfNr);
      writeLookupCache(dbfNr, data);
    }

    if (!data.entries || !data.entries.length) throw new Error('Ingen data');

    // Merge club from hacalle (lookup API doesn't return club)
    let club = '';
    try {
      const allPlayers = await fetchAllPlayers();
      const match = allPlayers.find(p => p.dbfNr === String(dbfNr));
      if (match) club = match.club || '';
    } catch { /* club stays empty */ }

    currentPlayer = {
      name:    data.name,
      dbfNr:   String(dbfNr),
      club,
      entries: data.entries.map(e => ({ date: new Date(e.date + 'T12:00:00'), hc: e.hc }))
    };

    setStatus('Indlæst: ' + data.name + (data.cache === 'HIT' ? ' (cache)' : ' (backend)'), 'ok');
    render();
  } catch (err) {
    setStatus('Fejl: ' + err.message, 'err');
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function getFrom() {
  const v = fromEl.value;
  return v ? new Date(v + 'T00:00:00') : null;
}

function getTo() {
  const v = toEl.value;
  if (!v) return null;
  const d = new Date(v + 'T23:59:59');
  return d;
}

function filterEntries(entries, from, to) {
  return entries.filter(e =>
    (!from || e.date >= from) &&
    (!to   || e.date <= to)
  );
}

// ── Linear regression ─────────────────────────────────────────────────────────
// points: [{x: number (days), y: number (hc)}]
// returns {slope, intercept}
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n === 1 ? points[0].y : 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX  += p.x;
    sumY  += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return { slope: 0, intercept: sumY / n };
  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// ── Optimism / prediction ─────────────────────────────────────────────────────
// Maps slider [-2..+2] to a multiplier:
//   opt=0  → factor 1 (exact regression slope)
//   opt=+2 → factor 3 (triple improvement rate)
//   opt=-2 → factor 0 (flat / stagnation) + tiny worsening bias
function optimismFactor(opt) {
  if (opt >= 0) return 1 + opt;                         // [1 .. 3]
  return Math.max(0, 1 + opt * 0.5);                    // [0 .. 1)
}

function adjustedSlope(rawSlope, opt) {
  let s = rawSlope * optimismFactor(opt);
  // At extreme pessimism add a gentle worsening drift (max 0.0004 hc/day ≈ +0.01/month at opt=-2)
  const worseningBias = Math.max(0, -opt - 1) * 0.0004;
  return s + worseningBias;
}

// Returns [{date:Date, hc:number}] — monthly points from anchorDate forward
function generatePrediction(anchorDate, anchorHc, rawSlope, opt, months) {
  if (months <= 0) return [];
  const adj = adjustedSlope(rawSlope, opt);
  const points = [];
  for (let i = 1; i <= months; i++) {
    const d = new Date(anchorDate);
    d.setMonth(d.getMonth() + i);
    const daysDelta = (d - anchorDate) / 86400000;
    const hc = Math.max(-10, Math.min(54, anchorHc + adj * daysDelta));
    points.push({ date: d, hc: parseFloat(hc.toFixed(2)) });
  }
  return points;
}

// ── Stability score ───────────────────────────────────────────────────────────
// Two equally-weighted components, each scored on the same anchoring principle:
//   < 0.03 per entry  → as stable as it gets → 100
//   > 1.2  per entry  → totally crazy        →   0
//
// Component A — per-entry average |Δhc|
//   Normalised on [0.03 … 1.2]
//
// Component B — month-over-month average |Δhc|
//   Last entry of each calendar month, same normalisation scaled ×4
//   (a month typically contains ~4 sessions, so the thresholds become
//    [0.12 … 4.8]; realistically capped at 2.5 to avoid extreme compression)
//
function stabilityScore(entries) {
  if (entries.length < 2) return { score: 100, label: 'Høj' };

  // ── A: per-entry deltas ──────────────────────────────────────────────
  let sumAbsDelta = 0;
  for (let i = 1; i < entries.length; i++) {
    sumAbsDelta += Math.abs(entries[i].hc - entries[i - 1].hc);
  }
  const avgEntryDelta = sumAbsDelta / (entries.length - 1);
  const scoreA = 100 * Math.max(0, Math.min(1,
    1 - (avgEntryDelta - 0.03) / (1.2 - 0.03)
  ));

  // ── B: month-over-month deltas ───────────────────────────────────────
  // Last HC value recorded in each calendar month
  const byMonth = new Map();
  for (const e of entries) {
    const key = e.date.getFullYear() * 100 + e.date.getMonth();
    byMonth.set(key, e.hc);   // last entry of the month wins
  }
  const monthHcs = [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, hc]) => hc);

  let scoreB = 100;
  if (monthHcs.length >= 2) {
    let sumMonthDelta = 0;
    for (let i = 1; i < monthHcs.length; i++) {
      sumMonthDelta += Math.abs(monthHcs[i] - monthHcs[i - 1]);
    }
    const avgMonthDelta = sumMonthDelta / (monthHcs.length - 1);
    // Scale: 0.12 → 100 (≈ 4 × 0.03),  2.5 → 0  (cap before extremes)
    scoreB = 100 * Math.max(0, Math.min(1,
      1 - (avgMonthDelta - 0.12) / (2.5 - 0.12)
    ));
  }

  // ── Combined (50 / 50) ───────────────────────────────────────────────
  const score = Math.round((scoreA + scoreB) / 2);

  const label = score > 75 ? 'Høj'
    : score > 50            ? 'God'
    : score > 25            ? 'Moderat'
    :                         'Lav';

  return {
    score, label,
    scoreA: Math.round(scoreA),
    scoreB: Math.round(scoreB),
    avgEntryDelta,
    avgMonthDelta: monthHcs.length >= 2
      ? (monthHcs.reduce((s, v, i) => i === 0 ? 0 : s + Math.abs(v - monthHcs[i - 1]), 0) / (monthHcs.length - 1))
      : 0,
  };
}

// ── Percentile ────────────────────────────────────────────────────────────────
function nationalPercentile(hc, allPlayers) {
  if (!allPlayers.length) return null;
  const worse = allPlayers.filter(p => p.hc > hc).length;
  return Math.round((worse / allPlayers.length) * 100);
}

function clubPercentile(hc, club, allPlayers) {
  if (!club) return null;
  const clubPlayers = allPlayers.filter(p => p.club === club);
  if (!clubPlayers.length) return null;
  const worse = clubPlayers.filter(p => p.hc > hc).length;
  return Math.round((worse / clubPlayers.length) * 100);
}

function applyHoverState() {
  if (hoverBtnEl) hoverBtnEl.classList.toggle('on', showHover);
  if (!chart) return;

  chart.options.plugins.tooltip.enabled = showHover;
  chart.data.datasets.forEach(dataset => {
    dataset.pointHoverRadius = showHover ? 5 : 0;
  });
  chart.update('none');
}

function applyPageMode() {
  document.body.classList.toggle('badge-embed-mode', isEmbedMode);
  if (isEmbedMode) {
    emptyEl.textContent = 'Angiv ?p=DBfNr i widget-linket for at vise et spillerbadge.';
  }
}

function notifyEmbedHeight() {
  if (!isEmbedMode || window.parent === window) return;
  window.parent.postMessage({
    type: 'dbf-player-badge:height',
    height: Math.ceil(document.documentElement.scrollHeight)
  }, '*');
}

// ── Date formatting ───────────────────────────────────────────────────────────
function fmtDate(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function toIso(d) {
  return d.toISOString().slice(0, 10);
}

// ── Stat card helper ──────────────────────────────────────────────────────────
function makeStatCard(label, val, sub, accentColor) {
  const card = document.createElement('div');
  card.className = 'stat-card';
  if (accentColor) card.style.borderTop = '3px solid ' + accentColor;

  const lbl = document.createElement('div');
  lbl.className = 'stat-label';
  lbl.textContent = label;

  const valEl = document.createElement('div');
  valEl.className = 'stat-val';
  valEl.textContent = val;

  const subEl = document.createElement('div');
  subEl.className = 'stat-sub';
  subEl.textContent = sub;

  card.append(lbl, valEl, subEl);
  return card;
}

// ── Main render ───────────────────────────────────────────────────────────────
function render() {
  if (!currentPlayer) {
    emptyEl.style.display = '';
    wrapEl.style.display  = 'none';
    notifyEmbedHeight();
    return;
  }

  // Clamp: `from` must not be later than `anchor − regression window`,
  // otherwise the chart would start after (or inside) the regression period.
  {
    const anchor   = getTo() || new Date();
    const rw       = Math.max(1, parseInt(regMonthsEl.value, 10) || 12);
    const rwMs     = rw * 30.4375 * 24 * 60 * 60 * 1000;
    const earliest = new Date(anchor.getTime() - rwMs);
    const curFrom  = getFrom();
    if (curFrom && curFrom > earliest) {
      fromEl.value = toIso(earliest);
    }
  }

  const from       = getFrom();
  const predMonths = Math.max(0, parseInt(predMonthsEl.value, 10) || 12);
  const opt        = parseFloat(optimismEl.value) || 0;

  // "to" is the anchor/prediction-start date. Show ALL actual entries from
  // `from` onwards — no upper filter — so the chart always shows the most
  // recent real data regardless of the anchor.
  const anchorDate = getTo() || new Date();
  const filteredEntries = filterEntries(currentPlayer.entries, from, null);

  // Fallback if nothing in range — show badge frame with "ingen data" note
  const hasData = filteredEntries.length > 0;

  // Current HC = most recent entry across full history
  const currentHc = currentPlayer.entries[currentPlayer.entries.length - 1].hc;

  // Stats from filtered range
  const minHc = hasData ? Math.min(...filteredEntries.map(e => e.hc)) : currentHc;
  const maxHc = hasData ? Math.max(...filteredEntries.map(e => e.hc)) : currentHc;
  const firstHc = hasData ? filteredEntries[0].hc : currentHc;
  const hcChange = parseFloat((currentHc - firstHc).toFixed(2));

  const stability = hasData ? stabilityScore(filteredEntries) : { score: 100, label: 'Høj' };

  // Percentile (requires allPlayersData)
  const natPct  = allPlayersData ? nationalPercentile(currentHc, allPlayersData) : null;
  const clubPct = allPlayersData ? clubPercentile(currentHc, currentPlayer.club, allPlayersData) : null;

  // Regression for prediction slope.
  // Uses the explicit regression window (regMonths) ending at the anchor date.
  // Centre x-values to prevent catastrophic float cancellation.
  const regMonths = Math.max(1, parseInt(regMonthsEl.value, 10) || 12);
  const regWindowMs = regMonths * 30.4375 * 24 * 60 * 60 * 1000;
  const regWindowStart = new Date(anchorDate.getTime() - regWindowMs);
  const regEntries = currentPlayer.entries.filter(
    e => e.date >= regWindowStart && e.date <= anchorDate
  );
  let rawSlope = 0;
  if (regEntries.length >= 2) {
    const x0  = regEntries[0].date / 86400000;
    const pts = regEntries.map(e => ({ x: e.date / 86400000 - x0, y: e.hc }));
    rawSlope = linearRegression(pts).slope;
  }

  // HC at anchor: last actual entry on or before the anchor date
  const beforeAnchor = currentPlayer.entries.filter(e => e.date <= anchorDate);
  const anchorHc = beforeAnchor.length
    ? beforeAnchor[beforeAnchor.length - 1].hc
    : (hasData ? filteredEntries[0].hc : currentHc);

  const predEntries = generatePrediction(anchorDate, anchorHc, rawSlope, opt, predMonths);
  // Prediction starts at the anchor date; both lines are fully independent
  const predWithAnchor = [{ date: anchorDate, hc: anchorHc }, ...predEntries];

  // Resolve CSS variables for Chart.js (canvas can't use var(--x) strings)
  const rootStyle  = getComputedStyle(document.documentElement);
  const mutedColor = rootStyle.getPropertyValue('--muted').trim() || '#888';

  // ── Build chart datasets as {x: timestamp_ms, y: hc} ─────────────────────
  // Two independent solid lines on a linear time axis — no merging, no
  // interleaving. The linear scale spaces points proportionally to real time
  // so dense actual data and sparse monthly prediction coexist cleanly.
  // x-axis bounds are set explicitly so the chart fills its full width.
  const xMin = hasData ? filteredEntries[0].date.getTime() : anchorDate.getTime();
  const xMax = predWithAnchor[predWithAnchor.length - 1].date.getTime();

  const actualDataset = {
    label: 'Faktisk HC',
    data: filteredEntries.map(e => ({ x: e.date.getTime(), y: e.hc })),
    borderColor: BADGE_COLOR,
    backgroundColor: BADGE_COLOR + '22',
    borderWidth: 2.5,
    pointRadius: filteredEntries.length > 60 ? 0 : 3,
    pointHoverRadius: showHover ? 5 : 0,
    tension: 0.1,
    fill: false,
  };

  const predDataset = {
    label: 'Prognose',
    data: predWithAnchor.map(e => ({ x: e.date.getTime(), y: e.hc })),
    borderColor: PRED_COLOR,
    backgroundColor: PRED_COLOR + '22',
    borderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: showHover ? 5 : 0,
    tension: 0,
    fill: false,
  };

  // ── Update or create chart ───────────────────────────────────────────────
  // Always destroy + recreate so scale options (min/max) stay fresh
  if (chart) { chart.destroy(); chart = null; }
  chart = new Chart(badgeChartEl, {
    type: 'line',
    data: { datasets: [actualDataset, predDataset] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: showHover,
          callbacks: {
            title: items => fmtDate(new Date(items[0].parsed.x)),
            label: ctx => {
              const v = ctx.parsed.y;
              if (v == null) return null;
              const tag = ctx.datasetIndex === 1 ? 'Prognose' : 'HC';
              return ` ${tag}: ${v.toFixed(2)}`;
            }
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
            callback: val => fmtDate(new Date(val))
          },
          grid: { color: 'rgba(128,128,128,0.08)' }
        },
        y: {
          reverse: true,
          title:  { display: true, text: 'Handicap', font: { size: 11 }, color: mutedColor },
          ticks:  { font: { size: 10 }, color: mutedColor },
          grid:   { color: 'rgba(128,128,128,0.08)' }
        }
      }
    }
  });

  // ── Badge header ─────────────────────────────────────────────────────────
  document.getElementById('badge-name').textContent = currentPlayer.name;
  document.getElementById('badge-meta').textContent =
    [currentPlayer.club, '#' + currentPlayer.dbfNr].filter(Boolean).join(' · ');
  document.getElementById('badge-hc-val').textContent = currentHc.toFixed(2);

  // ── Stats cards ──────────────────────────────────────────────────────────
  statsEl.innerHTML = '';

  const scoreColor = s => s > 75 ? 'var(--fresh)'
    : s > 50 ? 'var(--accent)'
    : s > 25 ? 'var(--muted)'
    : 'var(--danger)';

  statsEl.append(
    makeStatCard('Min HC',  minHc.toFixed(2), 'i perioden'),
    makeStatCard('Max HC',  maxHc.toFixed(2), 'i perioden'),
    makeStatCard('Stabilitet',   stability.score + '/100', stability.label,  scoreColor(stability.score)),
    makeStatCard('Pr. sektion',  stability.scoreA + '/100',
      'ø ' + stability.avgEntryDelta.toFixed(3) + ' Δhc pr. sektion',       scoreColor(stability.scoreA)),
    makeStatCard('Pr. måned',    stability.scoreB + '/100',
      'ø ' + stability.avgMonthDelta.toFixed(2)  + ' Δhc pr. måned',        scoreColor(stability.scoreB))
  );

  // ── Percentile strip ─────────────────────────────────────────────────────
  pctEl.innerHTML = '';

  const makePct = (label, pct, sub) => {
    const item = document.createElement('div');
    item.className = 'badge-pct-item';
    item.innerHTML = `<span class="badge-pct-label">${label}</span>
      <span class="badge-pct-val">${pct !== null ? 'Top ' + (100 - pct) + '%' : '–'}</span>
      <span class="badge-pct-sub">${pct !== null ? 'Bedre end ' + pct + '% ' + sub : 'Data ikke tilgængeligt'}</span>`;
    return item;
  };

  pctEl.append(
    makePct('Nationalt', natPct, 'nationalt'),
    makePct('Klub · ' + (currentPlayer.club || '?'), clubPct, 'i ' + (currentPlayer.club || 'klubben'))
  );

  // Show badge
  emptyEl.style.display = 'none';
  wrapEl.style.display  = '';

  syncUrl();

  // ── Datestamp ────────────────────────────────────────────────────────────
  document.getElementById('badge-datestamp').textContent = fmtDate(new Date());

  // ── QR code ───────────────────────────────────────────────────────────────
  // Build a clean URL from state params (avoids any stale/debug query strings)
  const cleanQs  = buildStateParams().toString();
  const shareUrl = window.location.origin + window.location.pathname + (cleanQs ? '?' + cleanQs : '');

  const qrEl = document.getElementById('badge-qr');
  qrEl.innerHTML = '';
  if (window.QRCodeStyling) {
    const qr = new QRCodeStyling({
      width: 80,
      height: 80,
      type: 'svg',
      data: shareUrl,
      qrOptions:            { errorCorrectionLevel: 'M' },
      dotsOptions:          { type: 'rounded',       color: BADGE_COLOR },
      cornersSquareOptions: { type: 'extra-rounded', color: BADGE_COLOR },
      cornersDotOptions:    { type: 'dot',           color: BADGE_COLOR },
      backgroundOptions:    { color: '#ffffff' },
    });
    qr.append(qrEl);
  }

  notifyEmbedHeight();
}

// ── URL state ─────────────────────────────────────────────────────────────────
function buildStateParams({ includeEmbed = isEmbedMode } = {}) {
  const p = new URLSearchParams();
  if (includeEmbed) p.set('embed', '1');
  if (currentPlayer) p.set('p', currentPlayer.dbfNr);
  if (fromEl.value) p.set('from', fromEl.value);
  if (toEl.value)   p.set('to', toEl.value);
  const pm = parseInt(predMonthsEl.value, 10);
  if (pm && pm !== 12) p.set('pm', String(pm));
  const rw = parseInt(regMonthsEl.value, 10);
  if (rw && rw !== 12) p.set('rw', String(rw));
  const opt = parseFloat(optimismEl.value);
  if (opt !== 0) p.set('opt', String(opt));
  if (!showHover) p.set('hover', '0');

  return p;
}

function syncUrl() {
  if (isRestoringState) return;
  const qs  = buildStateParams().toString();
  const rel = window.location.pathname + (qs ? '?' + qs : '');
  window.history.replaceState({}, '', rel);
}

function buildPageUrl({ includeEmbed = false } = {}) {
  const qs = buildStateParams({ includeEmbed }).toString();
  return window.location.origin + window.location.pathname + (qs ? '?' + qs : '');
}

async function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.toString()) return;

  isRestoringState = true;
  try {
    if (params.get('from'))  fromEl.value = params.get('from');
    if (params.get('to'))    toEl.value   = params.get('to');
    const pm = params.get('pm');
    if (pm) predMonthsEl.value = pm;
    const rw = params.get('rw');
    if (rw) regMonthsEl.value = rw;
    const opt = params.get('opt');
    if (opt) {
      optimismEl.value = opt;
      optValEl.textContent = parseFloat(opt).toFixed(1);
    }
    showHover = params.get('hover') !== '0';
    if (hoverBtnEl) hoverBtnEl.classList.toggle('on', showHover);

    const dbfNr = params.get('p');
    if (dbfNr) {
      setStatus('Henter spiller...', '');
      await loadPlayer(dbfNr);
    }
  } finally {
    isRestoringState = false;
  }
}

// ── Share / export ────────────────────────────────────────────────────────────
function copyShareUrl() {
  navigator.clipboard.writeText(buildPageUrl()).then(() => {
    const orig = shareBtnEl.textContent;
    shareBtnEl.textContent = '✓ Kopieret!';
    setTimeout(() => { shareBtnEl.textContent = orig; }, 2000);
  }).catch(() => {
    prompt('Kopier dette link:', buildPageUrl());
  });
}

function copyEmbedCode() {
  if (!currentPlayer) {
    setStatus('Vælg en spiller først', 'err');
    return;
  }

  const embedUrl = buildPageUrl({ includeEmbed: true });
  const code = `<iframe src="${embedUrl}" loading="lazy" title="DBf Spillerbadge" style="width:100%;max-width:740px;height:${EMBED_IFRAME_HEIGHT}px;border:0;overflow:hidden;"></iframe>`;

  navigator.clipboard.writeText(code).then(() => {
    const orig = embedBtnEl.textContent;
    embedBtnEl.textContent = '✓ Iframe kopieret!';
    setTimeout(() => { embedBtnEl.textContent = orig; }, 2000);
  }).catch(() => {
    prompt('Kopier denne iframe-kode:', code);
  });
}

function copyEmbedUrl() {
  if (!currentPlayer) {
    setStatus('Vælg en spiller først', 'err');
    return;
  }

  const embedUrl = buildPageUrl({ includeEmbed: true });
  navigator.clipboard.writeText(embedUrl).then(() => {
    const orig = embedUrlBtnEl.textContent;
    embedUrlBtnEl.textContent = '✓ Embed link kopieret!';
    setTimeout(() => { embedUrlBtnEl.textContent = orig; }, 2000);
  }).catch(() => {
    prompt('Kopier dette embed-link:', embedUrl);
  });
}

async function exportBadge() {
  const card = document.getElementById('badge-card');
  if (!card || !window.html2canvas) return;
  exportBtnEl.textContent = '⏳ Genererer...';
  try {
    // html2canvas 1.4.1 doesn't support color-mix() or color(srgb …) notation.
    // Chrome resolves color-mix() to color(srgb r g b) in computed styles, so
    // we snapshot computed backgrounds from the live DOM and convert any
    // color(srgb …) values to plain rgb() before inlining on the clone.
    const toRgb = str => str.replace(
      /\bcolor\(srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s+([\d.e+-]+))?\)/g,
      (_, r, g, b, a) => {
        const R = Math.round(parseFloat(r) * 255);
        const G = Math.round(parseFloat(g) * 255);
        const B = Math.round(parseFloat(b) * 255);
        return a !== undefined
          ? `rgba(${R}, ${G}, ${B}, ${parseFloat(a).toFixed(3)})`
          : `rgb(${R}, ${G}, ${B})`;
      }
    );

    const liveEls = [...card.querySelectorAll('*')];
    const liveBgs = liveEls.map(el => {
      const cs = getComputedStyle(el);
      return {
        backgroundImage: toRgb(cs.backgroundImage),
        backgroundColor: toRgb(cs.backgroundColor)
      };
    });

    const canvas = await html2canvas(card, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
      onclone: (_doc, clonedCard) => {
        [...clonedCard.querySelectorAll('*')].forEach((el, i) => {
          if (!liveBgs[i]) return;
          el.style.backgroundImage = liveBgs[i].backgroundImage;
          el.style.backgroundColor = liveBgs[i].backgroundColor;
        });
      }
    });
    const link = document.createElement('a');
    const name = (currentPlayer ? currentPlayer.name.replace(/\s+/g, '-') : 'spiller');
    link.download = 'badge-' + name + '-' + toIso(new Date()) + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    alert('Eksport fejlede: ' + err.message);
  } finally {
    exportBtnEl.textContent = '💾 Gem badge';
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────
fromEl.addEventListener('change', render);
toEl.addEventListener('change', render);
predMonthsEl.addEventListener('input', render);
regMonthsEl.addEventListener('input', render);

optimismEl.addEventListener('input', () => {
  optValEl.textContent = parseFloat(optimismEl.value).toFixed(1);
  render();
});

if (hoverBtnEl) {
  hoverBtnEl.addEventListener('click', () => {
    showHover = !showHover;
    applyHoverState();
    syncUrl();
  });
}

if (embedBtnEl) {
  embedBtnEl.addEventListener('click', copyEmbedCode);
}

if (embedUrlBtnEl) {
  embedUrlBtnEl.addEventListener('click', copyEmbedUrl);
}

shareBtnEl.addEventListener('click', copyShareUrl);
exportBtnEl.addEventListener('click', exportBadge);

// ── Boot ──────────────────────────────────────────────────────────────────────
// Set default dates to last 1 year when no URL state is present
(function initDefaults() {
  const params = initialParams;
  if (!params.get('from')) {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    fromEl.value = toIso(oneYearAgo);
  }
  if (!params.get('to')) {
    toEl.value = toIso(new Date());
  }
})();

applyPageMode();
window.addEventListener('resize', notifyEmbedHeight);

restoreStateFromUrl().finally(() => {
  // Pre-warm player list in background
  fetchAllPlayers().catch(() => {});
  notifyEmbedHeight();
});
