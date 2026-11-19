// Downloads the npm malware advisories of the GitHub Advisory Database that were published
// on or after a date, and writes one line per affected package to standard output:
//
//   name <TAB> GHSA id <TAB> published_at <TAB> vulnerable version range
//
//   node evaluation/advisory/fetch.mjs 2026-10-14 > evaluation/data/malware.tsv
//
// The public API allows 60 requests an hour without a token; a page holds 100 advisories.

const since = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? '')) throw new Error('usage: fetch.mjs YYYY-MM-DD');

let url = `https://api.github.com/advisories?type=malware&ecosystem=npm&per_page=100&sort=published&direction=desc&published=${encodeURIComponent(`>=${since}`)}`;
let advisories = 0;
let rows = 0;
while (url) {
  const res = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'npm-publish-monitor (research)' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}; rate limit left: ${res.headers.get('x-ratelimit-remaining')}`);
  for (const a of await res.json()) {
    advisories++;
    for (const v of a.vulnerabilities ?? []) {
      if (v.package?.ecosystem !== 'npm') continue;
      process.stdout.write(`${v.package.name}\t${a.ghsa_id}\t${a.published_at}\t${v.vulnerable_version_range ?? ''}\n`);
      rows++;
    }
  }
  url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null;
}
console.error(`${advisories} advisories, ${rows} package rows`);
