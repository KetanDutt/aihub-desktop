/**
 * Settings export / import.
 *
 * The export is a document the user can move between machines, so two things
 * matter: it must never carry secrets or machine-specific state, and anything
 * read back in must be treated as untrusted input.
 */

jest.mock(
  'electron-log',
  () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  { virtual: true }
);

// In-memory stand-in for electron-store.
const state = {};
jest.mock(
  'electron-store',
  () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(({ defaults } = {}) => {
      Object.assign(state, defaults || {});
      return {
        get: (key, fallback) => (state[key] !== undefined ? state[key] : fallback),
        set: (keyOrObject, value) => {
          if (typeof keyOrObject === 'object') Object.assign(state, keyOrObject);
          else state[keyOrObject] = value;
        },
        get store() {
          return { ...state };
        }
      };
    })
  }),
  { virtual: true }
);

const configStore = require('../src/config');

describe('exportSettings', () => {
  it('includes user preferences', () => {
    configStore.updateConfigItem('maxActiveServices', 5);
    configStore.updateConfigItem('enabledServices', ['chatgpt', 'claude']);

    const payload = configStore.exportSettings();
    expect(payload.schemaVersion).toBe(1);
    expect(typeof payload.exportedAt).toBe('string');
    expect(payload.settings.maxActiveServices).toBe(5);
    expect(payload.settings.enabledServices).toEqual(['chatgpt', 'claude']);
  });

  it('never exports the API token or machine-specific state', () => {
    configStore.updateConfigItem('apiToken', 'aihub-supersecret');
    configStore.updateConfigItem('openTabs', [{ id: 'chatgpt-1', serviceId: 'chatgpt' }]);
    configStore.updateConfigItem('sessionStates', { chatgpt: { state: 'logged-in' } });

    const { settings } = configStore.exportSettings();
    expect(settings.apiToken).toBeUndefined();
    expect(settings.openTabs).toBeUndefined();
    expect(settings.sessionStates).toBeUndefined();
    expect(settings.activeTabId).toBeUndefined();

    // Belt and braces: the secret must not appear anywhere in the document.
    expect(JSON.stringify(configStore.exportSettings())).not.toContain('supersecret');
  });
});

describe('importSettings', () => {
  it('round-trips an exported document', () => {
    configStore.updateConfigItem('maxActiveServices', 7);
    configStore.updateConfigItem('darkMode', false);
    const exported = configStore.exportSettings();

    configStore.updateConfigItem('maxActiveServices', 2);
    configStore.updateConfigItem('darkMode', true);

    const result = configStore.importSettings(exported);
    expect(result.applied).toEqual(expect.arrayContaining(['maxActiveServices', 'darkMode']));
    expect(configStore.getConfigItem('maxActiveServices')).toBe(7);
    expect(configStore.getConfigItem('darkMode')).toBe(false);
  });

  it('accepts a bare settings object as well as the wrapped document', () => {
    configStore.importSettings({ maxActiveServices: 4 });
    expect(configStore.getConfigItem('maxActiveServices')).toBe(4);
  });

  it('clamps out-of-range values instead of storing them', () => {
    configStore.importSettings({ settings: { maxActiveServices: 9999 } });
    expect(configStore.getConfigItem('maxActiveServices')).toBeLessThanOrEqual(20);
  });

  it('ignores non-writable keys, so a file cannot inject a token', () => {
    configStore.updateConfigItem('apiToken', 'aihub-original');
    const result = configStore.importSettings({
      settings: { maxActiveServices: 3, apiToken: 'aihub-attacker', sessionStates: { x: 1 } }
    });

    expect(result.applied).not.toContain('apiToken');
    expect(result.applied).not.toContain('sessionStates');
    expect(configStore.getConfigItem('apiToken')).toBe('aihub-original');
  });

  it('rejects malformed payloads', () => {
    expect(() => configStore.importSettings(null)).toThrow(/Invalid settings file/);
    expect(() => configStore.importSettings([1, 2, 3])).toThrow(/Invalid settings file/);
    expect(() => configStore.importSettings({ settings: {} })).toThrow(/No recognised settings/);
    expect(() => configStore.importSettings({ nothing: 'useful' })).toThrow(/No recognised settings/);
  });

  it('rejects a payload that would enable a bogus proxy', () => {
    expect(() =>
      configStore.importSettings({ settings: { useProxy: true, proxyUrl: 'javascript:alert(1)' } })
    ).toThrow();
  });
});
