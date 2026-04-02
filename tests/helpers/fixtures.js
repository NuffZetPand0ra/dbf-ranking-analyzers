const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SAMPLE_HTML_DIR = path.join(ROOT, 'sample_html');

function fixturePath(name) {
  return path.join(SAMPLE_HTML_DIR, name);
}

function readFixtureBuffer(name) {
  return fs.readFileSync(fixturePath(name));
}

function readFixtureText(name) {
  return fs.readFileSync(fixturePath(name), 'utf8');
}

module.exports = {
  SAMPLE_HTML_DIR,
  fixturePath,
  readFixtureBuffer,
  readFixtureText,
};
