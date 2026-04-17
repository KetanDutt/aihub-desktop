const fs = require('fs');

let cssCode = fs.readFileSync('ui/styles.css', 'utf8');
cssCode = cssCode.replace(
/body \{[\s\S]*?\}/,
`body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background-color 0.3s, color 0.3s;
}`
);

cssCode = cssCode.replace(
/\.app-container \{[\s\S]*?\}/,
`.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  transition: background-color 0.3s, color 0.3s;
}`
);

fs.writeFileSync('ui/styles.css', cssCode);

// Delete deprecated service.html
if (fs.existsSync('ui/service.html')) {
    fs.unlinkSync('ui/service.html');
}
