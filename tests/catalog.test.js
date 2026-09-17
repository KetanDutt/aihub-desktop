/**
 * Menu catalogue: the generated data must stay consistent with services.json,
 * and the loader must degrade safely when the file is missing or hostile.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { slugify } = require('../src/utils');

const DATA = path.join(__dirname, '..', 'data');
const catalogPath = path.join(DATA, 'catalog.json');

function freshCatalog() {
  jest.resetModules();
  // eslint-disable-next-line global-require
  return require('../src/catalog');
}

describe('bundled catalog.json', () => {
  const payload = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const services = JSON.parse(fs.readFileSync(path.join(DATA, 'services.json'), 'utf8')).ai_services;
  const serviceIds = services.map((entry) => slugify(Array.isArray(entry) ? entry[0] : entry.name));

  it('covers every catalogue service exactly once', () => {
    const ids = payload.services.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([...serviceIds].sort());
  });

  it('gives every service a usable homepage and an icon on disk', () => {
    for (const entry of payload.services) {
      expect(entry.homepage).toMatch(/^https:\/\//);
      expect(entry.icon).toMatch(/^assets\/icons\//);
      expect(fs.existsSync(path.join(__dirname, '..', entry.icon))).toBe(true);
    }
  });

  it('records a login URL for every service that requires a sign-in', () => {
    for (const entry of payload.services.filter((service) => service.requiresLogin)) {
      expect(typeof entry.loginUrl).toBe('string');
      expect(entry.loginUrl).toMatch(/^https:\/\//);
    }
  });

  it('agrees with services.json about who needs an account', () => {
    const byId = new Map(payload.services.map((entry) => [entry.id, entry]));
    for (const raw of services) {
      const [name, , , , , requiresLogin] = raw;
      expect(byId.get(slugify(name)).requiresLogin).toBe(requiresLogin !== false);
    }
  });
});

describe('catalog loader', () => {
  const originalCatalog = process.env.AIHUB_CATALOG_FILE;
  const originalIcons = process.env.AIHUB_ICON_DIR;

  afterEach(() => {
    if (originalCatalog === undefined) delete process.env.AIHUB_CATALOG_FILE;
    else process.env.AIHUB_CATALOG_FILE = originalCatalog;
    if (originalIcons === undefined) delete process.env.AIHUB_ICON_DIR;
    else process.env.AIHUB_ICON_DIR = originalIcons;
  });

  it('exposes details and a data-URL icon for a known service', () => {
    delete process.env.AIHUB_CATALOG_FILE;
    delete process.env.AIHUB_ICON_DIR;
    const catalog = freshCatalog();

    const details = catalog.detailsFor('chatgpt');
    expect(details.homepage).toMatch(/^https:\/\/chatgpt\.com/);
    expect(details.requiresLogin).toBe(true);
    expect(details.icon).toMatch(/^data:image\//);
    expect(details.authDomains).toContain('chatgpt.com');
  });

  it('returns null for unknown services instead of throwing', () => {
    const catalog = freshCatalog();
    expect(catalog.detailsFor('does-not-exist')).toBeNull();
    expect(catalog.detailsFor(null)).toBeNull();
    expect(catalog.iconDataUrl('does-not-exist')).toBeNull();
  });

  it('survives a missing catalogue file', () => {
    process.env.AIHUB_CATALOG_FILE = path.join(os.tmpdir(), 'aihub-missing-catalog.json');
    const catalog = freshCatalog();
    expect(catalog.load()).toBeNull();
    expect(catalog.status()).toMatchObject({ available: false, serviceCount: 0 });
    expect(catalog.detailsFor('chatgpt')).toBeNull();
  });

  it('survives a corrupt catalogue file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-cat-')), 'catalog.json');
    fs.writeFileSync(file, '{ not json', 'utf8');
    process.env.AIHUB_CATALOG_FILE = file;
    const catalog = freshCatalog();
    expect(catalog.load()).toBeNull();
  });

  it('never reads an icon outside the icon directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aihub-cat-'));
    const file = path.join(dir, 'catalog.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        services: [{ id: 'evil', name: 'Evil', homepage: 'https://e.test/', icon: '../../../etc/passwd' }]
      }),
      'utf8'
    );
    process.env.AIHUB_CATALOG_FILE = file;
    process.env.AIHUB_ICON_DIR = dir;

    const catalog = freshCatalog();
    // Traversal is stripped and the resulting path has no image extension.
    expect(catalog.iconDataUrl('evil')).toBeNull();
  });

  it('enriches a services list and leaves unknown entries intact', () => {
    delete process.env.AIHUB_CATALOG_FILE;
    delete process.env.AIHUB_ICON_DIR;
    const catalog = freshCatalog();

    const [known, unknown] = catalog.enrich([
      { id: 'claude', name: 'Claude', url: 'https://claude.ai/' },
      { id: 'mystery', name: 'Mystery', url: 'https://mystery.test/' }
    ]);

    expect(known.homepage).toBe('https://claude.ai/new');
    expect(known.icon).toMatch(/^data:image\//);
    expect(unknown.homepage).toBe('https://mystery.test/');
    expect(unknown.icon).toBeNull();
  });
});
