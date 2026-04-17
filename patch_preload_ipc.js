const fs = require('fs');

let preload = fs.readFileSync('preload.js', 'utf8');
preload = preload.replace(/,\n\s*setViewBounds: \(bounds\) => ipcRenderer\.send\('set-view-bounds', bounds\)/, '');
fs.writeFileSync('preload.js', preload);

let ipc = fs.readFileSync('src/ipc.js', 'utf8');
ipc = ipc.replace(/\s*ipcMain\.on\('set-view-bounds', \(event, bounds\) => \{[\s\S]*?\}\);/, '');
fs.writeFileSync('src/ipc.js', ipc);
