const COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#D4537E', '#7F77DD', '#BA7517', '#639922', '#E24B4A', '#888780'];
const players = [];
const hiddenPlayers = new Set();
let chart = null;
let showPoints = true;
let showHover = true;
const LOOKUP_BASE_URL = '/api/lookup';
const LOOKUP_CACHE_PREFIX = 'dbf_lookup_';
const LOOKUP_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const btnPoints = document.getElementById('toggle-points');
const btnHover = document.getElementById('toggle-hover');
const dbfNumberInput = document.getElementById('dbf-number');
const fetchPlayerBtn = document.getElementById('fetch-player-btn');
const fetchPlayerStatus = document.getElementById('fetch-player-status');

function setFetchPlayerStatus(msg, type) {
  if (!fetchPlayerStatus) return;
  fetchPlayerStatus.textContent = msg || '';
  fetchPlayerStatus.className = 'fetch-status';
  if (type === 'ok') fetchPlayerStatus.classList.add('ok');
  if (type === 'err') fetchPlayerStatus.classList.add('err');
}

function pickDecoder(contentType) {
  const m = (contentType || '').match(/charset\s*=\s*([^;]+)/i);
  let charset = m ? m[1].trim().toLowerCase() : 'windows-1252';
  if (charset === 'iso-8859-1' || charset === 'latin1') charset = 'windows-1252';
  try {
    return new TextDecoder(charset);
  } catch (_) {
    return new TextDecoder('windows-1252');
  }
}

function normalizeDbfNr(value) {
  return String(value || '').replace(/\D/g, '');
}

function getLookupCacheKey(dbfNr) {
  return LOOKUP_CACHE_PREFIX + dbfNr;
}

function readLookupCache(dbfNr) {
  const key = getLookupCacheKey(dbfNr);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !parsed.html) return null;
    const age = Date.now() - parsed.ts;
    if (age > LOOKUP_CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function writeLookupCache(dbfNr, html, source) {
  const key = getLookupCacheKey(dbfNr);
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), source, html }));
  } catch (_) {}
}

async function fetchHtmlText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const decoder = pickDecoder(res.headers.get('content-type'));
  const buf = await res.arrayBuffer();
  return decoder.decode(buf);
}

async function fetchLookupHtml(dbfNr) {
  const lookupUrl = LOOKUP_BASE_URL + '?dbfNr=' + encodeURIComponent(dbfNr);
  const html = await fetchHtmlText(lookupUrl);
  return { html, source: 'backend' };
}

async function addPlayerFromDbfNumber() {
  if (!dbfNumberInput || !fetchPlayerBtn) return;
  const dbfNr = normalizeDbfNr(dbfNumberInput.value);
  if (!dbfNr) {
    setFetchPlayerStatus('Indtast et DBfNr', 'err');
    dbfNumberInput.focus();
    return;
  }

  const originalLabel = fetchPlayerBtn.textContent;
  fetchPlayerBtn.textContent = 'Henter...';
  fetchPlayerBtn.style.pointerEvents = 'none';
  setFetchPlayerStatus('Henter spiller fra DBf...', '');

  try {
    let html;
    let source;
    const cached = readLookupCache(dbfNr);
    if (cached) {
      html = cached.html;
      source = 'cache';
    } else {
      const fetched = await fetchLookupHtml(dbfNr);
      html = fetched.html;
      source = fetched.source;
      writeLookupCache(dbfNr, html, source);
    }

    const parsed = parseHtml(html, 'DBF-' + dbfNr + '.html');
    if (!parsed.entries.length) throw new Error('Ingen handicap-data fundet for DBfNr ' + dbfNr);
    const withMeta = { ...parsed, dbfNr };
    const idx = players.findIndex(p => p.dbfNr === dbfNr || p.name === parsed.name);
    if (idx >= 0) players.splice(idx, 1, withMeta); else players.push(withMeta);

    updateDateRange();
    rebuildPills();
    render();
    setFetchPlayerStatus('Indlæst: ' + withMeta.name + ' (' + source + ')', 'ok');
    dbfNumberInput.select();
  } catch (err) {
    setFetchPlayerStatus('Kunne ikke hente spiller', 'err');
    alert('Kunne ikke hente DBf data: ' + err.message + '\n\nDu kan stadig uploade den gemte HTML-fil manuelt.');
  } finally {
    fetchPlayerBtn.textContent = originalLabel;
    fetchPlayerBtn.style.pointerEvents = '';
  }
}

if (btnPoints) {
  btnPoints.addEventListener('click', () => {
    showPoints = !showPoints;
    btnPoints.classList.toggle('on', showPoints);
    updatePointStyles();
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
  });
}

