const CLUB_DATA = {};
const CLUB_NAMES = [];
const ALL_VALUES = [];

const CACHE_KEY = 'dbf_hac_data';
const CACHE_TS = 'dbf_hac_ts';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REMOTE_HAC_URL = '/api/hacalle';

const CLUB_COLORS = [
  'rgba(15, 118, 110, 0.72)',   // teal
  'rgba(239, 68, 68, 0.72)',    // red
  'rgba(59, 130, 246, 0.72)',   // blue
  'rgba(16, 185, 129, 0.72)',   // emerald
  'rgba(245, 158, 11, 0.72)',   // amber
  'rgba(168, 85, 247, 0.72)',   // purple
  'rgba(236, 72, 153, 0.72)',   // pink
  'rgba(14, 165, 233, 0.72)'    // sky
];

let selectedClubs = [];
let numBins = 62;
let percentageMode = false;
let showCdf = false;
let chart = null;
let chartResizeObserver = null;
let isRestoringState = false;
let pendingUrlState = null;

const searchEl = document.getElementById('clubSearch');
const dropEl = document.getElementById('clubDropdown');
const pillArea = document.getElementById('pillArea');
const noDataOverlay = document.getElementById('noDataOverlay');
const helpBtn = document.getElementById('helpBtn');
const closeOverlayBtn = document.getElementById('closeOverlay');
const fetchRemoteBtn = document.getElementById('fetchRemoteBtn');
const shareLinkBtn = document.getElementById('shareLinkBtn');
const exportChartBtn = document.getElementById('exportChartBtn');
const fetchStatus = document.getElementById('fetchStatus');

