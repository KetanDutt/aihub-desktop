const fs = require('fs');

let blockingCode = fs.readFileSync('src/blocking.js', 'utf8');

const matchesDomainFunc = `
function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}
`;

if (!blockingCode.includes('function matchesDomain')) {
    blockingCode = matchesDomainFunc + blockingCode;
}

blockingCode = blockingCode.replace(
    /if \(hostname === domain \|\| hostname\.endsWith\('\.' \+ domain\)\) \{/g,
    'if (matchesDomain(hostname, domain)) {'
);

fs.writeFileSync('src/blocking.js', blockingCode);
