const fs = require('fs');

// Patch main.js
let mainCode = fs.readFileSync('main.js', 'utf8');
if (!mainCode.includes('globalShortcut.unregisterAll()')) {
    mainCode = mainCode.replace(
        /app\.on\('will-quit', \(\) => \{/,
        "app.on('will-quit', () => {\n    const { globalShortcut } = require('electron');\n    globalShortcut.unregisterAll();"
    );
    fs.writeFileSync('main.js', mainCode);
}

// Patch window.js tray fallback
let windowCode = fs.readFileSync('src/window.js', 'utf8');
windowCode = windowCode.replace(
    /const iconPath = path\.join\(__dirname, '\.\.', 'ui', 'favicon\.png'\);\n\s*tray = new Tray\(iconPath\);/,
    `const { nativeImage } = require('electron');
    const iconPath = path.join(__dirname, '..', 'ui', 'favicon.png');
    let trayIcon;
    try {
        if (require('fs').existsSync(iconPath)) {
            trayIcon = nativeImage.createFromPath(iconPath);
        } else {
            trayIcon = nativeImage.createEmpty();
            console.warn('Tray icon not found, using empty fallback');
        }
    } catch (e) {
        trayIcon = nativeImage.createEmpty();
    }
    tray = new Tray(trayIcon);`
);
fs.writeFileSync('src/window.js', windowCode);
