const fs = require('fs');

// Fix window.js properly
let windowCode = fs.readFileSync('src/window.js', 'utf8');
windowCode = windowCode.replace(/navReload,\n  \};\nfunction navGoBack/, 'navReload\n};\nfunction navGoBack');
fs.writeFileSync('src/window.js', windowCode);
