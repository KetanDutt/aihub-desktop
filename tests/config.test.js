
const mockStore = {
  get: jest.fn(),
  set: jest.fn(),
  store: {
    enabledServices: ['chatgpt'],
    blockingEnabled: true
  }
};

jest.mock('electron-store', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockStore)
  };
}, { virtual: true });

const configStore = require('../src/config');

describe('Config Store Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.store = {
      enabledServices: ['chatgpt'],
      blockingEnabled: true
    };
  });

  it('should get config correctly', () => {
    const config = configStore.getConfig();
    expect(config).toEqual(mockStore.store);
  });

  it('should update config item correctly', () => {
    configStore.updateConfigItem('darkMode', true);
    expect(mockStore.set).toHaveBeenCalledWith('darkMode', true);
  });

  it('should save config and remove duplicates from enabledServices', () => {
    const newConfig = { enabledServices: ['chatgpt', 'claude', 'chatgpt'] };
    configStore.saveConfig(newConfig);

    expect(mockStore.set).toHaveBeenCalledWith({
      enabledServices: ['chatgpt', 'claude']
    });
  });

  it('should toggle service correctly (add service)', () => {
    mockStore.get.mockReturnValue(['chatgpt']);

    const result = configStore.toggleService('claude');

    expect(mockStore.set).toHaveBeenCalledWith('enabledServices', ['chatgpt', 'claude']);
    expect(result).toEqual(['chatgpt', 'claude']);
  });

  it('should toggle service correctly (remove service)', () => {
    mockStore.get.mockReturnValue(['chatgpt', 'claude']);

    const result = configStore.toggleService('chatgpt');

    expect(mockStore.set).toHaveBeenCalledWith('enabledServices', ['claude']);
    expect(result).toEqual(['claude']);
  });
});
