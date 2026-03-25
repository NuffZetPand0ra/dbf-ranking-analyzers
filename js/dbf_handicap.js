const COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#D4537E', '#7F77DD', '#BA7517', '#639922', '#E24B4A', '#888780'];
const GROUP_COLORS = ['#FF9500', '#34C759', '#AF52DE', '#FF2D55', '#5AC8FA', '#FFCC00', '#00C7BE', '#FF6B35'];
const players = [];
const groups = [];
let nextGroupId = 1;
const hiddenPlayers = new Set();
let chart = null;
let showPoints = true;
let showHover = true;
const LOOKUP_BASE_URL = '/api/lookup';
const LOOKUP_CACHE_PREFIX = 'dbf_lookup_';
const LOOKUP_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const ALL_PLAYERS_CACHE_KEY = 'dbf_all_players_cache_v1';
const ALL_PLAYERS_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const btnPoints = document.getElementById('toggle-points');
const btnHover = document.getElementById('toggle-hover');
const dbfNumberInput = document.getElementById('dbf-number');
const fetchPlayerBtn = document.getElementById('fetch-player-btn');
const fetchPlayerStatus = document.getElementById('fetch-player-status');
const clearPlayerCacheBtn = document.getElementById('clear-player-cache-btn');
const autocompleteDropdown = document.getElementById('autocomplete-dropdown');
const granularityEl = document.getElementById('granularity');
const fromDateEl = document.getElementById('from-date');
const toDateEl = document.getElementById('to-date');
const tensionEl = document.getElementById('tension');
const emptyMsgEl = document.getElementById('empty-msg');
const chartWrapEl = document.getElementById('chart-wrap');
const legendEl = document.getElementById('legend');
const statsRowEl = document.getElementById('stats-row');
const myChartEl = document.getElementById('myChart');
const pillRowEl = document.getElementById('pill-row');
const datePresetSelect = document.getElementById('date-preset');
const shareLinkBtn = document.getElementById('share-link-btn');
const exportChartBtn = document.getElementById('export-chart-btn');
const includeEndDateEl = document.getElementById('include-end-date');

let isRestoringState = false;

function setFetchPlayerStatus(msg, type) {
  if (!fetchPlayerStatus) return;
  fetchPlayerStatus.textContent = msg || '';
  fetchPlayerStatus.className = 'fetch-status';
  if (type === 'ok') fetchPlayerStatus.classList.add('ok');
  if (type === 'err') fetchPlayerStatus.classList.add('err');
}

function normalizeDbfNr(value) {
  return String(value || '').replace(/\D/g, '');
}

// ── Group management ──────────────────────────────────────────────────────────

function createGroup(name) {
  const color = GROUP_COLORS[groups.length % GROUP_COLORS.length];
  const g = { id: nextGroupId++, name, color, memberDbfNrs: new Set() };
  groups.push(g);
  return g;
}

function deleteGroup(groupId) {
  const idx = groups.findIndex(g => g.id === groupId);
  if (idx < 0) return;
  groups.splice(idx, 1);
  rebuildPills();
  render();
}

function setPlayerGroup(dbfNr, groupId) {
  for (const g of groups) g.memberDbfNrs.delete(dbfNr);
  if (groupId !== null) {
    const g = groups.find(g => g.id === groupId);
    if (g) g.memberDbfNrs.add(dbfNr);
  }
  rebuildPills();
  render();
}

function getPlayerGroup(dbfNr) {
  return groups.find(g => g.memberDbfNrs.has(dbfNr)) || null;
}

function promptCreateGroup() {
  // Prevent duplicate inline forms
  if (pillRowEl.querySelector('.group-create-form')) return;

  const form = document.createElement('span');
  form.className = 'group-create-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'group-create-input';
  input.placeholder = 'Gruppenavn';
  input.value = 'Gruppe ' + (groups.length + 1);

  const doCreate = () => {
    const name = input.value.trim();
    if (name) createGroup(name);
    rebuildPills();
    if (name) render();
  };
  const doCancel = () => rebuildPills();

  const saveBtn = document.createElement('span');
  saveBtn.className = 'add-btn';
  saveBtn.textContent = '✓';
  saveBtn.addEventListener('click', doCreate);

  const cancelBtn = document.createElement('span');
  cancelBtn.className = 'clear-btn';
  cancelBtn.textContent = '✕';
  cancelBtn.addEventListener('click', doCancel);

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') doCreate();
    if (e.key === 'Escape') doCancel();
  });

  form.append(input, saveBtn, cancelBtn);

  // Swap the "+ Ny gruppe" button out for the inline form
  const newGrpBtn = Array.from(pillRowEl.querySelectorAll('.add-btn'))
    .find(b => b.textContent === '+ Ny gruppe');
  if (newGrpBtn) pillRowEl.replaceChild(form, newGrpBtn);
  else pillRowEl.appendChild(form);

  input.focus();
  input.select();
}

