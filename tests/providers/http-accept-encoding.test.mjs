// tests/providers/http-accept-encoding.test.mjs — every provider request must
// pin accept-encoding to codecs undici decodes correctly. Left unset, Node's
// fetch negotiates zstd, and amazon.jobs' zstd response arrives truncated at
// exactly 1024 bytes with a 200 status — so the failure surfaces as
// "Unterminated string in JSON at position 1024" rather than a transport error.
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — _http accept-encoding');

const { fetchJson, fetchText } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);

const realFetch = globalThis.fetch;
let seen = null;
globalThis.fetch = async (_url, init) => {
  seen = new Headers(init?.headers);
  return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
};

try {
  // 1. Default: zstd is never offered.
  await fetchJson('https://example.com/jobs.json');
  const enc = seen?.get('accept-encoding') ?? '';
  if (enc && !/zstd/i.test(enc)) pass(`fetchJson pins accept-encoding without zstd ("${enc}")`);
  else fail(`fetchJson accept-encoding should be pinned and exclude zstd, got "${enc}"`);

  // 2. Same default on the text path.
  await fetchText('https://example.com/jobs.html');
  const textEnc = seen?.get('accept-encoding') ?? '';
  if (textEnc === enc) pass('fetchText sends the same pinned accept-encoding');
  else fail(`fetchText accept-encoding "${textEnc}" differs from fetchJson "${enc}"`);

  // 3. A caller's explicit header still wins.
  await fetchJson('https://example.com/jobs.json', { headers: { 'accept-encoding': 'identity' } });
  if (seen?.get('accept-encoding') === 'identity') pass('a caller-supplied accept-encoding overrides the default');
  else fail(`caller override lost: got "${seen?.get('accept-encoding')}"`);

  // 4. Pinning must not displace the default user-agent.
  if (seen?.get('user-agent')) pass('default user-agent is still sent alongside the pinned encoding');
  else fail('user-agent header went missing');
} catch (e) {
  fail(`accept-encoding test threw: ${e.message}`);
} finally {
  globalThis.fetch = realFetch;
}
