const dashboardGrid = document.getElementById('dashboardGrid');
const stackBtn = document.getElementById('stackBtn');
const sideBySideBtn = document.getElementById('sideBySideBtn');
const reloadBtn = document.getElementById('reloadBtn');
const comparisonFrame = document.getElementById('comparisonFrame');
const histogramFrame = document.getElementById('histogramFrame');

function setStacked(enabled) {
  dashboardGrid.classList.toggle('stacked', enabled);
}

function reloadFrames() {
  comparisonFrame.contentWindow.location.reload();
  histogramFrame.contentWindow.location.reload();
}

stackBtn.addEventListener('click', () => setStacked(true));
sideBySideBtn.addEventListener('click', () => setStacked(false));
reloadBtn.addEventListener('click', reloadFrames);