function pointRadius() {
  if (!showPoints) return 0;
  return document.getElementById('granularity').value === 'all' ? 1.5 : 3;
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

document.getElementById('add-btn').addEventListener('click', () => document.getElementById('file-input').click());

document.getElementById('file-input').addEventListener('change', function(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  let loaded = 0;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = parseHtml(ev.target.result, file.name);
      if (parsed.entries.length > 0) {
        const idx = players.findIndex(p => p.name === parsed.name);
        if (idx >= 0) players.splice(idx, 1, parsed); else players.push(parsed);
      }
      if (++loaded === files.length) {
        updateDateRange();
        rebuildPills();
        render();
      }
    };
    reader.readAsText(file, 'windows-1252');
  });
  this.value = '';
});

function parseHtml(html, filename) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let name = filename.replace(/\.html?$/i, '');
  const title = doc.querySelector('title');
  if (title) {
    const m = title.textContent.match(/for (.+)$/);
    if (m) name = m[1].trim();
  }
  if (name === filename.replace(/\.html?$/i, '')) {
    for (const h of doc.querySelectorAll('h3')) {
      const m = h.textContent.match(/Handicap for (.+?):/);
      if (m) {
        name = m[1].trim();
        break;
      }
    }
  }
  const entries = [];
  for (const row of doc.querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 5) continue;
    const dm = cells[0].textContent.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!dm) continue;
    const hc = parseFloat(cells[4].textContent.trim().replace(/\u00a0/g, '').replace(',', '.'));
    if (isNaN(hc)) continue;
    entries.push({ date: new Date(dm[3], dm[2] - 1, dm[1]), hc });
  }
  entries.sort((a, b) => a.date - b.date);
  return { name, entries };
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
  const v = document.getElementById('from-date').value;
  return v ? new Date(v) : null;
}

function getTo() {
  const v = document.getElementById('to-date').value;
  if (!v) return null;
  const d = new Date(v);
  d.setHours(23, 59, 59);
  return d;
}

function allKeys() {
  const f = getFrom();
  const t = getTo();
  const g = document.getElementById('granularity').value;
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

function updateDateRange() {
  let mn = null;
  let mx = null;
  for (const p of players) {
    for (const e of p.entries) {
      if (!mn || e.date < mn) mn = e.date;
      if (!mx || e.date > mx) mx = e.date;
    }
  }
  const fd = document.getElementById('from-date');
  const td = document.getElementById('to-date');
  if (mn && !fd.value) fd.value = mn.toISOString().slice(0, 10);
  if (mx && !td.value) td.value = mx.toISOString().slice(0, 10);
}

function rebuildPills() {
  const row = document.getElementById('pill-row');
  row.innerHTML = '';
  players.forEach((p, i) => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    const isHidden = hiddenPlayers.has(i);
    pill.style.borderColor = COLORS[i % COLORS.length];
    pill.style.opacity = isHidden ? '0.4' : '1';
    pill.style.cursor = 'pointer';
    pill.style.transition = 'opacity 0.2s';
    
    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${COLORS[i % COLORS.length]};display:inline-block`;
    
    const txt = document.createElement('span');
    txt.textContent = p.dbfNr ? `${p.name} (#${p.dbfNr})` : p.name;
    
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.title = 'Fjern';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      players.splice(i, 1);
      hiddenPlayers.delete(i);
      for (let idx of hiddenPlayers) {
        if (idx > i) {
          hiddenPlayers.delete(idx);
          hiddenPlayers.add(idx - 1);
        }
      }
      rebuildPills();
      render();
    });
    
    const toggleVisibility = () => {
      if (hiddenPlayers.has(i)) {
        hiddenPlayers.delete(i);
      } else {
        hiddenPlayers.add(i);
      }
      rebuildPills();
      render();
    };
    
    pill.append(dot, txt, btn);
    pill.addEventListener('click', toggleVisibility);
    row.appendChild(pill);
  });
  const ab = document.createElement('span');
  ab.className = 'add-btn';
  ab.textContent = '+ Tilføj spiller';
  ab.addEventListener('click', () => document.getElementById('file-input').click());
  row.appendChild(ab);
}

