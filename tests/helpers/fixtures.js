const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.resolve(__dirname, '..', 'fixtures');

function fixturePath(name) {
  return path.join(FIXTURE_DIR, name);
}

function readFixtureBuffer(name) {
  return fs.readFileSync(fixturePath(name));
}

function readFixtureText(name) {
  return fs.readFileSync(fixturePath(name), 'utf8');
}

module.exports = {
  FIXTURE_DIR,
  fixturePath,
  readFixtureBuffer,
  readFixtureText,
};
