const fs = require('fs');
let code = fs.readFileSync('ui/renderer.js', 'utf8');

code = code.replace(/const updateViewBounds = \(\) => \{[\s\S]*?\};\n\n/, '');
code = code.replace(/updateViewBounds\(\);\n/g, '');
code = code.replace(/window\.addEventListener\('resize', updateViewBounds\);\n/g, '');

fs.writeFileSync('ui/renderer.js', code);