function setFetchStatus(msg, type) {
  if (!fetchStatus) return;
  fetchStatus.textContent = msg || '';
  fetchStatus.className = 'data-age';
  if (type === 'ok') fetchStatus.classList.add('fresh');
  if (type === 'err') fetchStatus.classList.add('stale');
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

function buildStateParams() {
  const params = new URLSearchParams();
  const hcMin = document.getElementById('hcMin').value;
  const hcMax = document.getElementById('hcMax').value;
  if (hcMin) params.set('min', hcMin);
  if (hcMax) params.set('max', hcMax);
  if (numBins !== 62) params.set('bins', String(numBins));
  if (percentageMode) params.set('pct', '1');
  if (showCdf) params.set('cdf', '1');
  selectedClubs.forEach(club => params.append('club', club));
  return params;
}

function buildShareUrl() {
  const qs = buildStateParams().toString();
  return window.location.origin + window.location.pathname + (qs ? '?' + qs : '');
}

function syncActiveUrl() {
  if (isRestoringState) return;
  const relative = buildShareUrl().replace(window.location.origin, '');
  window.history.replaceState({}, '', relative);
}

async function copyShareUrl() {
  const url = buildShareUrl();

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
    setFetchStatus('Link kopieret', 'ok');
    flashShareButton('Kopieret');
  } catch (_) {
    setFetchStatus('Kunne ikke kopiere link', 'err');
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
    link.download = `handicap-diagram-${dateStr}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    flashExportButton('Gemt');
  } catch (err) {
    console.error('Export failed:', err);
    flashExportButton('Fejl');
  }
}

function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.toString()) return;
  pendingUrlState = {
    min: params.get('min'),
    max: params.get('max'),
    bins: params.get('bins'),
    pct: params.get('pct') === '1',
    cdf: params.get('cdf') === '1',
    clubs: params.getAll('club')
  };
}

function applyPendingUrlStateToInputs() {
  if (!pendingUrlState) return;
  const slider = document.getElementById('binSlider');
  const binValue = document.getElementById('binValue');
  const pctBox = document.getElementById('percentMode');
  const cdfBox = document.getElementById('cdfMode');
  const hcMin = document.getElementById('hcMin');
  const hcMax = document.getElementById('hcMax');

  const parsedBins = parseInt(pendingUrlState.bins, 10);
  if (!Number.isNaN(parsedBins)) {
    const clamped = Math.max(parseInt(slider.min, 10), Math.min(parsedBins, parseInt(slider.max, 10)));
    numBins = clamped;
    slider.value = String(clamped);
    binValue.textContent = String(clamped);
  }

  percentageMode = pendingUrlState.pct;
  pctBox.checked = percentageMode;
  showCdf = pendingUrlState.cdf;
  if (cdfBox) cdfBox.checked = showCdf;

  if (pendingUrlState.min !== null) hcMin.value = pendingUrlState.min;
  if (pendingUrlState.max !== null) hcMax.value = pendingUrlState.max;
}

function applyPendingUrlStateToData() {
  if (!pendingUrlState) return;
  isRestoringState = true;
  const hcMin = document.getElementById('hcMin');
  const hcMax = document.getElementById('hcMax');
  if (pendingUrlState.min !== null) hcMin.value = pendingUrlState.min;
  if (pendingUrlState.max !== null) hcMax.value = pendingUrlState.max;
  if (Array.isArray(pendingUrlState.clubs) && pendingUrlState.clubs.length) {
    selectedClubs = pendingUrlState.clubs.filter(club => CLUB_DATA[club]);
  }
  clampInputs();
  updatePills();
  isRestoringState = false;
  pendingUrlState = null;
}

function applyNewData(clubData, timestamp) {
  Object.keys(CLUB_DATA).forEach(k => delete CLUB_DATA[k]);
  Object.assign(CLUB_DATA, clubData);
  CLUB_NAMES.length = 0;
  CLUB_NAMES.push(...Object.keys(CLUB_DATA).sort((a, b) => a.localeCompare(b, 'da')));
  ALL_VALUES.length = 0;
  ALL_VALUES.push(...Object.values(CLUB_DATA).flat());

  const hcMinInput = document.getElementById('hcMin');
  const hcMaxInput = document.getElementById('hcMax');
  const dataMinFloor = ALL_VALUES.length ? Math.floor(Math.min(...ALL_VALUES)) : -10;
  hcMinInput.value = String(dataMinFloor);
  if (!isNaN(parseFloat(hcMinInput.min)) && dataMinFloor < parseFloat(hcMinInput.min)) {
    hcMinInput.min = String(dataMinFloor);
    hcMaxInput.min = String(dataMinFloor);
  }

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
  selectedClubs.length = 0;
  pillArea.innerHTML = '';
  searchEl.value = '';
  applyPendingUrlStateToData();
  refresh();
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
  const lowerBound = ALL_VALUES.length ? Math.floor(Math.min(...ALL_VALUES)) : -10;
  const lo = parseFloat(document.getElementById('hcMin').value);
  const hi = parseFloat(document.getElementById('hcMax').value);
  return {
    lo: isNaN(lo) ? lowerBound : Math.max(lowerBound, Math.min(lo, 52)),
    hi: isNaN(hi) ? 52 : Math.max(lowerBound, Math.min(hi, 52))
  };
}

function filterByRange(vals) {
  const { lo, hi } = getHcRange();
  return vals.filter(v => v >= lo && v <= hi);
}

function buildHist(vals, bins) {
  const { lo: mn, hi: mx } = getHcRange();
  const range = mx - mn;
  if (range <= 0) return { labels: [], datasets: [], w: 1 };
  const w = range / bins;
  const labels = [];
  for (let i = 0; i < bins; i++) labels.push((mn + i * w).toFixed(2));
  
  // Build per-club datasets if multiple clubs selected
  const datasets = [];
  if (!selectedClubs.length) {
    // All clubs: single combined dataset
    const counts = new Array(bins).fill(0);
    for (const v of vals) {
      if (v < mn || v > mx) continue;
      const idx = Math.min(Math.floor((v - mn) / w), bins - 1);
      if (idx >= 0) counts[idx]++;
    }
    datasets.push({
      label: 'Alle klubber',
      data: counts,
      color: 0
    });
  } else {
    // Multiple selected clubs: separate dataset per club
    for (let i = 0; i < selectedClubs.length; i++) {
      const club = selectedClubs[i];
      const clubVals = CLUB_DATA[club] || [];
      const counts = new Array(bins).fill(0);
      for (const v of clubVals) {
        if (v < mn || v > mx) continue;
        const idx = Math.min(Math.floor((v - mn) / w), bins - 1);
        if (idx >= 0) counts[idx]++;
      }
      datasets.push({
        label: club,
        data: counts,
        color: i % CLUB_COLORS.length
      });
    }
  }
  
  return { labels, datasets, w };
}

function renderChart(vals) {
  const { labels, datasets, w } = buildHist(vals, numBins);
  const ctx = document.getElementById('hChart').getContext('2d');
  if (chart) chart.destroy();
  
  const multiClub = selectedClubs.length > 1;
  const chartDatasets = datasets.map(ds => {
    const total = ds.data.reduce((sum, count) => sum + count, 0);
    const data = percentageMode && total > 0 ? ds.data.map(count => (count / total) * 100) : ds.data;
    return {
      label: ds.label,
      data,
      backgroundColor: CLUB_COLORS[ds.color],
      hoverBackgroundColor: CLUB_COLORS[ds.color].replace('0.72', '0.92'),
      borderColor: 'transparent',
      borderRadius: 2,
      barPercentage: multiClub ? 0.8 : 1.0,
      categoryPercentage: multiClub ? 0.8 : 1.0,
      yAxisID: 'y'
    };
  });

  if (showCdf) {
    datasets.forEach(ds => {
      const total = ds.data.reduce((sum, v) => sum + v, 0);
      if (!total) return;
      let running = 0;
      const cdfData = ds.data.map(count => {
        running += count;
        return (running / total) * 100;
      });
      const solidColor = CLUB_COLORS[ds.color].replace('0.72', '1');
      chartDatasets.push({
        type: 'line',
        label: 'CDF' + (datasets.length > 1 ? ' ' + ds.label : ''),
        data: cdfData,
        yAxisID: 'y2',
        borderColor: solidColor,
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: false,
        spanGaps: true
      });
    });
  }
  
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: chartDatasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: {
          display: selectedClubs.length > 1 || showCdf,
          position: 'top',
          labels: {
            color: '#63584d',
            font: { family: 'IBM Plex Mono', size: 10 },
            boxWidth: 12,
            boxHeight: 12,
            padding: 10
          }
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const lo = parseFloat(items[0].label);
              return 'HC ' + lo.toFixed(1).replace('.', ',') + '–' + (lo + w).toFixed(1).replace('.', ',');
            },
            label: (item) => {
              if (percentageMode) {
                return ' ' + item.raw.toFixed(1).replace('.', ',') + '%';
              }
              return ' ' + item.raw + ' spillere';
            }
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
            maxTicksLimit: window.matchMedia('(max-width: 860px)').matches ? 8 : 13,
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
            title: { display: true, text: percentageMode ? 'Procent af klub' : 'Antal spillere', color: '#63584d', font: { family: 'Manrope', size: 12 } }
          },
          y2: showCdf ? {
            position: 'right',
            min: 0,
            max: 100,
            ticks: {
              color: '#63584d',
              font: { family: 'IBM Plex Mono', size: 10 },
              callback: v => v + '%'
            },
            grid: { drawOnChartArea: false },
            border: { color: 'transparent' },
            title: { display: true, text: 'Kumulativ %', color: '#63584d', font: { family: 'Manrope', size: 12 } }
          } : { display: false }
      }
    }
  });
}

function renderDropdown(q) {
  const filt = q ? CLUB_NAMES.filter(c => c.toLowerCase().includes(q.toLowerCase())) : CLUB_NAMES;
  dropEl.innerHTML = '';
  const allDiv = document.createElement('div');
  allDiv.className = 'dropdown-item';
  const allChecked = selectedClubs.length === 0 ? '✓ ' : '';
  allDiv.innerHTML = '<span><strong>' + allChecked + 'Alle klubber</strong></span><span class="count">' + ALL_VALUES.length.toLocaleString('da-DK') + '</span>';
  allDiv.addEventListener('mousedown', e => {
    e.preventDefault();
    selectClub(null);
  });
  dropEl.appendChild(allDiv);
  filt.slice(0, 100).forEach(club => {
    const d = document.createElement('div');
    d.className = 'dropdown-item';
    const nameSpan = document.createElement('span');
    if (selectedClubs.includes(club)) nameSpan.appendChild(document.createTextNode('\u2713 '));
    nameSpan.appendChild(document.createTextNode(club));
    const countSpan = document.createElement('span');
    countSpan.className = 'count';
    countSpan.textContent = CLUB_DATA[club].length;
    d.append(nameSpan, countSpan);
    d.addEventListener('mousedown', e => {
      e.preventDefault();
      selectClub(club);
    });
    dropEl.appendChild(d);
  });
  dropEl.classList.add('open');
}

function getCurrentVals() {
  if (!selectedClubs.length) return ALL_VALUES;
  const combined = [];
  for (const club of selectedClubs) {
    if (CLUB_DATA[club]) combined.push(...CLUB_DATA[club]);
  }
  return combined;
}

function refresh() {
  if (!ALL_VALUES.length) return;
  const vals = getCurrentVals();
  const filtered = filterByRange(vals);
  renderChart(vals);
  updateStats(filtered);
  syncActiveUrl();
}

function selectClub(club) {
  if (club === null) {
    // Clear all selections
    selectedClubs.length = 0;
  } else if (selectedClubs.includes(club)) {
    // Toggle off
    selectedClubs.splice(selectedClubs.indexOf(club), 1);
  } else {
    // Toggle on
    selectedClubs.push(club);
  }
  updatePills();
  dropEl.classList.remove('open');
  searchEl.value = '';
  refresh();
}

function updatePills() {
  pillArea.innerHTML = '';
  if (!selectedClubs.length) return;
  selectedClubs.forEach((club, idx) => {
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.style.borderColor = CLUB_COLORS[idx % CLUB_COLORS.length].replace('0.72', '1');
    pill.textContent = club;
    const btn = document.createElement('button');
    btn.className = 'clear-club-btn';
    btn.type = 'button';
    btn.textContent = '\u2715';
    btn.addEventListener('click', () => {
      selectedClubs.splice(idx, 1);
      updatePills();
      refresh();
    });
    pill.appendChild(btn);
    pillArea.appendChild(pill);
  });
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
  restoreStateFromUrl();
  applyPendingUrlStateToInputs();

  document.getElementById('clearBtn').addEventListener('click', () => {
    if (!confirm('Ryd cachet data? Du skal uploade en ny fil for at se histogrammet igen.')) return;
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(CACHE_TS);
    } catch (_) {}

    Object.keys(CLUB_DATA).forEach(k => delete CLUB_DATA[k]);
    CLUB_NAMES.length = 0;
    ALL_VALUES.length = 0;
    selectedClubs.length = 0;
    percentageMode = false;
    showCdf = false;
    document.getElementById('percentMode').checked = false;
    document.getElementById('cdfMode').checked = false;
    document.getElementById('headerDesc').innerHTML = 'Danmarks Bridgeforbund';
    document.getElementById('dataAge').textContent = '';
    document.getElementById('dataAge').className = 'data-age';
    document.getElementById('hcMin').value = '-10';
    document.getElementById('hcMax').value = '52';
    document.getElementById('hcMin').min = '-10';
    document.getElementById('hcMax').min = '-10';
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
    syncActiveUrl();
  });

  helpBtn.addEventListener('click', () => {
    noDataOverlay.style.display = 'flex';
  });

  closeOverlayBtn.addEventListener('click', () => {
    noDataOverlay.style.display = 'none';
  });

  if (fetchRemoteBtn) {
    fetchRemoteBtn.addEventListener('click', () => {
      noDataOverlay.style.display = 'none';
      fetchAndApplyRemoteData();
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

  searchEl.addEventListener('focus', () => renderDropdown(searchEl.value));
  searchEl.addEventListener('input', () => renderDropdown(searchEl.value));
  searchEl.addEventListener('blur', () => setTimeout(() => dropEl.classList.remove('open'), 150));

  document.getElementById('binSlider').addEventListener('input', function() {
    numBins = parseInt(this.value);
    document.getElementById('binValue').textContent = numBins;
    refresh();
  });

  document.getElementById('percentMode').addEventListener('change', function() {
    percentageMode = this.checked;
    refresh();
  });

  document.getElementById('cdfMode').addEventListener('change', function() {
    showCdf = this.checked;
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

  // Keep canvas in sync when container size changes without a window resize event.
  const chartWrapper = document.querySelector('.chart-wrapper');
  if (chartWrapper && typeof ResizeObserver !== 'undefined') {
    chartResizeObserver = new ResizeObserver(() => {
      if (chart) chart.resize();
    });
    chartResizeObserver.observe(chartWrapper);
  }

  try {
    const ts = parseInt(localStorage.getItem(CACHE_TS));
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw && ts && !isNaN(ts)) {
      applyNewData(JSON.parse(raw), ts);
      if (Date.now() - ts > MAX_AGE_MS) {
        document.getElementById('dataAge').textContent += ' — overvej at opdatere';
        document.getElementById('dataAge').className = 'data-age stale';
      }
    } else {
      // No cached data; fetch automatically instead of showing overlay
      fetchAndApplyRemoteData();
    }
  } catch (_) {}
});
