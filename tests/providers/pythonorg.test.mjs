// tests/providers/pythonorg.test.mjs — provider-contract tests for Python.org Jobs RSS provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — pythonorg');

try {
  const pythonorgModule = await import(pathToFileURL(join(ROOT, 'providers/pythonorg.mjs')).href);
  const pythonorg = pythonorgModule.default;
  const { parsePythonOrgFeed, assertPythonOrgUrl } = pythonorgModule;

  if (pythonorg.id === 'pythonorg') pass('pythonorg.id is "pythonorg"');
  else fail(`pythonorg.id is ${JSON.stringify(pythonorg.id)}`);

  // detect() — explicit provider and URL pattern detection
  const hitProvider = pythonorg.detect({ name: 'Python.org Jobs', provider: 'pythonorg' });
  if (hitProvider && hitProvider.url === 'https://www.python.org/jobs/feed/rss/') {
    pass('pythonorg.detect() resolves provider:pythonorg → feed URL');
  } else {
    fail(`pythonorg.detect() with provider returned ${JSON.stringify(hitProvider)}`);
  }

  const hitUrl = pythonorg.detect({ name: 'Python.org Jobs', careers_url: 'https://www.python.org/jobs/' });
  if (hitUrl && hitUrl.url === 'https://www.python.org/jobs/feed/rss/') {
    pass('pythonorg.detect() resolves python.org/jobs careers_url → feed URL');
  } else {
    fail(`pythonorg.detect() with careers_url returned ${JSON.stringify(hitUrl)}`);
  }

  if (pythonorg.detect({ name: 'Other', careers_url: 'https://example.com' }) === null) {
    pass('pythonorg.detect() returns null for unrelated entry');
  } else {
    fail('pythonorg.detect() should return null for unrelated entry');
  }

  // assertPythonOrgUrl — SSRF protection
  try {
    assertPythonOrgUrl('https://www.python.org/jobs/feed/rss/');
    assertPythonOrgUrl('https://python.org/jobs/feed/rss/');
    pass('assertPythonOrgUrl accepts valid python.org HTTPS URLs');
  } catch (err) {
    fail(`assertPythonOrgUrl failed on valid URL: ${err.message}`);
  }

  let rejectedHttp = false;
  try {
    assertPythonOrgUrl('http://www.python.org/jobs/feed/rss/');
  } catch {
    rejectedHttp = true;
  }
  if (rejectedHttp) pass('assertPythonOrgUrl rejects non-HTTPS URLs');
  else fail('assertPythonOrgUrl should reject http:// URLs');

  let rejectedHost = false;
  try {
    assertPythonOrgUrl('https://evil.com/jobs/feed/rss/');
  } catch {
    rejectedHost = true;
  }
  if (rejectedHost) pass('assertPythonOrgUrl rejects untrusted hostnames');
  else fail('assertPythonOrgUrl should reject untrusted hostnames');

  // parsePythonOrgFeed — sample XML fixture
  const sampleXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
    '<title>Python.org Jobs Feed</title>',
    '<link>https://www.python.org/jobs/</link>',
    '<item>',
    '  <title>Agentic Python Engineer, ExampleCo</title>',
    '  <link>https://www.python.org/jobs/8133/</link>',
    '  <description>Remote, Remote/Worldwide, Remote',
    '&lt;p&gt;ExampleCo builds intelligent developer tools.&lt;/p&gt;',
    '  </description>',
    '  <guid>https://www.python.org/jobs/8133/</guid>',
    '  <pubDate>Mon, 14 Sep 2026 08:29:07 +0000</pubDate>',
    '</item>',
    '<item>',
    '  <title>Backend &amp; ML Developer, Acme AI</title>',
    '  <link>https://www.python.org/jobs/8132/</link>',
    '  <description>San Francisco, CA, USA',
    '&lt;p&gt;Looking for senior engineers.&lt;/p&gt;',
    '  </description>',
    '</item>',
    '<item>',
    '  <title>Single Title Without Comma</title>',
    '  <link>https://www.python.org/jobs/8131/</link>',
    '  <description>&lt;p&gt;Description without location line.&lt;/p&gt;</description>',
    '</item>',
    '<item>',
    '  <title>Ghost Role (no link)</title>',
    '  <description>Somewhere</description>',
    '</item>',
    '<item>',
    '  <title></title>',
    '  <link>https://www.python.org/jobs/8130/</link>',
    '</item>',
    '</channel></rss>',
  ].join('\n');

  const jobs = parsePythonOrgFeed(sampleXml, 'Python.org');
  if (jobs.length === 3) pass('parsePythonOrgFeed keeps 3 valid items (drops missing-link and empty-title rows)');
  else fail(`parsePythonOrgFeed returned ${jobs.length} jobs, expected 3`);

  if (jobs[0]?.title === 'Agentic Python Engineer' && jobs[0]?.company === 'ExampleCo') {
    pass('parsePythonOrgFeed splits "{Role}, {Company}" cleanly');
  } else {
    fail(`jobs[0] title/company = ${JSON.stringify({ title: jobs[0]?.title, company: jobs[0]?.company })}`);
  }

  if (jobs[0]?.location === 'Remote, Remote/Worldwide, Remote') {
    pass('parsePythonOrgFeed extracts location from first line of description');
  } else {
    fail(`jobs[0] location = ${JSON.stringify(jobs[0]?.location)}`);
  }

  if (jobs[0]?.url === 'https://www.python.org/jobs/8133/') {
    pass('parsePythonOrgFeed preserves canonical job URL');
  } else {
    fail(`jobs[0] url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.postedAt === Date.parse('Mon, 14 Sep 2026 08:29:07 +0000')) {
    pass('parsePythonOrgFeed parses pubDate to epoch ms');
  } else {
    fail(`jobs[0] postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.title === 'Backend & ML Developer' && jobs[1]?.company === 'Acme AI') {
    pass('parsePythonOrgFeed decodes XML entities in title');
  } else {
    fail(`jobs[1] title = ${JSON.stringify(jobs[1]?.title)}`);
  }

  if (jobs[2]?.title === 'Single Title Without Comma' && jobs[2]?.company === 'Python.org') {
    pass('parsePythonOrgFeed falls back to default company when no comma exists in title');
  } else {
    fail(`jobs[2] title/company = ${JSON.stringify({ title: jobs[2]?.title, company: jobs[2]?.company })}`);
  }

  // Robustness checks
  if (parsePythonOrgFeed('').length === 0) pass('empty input → empty result');
  else fail('empty input should yield empty result');

  if (parsePythonOrgFeed(null).length === 0) pass('null input → empty result without crashing');
  else fail('null input should yield empty result');

  // fetch() with mock context
  let capturedUrl = null;
  let capturedOpts = null;
  const fetched = await pythonorg.fetch(
    { name: 'Python.org Board', provider: 'pythonorg' },
    {
      fetchText: async (url, opts) => {
        capturedUrl = url;
        capturedOpts = opts;
        return sampleXml;
      },
    },
  );

  if (capturedUrl === 'https://www.python.org/jobs/feed/rss/') {
    pass('pythonorg.fetch() requests the official feed URL');
  } else {
    fail(`pythonorg.fetch() requested unexpected URL: ${capturedUrl}`);
  }

  if (capturedOpts && capturedOpts.redirect === 'error') {
    pass('pythonorg.fetch() passes redirect:"error" to fetchText (SSRF guard)');
  } else {
    fail(`pythonorg.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
  }

  if (fetched.length === 3) {
    pass('pythonorg.fetch() returns parsed jobs from context');
  } else {
    fail(`pythonorg.fetch() returned ${fetched.length} jobs, expected 3`);
  }
} catch (err) {
  fail(`Unhandled error in pythonorg.test.mjs: ${err.message}\n${err.stack}`);
}
