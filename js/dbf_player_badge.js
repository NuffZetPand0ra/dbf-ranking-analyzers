// ── Constants ─────────────────────────────────────────────────────────────────
const LOOKUP_CACHE_PREFIX        = 'dbf_lookup_';
const LOOKUP_CACHE_MAX_AGE_MS    = 12 * 60 * 60 * 1000;
const ALL_PLAYERS_CACHE_KEY      = 'dbf_all_players_cache_v1';
const ALL_PLAYERS_CACHE_MAX_AGE  = 12 * 60 * 60 * 1000;
const BADGE_COLOR                = '#378ADD';

// ── State ─────────────────────────────────────────────────────────────────────
let currentPlayer    = null;   // { name, dbfNr, club, entries:[{date:Date, hc}] }
let allPlayersData   = null;   // players[] from /api/hacalle
let chart            = null;
let autocompleteIndex = -1;
let isRestoringState = false;

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
    if (!parsed || !parsed.ts || !parsed.players) return null;
    if (Date.now() - parsed.ts > ALL_PLAYERS_CACHE_MAX_AGE) return null;
    return parsed.players;
  } catch { return null; }
}

function writeAllPlayersCache(players) {
  try {
    localStorage.setItem(ALL_PLAYERS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), players }));
  } catch { /* ignore */ }
}