// ─────────────────────────────────────────────────────────────────────────────

function getLookupCacheKey(dbfNr) {
  return LOOKUP_CACHE_PREFIX + dbfNr;
}

function readLookupCache(dbfNr) {
  const key = getLookupCacheKey(dbfNr);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !parsed.data) return null;
    if (Date.now() - parsed.ts > LOOKUP_CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function writeLookupCache(dbfNr, data, source) {
  const key = getLookupCacheKey(dbfNr);
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), source, data }));
  } catch (_) {}
}

async function fetchLookupData(dbfNr) {
  const res = await fetch(LOOKUP_BASE_URL + '?dbfNr=' + encodeURIComponent(dbfNr));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function addPlayerByDbfNr(dbfNr, options) {
  const opts = options || {};
  const showUi = opts.showUi !== false;
  const skipRender = opts.skipRender === true;
  const selectInput = opts.selectInput === true;
  const normalized = normalizeDbfNr(dbfNr);
  if (!normalized) throw new Error('Indtast et DBfNr');

  let originalLabel = '';
  if (showUi && fetchPlayerBtn) {
    originalLabel = fetchPlayerBtn.textContent;
    fetchPlayerBtn.textContent = 'Henter...';
    fetchPlayerBtn.style.pointerEvents = 'none';
    setFetchPlayerStatus('Henter spiller fra DBf...', '');
  }

  try {
    let playerData;
    let source;
    const cached = readLookupCache(normalized);
    if (cached) {
      playerData = cached.data;
      source = 'cache';
    } else {
      playerData = await fetchLookupData(normalized);
      source = 'backend';
      writeLookupCache(normalized, playerData, source);
    }

    const entries = playerData.entries.map(e => ({ date: new Date(e.date), hc: e.hc }));
    if (!entries.length) throw new Error('Ingen handicap-data fundet for DBfNr ' + normalized);
    const withMeta = { name: playerData.name, entries, dbfNr: normalized };
    const idx = players.findIndex(p => p.dbfNr === normalized || p.name === withMeta.name);
    if (idx >= 0) players.splice(idx, 1, withMeta); else players.push(withMeta);

    if (!skipRender) {
      updateDateRange();
      rebuildPills();
      render();
    }
    if (showUi) setFetchPlayerStatus('Indlaest: ' + withMeta.name + ' (' + source + ')', 'ok');
    if (showUi && selectInput && dbfNumberInput) dbfNumberInput.select();
  } finally {
    if (showUi && fetchPlayerBtn) {
      fetchPlayerBtn.textContent = originalLabel;
      fetchPlayerBtn.style.pointerEvents = '';
    }
  }
}

async function addPlayerFromDbfNumber() {
  if (!dbfNumberInput) return;
  const dbfNr = normalizeDbfNr(dbfNumberInput.value);
  if (!dbfNr) {
    setFetchPlayerStatus('Indtast et DBfNr', 'err');
    dbfNumberInput.focus();
    return;
  }

  try {
    await addPlayerByDbfNr(dbfNr, { showUi: true, selectInput: true });
    dbfNumberInput.value = '';
    autocompleteDropdown.style.display = 'none';
  } catch (err) {
    setFetchPlayerStatus('Kunne ikke hente spiller', 'err');
    alert('Kunne ikke hente DBf data: ' + err.message + '\n\nDu kan stadig uploade den gemte HTML-fil manuelt.');
  }
}

if (btnPoints) {
  btnPoints.addEventListener('click', () => {
    showPoints = !showPoints;
    btnPoints.classList.toggle('on', showPoints);
    updatePointStyles();
    syncActiveUrl();
  });
}

if (btnHover) {
  btnHover.addEventListener('click', () => {
    showHover = !showHover;
    btnHover.classList.toggle('on', showHover);
    if (chart) {
      chart.options.plugins.tooltip.enabled = showHover;
      chart.update('none');
    }
    syncActiveUrl();
  });
}

function pointRadius() {
  if (!showPoints) return 0;
  return granularityEl.value === 'all' ? 1.5 : 3;
}

function updatePointStyles() {
  if (!chart) return;
  const r = pointRadius();
  if (!chart.options.elements) chart.options.elements = {};
  if (!chart.options.elements.point) chart.options.elements.point = {};
  chart.options.elements.point.radius = r;
  chart.options.elements.point.hoverRadius = showPoints ? 5 : 0;
  chart.options.elements.point.hitRadius = showPoints ? 6 : 0;
  chart.data.datasets.forEach(ds => {
    ds.pointRadius = r;
    ds.pointHoverRadius = showPoints ? 5 : 0;
    ds.pointHitRadius = showPoints ? 6 : 0;
  });
  chart.update();
}


function bucketKey(date, gran) {
  const y = date.getFullYear();
  const m = date.getMonth();
  if (gran === 'all') return date.toISOString().slice(0, 10);
  if (gran === 'week') {
    const j = new Date(y, 0, 1);
    const w = Math.ceil(((date - j) / 86400000 + j.getDay() + 1) / 7);
    return `${y}-W${String(w).padStart(2, '0')}`;
  }
  if (gran === 'month') return `${y}-${String(m + 1).padStart(2, '0')}`;
  if (gran === 'quarter') return `${y}-Q${Math.floor(m / 3) + 1}`;
  return `${y}`;
}

function bucketLabel(key, gran) {
  if (gran === 'all') {
    const d = new Date(key);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  }
  if (gran === 'week') return key.replace('-W', '\u00a0uge ');
  if (gran === 'month') {
    const [y, m] = key.split('-');
    return `${'jan feb mar apr maj jun jul aug sep okt nov dec'.split(' ')[+m - 1]} ${y}`;
  }
  if (gran === 'quarter') return key.replace('-', '  ');
  return key;
}

function getFrom() {
  const v = fromDateEl.value;
  return v ? new Date(v) : null;
}

function getTo() {
  const v = toDateEl.value;
  if (!v) return null;
  const d = new Date(v);
  d.setHours(23, 59, 59);
  return d;
}

function allKeys() {
  const f = getFrom();
  const t = getTo();
  const g = granularityEl.value;
  const s = new Set();
  for (const p of players) {
    for (const e of p.entries) {
      if (f && e.date < f) continue;
      if (t && e.date > t) continue;
      s.add(bucketKey(e.date, g));
    }
  }
  return Array.from(s).sort();
}

function buildDs(player, labels, gran) {
  const f = getFrom();
  const t = getTo();
  const b = {};
  for (const e of player.entries) {
    if (f && e.date < f) continue;
    if (t && e.date > t) continue;
    const k = bucketKey(e.date, gran);
    (b[k] = b[k] || []).push(e.hc);
  }
  return labels.map(k => {
    if (!b[k]) return null;
    const v = b[k];
    return parseFloat((v.reduce((a, c) => a + c, 0) / v.length).toFixed(2));
  });
}

function buildGroupDs(group, labels, gran) {
  const f = getFrom();
  const t = getTo();
  const memberPlayers = players.filter(p => group.memberDbfNrs.has(p.dbfNr));
  if (!memberPlayers.length) return labels.map(() => null);

  if (gran === 'all') {
    // Carry-forward: at each date point use each member's most-recent HC
    return labels.map(dateStr => {
      const d = new Date(dateStr + 'T23:59:59');
      const vals = [];
      for (const p of memberPlayers) {
        let lastHc = null;
        for (const e of p.entries) {
          if (f && e.date < f) continue;
          if (e.date <= d) lastHc = e.hc;
        }
        if (lastHc !== null) vals.push(lastHc);
      }
      if (!vals.length) return null;
      return parseFloat((vals.reduce((a, c) => a + c, 0) / vals.length).toFixed(2));
    });
  }

  // Bucketed granularities: average of each member's bucket average
  const memberBuckets = memberPlayers.map(p => {
    const b = {};
    for (const e of p.entries) {
      if (f && e.date < f) continue;
      if (t && e.date > t) continue;
      const k = bucketKey(e.date, gran);
      (b[k] = b[k] || []).push(e.hc);
    }
    return b;
  });

  return labels.map(k => {
    const vals = [];
    for (const b of memberBuckets) {
      if (b[k]) {
        vals.push(b[k].reduce((a, c) => a + c, 0) / b[k].length);
      }
    }
    if (!vals.length) return null;
    return parseFloat((vals.reduce((a, c) => a + c, 0) / vals.length).toFixed(2));
  });
}

function updateDateRange() {
  let mn = null;
  let mx = null;
  for (const p of players) {
    for (const e of p.entries) {
      if (!mn || e.date < mn) mn = e.date;
      if (!mx || e.date > mx) mx = e.date;
    }
  }
  if (mn && !fromDateEl.value) fromDateEl.value = mn.toISOString().slice(0, 10);
  if (mx && !toDateEl.value) toDateEl.value = mx.toISOString().slice(0, 10);
}

function togglePlayerVisibility(i) {
  if (hiddenPlayers.has(i)) {
    hiddenPlayers.delete(i);
  } else {
    hiddenPlayers.add(i);
  }
  rebuildPills();
  render();
}

function deleteAllPlayers() {
  players.length = 0;
  groups.length = 0;
  nextGroupId = 1;
  hiddenPlayers.clear();
  dbfNumberInput.value = '';
  setFetchPlayerStatus('', '');
  rebuildPills();
  render();
}

function rebuildPills() {
  pillRowEl.innerHTML = '';

  // ── Player pills ────────────────────────────────────────────────────────────
  players.forEach((p, i) => {
    const playerGroup = getPlayerGroup(p.dbfNr);
    const playerColor = COLORS[i % COLORS.length];
    const isHidden = hiddenPlayers.has(i);

    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.style.borderColor = playerGroup ? playerGroup.color : playerColor;
    pill.style.opacity = isHidden ? '0.4' : '1';
    pill.style.cursor = 'pointer';
    pill.style.transition = 'opacity 0.2s';

    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${playerColor};display:inline-block;flex-shrink:0`;

    const txt = document.createElement('span');
    txt.textContent = p.dbfNr ? `${p.name} (#${p.dbfNr})` : p.name;

    // Group selector
    const groupSel = document.createElement('select');
    groupSel.className = 'pill-group-select';
    groupSel.title = 'Tildel gruppe';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '–';
    groupSel.appendChild(noneOpt);
    for (const g of groups) {
      const opt = document.createElement('option');
      opt.value = String(g.id);
      opt.textContent = g.name;
      if (playerGroup && playerGroup.id === g.id) opt.selected = true;
      groupSel.appendChild(opt);
    }
    if (playerGroup) groupSel.style.background = playerGroup.color + '55';
    groupSel.addEventListener('change', e => {
      e.stopPropagation();
      setPlayerGroup(p.dbfNr, e.target.value ? parseInt(e.target.value, 10) : null);
    });
    groupSel.addEventListener('click', e => e.stopPropagation());

    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.title = 'Fjern';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      for (const g of groups) g.memberDbfNrs.delete(p.dbfNr);
      players.splice(i, 1);
      const shifted = new Set();
      for (const idx of hiddenPlayers) {
        if (idx === i) continue;
        shifted.add(idx > i ? idx - 1 : idx);
      }
      hiddenPlayers.clear();
      for (const idx of shifted) hiddenPlayers.add(idx);
      rebuildPills();
      render();
    });

    pill.append(dot, txt, groupSel, btn);
    pill.addEventListener('click', () => togglePlayerVisibility(i));
    pillRowEl.appendChild(pill);
  });

  // ── Group pills ─────────────────────────────────────────────────────────────
  for (const g of groups) {
    const memberCount = players.filter(p => g.memberDbfNrs.has(p.dbfNr)).length;

    const pill = document.createElement('span');
    pill.className = 'pill pill-group';
    pill.style.borderColor = g.color;

    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:2px;background:${g.color};display:inline-block;flex-shrink:0`;

    const txt = document.createElement('span');
    txt.textContent = `${g.name} (${memberCount})`;

    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.title = 'Slet gruppe';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteGroup(g.id);
    });

    pill.append(dot, txt, btn);
    pillRowEl.appendChild(pill);
  }

  // ── Action buttons ──────────────────────────────────────────────────────────
  const newGroupBtn = document.createElement('span');
  newGroupBtn.className = 'add-btn';
  newGroupBtn.textContent = '+ Ny gruppe';
  newGroupBtn.addEventListener('click', promptCreateGroup);
  pillRowEl.appendChild(newGroupBtn);

  if (players.length > 0) {
    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'add-btn';
    deleteBtn.textContent = 'Slet alle';
    deleteBtn.addEventListener('click', deleteAllPlayers);
    pillRowEl.appendChild(deleteBtn);
  }
}

function render() {
  const gran = granularityEl.value;
  const tension = parseFloat(tensionEl.value);
  const labels = allKeys();
  const r = pointRadius();

  emptyMsgEl.style.display = players.length ? 'none' : '';
  chartWrapEl.style.display = players.length ? '' : 'none';
  
  const visiblePlayers = players.map((p, i) => ({ p, i })).filter(({ i }) => !hiddenPlayers.has(i));
  
  legendEl.innerHTML = '';
  players.forEach((p, i) => {
    const span = document.createElement('span');
    span.className = 'legend-item';
    const isHidden = hiddenPlayers.has(i);
    span.style.opacity = isHidden ? '0.4' : '1';
    span.style.cursor = 'pointer';

    const dot = document.createElement('span');
    dot.style.cssText = `width:10px;height:10px;border-radius:2px;background:${COLORS[i % COLORS.length]};display:inline-block`;
    const label = document.createElement('span');
    label.textContent = p.name;

    span.append(dot, label);
    span.addEventListener('click', () => togglePlayerVisibility(i));
    legendEl.appendChild(span);
  });
  // Group legend items
  for (const g of groups) {
    if (!players.some(p => g.memberDbfNrs.has(p.dbfNr))) continue;
    const span = document.createElement('span');
    span.className = 'legend-item legend-item-group';

    const dot = document.createElement('span');
    dot.style.cssText = `width:10px;height:4px;border-radius:1px;background:${g.color};display:inline-block;align-self:center`;
    const label = document.createElement('span');
    label.textContent = g.name + ' (gns.)';

    span.append(dot, label);
    legendEl.appendChild(span);
  }

  statsRowEl.innerHTML = '';
  const f = getFrom();
  const t = getTo();
  for (const { p, i } of visiblePlayers) {
    const fe = p.entries.filter(e => (!f || e.date >= f) && (!t || e.date <= t));
    const last = fe.length ? fe[fe.length - 1].hc.toFixed(2) : '–';
    const best = fe.length ? Math.min(...fe.map(e => e.hc)).toFixed(2) : '–';
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.style.borderLeft = `3px solid ${COLORS[i % COLORS.length]}`;
    const lbl = document.createElement('div');
    lbl.className = 'stat-label';
    lbl.textContent = p.name;
    const val = document.createElement('div');
    val.className = 'stat-val';
    val.textContent = last;
    const sub = document.createElement('div');
    sub.className = 'stat-sub';
    sub.textContent = 'Bedste: ' + best;
    card.append(lbl, val, sub);
    statsRowEl.appendChild(card);
  }
  // Group average stat cards
  for (const g of groups) {
    const memberPlayers = players.filter(p => g.memberDbfNrs.has(p.dbfNr));
    if (!memberPlayers.length) continue;
    const memberEntries = memberPlayers.map(p => p.entries.filter(e => (!f || e.date >= f) && (!t || e.date <= t)));
    const lastVals = memberEntries.map(fe => fe.length ? fe[fe.length - 1].hc : null).filter(v => v !== null);
    const bestVals = memberEntries.map(fe => fe.length ? Math.min(...fe.map(e => e.hc)) : null).filter(v => v !== null);
    const avgLast = lastVals.length ? (lastVals.reduce((a, c) => a + c, 0) / lastVals.length).toFixed(2) : '–';
    const avgBest = bestVals.length ? (bestVals.reduce((a, c) => a + c, 0) / bestVals.length).toFixed(2) : '–';
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.style.borderLeft = `3px dashed ${g.color}`;
    const lbl = document.createElement('div');
    lbl.className = 'stat-label';
    lbl.textContent = g.name + ' (gns.)';
    const val = document.createElement('div');
    val.className = 'stat-val';
    val.textContent = avgLast;
    const sub = document.createElement('div');
    sub.className = 'stat-sub';
    sub.textContent = 'Bedste gns.: ' + avgBest;
    card.append(lbl, val, sub);
    statsRowEl.appendChild(card);
  }

  if (!players.length) {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    syncActiveUrl();
    return;
  }

  const playerDatasets = visiblePlayers.map(({ p, i }) => ({
    label: p.name,
    data: buildDs(p, labels, gran),
    borderColor: COLORS[i % COLORS.length],
    backgroundColor: COLORS[i % COLORS.length] + '22',
    borderWidth: 2,
    pointRadius: r,
    pointHoverRadius: showPoints ? 5 : 0,
    pointHitRadius: showPoints ? 6 : 0,
    tension,
    fill: false,
    spanGaps: true
  }));

  const groupDatasets = groups
    .filter(g => players.some(p => g.memberDbfNrs.has(p.dbfNr)))
    .map(g => ({
      label: g.name + ' (gns.)',
      data: buildGroupDs(g, labels, gran),
      borderColor: g.color,
      backgroundColor: g.color + '22',
      borderWidth: 2.5,
      borderDash: [7, 4],
      pointRadius: r,
      pointHoverRadius: showPoints ? 5 : 0,
      pointHitRadius: showPoints ? 6 : 0,
      tension,
      fill: false,
      spanGaps: true
    }));

  const datasets = [...playerDatasets, ...groupDatasets];
  const cl = labels.map(k => bucketLabel(k, gran));

  if (chart) {
    chart.data.labels = cl;
    chart.data.datasets = datasets;
    chart.options.plugins.tooltip.enabled = showHover;
    chart.update();
  } else {
    chart = new Chart(myChartEl, {
      type: 'line',
      data: { labels: cl, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: showHover,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y !== null ? ctx.parsed.y.toFixed(2) : '–'}`
            }
          }
        },
        scales: {
          x: {
            ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 20, font: { size: 11 } },
            grid: { color: 'rgba(128,128,128,0.1)' }
          },
          y: {
            reverse: true,
            title: { display: true, text: 'Handicap', font: { size: 12 } },
            ticks: { font: { size: 11 } },
            grid: { color: 'rgba(128,128,128,0.1)' }
          }
        }
      }
    });
  }

  syncActiveUrl();
}

