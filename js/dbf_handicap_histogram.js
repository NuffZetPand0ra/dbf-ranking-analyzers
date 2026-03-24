const CLUB_DATA = {};
const CLUB_NAMES = [];
const ALL_VALUES = [];

const CACHE_KEY = 'dbf_hac_data';
const CACHE_TS = 'dbf_hac_ts';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REMOTE_HAC_URL = '/api/hacalle';

let currentClub = null;
let numBins = 62;
let chart = null;

const searchEl = document.getElementById('clubSearch');
const dropEl = document.getElementById('clubDropdown');
const pillArea = document.getElementById('pillArea');
const noDataOverlay = document.getElementById('noDataOverlay');
const helpBtn = document.getElementById('helpBtn');
const closeOverlayBtn = document.getElementById('closeOverlay');
const uploadBtnBig = document.getElementById('uploadBtnBig');
const fetchRemoteBtn = document.getElementById('fetchRemoteBtn');
const fetchStatus = document.getElementById('fetchStatus');

function setFetchStatus(msg, type) {
  if (!fetchStatus) return;
  fetchStatus.textContent = msg || '';
  fetchStatus.className = 'data-age';
  if (type === 'ok') fetchStatus.classList.add('fresh');
  if (type === 'err') fetchStatus.classList.add('stale');
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

async function fetchHtmlText(url, signal) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const decoder = pickDecoder(res.headers.get('content-type'));
  const buf = await res.arrayBuffer();
  return decoder.decode(buf);
}

async function fetchRemoteHacHtml(signal) {
  const html = await fetchHtmlText(REMOTE_HAC_URL, signal);
  return { html, source: 'backend' };
}

async function fetchAndApplyRemoteData() {
  if (!fetchRemoteBtn) return;
  fetchRemoteBtn.disabled = true;
  setFetchStatus('Henter fra DBf...', '');
  try {
    const { html, source } = await fetchRemoteHacHtml();
    const parsed = parseHACHtml(html);
    const nPlayers = Object.values(parsed).flat().length;
    if (nPlayers < 100) throw new Error('For få spillere fundet i svar (' + nPlayers + ')');
    const ts = Date.now();
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
      localStorage.setItem(CACHE_TS, String(ts));
    } catch (_) {}
    applyNewData(parsed, ts);
    setFetchStatus('Hentet fra DBf (' + source + ')', 'ok');
  } catch (err) {
    setFetchStatus('Kunne ikke hente online data', 'err');
    alert('Kunne ikke hente HACAlle.php automatisk: ' + err.message + '\n\nBrug upload-knappen i stedet.');
  } finally {
    fetchRemoteBtn.disabled = false;
  }
}

function parseHACHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = doc.querySelectorAll('table tr');
  const clubs = {};
  for (const tr of rows) {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 4) continue;
    const hcText = cells[3] ? cells[3].textContent.trim().replace(',', '.') : '';
    const hc = parseFloat(hcText);
    if (isNaN(hc)) continue;
    const club = cells[2] ? cells[2].textContent.trim() : '';
    if (!club) continue;
    if (!clubs[club]) clubs[club] = [];
    clubs[club].push(hc);
  }
  for (const k of Object.keys(clubs)) clubs[k].sort((a, b) => a - b);
  return clubs;
}

function applyNewData(clubData, timestamp) {
  Object.keys(CLUB_DATA).forEach(k => delete CLUB_DATA[k]);
  Object.assign(CLUB_DATA, clubData);
  CLUB_NAMES.length = 0;
  CLUB_NAMES.push(...Object.keys(CLUB_DATA).sort((a, b) => a.localeCompare(b, 'da')));
  ALL_VALUES.length = 0;
  ALL_VALUES.push(...Object.values(CLUB_DATA).flat());
  const total = ALL_VALUES.length;
  const nClubs = CLUB_NAMES.length;
  document.getElementById('headerDesc').innerHTML =
    'Danmarks Bridgeforbund &mdash; ' +
    total.toLocaleString('da-DK') + ' spillere &middot; ' + nClubs + ' klubber';

  const el = document.getElementById('dataAge');
  if (timestamp) {
    const age = Date.now() - timestamp;
    const hrs = Math.floor(age / 3600000);
    const mins = Math.floor((age % 3600000) / 60000);
    el.textContent = hrs > 0 ? `Data: ${hrs}t ${mins}m gammel` : `Data: ${mins}m gammel`;
    el.className = 'data-age ' + (age > MAX_AGE_MS ? 'stale' : 'fresh');
  }

  noDataOverlay.style.display = 'none';
  currentClub = null;
  pillArea.innerHTML = '';
  searchEl.value = '';
  refresh();
}

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = parseHACHtml(e.target.result);
      const nPlayers = Object.values(parsed).flat().length;
      if (nPlayers < 100) throw new Error('Kun ' + nPlayers + ' spillere fundet — forkert fil?');
      const ts = Date.now();
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
        localStorage.setItem(CACHE_TS, String(ts));
      } catch (_) {}
      applyNewData(parsed, ts);
    } catch (err) {
      alert('Kunne ikke indlæse fil: ' + err.message);
    }
  };
  reader.readAsText(file, 'utf-8');
}

