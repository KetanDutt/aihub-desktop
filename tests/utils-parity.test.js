/**
 * The main process and the renderer each carry a tiny copy of a few pure
 * helpers (they run in separate JS realms). These tests pin them together.
 */

jest.mock('electron-log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}), { virtual: true });

const mainUtils = require('../src/utils');
const rendererUtils = require('../ui/utils');

describe('slug parity between main and renderer', () => {
  const samples = [
    'ChatGPT',
    'Claude',
    'Gemini',
    'Meta AI',
    'Mistral Le Chat',
    '  spaced  out  ',
    'Ünicode Service',
    'service-99',
    '',
    '   '
  ];

  it('generateId matches slugify for every sample', () => {
    for (const sample of samples) {
      expect(rendererUtils.generateId(sample)).toBe(mainUtils.slugify(sample));
    }
  });
});

describe('normalizeHostname', () => {
  it('lowercases, strips ports and trailing dots', () => {
    expect(mainUtils.normalizeHostname('CDN.OpenAI.COM')).toBe('cdn.openai.com');
    expect(mainUtils.normalizeHostname('example.com.')).toBe('example.com');
    expect(mainUtils.normalizeHostname('example.com:8443')).toBe('example.com');
    expect(mainUtils.normalizeHostname('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(mainUtils.normalizeHostname('')).toBe('');
    expect(mainUtils.normalizeHostname(null)).toBe('');
  });
});

describe('clamp / boolean coercion', () => {
  it('clamps numbers with a fallback', () => {
    expect(mainUtils.clampNumber('7', 1, 5, 3)).toBe(5);
    expect(mainUtils.clampNumber(-2, 1, 5, 3)).toBe(1);
    expect(mainUtils.clampNumber('nope', 1, 5, 3)).toBe(3);
  });

  it('coerces booleans', () => {
    expect(mainUtils.toBoolean('true')).toBe(true);
    expect(mainUtils.toBoolean('false', true)).toBe(false);
    expect(mainUtils.toBoolean(undefined, true)).toBe(true);
  });
});

describe('renderer helpers', () => {
  it('initials builds short labels', () => {
    expect(rendererUtils.initials('ChatGPT')).toBe('C');
    expect(rendererUtils.initials('Meta AI')).toBe('MA');
    expect(rendererUtils.initials('')).toBe('?');
  });

  it('debounce collapses rapid calls', () => {
    jest.useFakeTimers();
    const spy = jest.fn();
    const debounced = rendererUtils.debounce(spy, 100);
    debounced(1);
    debounced(2);
    debounced(3);
    jest.advanceTimersByTime(150);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(3);
    jest.useRealTimers();
  });
});

describe('favicon originOf', () => {
  const favicon = require('../src/favicon');

  it('extracts a stable origin', () => {
    expect(favicon.originOf('https://chatgpt.com/c/123')).toBe('https://chatgpt.com');
    expect(favicon.originOf('http://a.example:8080/x')).toBe('http://a.example:8080');
    expect(favicon.originOf('not a url')).toBeNull();
    expect(favicon.originOf('file:///x')).toBeNull();
  });
});