fromDateEl.addEventListener('change', render);
toDateEl.addEventListener('change', () => {
  if (includeEndDateEl) includeEndDateEl.checked = true;
  render();
});
granularityEl.addEventListener('change', render);
tensionEl.addEventListener('input', render);

if (datePresetSelect) {
  datePresetSelect.addEventListener('change', () => {
    const months = parseInt(datePresetSelect.value, 10);
    if (isNaN(months)) return;

    const today = new Date();
    const from = new Date(today);
    from.setMonth(from.getMonth() - months);

    fromDateEl.value = from.toISOString().slice(0, 10);
    toDateEl.value = today.toISOString().slice(0, 10);
    if (includeEndDateEl) includeEndDateEl.checked = true;
    datePresetSelect.value = '';
    render();
  });
}

let allPlayersCache = null;

function playerMatchesQuery(p, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = (p.name + ' ' + p.club).toLowerCase().replace(/\s+/g, ' ');
  return words.every(w => haystack.includes(w));
}

function readAllPlayersCache() {
  try {
    const raw = localStorage.getItem(ALL_PLAYERS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !Array.isArray(parsed.players)) return null;
    if (Date.now() - parsed.ts > ALL_PLAYERS_CACHE_MAX_AGE_MS) return null;
    return parsed.players;
  } catch (_) {
    return null;
  }
}

