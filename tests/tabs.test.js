/**
 * TabManager is pure state logic (no Electron), so it can be tested directly.
 */

const { TabManager } = require('../src/tabs');

describe('TabManager', () => {
  it('enforces the concurrent tab limit', () => {
    const manager = new TabManager({ limit: 2 });
    expect(manager.add({ id: 'a', serviceId: 'chatgpt', url: 'https://a.com' }).ok).toBe(true);
    expect(manager.add({ id: 'b', serviceId: 'claude', url: 'https://b.com' }).ok).toBe(true);
    const third = manager.add({ id: 'c', serviceId: 'gemini', url: 'https://c.com' });
    expect(third.ok).toBe(false);
    expect(third.error).toBe('limit_reached');
  });

  it('rejects duplicate ids and invalid input', () => {
    const manager = new TabManager();
    expect(manager.add({ id: 'a', serviceId: 's', url: 'https://a.com' }).ok).toBe(true);
    expect(manager.add({ id: 'a', serviceId: 's', url: 'https://a.com' }).error).toBe('duplicate');
    expect(manager.add({ id: 'x' }).error).toBeDefined();
    expect(manager.add({ id: 'x', serviceId: 's' }).error).toBe('invalid_url');
  });

  it('clamps the limit to safe bounds', () => {
    const manager = new TabManager({ limit: 999 });
    expect(manager.getLimit()).toBe(20);
    const low = new TabManager({ limit: 0 });
    expect(low.getLimit()).toBe(1);
  });

  it('activates and tracks the active tab', () => {
    const manager = new TabManager();
    manager.add({ id: 'a', serviceId: 's', url: 'https://a.com' });
    manager.add({ id: 'b', serviceId: 's', url: 'https://b.com' });
    manager.activate('a');
    expect(manager.activeTabId).toBe('a');
    manager.activate('b');
    expect(manager.activeTabId).toBe('b');
    expect(manager.activate('missing')).toBeNull();
  });

  it('picks a sensible neighbour when the active tab closes', () => {
    const manager = new TabManager();
    ['a', 'b', 'c'].forEach((id) => manager.add({ id, serviceId: 's', url: `https://${id}.com` }));
    manager.activate('b');
    manager.remove('b');
    // The tab that slid into b's slot is 'c'.
    expect(manager.activeTabId).toBe('c');

    // Closing the last tab falls back to the previous one.
    manager.activate('c');
    manager.remove('c');
    expect(manager.activeTabId).toBe('a');

    manager.remove('a');
    expect(manager.activeTabId).toBeNull();
  });

  it('preserves and repairs ordering', () => {
    const manager = new TabManager();
    ['a', 'b', 'c'].forEach((id) => manager.add({ id, serviceId: 's', url: `https://${id}.com` }));
    manager.reorder(['c', 'a']); // 'b' was omitted -> appended at the end
    expect(manager.order).toEqual(['c', 'a', 'b']);
    manager.reorder(['b', 'a', 'c', 'ghost']); // unknown ids dropped
    expect(manager.order).toEqual(['b', 'a', 'c']);
  });

  it('cycles through tabs', () => {
    const manager = new TabManager();
    ['a', 'b', 'c'].forEach((id) => manager.add({ id, serviceId: 's', url: `https://${id}.com` }));
    manager.activate('a');
    expect(manager.cycle(1).id).toBe('b');
    expect(manager.cycle(1).id).toBe('c');
    expect(manager.cycle(1).id).toBe('a');
    expect(manager.cycle(-1).id).toBe('c');
  });

  it('marks hibernation candidates by idle time', () => {
    const manager = new TabManager();
    const now = 1_000_000;
    manager.add({ id: 'idle', serviceId: 's', url: 'https://idle.com' });
    manager.add({ id: 'fresh', serviceId: 's', url: 'https://fresh.com' });
    manager.add({ id: 'active', serviceId: 's', url: 'https://active.com' });
    manager.activate('active');

    // Make 'idle' look old.
    manager.get('idle').lastActiveAt = now - 30 * 60 * 1000;
    manager.get('fresh').lastActiveAt = now - 60 * 1000;

    const candidates = manager.hibernationCandidates(now, 15 * 60 * 1000).map((t) => t.id);
    expect(candidates).toEqual(['idle']); // 'fresh' too new, 'active' excluded
  });

  it('serialises tabs for persistence in strip order', () => {
    const manager = new TabManager();
    manager.add({ id: 'a', serviceId: 'sa', url: 'https://a.com', title: 'A' });
    manager.add({ id: 'b', serviceId: 'sb', url: 'https://b.com', title: 'B' });
    manager.reorder(['b', 'a']);
    expect(manager.toJSON()).toEqual([
      { id: 'b', serviceId: 'sb', url: 'https://b.com', title: 'B' },
      { id: 'a', serviceId: 'sa', url: 'https://a.com', title: 'A' }
    ]);
  });
});
