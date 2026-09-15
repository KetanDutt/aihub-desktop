/**
 * The model catalogue: every service is listed, free ones included, and each
 * entry carries the shape an OpenAI client (and `curl`) expects.
 */

jest.mock(
  'electron',
  () => ({
    app: { getPath: () => require('os').tmpdir(), isPackaged: false, getVersion: () => '1.4.0' },
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

const engine = require('../src/api/engine');
const openai = require('../src/api/openai');
const dataStore = require('../src/data');
const adapterLoader = require('../src/api/adapters');

describe('GET /v1/models payload', () => {
  let models;

  beforeAll(async () => {
    const { adapters, defaultAdapter } = adapterLoader.loadAdapters({
      userDataDir: path.join(require('os').tmpdir(), 'aihub-models-test'),
      bundledDataDir: DATA_DIR
    });
    engine.setAdapters(adapters, defaultAdapter);
    await dataStore.loadServices({ force: true });
    models = engine.models();
  });

  it('lists every exposed service, not only the signed-in ones', () => {
    const services = engine.exposedServices();
    expect(models.length).toBeGreaterThan(services.length - 1);
    for (const service of services) {
      expect(models.some((model) => model.id === `aihub/${service.id}`)).toBe(true);
    }
  });

  it('publishes one entry per upstream model as well', () => {
    const perService = models.filter((model) => model.id.startsWith('aihub/chatgpt'));
    // The base id plus every model the ChatGPT adapter declares.
    expect(perService.length).toBeGreaterThan(1);
    expect(models.filter((model) => model.id.startsWith('aihub/gemini')).length).toBeGreaterThan(1);
  });

  it('uses the OpenAI model object shape plus a description', () => {
    for (const model of models) {
      expect(model.object).toBe('model');
      expect(typeof model.id).toBe('string');
      expect(typeof model.created).toBe('number');
      expect(typeof model.owned_by).toBe('string');
      expect(typeof model.description).toBe('string');
      expect(model.description.length).toBeGreaterThan(0);
    }
    expect(models.find((m) => m.id === 'aihub/gemini').owned_by).toBe('google');
    expect(models.find((m) => m.id === 'aihub/chatgpt').owned_by).toBe('openai');
    expect(models.find((m) => m.id === 'aihub/claude').owned_by).toBe('anthropic');
  });

  it('separates free services from sign-in ones', () => {
    const free = models.filter((model) => model.aihub.requiresLogin === false);
    const gated = models.filter((model) => model.aihub.requiresLogin === true);

    expect(free.length).toBeGreaterThan(0);
    expect(gated.length).toBeGreaterThan(0);
    expect(free.some((model) => model.aihub.service === 'perplexity')).toBe(true);
    expect(gated.some((model) => model.aihub.service === 'chatgpt')).toBe(true);

    // A free service is callable with no session at all; a gated one is not.
    for (const model of free) expect(model.aihub.ready).toBe(true);
    expect(free[0].description).toMatch(/no sign-in/i);
  });

  it('routes a bare upstream model name back to its service', () => {
    expect(openai.serviceIdFromModel('aihub/perplexity')).toBe('perplexity');
    expect(openai.serviceIdFromModel('gpt-5')).toBe('chatgpt');
    expect(openai.serviceIdFromModel('gemini-2.5-flash')).toBe('gemini');
    expect(openai.serviceIdFromModel('aihub/chatgpt:gpt-4o')).toBe('chatgpt');
    // Unknown names keep the old behaviour instead of guessing a service.
    expect(openai.serviceIdFromModel('aihub/nope')).toBe('nope');
  });

  it('resolves a requested model to an upstream name the service knows', () => {
    const adapters = adapterLoader.loadAdapters({
      userDataDir: path.join(require('os').tmpdir(), 'aihub-models-test'),
      bundledDataDir: DATA_DIR
    }).adapters;
    const chatgpt = adapters.get('chatgpt');
    expect(engine.resolveModel(chatgpt, 'aihub/chatgpt:gpt-4o')).toBe('gpt-4o');
    expect(engine.resolveModel(chatgpt, 'gpt-4o')).toBe('gpt-4o');
    expect(engine.resolveModel(chatgpt, 'aihub/chatgpt')).toBe(chatgpt.defaultModel);
  });

  it('tells the engine which services may be called anonymously', () => {
    expect(engine.serviceRequiresLogin('perplexity')).toBe(false);
    expect(engine.serviceRequiresLogin('chatgpt')).toBe(true);
    // Unknown ids fail safe: assume a sign-in is needed.
    expect(engine.serviceRequiresLogin('does-not-exist')).toBe(true);
  });

  it('reports the same split through the sessions extension', () => {
    const sessions = engine.sessions();
    expect(sessions.perplexity.requiresLogin).toBe(false);
    expect(sessions.perplexity.ready).toBe(true);
    expect(sessions.chatgpt.requiresLogin).toBe(true);
  });
});
