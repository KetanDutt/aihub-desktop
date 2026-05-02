const { performance } = require('perf_hooks');

// Mock window and necessary functions
global.window = {
    generateId: (name) => name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')
};

function benchmark(numServices, numActiveTabs) {
    const allServices = [];
    for (let i = 0; i < numServices; i++) {
        allServices.push([`Service ${i}`, `https://service${i}.com`, 'AI Service', 'Privacy', 'ffffff']);
    }

    const activeTabs = [];
    for (let i = 0; i < numActiveTabs; i++) {
        // Activate every other service
        const name = `Service ${i * 2}`;
        activeTabs.push({ id: global.window.generateId(name), serviceId: global.window.generateId(name), url: `https://service${i*2}.com`, title: name });
    }

    global.window.activeTabs = activeTabs;

    // Baseline implementation
    const startBaseline = performance.now();
    const resultsBaseline = [];
    allServices.forEach(service => {
        const name = service[0];
        const id = global.window.generateId(name);
        const isActive = global.window.activeTabs.find(t => t.id === id);
        resultsBaseline.push(!!isActive);
    });
    const endBaseline = performance.now();
    const baselineTime = endBaseline - startBaseline;

    // Optimized implementation
    const startOptimized = performance.now();
    const activeTabIds = new Set(global.window.activeTabs.map(t => t.id));
    const resultsOptimized = [];
    allServices.forEach(service => {
        const name = service[0];
        const id = global.window.generateId(name);
        const isActive = activeTabIds.has(id);
        resultsOptimized.push(isActive);
    });
    const endOptimized = performance.now();
    const optimizedTime = endOptimized - startOptimized;

    console.log(`Results for ${numServices} services and ${numActiveTabs} active tabs:`);
    console.log(`Baseline: ${baselineTime.toFixed(4)}ms`);
    console.log(`Optimized: ${optimizedTime.toFixed(4)}ms`);
    console.log(`Improvement: ${((baselineTime - optimizedTime) / baselineTime * 100).toFixed(2)}%`);

    // Sanity check
    if (JSON.stringify(resultsBaseline) !== JSON.stringify(resultsOptimized)) {
        console.error("Error: Results do not match!");
    }
}

console.log("--- Small Scale ---");
benchmark(10, 5);
console.log("\n--- Medium Scale ---");
benchmark(100, 50);
console.log("\n--- Large Scale ---");
benchmark(1000, 500);