function writeAllPlayersCache(playersList) {
  try {
    localStorage.setItem(ALL_PLAYERS_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      players: playersList
    }));
  } catch (_) {}
}

function clearClientCaches() {
  allPlayersCache = null;
  try {
    localStorage.removeItem(ALL_PLAYERS_CACHE_KEY);
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LOOKUP_CACHE_PREFIX)) toRemove.push(key);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch (_) {}
}

function buildStateParams(includeEndDate) {
  const params = new URLSearchParams();
  const dbfPlayers = players.map(p => p.dbfNr).filter(Boolean);
  if (dbfPlayers.length) params.set('p', dbfPlayers.join('-'));
  if (fromDateEl.value) params.set('from', fromDateEl.value);
  if (includeEndDate && toDateEl.value) params.set('to', toDateEl.value);

  if (granularityEl.value && granularityEl.value !== 'month') params.set('g', granularityEl.value);
  if (tensionEl.value && tensionEl.value !== '0.1') params.set('t', tensionEl.value);
  if (!showPoints) params.set('sp', '0');
  if (!showHover) params.set('sh', '0');

  const hiddenDbf = players
    .map((p, i) => (hiddenPlayers.has(i) ? p.dbfNr : null))
    .filter(Boolean);
  if (hiddenDbf.length) params.set('h', hiddenDbf.join('-'));

  if (groups.length) {
    const grpStr = groups
      .map(g => encodeURIComponent(g.name) + ':' + Array.from(g.memberDbfNrs).join(','))
      .join('|');
    params.set('grp', grpStr);
  }

  return params;
}

