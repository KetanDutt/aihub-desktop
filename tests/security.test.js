
jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        getName: jest.fn().mockReturnValue('aihub-desktop'),
        getVersion: jest.fn().mockReturnValue('1.1.0'),
        requestSingleInstanceLock: jest.fn().mockReturnValue(true),
        on: jest.fn(),
        quit: jest.fn(),
        whenReady: jest.fn().mockReturnValue({
            then: jest.fn().mockReturnValue({ catch: jest.fn() }),
            catch: jest.fn()
        }),
        setAsDefaultProtocolClient: jest.fn(),
        setLoginItemSettings: jest.fn()
    },
    session: {
        defaultSession: {
            webRequest: {
                onBeforeRequest: jest.fn()
            }
        }
    },
    dialog: {
        showErrorBox: jest.fn()
    },
    ipcMain: {
        handle: jest.fn(),
        on: jest.fn()
    }
}), { virtual: true });

jest.mock('electron-reload', () => jest.fn(), { virtual: true });

jest.mock('electron-log', () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    transports: {
        console: { level: 'debug' },
        file: { level: 'debug' }
    }
}), { virtual: true });

jest.mock('electron-store', () => {
    return jest.fn().mockImplementation(() => ({
        get: jest.fn(),
        set: jest.fn(),
        store: {}
    }));
}, { virtual: true });

// Mock other internal modules to prevent them from trying to load electron
jest.mock('../src/data', () => ({
    loadRules: jest.fn(),
    loadServices: jest.fn(),
    updateRemoteData: jest.fn(),
    getRulesCache: jest.fn()
}));
jest.mock('../src/window', () => ({
    getMainWindow: jest.fn(),
    createMainWindow: jest.fn(),
    setupTray: jest.fn(),
    setupGlobalShortcuts: jest.fn()
}));
jest.mock('../src/blocking', () => ({
    updateBlockingState: jest.fn(),
    setupWebRequestBlocking: jest.fn()
}));
jest.mock('../src/ipc', () => ({
    setupIpcHandlers: jest.fn()
}));
jest.mock('../src/updater', () => ({
    setupAutoUpdater: jest.fn()
}));

const { validateServiceId } = require('../main');
const configStore = require('../src/config');

describe('Security Validation', () => {
    test('validateServiceId should allow valid alphanumeric service IDs', () => {
        expect(validateServiceId('chatgpt')).toBe(true);
        expect(validateServiceId('claude3')).toBe(true);
        expect(validateServiceId('gemini15pro')).toBe(true);
    });

    test('validateServiceId should reject IDs with special characters', () => {
        expect(validateServiceId('chat-gpt')).toBe(false);
        expect(validateServiceId('chat_gpt')).toBe(false);
        expect(validateServiceId('chat.gpt')).toBe(false);
        expect(validateServiceId('chatgpt;inject')).toBe(false);
        expect(validateServiceId('chatgpt<script>')).toBe(false);
        expect(validateServiceId('chatgpt"')).toBe(false);
    });

    test('validateServiceId should reject empty or null IDs', () => {
        expect(validateServiceId('')).toBeFalsy();
        expect(validateServiceId(null)).toBeFalsy();
        expect(validateServiceId(undefined)).toBeFalsy();
    });

    test('saveConfig should reject invalid proxy URLs when proxy is enabled', () => {
        const invalidConfigs = [
            { useProxy: true, proxyUrl: 'javascript:alert(1)' },
            { useProxy: true, proxyUrl: 'file:///etc/passwd' },
            { useProxy: true, proxyUrl: 'not-a-url' },
            { useProxy: true, proxyUrl: 'ftp://proxy.com' }
        ];

        invalidConfigs.forEach(config => {
            expect(() => configStore.saveConfig(config)).toThrow('Invalid proxy URL or protocol');
        });
    });

    test('saveConfig should allow valid proxy URLs when proxy is enabled', () => {
        const validConfigs = [
            { useProxy: true, proxyUrl: 'http://proxy.com' },
            { useProxy: true, proxyUrl: 'https://proxy.com/path?query=1' }
        ];

        validConfigs.forEach(config => {
            expect(() => configStore.saveConfig(config)).not.toThrow();
        });
    });

    test('saveConfig should ignore invalid proxy URLs if proxy is disabled', () => {
        const config = { useProxy: false, proxyUrl: 'javascript:alert(1)' };
        expect(() => configStore.saveConfig(config)).not.toThrow();
    });
});
