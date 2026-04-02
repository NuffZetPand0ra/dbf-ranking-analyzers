const LOOKUP_CACHE_PREFIX = 'dbf_lookup_wp_v2_';
const LOOKUP_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TURN_CACHE_PREFIX = 'dbf_turn_wp_v1_';
const TURN_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const ALL_PLAYERS_CACHE_KEY = 'dbf_all_players_wp_v1';
const ALL_PLAYERS_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

let currentPlayer = null;
let allPlayersData = null;
let autocompleteIndex = -1;
let loadController = null;
let analysisResult = null;
let loadRequestSeq = 0;
let pendingUiState = null;
let activeTab = 'partners';

const TAB_NAMES = new Set(['partners', 'locations', 'location-detail', 'partner-detail', 'unresolved']);

const searchEl = document.getElementById('wp-search');
const dropdownEl = document.getElementById('wp-dropdown');
const statusEl = document.getElementById('wp-status');
const loadStatusEl = document.getElementById('wp-load-status');
const progressWrapEl = document.getElementById('wp-progress-wrap');
const progressBarEl = document.getElementById('wp-progress-bar');
const progressMetaEl = document.getElementById('wp-progress-meta');
const emptyEl = document.getElementById('wp-empty');
const wrapEl = document.getElementById('wp-wrap');
const playerEl = document.getElementById('wp-player');
const playerMetaEl = document.getElementById('wp-player-meta');
const summaryEl = document.getElementById('wp-summary');
const coverageEl = document.getElementById('wp-coverage');
const statsEl = document.getElementById('wp-stats');
const noteEl = document.getElementById('wp-note');
const locationSelectEl = document.getElementById('wp-location-select');
const partnerSelectEl = document.getElementById('wp-partner-select');

const turnDataMemo = new Map();
const TURN_BATCH_SIZE = 75;
const TURN_BATCH_CONCURRENCY = 3;
const ETA_RECALC_INTERVAL_MS = 20 * 1000;
const ETA_TICK_MS = 1000;

let etaTicker = null;
let etaTargetAtMs = null;
let etaNextRecalcAtMs = 0;
let latestLoadProgress = null;

/* ── Helpers ── */

