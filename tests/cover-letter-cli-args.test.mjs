// tests/cover-letter-cli-args.test.mjs: generate-cover-letter.mjs parses its
// flags strictly and carries its own page budget (#6373).
//
// main() used parseArgs({ strict: false }), so three mistakes succeeded
// silently: an unknown flag (`--max-pages=1 --strict-pages`, a typo such as
// `--reprot 42`) was dropped, a valueless `--report` swallowed the next flag
// as its value (`--report --out x.pdf` filed a manifest row for report
// "--out" and wrote to the default path), and a valueless `--out` became
// boolean `true`. And with no budget of its own, a five-page letter inherited
// the CV default (2 pages, warning only) and was reported as a "CV".
//
// The parse is checked through the exported parseCoverArgs(), the CLI through
// a child process whose data root is a temp dir: every rejected argv must exit
// 1 before anything is written. The wording through enforcePageBudget().
//
// Run:  node --test tests/cover-letter-cli-args.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCoverArgs, COVER_DEFAULT_MAX_PAGES } from '../generate-cover-letter.mjs';
import { enforcePageBudget } from '../generate-pdf.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'generate-cover-letter.mjs');

test('parseCoverArgs accepts the documented flags and defaults the budget to one page', () => {
  assert.equal(COVER_DEFAULT_MAX_PAGES, 1);
  assert.deepEqual(parseCoverArgs(['--payload', 'p.json']), {
    help: false, payload: 'p.json', out: undefined, format: undefined, country: undefined,
    report: undefined, maxPages: 1, strictPages: false,
  });
  const got = parseCoverArgs([
    '--payload', 'p.json', '--out', 'output/x.pdf', '--format', 'a4', '--country', 'DE',
    '--report', '042', '--max-pages=2', '--strict-pages',
  ]);
  assert.equal(got.out, 'output/x.pdf');
  assert.equal(got.report, '042');
  assert.equal(got.maxPages, 2);
  assert.equal(got.strictPages, true);
  assert.equal(parseCoverArgs(['-h']).help, true);
});

test('parseCoverArgs rejects what non-strict parsing let through', () => {
  const rejected = [
    [['--payload', 'p.json', '--reprot', '42'], /Unknown option '--reprot'/],
    [['--payload', 'p.json', '--report', '--out', 'x.pdf'], /--report/],
    [['--payload', 'p.json', '--out'], /--out/],
    [['--payload'], /--payload/],
    [['--payload', 'p.json', 'stray.pdf'], /positional/i],
    [['--payload', 'p.json', '--report', 'abc'], /Invalid --report "abc"/],
    [['--payload', 'p.json', '--report', ''], /Invalid --report ""/],
    [['--payload', 'p.json', '--out', ''], /Invalid --out ""/],
    [['--payload', 'p.json', '--max-pages', '0'], /Invalid --max-pages "0"/],
    [['--payload', 'p.json', '--max-pages=1.5'], /Invalid --max-pages "1.5"/],
    [['--payload', 'p.json', '--max-pages=two'], /Invalid --max-pages "two"/],
    [['--payload', 'p.json', '--strict-pages=yes'], /strict-pages/],
  ];
  for (const [argv, message] of rejected) {
    assert.throws(() => parseCoverArgs(argv), message, `expected ${JSON.stringify(argv)} to be rejected`);
  }
});

test('the CLI exits 1 on a bad flag and writes nothing', () => {
  // realpathSync: macOS reaches the temp dir through a /var -> /private/var symlink.
  const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-cover-args-')));
  try {
    mkdirSync(join(dataRoot, 'data'), { recursive: true });
    mkdirSync(join(dataRoot, 'output'), { recursive: true });
    writeFileSync(join(dataRoot, 'data', 'applications.md'), '# Applications Tracker\n');
    // A real payload, so a regressed parser would get past "file not found"
    // and the assertions below would see the render it started.
    const payload = join(dataRoot, 'p.json');
    writeFileSync(payload, JSON.stringify({ letter: { company: 'Acme', role_title: 'Engineer' } }));

    for (const extra of [
      ['--max-pages=0'],
      ['--reprot', '42'],
      ['--report', '--out', 'x.pdf'],
      ['--out'],
    ]) {
      const r = spawnSync(process.execPath, [SCRIPT, '--payload', payload, ...extra], {
        cwd: dataRoot,
        encoding: 'utf-8',
        timeout: 60_000,
        env: { ...process.env, CAREER_OPS_ROOT: dataRoot, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '', CAREER_OPS_PDF_INDEX: '' },
      });
      assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
      assert.equal(r.status, 1, `${extra.join(' ')} should exit 1, got ${r.status}:\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /ERROR: /, `${extra.join(' ')} should explain the rejection`);
      assert.match(r.stderr, /Usage:/, `${extra.join(' ')} should print the usage`);
      assert.deepEqual(readdirSync(join(dataRoot, 'output')), [], `${extra.join(' ')} wrote into output/`);
      assert.equal(existsSync(join(dataRoot, 'data', 'pdf-index.tsv')), false, `${extra.join(' ')} touched the manifest`);
    }
  } finally {
    rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('the page-budget message names a cover letter as a cover letter', () => {
  assert.throws(
    () => enforcePageBudget(5, { maxPages: 1, strictPages: true, kind: 'cover' }),
    (err) => /^Cover letter is 5 pages; the allowed maximum is 1 page\. Shorten the letter body/.test(err.message)
      && !/older roles/.test(err.message),
  );
  // The CV wording is unchanged, and stays the fallback for an unknown kind.
  for (const kind of [undefined, 'cv', 'something-else']) {
    assert.throws(
      () => enforcePageBudget(3, { maxPages: 2, strictPages: true, kind }),
      /CV is 3 pages; the allowed maximum is 2 pages\. Trim lower-priority bullets/,
    );
  }
  assert.doesNotThrow(() => enforcePageBudget(1, { maxPages: 1, strictPages: true, kind: 'cover' }));
});