function buildShareUrl(includeEndDate) {
  const params = buildStateParams(includeEndDate);
  const qs = params.toString();
  return window.location.origin + window.location.pathname + (qs ? '?' + qs : '');
}

function syncActiveUrl() {
  if (isRestoringState) return;
  const includeEndDate = includeEndDateEl ? includeEndDateEl.checked : true;
  const url = buildShareUrl(includeEndDate);
  const relative = url.replace(window.location.origin, '');
  window.history.replaceState({}, '', relative);
}

async function copyShareUrl() {
  const includeEndDate = includeEndDateEl ? includeEndDateEl.checked : true;
  const url = buildShareUrl(includeEndDate);

  const flashShareButton = (label) => {
    if (!shareLinkBtn) return;
    const old = shareLinkBtn.textContent;
    shareLinkBtn.textContent = label;
    shareLinkBtn.style.pointerEvents = 'none';
    setTimeout(() => {
      shareLinkBtn.textContent = old;
      shareLinkBtn.style.pointerEvents = '';
    }, 1200);
  };

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (!ok) throw new Error('copy failed');
    }
    setFetchPlayerStatus('Link kopieret', 'ok');
    flashShareButton('Kopieret');
  } catch (_) {
    setFetchPlayerStatus('Kunne ikke kopiere link', 'err');
    flashShareButton('Fejl');
  }
}

