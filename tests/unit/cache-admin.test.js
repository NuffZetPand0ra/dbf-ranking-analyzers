const assert = require('assert');
const { run } = require('../../scripts/cache-admin');

describe('cache-admin CLI command routing', () => {
  it('calls status endpoint for status command', async () => {
    const calls = [];
    const logs = [];

    await run(['status'], {
      requestJson: async (method, path, body) => {
        calls.push({ method, path, body });
        return { ok: true };
      },
      log: msg => logs.push(msg),
      setExitCode: () => {
        throw new Error('setExitCode should not be called on valid command');
      },
    });

    assert.deepStrictEqual(calls, [{ method: 'GET', path: '/api/cache-status', body: undefined }]);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(typeof logs[0], 'string');
  });

  it('clears all cache groups in sequence for clear all', async () => {
    const calls = [];

    await run(['clear', 'all'], {
      requestJson: async (method, path, body) => {
        calls.push({ method, path, body });
        return { ok: true };
      },
      log: () => {},
      setExitCode: () => {
        throw new Error('setExitCode should not be called on valid command');
      },
    });

    assert.deepStrictEqual(calls, [
      { method: 'POST', path: '/api/cache/clear/hacalle', body: undefined },
      { method: 'POST', path: '/api/cache/clear/lookup', body: { all: true } },
      { method: 'POST', path: '/api/cache/clear/turns', body: { all: true } },
    ]);
  });

  it('returns usage exit code for invalid clear lookup command', async () => {
    const exitCodes = [];
    let usageCalled = 0;

    await run(['clear', 'lookup'], {
      requestJson: async () => {
        throw new Error('requestJson should not be called for invalid args');
      },
      usage: () => {
        usageCalled += 1;
      },
      log: () => {},
      setExitCode: code => exitCodes.push(code),
    });

    assert.strictEqual(usageCalled, 1);
    assert.deepStrictEqual(exitCodes, [1]);
  });
});