function stats(vals) {
  const s = [...vals].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return {};
  const mean = s.reduce((x, v) => x + v, 0) / n;
  const median = n % 2 === 0 ? (s[n / 2 - 1] + s[n / 2]) / 2 : s[Math.floor(n / 2)];
  const std = Math.sqrt(s.reduce((x, v) => x + (v - mean) ** 2, 0) / n);
  return { n, mean, median, min: s[0], max: s[n - 1], std };
}

function fmt(v) {
  return v.toFixed(2).replace('.', ',');
}

function updateStats(vals) {
  const s = stats(vals);
  if (!s.n) {
    ['sN', 'sMean', 'sMedian', 'sMin', 'sMax', 'sStd'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    return;
  }
  document.getElementById('sN').textContent = s.n.toLocaleString('da-DK');
  document.getElementById('sMean').textContent = fmt(s.mean);
  document.getElementById('sMedian').textContent = fmt(s.median);
  document.getElementById('sMin').textContent = fmt(s.min);
  document.getElementById('sMax').textContent = fmt(s.max);
  document.getElementById('sStd').textContent = fmt(s.std);
}

function getHcRange() {
  const lo = parseFloat(document.getElementById('hcMin').value);
  const hi = parseFloat(document.getElementById('hcMax').value);
  return {
    lo: isNaN(lo) ? -10 : Math.max(-10, Math.min(lo, 52)),
    hi: isNaN(hi) ? 52 : Math.max(-10, Math.min(hi, 52))
  };
}

function filterByRange(vals) {
  const { lo, hi } = getHcRange();
  return vals.filter(v => v >= lo && v <= hi);
}

function buildHist(vals, bins) {
  const { lo: mn, hi: mx } = getHcRange();
  const range = mx - mn;
  if (range <= 0) return { labels: [], counts: [], w: 1 };
  const w = range / bins;
  const counts = new Array(bins).fill(0);
  const labels = [];
  for (let i = 0; i < bins; i++) labels.push((mn + i * w).toFixed(2));
  for (const v of vals) {
    if (v < mn || v > mx) continue;
    const idx = Math.min(Math.floor((v - mn) / w), bins - 1);
    if (idx >= 0) counts[idx]++;
  }
  return { labels, counts, w };
}

function renderChart(vals) {
  const { labels, counts, w } = buildHist(vals, numBins);
  const ctx = document.getElementById('hChart').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Spillere',
        data: counts,
        backgroundColor: 'rgba(15, 118, 110, 0.72)',
        hoverBackgroundColor: 'rgba(13, 148, 136, 0.92)',
        borderColor: 'transparent',
        borderRadius: 2,
        barPercentage: 1.0,
        categoryPercentage: 1.0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.8,
      animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const lo = parseFloat(items[0].label);
              return 'HC ' + lo.toFixed(1).replace('.', ',') + '–' + (lo + w).toFixed(1).replace('.', ',');
            },
            label: (item) => ' ' + item.raw + ' spillere'
          },
          backgroundColor: 'rgba(255,255,255,.97)',
          borderColor: 'rgba(64,52,40,.22)',
          borderWidth: 1,
          titleColor: '#0f766e',
          bodyColor: '#1f1a15',
          padding: 10
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#63584d',
            font: { family: 'IBM Plex Mono', size: 10 },
            maxTicksLimit: 13,
            callback: function(val, idx) {
              const lbl = this.chart.data.labels[idx];
              const v = parseFloat(lbl);
              return isNaN(v) ? '' : v.toFixed(0);
            }
          },
          grid: { color: 'rgba(64,52,40,.16)' },
          border: { color: 'transparent' },
          title: { display: true, text: 'Handicap', color: '#63584d', font: { family: 'Manrope', size: 12 } }
        },
        y: {
          ticks: { color: '#63584d', font: { family: 'IBM Plex Mono', size: 10 } },
          grid: { color: 'rgba(64,52,40,.16)' },
          border: { color: 'transparent', dash: [4, 4] },
          title: { display: true, text: 'Antal spillere', color: '#63584d', font: { family: 'Manrope', size: 12 } }
        }
      }
    }
  });
}

