const COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#D4537E', '#7F77DD', '#BA7517', '#639922', '#E24B4A', '#888780'];
const players = [];
let chart = null;
let showPoints = true;
let showHover = true;

const btnPoints = document.getElementById('toggle-points');
const btnHover = document.getElementById('toggle-hover');

btnPoints.addEventListener('click', () => {
  showPoints = !showPoints;
  btnPoints.classList.toggle('on', showPoints);
  updatePointStyles();
});

btnHover.addEventListener('click', () => {
  showHover = !showHover;
  btnHover.classList.toggle('on', showHover);
  if (chart) {
    chart.options.plugins.tooltip.enabled = showHover;
    chart.update('none');
  }
});

function pointRadius() {
  if (!showPoints) return 0;
  return document.getElementById('granularity').value === 'all' ? 1.5 : 3;
}

function updatePointStyles() {
  if (!chart) return;
  const r = pointRadius();
  chart.data.datasets.forEach(ds => {
    ds.pointRadius = r;
    ds.pointHoverRadius = showPoints ? 5 : 0;
  });
  chart.update('none');
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
    pill.style.borderColor = COLORS[i % COLORS.length];
    const dot = document.createElement('span');
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${COLORS[i % COLORS.length]};display:inline-block`;
    const txt = document.createElement('span');
    txt.textContent = p.name;
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.title = 'Fjern';
    btn.addEventListener('click', ((idx) => () => {
      players.splice(idx, 1);
      rebuildPills();
      render();
    })(i));
    pill.append(dot, txt, btn);
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
  document.getElementById('legend').innerHTML = players.map((p, i) =>
    `<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:${COLORS[i % COLORS.length]};display:inline-block"></span>${p.name}</span>`
  ).join('');
  document.getElementById('stats-row').innerHTML = players.map((p, i) => {
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

  const datasets = players.map((p, i) => ({
    label: p.name,
    data: buildDs(p, labels, gran),
    borderColor: COLORS[i % COLORS.length],
    backgroundColor: COLORS[i % COLORS.length] + '22',
    borderWidth: 2,
    pointRadius: r,
    pointHoverRadius: showPoints ? 5 : 0,
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