function exportChart() {
  if (!chart) {
    alert('Diagrammet er ikke klar endnu');
    return;
  }

  const flashExportButton = (label) => {
    if (!exportChartBtn) return;
    const old = exportChartBtn.textContent;
    exportChartBtn.textContent = label;
    exportChartBtn.style.pointerEvents = 'none';
    setTimeout(() => {
      exportChartBtn.textContent = old;
      exportChartBtn.style.pointerEvents = '';
    }, 1200);
  };

  try {
    const imageData = chart.toBase64Image();
    const link = document.createElement('a');
    link.href = imageData;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 16).replace(/[T:]/g, '-');
    link.download = `handicap-trend-${dateStr}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    flashExportButton('Gemt');
  } catch (err) {
    console.error('Export failed:', err);
    flashExportButton('Fejl');
  }
}

async function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.toString()) return;

  isRestoringState = true;
  try {
    const g = params.get('g');
    if (g && Array.from(granularityEl.options).some(o => o.value === g)) granularityEl.value = g;

    const t = params.get('t');
    if (t && !Number.isNaN(parseFloat(t))) tensionEl.value = t;

    const from = params.get('from');
    if (from) fromDateEl.value = from;
    const to = params.get('to');
    if (to) {
      toDateEl.value = to;
      if (includeEndDateEl) includeEndDateEl.checked = true;
    }

    showPoints = params.get('sp') !== '0';
    showHover = params.get('sh') !== '0';
    if (btnPoints) btnPoints.classList.toggle('on', showPoints);
    if (btnHover) btnHover.classList.toggle('on', showHover);

    const p = (params.get('p') || '').split('-').map(normalizeDbfNr).filter(Boolean);
    if (p.length) {
      for (const dbfNr of p) {
        try {
          await addPlayerByDbfNr(dbfNr, { showUi: false, skipRender: true });
        } catch (_) {}
      }
    }

    const grpParam = params.get('grp');
    if (grpParam) {
      for (const part of grpParam.split('|')) {
        const colonIdx = part.indexOf(':');
        if (colonIdx < 0) continue;
        const name = decodeURIComponent(part.slice(0, colonIdx));
        const memberNrs = part.slice(colonIdx + 1).split(',').map(normalizeDbfNr).filter(Boolean);
        if (!name) continue;
        const g = createGroup(name);
        for (const nr of memberNrs) g.memberDbfNrs.add(nr);
      }
    }

    const hidden = new Set((params.get('h') || '').split('-').map(normalizeDbfNr).filter(Boolean));
    hiddenPlayers.clear();
    players.forEach((player, idx) => {
      if (player.dbfNr && hidden.has(player.dbfNr)) hiddenPlayers.add(idx);
    });

    updateDateRange();
    rebuildPills();
    render();
    if (players.length) setFetchPlayerStatus('Link indlaest', 'ok');
  } finally {
    isRestoringState = false;
  }
}

async function fetchAllPlayers() {
  if (allPlayersCache) return allPlayersCache;
  const cachedPlayers = readAllPlayersCache();
  if (cachedPlayers) {
    allPlayersCache = cachedPlayers;
    return cachedPlayers;
  }
  try {
    const res = await fetch('/api/hacalle');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    allPlayersCache = data.players;
    writeAllPlayersCache(data.players);
    return data.players;
  } catch (err) {
    console.error('Error fetching player list:', err);
    return [];
  }
}

let autocompleteIndex = -1;

function showAutocomplete(matches) {
  autocompleteIndex = -1;
  if (!matches.length) {
    autocompleteDropdown.style.display = 'none';
    return;
  }
  autocompleteDropdown.innerHTML = '';
  for (const p of matches.slice(0, 10)) {
    const item = document.createElement('div');
    item.className = 'autocomplete-item';
    item.dataset.dbf = p.dbfNr;
    const nameDiv = document.createElement('div');
    nameDiv.className = 'autocomplete-item-name';
    nameDiv.textContent = p.name;
    const clubDiv = document.createElement('div');
    clubDiv.className = 'autocomplete-item-club';
    clubDiv.textContent = `${p.club} (${p.dbfNr})`;
    item.append(nameDiv, clubDiv);
    autocompleteDropdown.appendChild(item);
  }
  autocompleteDropdown.style.display = 'block';
}

if (dbfNumberInput) {
  // Show dropdown on input focus if there's any cached data
  dbfNumberInput.addEventListener('focus', async () => {
    dbfNumberInput.select();
    const query = dbfNumberInput.value.trim();
    if (query.length > 0) {
      const allPlayers = await fetchAllPlayers();
      const matches = allPlayers.filter(p => playerMatchesQuery(p, query));
      showAutocomplete(matches);
    }
  });

  // Filter on each input
  dbfNumberInput.addEventListener('input', async () => {
    const query = dbfNumberInput.value.trim();
    if (query.length === 0) {
      autocompleteDropdown.style.display = 'none';
      return;
    }
    const allPlayers = await fetchAllPlayers();
    const matches = allPlayers.filter(p => playerMatchesQuery(p, query));
    showAutocomplete(matches);
  });

  // Hide dropdown on blur — only if focus didn't move into the dropdown itself
  dbfNumberInput.addEventListener('blur', () => {
    autocompleteDropdown.style.display = 'none';
    autocompleteIndex = -1;
  });

  // Prevent mousedown on the dropdown from stealing focus (keeps blur from firing)
  autocompleteDropdown.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  // Click on dropdown item
  autocompleteDropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (item) {
      const dbfNr = item.dataset.dbf;
      dbfNumberInput.value = dbfNr;
      autocompleteDropdown.style.display = 'none';
      autocompleteIndex = -1;
      addPlayerFromDbfNumber();
    }
  });

  // Keyboard navigation
  dbfNumberInput.addEventListener('keydown', e => {
    const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
    const isOpen = autocompleteDropdown.style.display !== 'none' && items.length > 0;

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
        dbfNumberInput.value = selected.dataset.dbf;
        autocompleteDropdown.style.display = 'none';
        autocompleteIndex = -1;
        addPlayerFromDbfNumber();
      } else {
        addPlayerFromDbfNumber();
      }
    } else if (e.key === 'Escape') {
      autocompleteDropdown.style.display = 'none';
      autocompleteIndex = -1;
    }
  });
}

if (fetchPlayerBtn) {
  fetchPlayerBtn.addEventListener('click', addPlayerFromDbfNumber);
}

if (clearPlayerCacheBtn) {
  clearPlayerCacheBtn.addEventListener('click', () => {
    clearClientCaches();
    autocompleteDropdown.style.display = 'none';
    setFetchPlayerStatus('Lokal cache ryddet', 'ok');
    fetchAllPlayers();
  });
}

if (shareLinkBtn) {
  shareLinkBtn.addEventListener('click', () => {
    copyShareUrl();
  });
}

if (exportChartBtn) {
  exportChartBtn.addEventListener('click', () => {
    exportChart();
  });
}

if (includeEndDateEl) {
  includeEndDateEl.addEventListener('change', () => {
    syncActiveUrl();
  });
}

// Pre-fetch player list on load for autocomplete
if (includeEndDateEl) {
  includeEndDateEl.checked = new URLSearchParams(window.location.search).has('to');
}

rebuildPills();
restoreStateFromUrl().finally(() => {
  fetchAllPlayers();
});
