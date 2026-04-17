const fs = require('fs');

let code = fs.readFileSync('ui/renderer.js', 'utf8');

const oldRenderEnabled = `      elements.servicesList.appendChild(card);
    });
  };`;

const newRenderEnabled = `      elements.servicesList.appendChild(card);
    });

    // Populate quick start grid on welcome screen
    const quickStartGrid = document.getElementById('quick-start-services');
    if (quickStartGrid) {
        quickStartGrid.innerHTML = '';
        enabledServices.forEach(service => {
            const [name, url, type, privacy, color] = service;
            const id = generateId(name);
            const item = document.createElement('div');
            item.className = 'quick-start-item';
            item.textContent = name;
            item.style.borderLeft = \`4px solid \${color ? '#' + color : '#4285f4'}\`;
            item.addEventListener('click', () => {
                createTab(id, url, name);
            });
            quickStartGrid.appendChild(item);
        });
    }
  };`;

code = code.replace(oldRenderEnabled, newRenderEnabled);
fs.writeFileSync('ui/renderer.js', code);
