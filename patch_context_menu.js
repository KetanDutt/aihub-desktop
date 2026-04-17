const fs = require('fs');

let windowCode = fs.readFileSync('src/window.js', 'utf8');

const contextMenuCode = `
    view.webContents.on('context-menu', (event, params) => {
        const { Menu } = require('electron');
        const menu = Menu.buildFromTemplate([
            { role: 'copy' },
            { role: 'paste' },
            { type: 'separator' },
            { label: 'Reload', click: () => view.webContents.reload() },
            { type: 'separator' },
            { role: 'toggleDevTools' }
        ]);
        menu.popup();
    });
`;

windowCode = windowCode.replace(
/view\.webContents\.loadURL\(url\);/,
`view.webContents.loadURL(url);\n${contextMenuCode}`
);

fs.writeFileSync('src/window.js', windowCode);
