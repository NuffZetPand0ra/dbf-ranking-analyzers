const assert = require('assert');
const {
  parseTurnHtml,
  parseLookupHtml,
  parseHacalleHtml,
} = require('../../server');
const { readFixtureText } = require('../helpers/fixtures');

describe('HTML parsers', () => {
  it('parseTurnHtml extracts pair tournament structure', () => {
    const html = readFixtureText('turn_pair.html');
    const parsed = parseTurnHtml(html);

    assert.strictEqual(typeof parsed.title, 'string');
    assert.strictEqual(parsed.title.length > 0, true);
    assert.strictEqual(parsed.formatHint, 'pair');
    assert.strictEqual(Array.isArray(parsed.groups), true);
    assert.strictEqual(parsed.groups.length > 0, true);
    assert.strictEqual(Array.isArray(parsed.groups[0].players), true);
    assert.strictEqual(parsed.groups[0].players.length > 0, true);
  });

  it('parseLookupHtml extracts player handicap timeline', () => {
    const html = readFixtureText('lookup_dennis.html');
    const parsed = parseLookupHtml(html);

    assert.strictEqual(typeof parsed.name, 'string');
    assert.strictEqual(parsed.name.length > 0, true);
    assert.strictEqual(Array.isArray(parsed.entries), true);
    assert.strictEqual(parsed.entries.length > 0, true);

    const firstEntry = parsed.entries[0];
    assert.strictEqual(typeof firstEntry.date, 'string');
    assert.match(firstEntry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(firstEntry, 'turnId'), true);
  });

  it('parseLookupHtml handles a second player fixture', () => {
    const html = readFixtureText('lookup_esben.html');
    const parsed = parseLookupHtml(html);

    assert.strictEqual(typeof parsed.name, 'string');
    assert.strictEqual(parsed.name.length > 0, true);
    assert.strictEqual(Array.isArray(parsed.entries), true);
    assert.strictEqual(parsed.entries.length > 0, true);
  });

  it('parseHacalleHtml extracts ranking list rows', () => {
    const html = readFixtureText('hacalle_rankings.html');
    const parsed = parseHacalleHtml(html);

    assert.strictEqual(Array.isArray(parsed), true);
    assert.strictEqual(parsed.length > 0, true);

    const first = parsed[0];
    assert.strictEqual(typeof first.dbfNr, 'string');
    assert.strictEqual(typeof first.name, 'string');
    assert.strictEqual(typeof first.club, 'string');
    assert.strictEqual(typeof first.hc, 'number');
  });
});
