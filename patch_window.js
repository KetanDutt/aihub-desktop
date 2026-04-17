const fs = require('fs');
let code = fs.readFileSync('src/window.js', 'utf8');

const constantsObj = `const HEADER_HEIGHT = 80;
const TABS_HEIGHT = 40;
const STATUS_BAR_HEIGHT = 28;`;

code = code.replace(/const log = require\('electron-log'\);/, `const log = require('electron-log');\n\n${constantsObj}`);

const calculateBoundsFunc = `
function calculateViewBounds() {
    if (!mainWindow) return { x: 0, y: 0, width: 0, height: 0 };
    const [windowWidth, windowHeight] = mainWindow.getContentSize();
    return {
        x: 0,
        y: HEADER_HEIGHT + TABS_HEIGHT,
        width: windowWidth,
        height: windowHeight - (HEADER_HEIGHT + TABS_HEIGHT + STATUS_BAR_HEIGHT)
    };
}

function applyViewBounds() {
    if (!mainWindow) return;
    const bounds = calculateViewBounds();
    for (const view of Object.values(views)) {
        view.setBounds(bounds);
    }
}
`;

code = code.replace(/function updateViewsBounds\(\) \{[\s\S]*?\}/, calculateBoundsFunc);

code = code.replace(/updateViewsBounds/g, 'applyViewBounds');

code = code.replace(/function setViewBounds\(bounds\) \{[\s\S]*?\}/, '');

code = code.replace(/setViewBounds\n/, '');
code = code.replace(/setViewBounds,\n/, '');
code = code.replace(/,\n\s*setViewBounds\n/, '\n');

fs.writeFileSync('src/window.js', code);
