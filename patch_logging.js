const fs = require('fs');

let mainCode = fs.readFileSync('main.js', 'utf8');

const logSetup = `
// Configure logging
const log = require('electron-log');
if (app.isPackaged) {
    log.transports.console.level = false;
    log.transports.file.level = 'info';
} else {
    log.transports.console.level = 'debug';
    log.transports.file.level = 'debug';
}
`;

mainCode = mainCode.replace(/const log = require\('electron-log'\);/, logSetup);
fs.writeFileSync('main.js', mainCode);
