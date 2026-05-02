function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

function isDomainAllowedOld(hostname, serviceDomains, blockingEnabled, commonAuthDomains) {
  if (!blockingEnabled) return true;

  for (const domain of commonAuthDomains) {
    if (matchesDomain(hostname, domain)) {
      return true;
    }
  }

  if (serviceDomains && serviceDomains.length > 0) {
    for (const domain of serviceDomains) {
      if (matchesDomain(hostname, domain)) {
        return true;
      }
    }
  }

  return false;
}

function isDomainAllowedNew(hostname, serviceDomainsSet, blockingEnabled, commonAuthDomainsSet) {
  if (!blockingEnabled) return true;

  let currentDomain = hostname;
  while (currentDomain) {
    if (commonAuthDomainsSet && commonAuthDomainsSet.has(currentDomain)) {
      return true;
    }
    if (serviceDomainsSet && serviceDomainsSet.has(currentDomain)) {
      return true;
    }

    const dotIndex = currentDomain.indexOf('.');
    if (dotIndex === -1) {
      break;
    }
    currentDomain = currentDomain.substring(dotIndex + 1);
  }

  return false;
}

const authDomains = [];
for(let i=0; i<100; i++) authDomains.push(`auth${i}.com`);
const serviceDomains = [];
for(let i=0; i<100; i++) serviceDomains.push(`service${i}.com`);

const authSet = new Set(authDomains);
const serviceSet = new Set(serviceDomains);

const testHostnames = [
  'auth99.com',
  'sub.service99.com',
  'notfound.com',
  'a.b.c.d.e.f.auth0.com'
];

const iterations = 100000;

const startOld = process.hrtime.bigint();
for(let i=0; i<iterations; i++) {
  for(const host of testHostnames) {
    isDomainAllowedOld(host, serviceDomains, true, authDomains);
  }
}
const endOld = process.hrtime.bigint();

const startNew = process.hrtime.bigint();
for(let i=0; i<iterations; i++) {
  for(const host of testHostnames) {
    isDomainAllowedNew(host, serviceSet, true, authSet);
  }
}
const endNew = process.hrtime.bigint();

console.log(`Old time: ${Number(endOld - startOld) / 1000000} ms`);
console.log(`New time: ${Number(endNew - startNew) / 1000000} ms`);
