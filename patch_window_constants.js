const fs = require('fs');
let code = fs.readFileSync('src/window.js', 'utf8');

code = code.replace(
/const HEADER_HEIGHT = 80;\nconst TABS_HEIGHT = 40;\nconst STATUS_BAR_HEIGHT = 28;/,
`const { HEADER_HEIGHT, TABS_HEIGHT, STATUS_BAR_HEIGHT } = require('./constants');`
);

fs.writeFileSync('src/window.js', code);