function render() {
  const gran = document.getElementById('granularity').value;
  const tension = parseFloat(document.getElementById('tension').value);
  const labels = allKeys();
  const r = pointRadius();

  document.getElementById('empty-msg').style.display = players.length ? 'none' : '';
  document.getElementById('chart-wrap').style.display = players.length ? '' : 'none';
  
  const visiblePlayers = players.map((p, i) => ({ p, i })).filter(({ i }) => !hiddenPlayers.has(i));
  
  const legendDiv = document.getElementById('legend');
  legendDiv.innerHTML = '';
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
    span.addEventListener('click', () => {
      if (hiddenPlayers.has(i)) {
        hiddenPlayers.delete(i);
      } else {
        hiddenPlayers.add(i);
      }
      rebuildPills();
      render();
    });
    legendDiv.appendChild(span);
  });
  document.getElementById('stats-row').innerHTML = visiblePlayers.map(({ p, i }) => {
    const f = getFrom();
    const t = getTo();
    const fe = p.entries.filter(e => (!f || e.date >= f) && (!t || e.date <= t));
    const last = fe.length ? fe[fe.length - 1].hc.toFixed(2) : '–';
    const best = fe.length ? Math.min(...fe.map(e => e.hc)).toFixed(2) : '–';
    return `<div class="stat-card" style="border-left:3px solid ${COLORS[i % COLORS.length]}"><div class="stat-label">${p.name}</div><div class="stat-val">${last}</div><div class="stat-sub">Bedste: ${best}</div></div>`;
  }).join('');

  if (!players.length) {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    return;
  }

  const datasets = visiblePlayers.map(({ p, i }) => ({
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
  const cl = labels.map(k => bucketLabel(k, gran));

  if (chart) {
    chart.data.labels = cl;
    chart.data.datasets = datasets;
    chart.options.plugins.tooltip.enabled = showHover;
    chart.update();
  } else {
    chart = new Chart(document.getElementById('myChart'), {
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
}

['from-date', 'to-date', 'granularity'].forEach(id => document.getElementById(id).addEventListener('change', render));
document.getElementById('tension').addEventListener('input', render);

const datePresetSelect = document.getElementById('date-preset');
if (datePresetSelect) {
  datePresetSelect.addEventListener('change', () => {
    const months = parseInt(datePresetSelect.value, 10);
    if (isNaN(months)) return;
    
    const today = new Date();
    const from = new Date(today);
    from.setMonth(from.getMonth() - months);
    
    const fromDateEl = document.getElementById('from-date');
    const toDateEl = document.getElementById('to-date');
    fromDateEl.value = from.toISOString().slice(0, 10);
    toDateEl.value = today.toISOString().slice(0, 10);
    datePresetSelect.value = '';
    render();
  });
}

let allPlayersCache = null;
const autocompleteDropdown = document.getElementById('autocomplete-dropdown');

async function fetchAllPlayers() {
  if (allPlayersCache) return allPlayersCache;
  try {
    const res = await fetch('/api/hacalle');
    if (!res.ok) throw new Error('Failed to fetch player list');
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const players = [];
    for (const row of doc.querySelectorAll('tr.MasterPointEqualRow, tr.MasterPointOddRow')) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) continue;
      const playerLink = cells[1]?.querySelector('a');
      const clubLink = cells[2]?.querySelector('a');
      if (!playerLink) continue;
      const hrefMatch = (playerLink.getAttribute('href') || '').match(/DBFNr=(\d+)/i);
      if (!hrefMatch) continue;
      players.push({
        name: playerLink.textContent.trim(),
        club: clubLink ? clubLink.textContent.trim() : '',
        dbfNr: hrefMatch[1]
      });
    }
    allPlayersCache = players;
    return players;
  } catch (err) {
    console.error('Error fetching player list:', err);
    return [];
  }
}

function showAutocomplete(matches) {
  if (!matches.length) {
    autocompleteDropdown.style.display = 'none';
    return;
  }
  autocompleteDropdown.innerHTML = matches.slice(0, 10).map(p =>
    `<div class="autocomplete-item" data-dbf="${p.dbfNr}">
      <div class="autocomplete-item-name">${p.name}</div>
      <div class="autocomplete-item-club">${p.club} (${p.dbfNr})</div>
    </div>`
  ).join('');
  autocompleteDropdown.style.display = 'block';
}

if (dbfNumberInput) {
  // Show dropdown on input focus if there's any cached data
  dbfNumberInput.addEventListener('focus', async () => {
    const query = dbfNumberInput.value.trim();
    if (query.length > 0) {
      const allPlayers = await fetchAllPlayers();
      const matches = allPlayers.filter(p =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.club.toLowerCase().includes(query.toLowerCase())
      );
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
    const matches = allPlayers.filter(p =>
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.club.toLowerCase().includes(query.toLowerCase())
    );
    showAutocomplete(matches);
  });

  // Hide dropdown on blur
  dbfNumberInput.addEventListener('blur', () => {
    setTimeout(() => {
      autocompleteDropdown.style.display = 'none';
    }, 150);
  });

  // Click on dropdown item
  document.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (item) {
      const dbfNr = item.dataset.dbf;
      dbfNumberInput.value = dbfNr;
      autocompleteDropdown.style.display = 'none';
      addPlayerFromDbfNumber();
    }
  });

  // Enter key
  dbfNumberInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addPlayerFromDbfNumber();
    }
  });
}

if (fetchPlayerBtn) {
  fetchPlayerBtn.addEventListener('click', addPlayerFromDbfNumber);
}

// Pre-fetch player list on load for autocomplete
fetchAllPlayers();
