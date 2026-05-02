const generateId = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

const allServices = [];
for (let i = 0; i < 1000; i++) {
  allServices.push([`Service ${i}`, `http://service${i}.com`, 'Type', 'Privacy', 'Color']);
}

const openTabs = [];
for (let i = 0; i < 500; i++) {
  openTabs.push({ id: `service${i}`, url: `http://service${i}.com` });
}

console.time('Baseline O(N*M)');
for (const savedTab of openTabs) {
  const serviceId = savedTab.id;
  const serviceMeta = allServices.find(s => generateId(s[0]) === serviceId);
}
console.timeEnd('Baseline O(N*M)');

console.time('Optimized O(N)');
const servicesMap = new Map();
for (const s of allServices) {
  servicesMap.set(generateId(s[0]), s);
}
for (const savedTab of openTabs) {
  const serviceId = savedTab.id;
  const serviceMeta = servicesMap.get(serviceId);
}
console.timeEnd('Optimized O(N)');
