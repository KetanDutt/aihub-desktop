const fs = require('fs');

// Fix window.js syntax error
let windowCode = fs.readFileSync('src/window.js', 'utf8');
windowCode = windowCode.replace(/navReload,\n  \};\n\}\n\n\nfunction navGoBack/m, 'navReload\n};\n\nfunction navGoBack');
fs.writeFileSync('src/window.js', windowCode);

// Fix updater.js syntax error
let updaterCode = fs.readFileSync('src/updater.js', 'utf8');
updaterCode = updaterCode.replace(/\}\);\n    \n    \n    \/\/ We can wrap/, '});\n\n    // We can wrap');
// remove trailing unexpected token issue if there
if (updaterCode.includes('try {\n        autoUpdater.checkForUpdatesAndNotify();\n    } catch (e) {\n        log.error(\'Failed to check for updates: \' + e);\n    }\n}\n\nmodule.exports = {\n    setupAutoUpdater\n};\n)')) {
    updaterCode = updaterCode.replace(/\);\n$/, '');
}
fs.writeFileSync('src/updater.js', updaterCode);

// Update eslintrc to include jest env and browser globals
const eslintrc = {
  "env": {
    "browser": true,
    "commonjs": true,
    "es2021": true,
    "node": true,
    "jest": true
  },
  "extends": "eslint:recommended",
  "parserOptions": {
    "ecmaVersion": 12
  },
  "rules": {
    "no-unused-vars": "warn",
    "no-undef": "warn",
    "no-regex-spaces": "off",
    "no-empty": "off"
  },
  "globals": {
    "showStatus": "readonly",
    "formatDate": "readonly",
    "generateId": "readonly"
  }
};
fs.writeFileSync('.eslintrc.json', JSON.stringify(eslintrc, null, 2));
