const fs = require('fs');

let code = fs.readFileSync('ui/renderer.js', 'utf8');

// Replace tab creation logic to include drag and drop and a loading spinner
const oldTabHtml = `    tab.innerHTML = \`
    <span class="tab-title">\${title}</span>
    <button class="btn-close-tab">✕</button>
    \`;`;

const newTabHtml = `    tab.setAttribute('draggable', 'true');
    tab.innerHTML = \`
    <img class="tab-favicon" src="https://\${new URL(url).hostname}/favicon.ico" onerror="this.style.display='none'">
    <span class="tab-title">\${title}</span>
    <span class="tab-loading spin hidden">⏳</span>
    <button class="btn-close-tab">✕</button>
    \`;

    // Simple Drag and Drop
    tab.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', serviceId);
        e.currentTarget.classList.add('dragging');
    });
    tab.addEventListener('dragend', (e) => {
        e.currentTarget.classList.remove('dragging');
    });
    tab.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = document.querySelector('.dragging');
        if (dragging && dragging !== tab) {
            const list = elements.tabsList;
            const children = Array.from(list.children);
            if (children.indexOf(dragging) < children.indexOf(tab)) {
                tab.after(dragging);
            } else {
                tab.before(dragging);
            }
        }
    });
    tab.addEventListener('drop', (e) => {
        e.preventDefault();
        // Update activeTabs array based on DOM order
        const newOrderIds = Array.from(elements.tabsList.children).map(el => el.dataset.id);
        activeTabs.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
    });`;

code = code.replace(oldTabHtml, newTabHtml);

fs.writeFileSync('ui/renderer.js', code);

let cssCode = fs.readFileSync('ui/styles.css', 'utf8');
cssCode += `
.tab-favicon { width: 14px; height: 14px; border-radius: 2px; }
.tab-loading { font-size: 10px; }
.tab-item.dragging { opacity: 0.5; }
`;
fs.writeFileSync('ui/styles.css', cssCode);
