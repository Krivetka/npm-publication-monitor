// Prints the text of one file of a published package version, read over HTTP from a CDN mirror
// of the registry. Nothing is installed, saved or executed.
//
//   node evaluation/external/peek.mjs <package>@<version> <path> [max-chars]

const [spec, path, max = '2500'] = process.argv.slice(2);
const res = await fetch(`https://unpkg.com/${spec}/${path.replace(/^\.\//, '')}`, { headers: { 'user-agent': 'npm-publish-monitor (research)' } });
console.log(`== ${spec} ${path}: HTTP ${res.status}, ${res.headers.get('content-length') ?? '?'} bytes`);
if (res.ok) {
  const text = await res.text();
  console.log(text.slice(0, Number(max)).replace(/[^\x09\x0a\x20-\x7e]/g, '?'));
  if (text.length > Number(max)) console.log(`… (${text.length} chars in total)`);
}
