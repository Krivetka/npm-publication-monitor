// Package names of one consumer, read in the browser from what the analyst pastes or opens:
// a package-lock.json (all three lockfile versions), a package.json, or one name per line.
// Nothing but the list of names is sent to the server.

const MAX_NAME = 214;
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function fromLockPackages(packages, out) {
  for (const [key, entry] of Object.entries(packages)) {
    if (key === '' || (entry && entry.link)) continue;
    // "node_modules/a/node_modules/@scope/b" → "@scope/b"
    const at = key.lastIndexOf('node_modules/');
    const name = (entry && typeof entry.name === 'string' && entry.name) || (at >= 0 ? key.slice(at + 13) : '');
    if (name) out.add(name);
  }
}

function fromLockDependencies(deps, out) {
  for (const [name, entry] of Object.entries(deps)) {
    out.add(name);
    if (entry && typeof entry === 'object' && entry.dependencies) fromLockDependencies(entry.dependencies, out);
  }
}

// Returns the distinct names, sorted. Unknown input gives an empty list.
export function parseDependencyList(text) {
  const out = new Set();
  const trimmed = String(text ?? '').trim();
  if (trimmed.startsWith('{')) {
    let doc;
    try { doc = JSON.parse(trimmed); } catch { return []; }
    if (doc && typeof doc === 'object') {
      if (doc.packages && typeof doc.packages === 'object') fromLockPackages(doc.packages, out);
      else if (doc.lockfileVersion && doc.dependencies && typeof doc.dependencies === 'object') fromLockDependencies(doc.dependencies, out);
      else for (const f of DEP_FIELDS) if (doc[f] && typeof doc[f] === 'object') for (const name of Object.keys(doc[f])) out.add(name);
    }
  } else {
    for (const line of trimmed.split(/[\r\n,]+/)) {
      // "lodash@4.17.21", "@scope/name@1.0.0", "- name", "name  # note"
      const m = /^[\s\-*]*((?:@[^\s@/]+\/)?[^\s@/#]+)/.exec(line);
      if (m) out.add(m[1]);
    }
  }
  return [...out].filter((n) => n.length > 0 && n.length <= MAX_NAME && !n.startsWith('.') && !n.startsWith('_')).sort();
}
