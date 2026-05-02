
jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        requestSingleInstanceLock: jest.fn().mockReturnValue(true),
        on: jest.fn(),
        quit: jest.fn(),
        whenReady: jest.fn().mockReturnValue({ then: jest.fn() }),
        setAsDefaultProtocolClient: jest.fn()
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
});
