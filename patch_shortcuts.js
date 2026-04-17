const fs = require('fs');

let code = fs.readFileSync('ui/renderer.js', 'utf8');

const switchToNextTabImpl = `  const switchToNextTab = (direction) => {
    if (activeTabs.length < 2) return;
    const currentIndex = activeTabs.findIndex(t => t.id === currentTabId);
    let nextIndex = currentIndex + direction;
    if (nextIndex >= activeTabs.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = activeTabs.length - 1;
    switchToTab(activeTabs[nextIndex].id);
  };
`;

code = code.replace(/const switchToTab =/, `${switchToNextTabImpl}\n  const switchToTab =`);

const newShortcuts = `  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Tab switching
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      switchToNextTab(e.shiftKey ? -1 : 1);
      return;
    }

    // Close current tab
    if (e.ctrlKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (currentTabId) closeTab(currentTabId);
      return;
    }

    // Open sidebar
    if (e.ctrlKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      elements.sidebar.classList.remove('hidden');
      return;
    }

    // Close sidebar with Escape
    if (e.key === 'Escape') {
      elements.sidebar.classList.add('hidden');
      elements.settingsPanel.classList.add('hidden');
    }
  });`;

code = code.replace(/\/\/ Keyboard shortcuts\n  document\.addEventListener\('keydown', \(e\) => \{[\s\S]*?\}\);/, newShortcuts);

fs.writeFileSync('ui/renderer.js', code);
