const fs = require('fs');
let code = fs.readFileSync('ui/renderer.js', 'utf8');

// There are a few unhandled non-await IPC calls:
// window.electronAPI.setActiveService(serviceId);
// window.electronAPI.switchTab(id);
// window.electronAPI.closeTab(id);

code = code.replace(
    /window\.electronAPI\.setActiveService\(serviceId\);/g,
    "try { window.electronAPI.setActiveService(serviceId); } catch(err) { console.error(err); }"
);

code = code.replace(
    /window\.electronAPI\.switchTab\(id\);/g,
    "try { window.electronAPI.switchTab(id); } catch(err) { console.error(err); }"
);

code = code.replace(
    /window\.electronAPI\.closeTab\(id\);/g,
    "try { window.electronAPI.closeTab(id); } catch(err) { console.error(err); }"
);

fs.writeFileSync('ui/renderer.js', code);