function parseNumber(value) {
  const parsed = parseFloat(String(value ?? '').replace(/\u00a0/g, '').replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseUrlState() {
  const params = new URLSearchParams(window.location.search);
  const dbfNr = String(params.get('p') || '').replace(/\D/g, '');
  const tab = params.get('tab');
  return {
    dbfNr,
    tab: TAB_NAMES.has(tab) ? tab : 'partners',
    location: params.get('loc') || '',
    partner: params.get('partner') || '',
  };
}

function buildStateParams() {
  const params = new URLSearchParams();
  if (currentPlayer?.dbfNr) params.set('p', currentPlayer.dbfNr);
  if (activeTab !== 'partners') params.set('tab', activeTab);
  if (locationSelectEl.value) params.set('loc', locationSelectEl.value);
  if (partnerSelectEl.value) params.set('partner', partnerSelectEl.value);
  return params;
}

function replaceUrlFromState() {
  const qs = buildStateParams().toString();
  const rel = window.location.pathname + (qs ? '?' + qs : '');
  window.history.replaceState({}, '', rel);
}

/* ── Normalize upstream responses ── */

function normalizePlayers(players) {
  if (!Array.isArray(players)) return null;
  const normalized = players
    .map(player => {
      if (!player || typeof player !== 'object') return null;
      const hc = typeof player.hc === 'number' ? player.hc : parseNumber(player.hc);
      const dbfNr = String(player.dbfNr ?? '').replace(/\D/g, '');
      if (!Number.isFinite(hc) || !dbfNr) return null;
      return { name: typeof player.name === 'string' ? player.name : '', club: typeof player.club === 'string' ? player.club : '', dbfNr, hc };
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
      const date = new Date(entry.date + 'T12:00:00');
      if (Number.isNaN(date.getTime())) return null;
      const change = entry.change === null || entry.change === undefined || entry.change === '' ? null : parseNumber(entry.change);
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
        sourceLabel: typeof entry.sourceLabel === 'string' ? entry.sourceLabel.trim() : (typeof entry.club === 'string' ? entry.club.trim() : ''),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.seq - b.seq);
  if (!entries.length) return null;
  return { name: typeof data.name === 'string' ? data.name : '', dbfNr: String(data.dbfNr ?? '').replace(/\D/g, ''), entries };
}

function normalizeTurnResponse(data) {
  if (!data || typeof data !== 'object') return null;
  const groups = Array.isArray(data.groups)
    ? data.groups
        .map((group, index) => {
          if (!group || typeof group !== 'object' || !Array.isArray(group.players)) return null;
          const players = group.players
            .map(player => {
              if (!player || typeof player !== 'object') return null;
              const name = String(player.name || '').replace(/\s+/g, ' ').trim();
              if (!name) return null;
              return { name, direction: typeof player.direction === 'string' ? player.direction : '' };
            })
            .filter(Boolean);
          if (!players.length) return null;
          return { groupKey: String(group.groupKey || `group-${index + 1}`), players };
        })
        .filter(Boolean)
    : [];
  return {
    title: String(data.title || '').trim(),
    organizer: String(data.organizer || '').trim(),
    playedAt: String(data.playedAt || '').trim(),
    postedAt: String(data.postedAt || '').trim(),
    formatHint: data.formatHint === 'pair' || data.formatHint === 'team-known-seating' ? data.formatHint : 'unknown',
    groups,
  };
}

/* ── Cache helpers ── */

function readCache(prefix, key, maxAge, normalizer) {
  try {
    const raw = localStorage.getItem(prefix + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !parsed.data) return null;
    if (Date.now() - parsed.ts > maxAge) return null;
    return normalizer ? normalizer(parsed.data) : parsed.data;
  } catch { return null; }
}

function writeCache(prefix, key, data) {
  try { localStorage.setItem(prefix + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

/* ── Fetchers ── */

async function fetchLookupData(dbfNr, signal) {
  const res = await fetch('/api/lookup?dbfNr=' + encodeURIComponent(dbfNr), { signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

function getCachedTurnData(turnId) {
  if (!turnId) return null;
  if (turnDataMemo.has(turnId)) return turnDataMemo.get(turnId);
  const cached = readCache(TURN_CACHE_PREFIX, turnId, TURN_CACHE_MAX_AGE_MS, normalizeTurnResponse);
  if (cached) { turnDataMemo.set(turnId, cached); return cached; }
  return undefined; // not cached
}

function chunkArray(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

function estimateEtaSeconds(startedAtMs, completedUncached, totalUncached) {
  if (!startedAtMs || completedUncached <= 0 || totalUncached <= completedUncached) return null;
  const elapsedSeconds = (Date.now() - startedAtMs) / 1000;
  if (elapsedSeconds <= 0) return null;
  const perSecond = completedUncached / elapsedSeconds;
  if (!Number.isFinite(perSecond) || perSecond <= 0) return null;
  const remaining = totalUncached - completedUncached;
  return Math.max(1, Math.ceil(remaining / perSecond));
}

async function fetchTurnDataBatch(turnIds, signal, onProgress) {
  // Partition into cached and uncached
  const results = new Map();
  const uncachedIds = [];
  for (const id of turnIds) {
    const cached = getCachedTurnData(id);
    if (cached !== undefined) { results.set(id, cached); }
    else { uncachedIds.push(id); }
  }

  const progressState = {
    total: turnIds.length,
    done: results.size,
    cached: results.size,
    fetched: 0,
    failed: 0,
    etaSeconds: null,
  };
  if (onProgress) onProgress(progressState);

  if (!uncachedIds.length) {
    return results;
  }

  const startedAtMs = Date.now();
  const chunks = chunkArray(uncachedIds, TURN_BATCH_SIZE);
  let nextChunk = 0;

  async function worker() {
    while (nextChunk < chunks.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const idx = nextChunk++;
      const chunk = chunks[idx];

      const res = await fetch('/api/turns?ids=' + chunk.join(','), { signal });

      if (!res.ok) throw new Error('HTTP ' + res.status);

      const json = await res.json();
      const responseItems = Array.isArray(json.results) ? json.results : [];
      const seenIds = new Set();

      for (const item of responseItems) {
        const turnId = String(item?.turnId ?? '').replace(/\D/g, '');
        if (!turnId || seenIds.has(turnId)) continue;
        seenIds.add(turnId);

        if (item.error) {
          results.set(turnId, null);
          progressState.failed++;
          continue;
        }

        const normalized = normalizeTurnResponse(item);
        if (normalized) {
          writeCache(TURN_CACHE_PREFIX, turnId, item);
          turnDataMemo.set(turnId, normalized);
          results.set(turnId, normalized);
        } else {
          results.set(turnId, null);
          progressState.failed++;
        }
      }

      for (const requestedId of chunk) {
        if (seenIds.has(requestedId)) continue;
        if (!results.has(requestedId)) {
          results.set(requestedId, null);
          progressState.failed++;
        }
      }

      progressState.fetched += chunk.length;
      progressState.done = progressState.cached + progressState.fetched;
      progressState.etaSeconds = estimateEtaSeconds(startedAtMs, progressState.fetched, uncachedIds.length);
      if (onProgress) onProgress(progressState);
    }
  }

  const workers = Array.from({ length: Math.min(TURN_BATCH_CONCURRENCY, chunks.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

async function fetchAllPlayers() {
  if (allPlayersData) return allPlayersData;
  const cached = readCache(ALL_PLAYERS_CACHE_KEY, '', ALL_PLAYERS_CACHE_MAX_AGE_MS, null);
  if (cached) { const n = normalizePlayers(cached); if (n) { allPlayersData = n; return n; } }
  const res = await fetch('/api/hacalle');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  allPlayersData = normalizePlayers(json.players) || [];
  try { localStorage.setItem(ALL_PLAYERS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: json.players })); } catch {}
  return allPlayersData;
}

/* ── Status helpers ── */

let statusTimer = null;
function setStatus(msg, cls) {
  statusEl.textContent = msg || '';
  statusEl.className = 'fetch-status' + (cls ? ' ' + cls : '');
  clearTimeout(statusTimer);
  if (cls === 'ok') statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2800);
}

function setLoadStatus(msg, cls, showCancel) {
  loadStatusEl.innerHTML = '';
  loadStatusEl.className = 'wp-load-status' + (cls ? ' ' + cls : '');
  if (showCancel && loadController) {
    const wrapper = document.createElement('div');
    wrapper.className = 'wp-load-status-wrapper';
    const spinner = document.createElement('div');
    spinner.className = 'wp-loading-spinner';
    wrapper.appendChild(spinner);
    const text = document.createElement('span');
    text.textContent = msg || '';
    wrapper.appendChild(text);
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'wp-cancel-btn';
    cancelBtn.textContent = 'Annuller';
    cancelBtn.onclick = () => { if (loadController) { loadController.abort(); loadController = null; setLoadStatus('Annulleret', 'err'); } };
    wrapper.appendChild(cancelBtn);
    loadStatusEl.appendChild(wrapper);
  } else {
    loadStatusEl.textContent = msg || '';
  }
}

function formatDurationHms(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatClockHms(timestampMs) {
  if (!timestampMs) return '';
  const d = new Date(timestampMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function stopEtaTicker() {
  if (etaTicker) {
    clearInterval(etaTicker);
    etaTicker = null;
  }
}

function renderProgressMeta() {
  if (!progressMetaEl || !latestLoadProgress) return;
  const progress = latestLoadProgress;

  const failText = progress.failed ? ` · fejl ${progress.failed}` : '';
  let etaText = '';

  if (etaTargetAtMs && progress.done < progress.total) {
    const remainingSeconds = Math.max(0, Math.ceil((etaTargetAtMs - Date.now()) / 1000));
    etaText = ` · est. færdig ${formatClockHms(etaTargetAtMs)} · tilbage ${formatDurationHms(remainingSeconds)}`;
  }

  progressMetaEl.textContent = `${progress.done}/${progress.total} · cache ${progress.cached} · hentet ${progress.fetched}${failText}${etaText}`;
}

function setLoadProgress(progress) {
  if (!progressWrapEl || !progressBarEl || !progressMetaEl) return;
  if (!progress || !progress.total) {
    latestLoadProgress = null;
    etaTargetAtMs = null;
    etaNextRecalcAtMs = 0;
    stopEtaTicker();
    progressWrapEl.style.display = 'none';
    progressBarEl.style.width = '0%';
    progressMetaEl.textContent = '';
    return;
  }

  latestLoadProgress = {
    total: progress.total,
    done: progress.done,
    cached: progress.cached,
    fetched: progress.fetched,
    failed: progress.failed,
  };

  progressWrapEl.style.display = '';
  const pct = Math.max(0, Math.min(100, (progress.done / progress.total) * 100));
  const track = progressBarEl.parentElement;
  if (track) track.setAttribute('aria-valuenow', String(Math.round(pct)));
  progressBarEl.style.width = `${pct}%`;

  const now = Date.now();
  if (progress.etaSeconds && progress.done < progress.total) {
    if (!etaTargetAtMs || now >= etaNextRecalcAtMs) {
      etaTargetAtMs = now + progress.etaSeconds * 1000;
      etaNextRecalcAtMs = now + ETA_RECALC_INTERVAL_MS;
    }
    if (!etaTicker) {
      etaTicker = setInterval(() => {
        if (!latestLoadProgress || latestLoadProgress.done >= latestLoadProgress.total) {
          stopEtaTicker();
          return;
        }
        renderProgressMeta();
      }, ETA_TICK_MS);
    }
  }

  if (progress.done >= progress.total) {
    etaTargetAtMs = null;
    etaNextRecalcAtMs = 0;
    stopEtaTicker();
  }

  renderProgressMeta();
}

/* ── Autocomplete ── */

function playerMatchesQuery(player, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = (player.name + ' ' + (player.club || '')).toLowerCase();
  return words.every(w => haystack.includes(w));
}

function showAutocomplete(matches) {
  dropdownEl.innerHTML = '';
  autocompleteIndex = -1;
  if (!matches.length) { dropdownEl.style.display = 'none'; return; }
  matches.slice(0, 50).forEach(player => {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.dataset.dbf = player.dbfNr;
    item.dataset.name = player.name;
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

function hideAutocomplete() { dropdownEl.style.display = 'none'; autocompleteIndex = -1; }

async function handleSearchInput() {
  const query = searchEl.value.trim();
  if (!query) { hideAutocomplete(); return; }
  try {
    const players = await fetchAllPlayers();
    showAutocomplete(players.filter(p => playerMatchesQuery(p, query)));
  } catch {}
}

/* ── Core analysis ── */

async function analyzePlayer(player, signal, onProgress) {
  const entries = player.entries.filter(e => e.turnId);
  const turnIds = [...new Set(entries.map(e => e.turnId))];
  const playerKey = normalizeName(player.name);

  const turnResultsMap = await fetchTurnDataBatch(turnIds, signal, onProgress);

  // Map turnId -> { partners[], location, title }
  const turnInfo = new Map();
  const unresolvedReasonByTurnId = new Map();
  let resolvedTurns = 0;
  let unresolvedTurns = 0;

  for (const turnId of turnIds) {
    const turn = turnResultsMap.get(turnId) || null;
    if (!turn || !turn.groups.length) {
      unresolvedTurns++;
      unresolvedReasonByTurnId.set(
        turnId,
        turn
          ? (turn.formatHint === 'unknown' ? 'Ukendt turneringsformat eller manglende spillerplacering' : 'Mangler spillergrupper i turneringsdata')
          : 'Kunne ikke hente turneringsdata'
      );
      if (turn) {
        turnInfo.set(turnId, { partners: [], location: turn.organizer || '', title: turn.title });
      }
      continue;
    }

    const location = turn.organizer || '';
    let linkedPlayers = null;

    if (turn.formatHint === 'pair') {
      for (const group of turn.groups) {
        if (!group.players.some(p => normalizeName(p.name) === playerKey)) continue;
        linkedPlayers = group.players.map(p => p.name).filter(n => normalizeName(n) !== playerKey);
        break;
      }
    } else if (turn.formatHint === 'team-known-seating') {
      for (const group of turn.groups) {
        const self = group.players.find(p => normalizeName(p.name) === playerKey);
        if (!self) continue;
        const selfDir = String(self.direction || '').trim().toLowerCase();
        linkedPlayers = group.players
          .filter(p => normalizeName(p.name) !== playerKey)
          .filter(p => String(p.direction || '').trim().toLowerCase() === selfDir)
          .map(p => p.name);
        break;
      }
    }

    if (linkedPlayers && linkedPlayers.length) {
      resolvedTurns++;
      turnInfo.set(turnId, { partners: [...new Set(linkedPlayers)], location, title: turn.title });
    } else {
      unresolvedTurns++;
      unresolvedReasonByTurnId.set(turnId, 'Ingen makkerrelation fundet for spilleren');
      turnInfo.set(turnId, { partners: [], location, title: turn.title });
    }
  }

  // Also capture location from the lookup entry's sourceLabel for entries without turn data
  const entryLocations = new Map(); // turnId-or-key -> location
  for (const entry of player.entries) {
    const key = entry.turnId || `${entry.dateIso}|${entry.tournament}`;
    if (entry.turnId && turnInfo.has(entry.turnId)) {
      entryLocations.set(key, turnInfo.get(entry.turnId).location);
    } else {
      entryLocations.set(key, entry.sourceLabel || entry.club || '');
    }
  }

  // Build aggregations
  const partnerTotalMap = new Map();      // partnerName -> count
  const locationTotalMap = new Map();     // location -> count
  const partnerLocationMap = new Map();   // partnerName -> Map<location, count>
  const locationPartnerMap = new Map();   // location -> Map<partnerName, count>
  const partnerEventsMap = new Map();     // partnerName -> [{ date, dateIso, location, tournament, change, hc, turnId }]
  const unresolvedRows = [];

  const processedTurnIds = new Set();

  for (const entry of player.entries) {
    const key = entry.turnId || `${entry.dateIso}|${entry.tournament}`;
    if (processedTurnIds.has(key)) continue;
    processedTurnIds.add(key);

    const info = entry.turnId ? turnInfo.get(entry.turnId) : null;
    const location = entry.sourceLabel || entry.club || info?.location || '';
    const tournamentTitle = info?.title || entry.tournament || '';

    if (location) {
      locationTotalMap.set(location, (locationTotalMap.get(location) || 0) + 1);
    }

    if (!entry.turnId) {
      unresolvedRows.push({
        date: entry.date,
        dateIso: entry.dateIso,
        tournament: tournamentTitle,
        location,
        reason: 'Mangler TurnID i handicaphistorik',
        turnId: null,
      });
    } else if (!info || !info.partners?.length) {
      unresolvedRows.push({
        date: entry.date,
        dateIso: entry.dateIso,
        tournament: tournamentTitle,
        location,
        reason: unresolvedReasonByTurnId.get(entry.turnId) || 'Makkerrelation kunne ikke udledes',
        turnId: entry.turnId,
      });
    }

    if (info?.partners?.length) {
      for (const partner of info.partners) {
        partnerTotalMap.set(partner, (partnerTotalMap.get(partner) || 0) + 1);

        if (!partnerEventsMap.has(partner)) partnerEventsMap.set(partner, []);
        partnerEventsMap.get(partner).push({
          date: entry.date,
          dateIso: entry.dateIso,
          location,
          tournament: info.title || entry.tournament || '',
          change: entry.change,
          hc: entry.hc,
          turnId: entry.turnId,
        });

        if (!partnerLocationMap.has(partner)) partnerLocationMap.set(partner, new Map());
        const pl = partnerLocationMap.get(partner);
        pl.set(location, (pl.get(location) || 0) + 1);

        if (location) {
          if (!locationPartnerMap.has(location)) locationPartnerMap.set(location, new Map());
          const lp = locationPartnerMap.get(location);
          lp.set(partner, (lp.get(partner) || 0) + 1);
        }
      }
    }
  }

  // Sort events newest-first per partner
  for (const events of partnerEventsMap.values()) {
    events.sort((a, b) => b.date - a.date);
  }

  const sortByCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'da');

  const partnerTotals = [...partnerTotalMap.entries()].map(([name, count]) => ({ name, count })).sort(sortByCount);
  const locationTotals = [...locationTotalMap.entries()].map(([name, count]) => ({ name, count })).sort(sortByCount);
  unresolvedRows.sort((a, b) => b.date - a.date || a.tournament.localeCompare(b.tournament, 'da'));

  return {
    partnerTotals,
    locationTotals,
    partnerLocationMap,
    locationPartnerMap,
    partnerEventsMap,
    unresolvedRows,
    resolvedTurns,
    unresolvedTurns,
    totalEntries: processedTurnIds.size,
  };
}

/* ── UI: Stat card ── */

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

/* ── UI: Tables ── */

function fmtDateShort(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getFullYear()}`;
}

function fillTable(tableId, rows, col1Label, col2Label) {
  const table = document.getElementById(tableId);
  const hasClub = rows.some(r => r.club);
  const colCount = hasClub ? 3 : 2;
  const thead = table.querySelector('thead tr');
  thead.innerHTML = '';
  const th1 = document.createElement('th');
  th1.textContent = col1Label;
  thead.appendChild(th1);
  if (hasClub) {
    const thClub = document.createElement('th');
    thClub.textContent = 'Klub';
    thead.appendChild(thClub);
  }
  const th2 = document.createElement('th');
  th2.textContent = col2Label;
  thead.appendChild(th2);

  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colCount;
    td.className = 'wp-table-empty';
    td.textContent = 'Ingen data';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  for (const row of rows) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = row.name;
    tr.appendChild(tdName);
    if (hasClub) {
      const tdClub = document.createElement('td');
      tdClub.textContent = row.club || '';
      tr.appendChild(tdClub);
    }
    const tdCount = document.createElement('td');
    tdCount.textContent = String(row.count);
    tr.appendChild(tdCount);
    tbody.appendChild(tr);
  }
}

function fillPartnerTree(tableId, partners, eventsMap) {
  const table = document.getElementById(tableId);
  const thead = table.querySelector('thead tr');
  thead.innerHTML = '';
  const th1 = document.createElement('th');
  th1.textContent = 'Makker';
  const th2 = document.createElement('th');
  th2.textContent = 'Klub';
  const th3 = document.createElement('th');
  th3.textContent = 'Turnering';
  const th4 = document.createElement('th');
  th4.textContent = 'Antal';
  const th5 = document.createElement('th');
  th5.textContent = 'HC';
  thead.append(th1, th2, th3, th4, th5);

  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  if (!partners.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'wp-table-empty';
    td.textContent = 'Ingen data';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const partner of partners) {
    const events = eventsMap.get(partner.name) || [];

    // Parent row
    const tr = document.createElement('tr');
    tr.className = 'wp-tree-parent';
    const tdName = document.createElement('td');
    const toggle = document.createElement('span');
    toggle.className = 'wp-tree-toggle';
    toggle.textContent = '\u25B6';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = partner.name;
    tdName.append(toggle, nameSpan);
    const tdClubParent = document.createElement('td');
    const tdTournParent = document.createElement('td');
    const tdCount = document.createElement('td');
    tdCount.textContent = String(partner.count);
    const tdHcSum = document.createElement('td');
    tdHcSum.className = 'wp-tree-hc-cell';
    const hcSum = events.reduce((sum, e) => sum + (typeof e.change === 'number' ? e.change : 0), 0);
    const sign = hcSum >= 0 ? '+' : '';
    tdHcSum.textContent = sign + hcSum.toFixed(2);
    if (hcSum !== 0) tdHcSum.classList.add(hcSum < 0 ? 'wp-hc-down' : 'wp-hc-up');
    tr.append(tdName, tdClubParent, tdTournParent, tdCount, tdHcSum);
    tbody.appendChild(tr);

    // Child rows (hidden by default)
    for (const evt of events) {
      const childTr = document.createElement('tr');
      childTr.className = 'wp-tree-child';
      childTr.style.display = 'none';
      const tdInfo = document.createElement('td');
      tdInfo.className = 'wp-tree-child-cell';
      const infoWrap = document.createElement('div');
      infoWrap.className = 'wp-tree-child-inner';
      const dateSpan = document.createElement('span');
      dateSpan.className = 'wp-tree-date';
      dateSpan.textContent = fmtDateShort(evt.date);
      infoWrap.appendChild(dateSpan);
      if (evt.turnId) {
        const link = document.createElement('a');
        link.className = 'wp-tree-link';
        link.href = 'https://medlemmer.bridge.dk/LookUpTURN.php?TurnID=' + encodeURIComponent(evt.turnId);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'DBf';
        link.title = 'Åbn turnering på bridge.dk';
        infoWrap.appendChild(link);
      }
      tdInfo.appendChild(infoWrap);
      const tdHc = document.createElement('td');
      tdHc.className = 'wp-tree-hc-cell';
      const parts = [];
      if (typeof evt.change === 'number') {
        const sign = evt.change >= 0 ? '+' : '';
        parts.push(sign + evt.change.toFixed(2));
      }
      parts.push('\u2192 ' + evt.hc.toFixed(2));
      tdHc.textContent = parts.join(' ');
      if (typeof evt.change === 'number' && evt.change !== 0) {
        tdHc.classList.add(evt.change < 0 ? 'wp-hc-down' : 'wp-hc-up');
      }
      const tdChildClub = document.createElement('td');
      tdChildClub.className = 'wp-tree-club';
      tdChildClub.textContent = evt.location || '';
      const tdChildTourn = document.createElement('td');
      tdChildTourn.className = 'wp-tree-tournament';
      tdChildTourn.textContent = evt.tournament || '';
      childTr.append(tdInfo, tdChildClub, tdChildTourn, tdHc);
      tbody.appendChild(childTr);
    }

    // Toggle handler
    tr.addEventListener('click', () => {
      const isOpen = tr.classList.toggle('wp-tree-open');
      toggle.textContent = isOpen ? '\u25BC' : '\u25B6';
      let sibling = tr.nextElementSibling;
      while (sibling && sibling.classList.contains('wp-tree-child')) {
        sibling.style.display = isOpen ? '' : 'none';
        sibling = sibling.nextElementSibling;
      }
    });
  }
}

function fillUnresolvedTable(tableId, rows) {
  const table = document.getElementById(tableId);
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'wp-table-empty';
    td.textContent = 'Ingen uafklarede turneringer';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = row.date ? fmtDateShort(row.date) : '';

    const tdTournament = document.createElement('td');
    tdTournament.textContent = row.tournament || '';

    const tdLocation = document.createElement('td');
    tdLocation.textContent = row.location || '';

    const tdReason = document.createElement('td');
    tdReason.textContent = row.reason || '';

    const tdLink = document.createElement('td');
    if (row.turnId) {
      const link = document.createElement('a');
      link.className = 'wp-tree-link';
      link.href = 'https://medlemmer.bridge.dk/LookUpTURN.php?TurnID=' + encodeURIComponent(row.turnId);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'DBf';
      link.title = 'Åbn turnering på bridge.dk';
      tdLink.appendChild(link);
    } else {
      tdLink.textContent = '–';
      tdLink.className = 'wp-table-dim';
    }

    tr.append(tdDate, tdTournament, tdLocation, tdReason, tdLink);
    tbody.appendChild(tr);
  }
}

function populateSelect(selectEl, items, placeholder) {
  selectEl.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = placeholder;
  selectEl.appendChild(opt);
  for (const item of items) {
    const o = document.createElement('option');
    o.value = item.name;
    o.textContent = `${item.name} (${item.count})`;
    selectEl.appendChild(o);
  }
}

function selectHasValue(selectEl, value) {
  if (!value) return false;
  return Array.from(selectEl.options).some(option => option.value === value);
}

function renderLocationDetailTable() {
  if (!analysisResult) return;
  const loc = locationSelectEl.value;
  if (!loc) {
    fillTable('wp-table-location-detail', [], 'Makker', 'Turneringer');
    return;
  }

  const partnerMap = analysisResult.locationPartnerMap.get(loc);
  const clubByName = new Map();
  if (allPlayersData) {
    for (const p of allPlayersData) clubByName.set(normalizeName(p.name), p.club || '');
  }

  const rows = partnerMap
    ? [...partnerMap.entries()].map(([name, count]) => ({ name, count, club: clubByName.get(normalizeName(name)) || '' })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'da'))
    : [];
  fillTable('wp-table-location-detail', rows, 'Makker', 'Turneringer');
}

function renderPartnerDetailTable() {
  if (!analysisResult) return;
  const partner = partnerSelectEl.value;
  if (!partner) {
    fillTable('wp-table-partner-detail', [], 'Lokation', 'Turneringer');
    return;
  }

  const locationMap = analysisResult.partnerLocationMap.get(partner);
  const rows = locationMap
    ? [...locationMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'da'))
    : [];
  fillTable('wp-table-partner-detail', rows, 'Lokation', 'Turneringer');
}

/* ── UI: Tabs ── */

const tabs = document.querySelectorAll('.wp-tab');
const panels = {
  partners: document.getElementById('wp-panel-partners'),
  locations: document.getElementById('wp-panel-locations'),
  'location-detail': document.getElementById('wp-panel-location-detail'),
  'partner-detail': document.getElementById('wp-panel-partner-detail'),
  unresolved: document.getElementById('wp-panel-unresolved'),
};

function switchTab(tabName) {
  if (!TAB_NAMES.has(tabName)) tabName = 'partners';
  activeTab = tabName;
  tabs.forEach(t => t.classList.toggle('wp-tab-active', t.dataset.tab === tabName));
  Object.entries(panels).forEach(([key, panel]) => { panel.style.display = key === tabName ? '' : 'none'; });
  replaceUrlFromState();
}

tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

/* ── UI: Render ── */

function render() {
  if (!currentPlayer || !analysisResult) {
    emptyEl.style.display = '';
    wrapEl.style.display = 'none';
    return;
  }

  const r = analysisResult;
  emptyEl.style.display = 'none';
  wrapEl.style.display = '';

  playerEl.textContent = currentPlayer.name;
  playerMetaEl.textContent = [currentPlayer.club, '#' + currentPlayer.dbfNr].filter(Boolean).join(' · ');

  summaryEl.textContent = `${r.partnerTotals.length} makkere · ${r.locationTotals.length} lokationer`;
  coverageEl.textContent = `${r.resolvedTurns} turneringer med makkerkobling, ${r.unresolvedTurns} uafklarede.`;

  statsEl.innerHTML = '';
  statsEl.append(
    makeStatCard('Turneringer', String(r.totalEntries), 'unikke posteringer', 'var(--accent)'),
    makeStatCard('Makkere', String(r.partnerTotals.length), 'unikke spillere', '#378ADD'),
    makeStatCard('Lokationer', String(r.locationTotals.length), 'unikke steder', '#D85A30'),
    makeStatCard('Top makker', r.partnerTotals[0]?.name || '–', r.partnerTotals[0] ? r.partnerTotals[0].count + ' turneringer' : '', 'var(--fresh)')
  );

  // Enrich partners with club name from all-players list
  const clubByName = new Map();
  if (allPlayersData) {
    for (const p of allPlayersData) {
      clubByName.set(normalizeName(p.name), p.club || '');
    }
  }

  fillPartnerTree('wp-table-partners', r.partnerTotals, r.partnerEventsMap);
  fillTable('wp-table-locations', r.locationTotals, 'Lokation', 'Turneringer');
  fillUnresolvedTable('wp-table-unresolved', r.unresolvedRows || []);

  populateSelect(locationSelectEl, r.locationTotals, 'Vælg lokation...');
  populateSelect(partnerSelectEl, r.partnerTotals, 'Vælg makker...');

  const stateToApply = pendingUiState;
  pendingUiState = null;

  if (stateToApply && selectHasValue(locationSelectEl, stateToApply.location)) {
    locationSelectEl.value = stateToApply.location;
  } else {
    locationSelectEl.value = '';
  }

  if (stateToApply && selectHasValue(partnerSelectEl, stateToApply.partner)) {
    partnerSelectEl.value = stateToApply.partner;
  } else {
    partnerSelectEl.value = '';
  }

  renderLocationDetailTable();
  renderPartnerDetailTable();
  switchTab(stateToApply?.tab || 'partners');
}

/* ── Detail selects ── */

locationSelectEl.addEventListener('change', () => {
  renderLocationDetailTable();
  replaceUrlFromState();
});

partnerSelectEl.addEventListener('change', () => {
  renderPartnerDetailTable();
  replaceUrlFromState();
});

/* ── Load player ── */

async function loadPlayer(dbfNr, options = {}) {
  if (!dbfNr) return;
  pendingUiState = options.restoreState || null;
  const requestSeq = ++loadRequestSeq;
  setStatus('Henter...', '');
  setLoadStatus('', '');
  setLoadProgress(null);
  analysisResult = null;
  currentPlayer = null;
  render(); // clear previous results immediately

  if (loadController) loadController.abort();
  loadController = new AbortController();

  try {
    setLoadStatus('Henter spillerhistorik...', '', true);
    const normalizedDbfNr = String(dbfNr).replace(/\D/g, '');

    // Fetch player lookup data
    let data = readCache(LOOKUP_CACHE_PREFIX, normalizedDbfNr, LOOKUP_CACHE_MAX_AGE_MS, normalizeLookupResponse);
    if (!data) {
      const raw = await fetchLookupData(normalizedDbfNr, loadController.signal);
      data = normalizeLookupResponse(raw);
      if (!data) throw new Error('Kunne ikke fortolke spillerhistorik');
      writeCache(LOOKUP_CACHE_PREFIX, normalizedDbfNr, raw);
    }
    if (requestSeq !== loadRequestSeq) return;
    searchEl.value = data.name;

    let club = '';
    try {
      const allPlayers = await fetchAllPlayers();
      const match = allPlayers.find(p => p.dbfNr === normalizedDbfNr);
      if (match) club = match.club || '';
    } catch {}
    if (requestSeq !== loadRequestSeq) return;

    currentPlayer = { ...data, dbfNr: normalizedDbfNr, club };

    const turnCount = new Set(data.entries.filter(e => e.turnId).map(e => e.turnId)).size;
    setStatus('Indlæst: ' + data.name, 'ok');
    setLoadStatus(`Henter detaljer om ${turnCount} turneringer for ${data.name}`, '', true);

    const onProgress = progress => {
      if (requestSeq !== loadRequestSeq) return;
      setLoadProgress(progress);
      setLoadStatus(`Henter turneringsdetaljer: ${progress.done}/${progress.total}`, '', true);
    };

    const result = await analyzePlayer(currentPlayer, loadController.signal, onProgress);
    if (requestSeq !== loadRequestSeq) return;

    analysisResult = result;

    setLoadStatus(
      `${result.resolvedTurns} turneringer analyseret, ${result.unresolvedTurns} uafklarede.`,
      'ok'
    );

    render();
  } catch (err) {
    if (err.name === 'AbortError') {
      setLoadStatus('Annulleret', 'err');
      setLoadProgress(null);
    } else {
      setStatus('Fejl: ' + err.message, 'err');
      setLoadProgress(null);
    }
  } finally {
    if (requestSeq === loadRequestSeq) loadController = null;
  }
}

/* ── Event wiring ── */

dropdownEl.addEventListener('mousedown', e => e.preventDefault());
searchEl.addEventListener('focus', handleSearchInput);
searchEl.addEventListener('input', handleSearchInput);
searchEl.addEventListener('blur', hideAutocomplete);

dropdownEl.addEventListener('click', e => {
  const item = e.target.closest('.autocomplete-item');
  if (!item) return;
  searchEl.value = item.dataset.name || '';
  hideAutocomplete();
  loadPlayer(item.dataset.dbf);
});

searchEl.addEventListener('keydown', e => {
  const items = dropdownEl.querySelectorAll('.autocomplete-item');
  const isOpen = dropdownEl.style.display !== 'none' && items.length > 0;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!isOpen) return;
    autocompleteIndex = Math.min(autocompleteIndex + 1, items.length - 1);
    items.forEach((item, i) => item.classList.toggle('autocomplete-item-active', i === autocompleteIndex));
    items[autocompleteIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!isOpen) return;
    autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
    items.forEach((item, i) => item.classList.toggle('autocomplete-item-active', i === autocompleteIndex));
    items[autocompleteIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (isOpen && autocompleteIndex >= 0) {
      const selected = items[autocompleteIndex];
      searchEl.value = selected.dataset.name || '';
      hideAutocomplete();
      loadPlayer(selected.dataset.dbf);
    }
  } else if (e.key === 'Escape') {
    hideAutocomplete();
  }
});

/* ── URL state ── */

(async function restoreFromUrl() {
  const state = parseUrlState();
  if (state.dbfNr) {
    await loadPlayer(state.dbfNr, { restoreState: state });
  }
})().finally(() => {
  fetchAllPlayers().catch(() => {});
});