function renderDropdown(q) {
  const filt = q ? CLUB_NAMES.filter(c => c.toLowerCase().includes(q.toLowerCase())) : CLUB_NAMES;
  dropEl.innerHTML = '';
  const allDiv = document.createElement('div');
  allDiv.className = 'dropdown-item';
  allDiv.innerHTML = '<span><strong>Alle klubber</strong></span><span class="count">' + ALL_VALUES.length.toLocaleString('da-DK') + '</span>';
  allDiv.addEventListener('mousedown', e => {
    e.preventDefault();
    selectClub(null);
  });
  dropEl.appendChild(allDiv);
  filt.slice(0, 100).forEach(club => {
    const d = document.createElement('div');
    d.className = 'dropdown-item';
    d.innerHTML = '<span>' + club + '</span><span class="count">' + CLUB_DATA[club].length + '</span>';
    d.addEventListener('mousedown', e => {
      e.preventDefault();
      selectClub(club);
    });
    dropEl.appendChild(d);
  });
  dropEl.classList.add('open');
}

function getCurrentVals() {
  return currentClub ? CLUB_DATA[currentClub] : ALL_VALUES;
}

function refresh() {
  if (!ALL_VALUES.length) return;
  const vals = getCurrentVals();
  const filtered = filterByRange(vals);
  renderChart(vals);
  updateStats(filtered);
}

function selectClub(club) {
  currentClub = club;
  dropEl.classList.remove('open');
  searchEl.value = '';
  if (club) {
    pillArea.innerHTML = '<div class="pill">' + club + '<button id="clearClubBtn" type="button">✕</button></div>';
    const clearClubBtn = document.getElementById('clearClubBtn');
    if (clearClubBtn) clearClubBtn.addEventListener('click', clearClub);
  } else {
    pillArea.innerHTML = '';
  }
  refresh();
}

function clearClub() {
  selectClub(null);
}

function clampInputs() {
  const lo = parseFloat(document.getElementById('hcMin').value);
  const hi = parseFloat(document.getElementById('hcMax').value);
  if (!isNaN(lo) && !isNaN(hi) && lo > hi) {
    document.getElementById('hcMin').value = hi;
    document.getElementById('hcMax').value = lo;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fi = document.getElementById('fileInput');
  fi.addEventListener('change', () => {
    handleFile(fi.files[0]);
    fi.value = '';
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    if (!confirm('Ryd cachet data? Du skal uploade en ny fil for at se histogrammet igen.')) return;
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(CACHE_TS);
    } catch (_) {}

    Object.keys(CLUB_DATA).forEach(k => delete CLUB_DATA[k]);
    CLUB_NAMES.length = 0;
    ALL_VALUES.length = 0;
    document.getElementById('headerDesc').innerHTML = 'Danmarks Bridgeforbund';
    document.getElementById('dataAge').textContent = '';
    document.getElementById('dataAge').className = 'data-age';
    setFetchStatus('');
    pillArea.innerHTML = '';
    searchEl.value = '';
    if (chart) {
      chart.destroy();
      chart = null;
    }
    ['sN', 'sMean', 'sMedian', 'sMin', 'sMax', 'sStd'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    noDataOverlay.style.display = 'flex';
  });

  helpBtn.addEventListener('click', () => {
    noDataOverlay.style.display = 'flex';
  });

  closeOverlayBtn.addEventListener('click', () => {
    noDataOverlay.style.display = 'none';
  });

  uploadBtnBig.addEventListener('click', () => {
    noDataOverlay.style.display = 'none';
  });

  if (fetchRemoteBtn) {
    fetchRemoteBtn.addEventListener('click', () => {
      noDataOverlay.style.display = 'none';
      fetchAndApplyRemoteData();
    });
  }

  searchEl.addEventListener('focus', () => renderDropdown(searchEl.value));
  searchEl.addEventListener('input', () => renderDropdown(searchEl.value));
  searchEl.addEventListener('blur', () => setTimeout(() => dropEl.classList.remove('open'), 150));

  document.getElementById('binSlider').addEventListener('input', function() {
    numBins = parseInt(this.value);
    document.getElementById('binValue').textContent = numBins;
    refresh();
  });

  document.getElementById('hcMin').addEventListener('change', () => {
    clampInputs();
    refresh();
  });

  document.getElementById('hcMax').addEventListener('change', () => {
    clampInputs();
    refresh();
  });

  try {
    const ts = parseInt(localStorage.getItem(CACHE_TS));
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw && ts && !isNaN(ts)) {
      applyNewData(JSON.parse(raw), ts);
      if (Date.now() - ts > MAX_AGE_MS) {
        document.getElementById('dataAge').textContent += ' — overvej at opdatere';
        document.getElementById('dataAge').className = 'data-age stale';
      }
    }
  } catch (_) {}
});