async function fetchAllPlayers() {
  if (allPlayersData) return allPlayersData;
  const cached = readAllPlayersCache();
  if (cached) { allPlayersData = cached; return allPlayersData; }
  const res = await fetch('/api/hacalle');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  allPlayersData = json.players || [];
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
function stabilityScore(entries) {
  if (entries.length < 2) return { score: 100, label: 'Høj' };
  const deltas = [];
  for (let i = 1; i < entries.length; i++) deltas.push(entries[i].hc - entries[i - 1].hc);
  const mean = deltas.reduce((a, c) => a + c, 0) / deltas.length;
  const variance = deltas.reduce((a, c) => a + (c - mean) ** 2, 0) / deltas.length;
  const stddev = Math.sqrt(variance);
  const score = Math.round(Math.max(0, 100 - stddev * 20));
  let label;
  if (score > 75)      label = 'Høj';
  else if (score > 50) label = 'God';
  else if (score > 25) label = 'Moderat';
  else                 label = 'Lav';
  return { score, label };
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

// ── Date formatting ───────────────────────────────────────────────────────────
function fmtDate(d) {
  return d.toLocaleDateString('da-DK', { day: '2-digit', month: 'short', year: '2-digit' });
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
    return;
  }

  const from        = getFrom();
  const to          = getTo();
  const predMonths  = Math.max(0, parseInt(predMonthsEl.value, 10) || 12);
  const opt         = parseFloat(optimismEl.value) || 0;

  // Filter actual entries to date range
  const filteredEntries = filterEntries(currentPlayer.entries, from, to);

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

  // ── Prediction anchor ────────────────────────────────────────────────────
  // Use URL-encoded anchor if present, else use last filtered entry date
  const params = new URLSearchParams(window.location.search);
  let anchorDateStr = params.get('ps');
  let anchorDate, anchorHc;

  if (anchorDateStr && hasData) {
    anchorDate = new Date(anchorDateStr + 'T12:00:00');
    // HC at anchor: find last entry up to that date
    const beforeAnchor = currentPlayer.entries.filter(e => e.date <= anchorDate);
    anchorHc = beforeAnchor.length
      ? beforeAnchor[beforeAnchor.length - 1].hc
      : currentPlayer.entries[0].hc;
  } else if (hasData) {
    const lastEntry = filteredEntries[filteredEntries.length - 1];
    anchorDate    = lastEntry.date;
    anchorHc      = lastEntry.hc;
    anchorDateStr = toIso(anchorDate);
    // Write anchor into URL state on first render
    if (!isRestoringState) {
      const p = new URLSearchParams(window.location.search);
      p.set('ps', anchorDateStr);
      window.history.replaceState({}, '', window.location.pathname + '?' + p.toString());
    }
  } else {
    anchorDate = new Date();
    anchorHc   = currentHc;
  }

  // Regression for prediction slope.
  // Use the explicit regression window (regMonths back from the anchor date),
  // independent of the view from/to. Centre x-values to prevent catastrophic
  // float cancellation with large epoch-day numbers.
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

  const predEntries = generatePrediction(anchorDate, anchorHc, rawSlope, opt, predMonths);

  // ── Build chart labels — unified sorted category timeline ─────────────────
  // Category scale gives each data point equal visual width, which looks much
  // better than a linear time scale when dense actual entries (weekly) sit
  // alongside sparse prediction points (monthly).
  //
  // The prediction always starts at anchorDate. Include it as the first pred
  // point so the dashed line begins exactly at ps, even when ps is mid-range.
  const predWithAnchor = [{ date: anchorDate, hc: anchorHc }, ...predEntries];

  // Merge actual + prediction timestamps into one sorted unique set
  const actualTimes = filteredEntries.map(e => e.date.getTime());
  const predTimes   = predWithAnchor.map(e => e.date.getTime());
  const allTimes    = [...new Set([...actualTimes, ...predTimes])].sort((a, b) => a - b);
  const allLabels   = allTimes.map(t => fmtDate(new Date(t)));

  const actualMap = new Map(filteredEntries.map(e => [e.date.getTime(), e.hc]));
  const predMap   = new Map(predWithAnchor.map(e => [e.date.getTime(), e.hc]));

  const actualDataFull = allTimes.map(t => actualMap.has(t) ? actualMap.get(t) : null);
  // spanGaps:true on pred so the dashed line is continuous even when prediction
  // monthly dates are interleaved with actual-only dates (nulls in pred array)
  const predDataFull   = allTimes.map(t => predMap.has(t)   ? predMap.get(t)   : null);

  const actualDataset = {
    label: 'Faktisk HC',
    data: actualDataFull,
    borderColor: BADGE_COLOR,
    backgroundColor: BADGE_COLOR + '22',
    borderWidth: 2.5,
    pointRadius: filteredEntries.length > 60 ? 0 : 3,
    pointHoverRadius: 5,
    tension: 0.1,
    fill: false,
    spanGaps: false
  };

  const predDataset = {
    label: 'Prognose',
    data: predDataFull,
    borderColor: BADGE_COLOR + '88',
    backgroundColor: BADGE_COLOR + '11',
    borderWidth: 2,
    borderDash: [6, 4],
    pointRadius: 2,
    pointHoverRadius: 4,
    tension: 0,
    fill: false,
    spanGaps: true
  };

  // ── Update or create chart ───────────────────────────────────────────────
  if (chart) {
    chart.data.labels   = allLabels;
    chart.data.datasets = [actualDataset, predDataset];
    chart.update();
  } else {
    chart = new Chart(badgeChartEl, {
      type: 'line',
      data: { labels: allLabels, datasets: [actualDataset, predDataset] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y;
                if (v === null) return null;
                const tag = ctx.datasetIndex === 1 ? 'Prognose' : 'HC';
                return ` ${tag}: ${v.toFixed(2)}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 14, font: { size: 10 }, color: 'var(--muted)' },
            grid:  { color: 'rgba(128,128,128,0.08)' }
          },
          y: {
            reverse: true,
            title:  { display: true, text: 'Handicap', font: { size: 11 }, color: 'var(--muted)' },
            ticks:  { font: { size: 10 }, color: 'var(--muted)' },
            grid:   { color: 'rgba(128,128,128,0.08)' }
          }
        }
      }
    });
  }

  // ── Badge header ─────────────────────────────────────────────────────────
  document.getElementById('badge-name').textContent = currentPlayer.name;
  document.getElementById('badge-meta').textContent =
    [currentPlayer.club, '#' + currentPlayer.dbfNr].filter(Boolean).join(' · ');
  document.getElementById('badge-hc-val').textContent = currentHc.toFixed(2);

  // ── Stats cards ──────────────────────────────────────────────────────────
  statsEl.innerHTML = '';

  const stabColor = stability.score > 75 ? 'var(--fresh)'
    : stability.score > 50 ? 'var(--accent)'
    : stability.score > 25 ? 'var(--muted)'
    : 'var(--danger)';

  const changeSub = hcChange < 0
    ? '▼ ' + Math.abs(hcChange).toFixed(2) + ' forbedring'
    : hcChange > 0
    ? '▲ ' + hcChange.toFixed(2) + ' forværring'
    : 'Ingen ændring';

  statsEl.append(
    makeStatCard('Min HC',    minHc.toFixed(2),     'i perioden'),
    makeStatCard('Max HC',    maxHc.toFixed(2),     'i perioden'),
    makeStatCard('Stabilitet', stability.score + '/100', stability.label, stabColor),
    makeStatCard('HC-ændring', (hcChange >= 0 ? '+' : '') + hcChange.toFixed(2), changeSub)
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
}

// ── URL state ─────────────────────────────────────────────────────────────────
function buildStateParams() {
  const p = new URLSearchParams();
  if (currentPlayer) p.set('p', currentPlayer.dbfNr);
  if (fromEl.value) p.set('from', fromEl.value);
  if (toEl.value)   p.set('to', toEl.value);
  const pm = parseInt(predMonthsEl.value, 10);
  if (pm && pm !== 12) p.set('pm', String(pm));
  const rw = parseInt(regMonthsEl.value, 10);
  if (rw && rw !== 12) p.set('rw', String(rw));
  const opt = parseFloat(optimismEl.value);
  if (opt !== 0) p.set('opt', String(opt));

  // Carry forward existing anchor date if present
  const existing = new URLSearchParams(window.location.search);
  const ps = existing.get('ps');
  if (ps) p.set('ps', ps);

  return p;
}

function syncUrl() {
  if (isRestoringState) return;
  const qs  = buildStateParams().toString();
  const rel = window.location.pathname + (qs ? '?' + qs : '');
  window.history.replaceState({}, '', rel);
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
  navigator.clipboard.writeText(window.location.href).then(() => {
    const orig = shareBtnEl.textContent;
    shareBtnEl.textContent = '✓ Kopieret!';
    setTimeout(() => { shareBtnEl.textContent = orig; }, 2000);
  }).catch(() => {
    prompt('Kopier dette link:', window.location.href);
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
fromEl.addEventListener('change', () => {
  // Reset anchor when date range changes
  const p = new URLSearchParams(window.location.search);
  p.delete('ps');
  window.history.replaceState({}, '', window.location.pathname + (p.toString() ? '?' + p.toString() : ''));
  render();
});
toEl.addEventListener('change', render);
predMonthsEl.addEventListener('input', render);
regMonthsEl.addEventListener('input', render);

optimismEl.addEventListener('input', () => {
  optValEl.textContent = parseFloat(optimismEl.value).toFixed(1);
  render();
});

shareBtnEl.addEventListener('click', copyShareUrl);
exportBtnEl.addEventListener('click', exportBadge);

// ── Boot ──────────────────────────────────────────────────────────────────────
// Set default dates to last 1 year when no URL state is present
(function initDefaults() {
  const params = new URLSearchParams(window.location.search);
  if (!params.get('from')) {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    fromEl.value = toIso(oneYearAgo);
  }
  if (!params.get('to')) {
    toEl.value = toIso(new Date());
  }
})();

restoreStateFromUrl().finally(() => {
  // Pre-warm player list in background
  fetchAllPlayers().catch(() => {});
});
