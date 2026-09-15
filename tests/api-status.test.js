/**
 * The payload the Settings ▸ Local API panel renders (`get-api-status`):
 * counts, per-model metadata and the free/sign-in split.
 */

jest.mock(
  'electron',
  () => ({
    app: { getPath: () => require('os').tmpdir(), isPackaged: false, getVersion: () => '1.5.0' },
    session: { defaultSession: { webRequest: { onBeforeRequest: jest.fn() } } },
    BrowserWindow: class HiddenWindow {},
    ipcMain: { handle: jest.fn(), on: jest.fn() },
    webContents: { getAllWebContents: () => [] }
  }),
  { virtual: true }
);

const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
process.env.AIHUB_BUNDLED_DIR = DATA_DIR;

const localApi = require('../src/api');
const dataStore = require('../src/data');

describe('get-api-status payload', () => {
  let status;

  beforeAll(async () => {
    localApi.loadAdapters();
    await dataStore.loadServices({ force: true });
    status = localApi.describe();
  });

  it('reports the endpoint and a usable key', () => {
    expect(status.enabled).toBe(true);
    expect(typeof status.baseUrl).toBe('string');
    expect(status.baseUrl).toContain('/v1');
    // A key is minted when none exists, and only ever leaves main masked here.
    expect(status.key).toMatch(/^aihub-[0-9a-f]{40}$/);
    expect(status.keyMasked).not.toBe(status.key);
  });

  it('counts models, ready models and free models', () => {
    expect(status.modelCount).toBeGreaterThan(1);
    expect(status.freeModelCount).toBeGreaterThan(0);
    expect(status.freeServiceCount).toBeGreaterThan(0);
    expect(status.readyModelCount).toBeGreaterThanOrEqual(status.freeModelCount);
    expect(status.models).toHaveLength(status.modelCount);
  });

  it('gives the panel everything it renders per model', () => {
    for (const model of status.models) {
      expect(typeof model.id).toBe('string');
      expect(typeof model.description).toBe('string');
      expect(typeof model.owned_by).toBe('string');
      expect(typeof model.requiresLogin).toBe('boolean');
      expect(typeof model.ready).toBe('boolean');
      expect(typeof model.service).toBe('string');
    }
  });

  it('marks the free models ready even with no session anywhere', () => {
    const free = status.models.filter((model) => model.requiresLogin === false);
    expect(free.length).toBeGreaterThan(0);
    for (const model of free) expect(model.ready).toBe(true);
  });

  it('points the copyable curl example at a callable model', () => {
    const example = localApi.curlExample(status.baseUrl, (status.models.find((m) => m.ready) || {}).id);
    expect(example).toContain(status.baseUrl);
    expect(example).toContain('messages');
    expect(example).not.toContain('undefined');
  });
});
