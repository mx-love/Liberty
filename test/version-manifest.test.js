import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
  createVersionManifest,
  generateVersionManifest,
} from '../scripts/generate-version.mjs';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const versionCheckSource = await readFile(new URL('../js/version-check.js', import.meta.url), 'utf8');

test('generated version.json uses package.json as its version source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'liberty-version-'));
  const outputPath = join(directory, 'version.json');
  try {
    const manifest = await generateVersionManifest({
      outputPath,
      env: {
        CF_PAGES_COMMIT_SHA: 'abcdef0123456789',
        CF_PAGES_BRANCH: 'refactor/liberty-core-v2',
        DANMU_API_BASE: 'https://private.example.test/private-token',
        TOKEN: 'private-token',
      },
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    const generated = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.deepEqual(generated, manifest);
    assert.equal(generated.version, packageJson.version);
    assert.deepEqual(Object.keys(generated), ['name', 'version', 'commit', 'branch', 'buildTime']);
    assert.equal(generated.name, 'Liberty');
    assert.equal(generated.commit, 'abcdef0');
    assert.equal(generated.branch, 'refactor/liberty-core-v2');
    assert.equal(generated.buildTime, '2026-01-01T00:00:00.000Z');
    const serialized = JSON.stringify(generated);
    assert.doesNotMatch(serialized, /DANMU_API_BASE|private\.example\.test|private-token/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('version manifest normalizes unavailable build metadata to null', () => {
  assert.deepEqual(createVersionManifest({ packageJson }), {
    name: 'Liberty',
    version: packageJson.version,
    commit: null,
    branch: null,
    buildTime: null,
  });
});

test('production version check only reads the same-origin version manifest', () => {
  assert.match(versionCheckSource, /fetch\(['"]\/version\.json['"]/u);
  assert.doesNotMatch(
    versionCheckSource,
    /LibreSpark\/LibreTV|VERSION\.txt|raw\.githubusercontent\.com|ghfast|github\.com/u,
  );
  assert.doesNotMatch(versionCheckSource, /Authorization|GitHub token|DANMU_API_BASE/u);
});

test('version footer renders package version from the same-origin manifest', async () => {
  const inserted = [];
  const fetchCalls = [];
  let onReady = null;
  const createElement = (tagName) => ({
    tagName,
    className: '',
    textContent: '',
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  });
  const footerLine = {
    insertAdjacentElement(_position, element) {
      inserted.push(element);
    },
  };
  const document = {
    addEventListener(type, callback) {
      if (type === 'DOMContentLoaded') onReady = callback;
    },
    createElement,
    createTextNode(text) {
      return { textContent: text };
    },
    querySelector(selector) {
      return selector === '.footer p.text-gray-500.text-sm' ? footerLine : null;
    },
  };
  vm.runInNewContext(versionCheckSource, {
    document,
    Date,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            name: 'Liberty',
            version: packageJson.version,
            commit: 'abcdef0',
            branch: 'refactor/liberty-core-v2',
            buildTime: '2026-01-01T00:00:00.000Z',
          };
        },
      };
    },
  });
  assert.equal(typeof onReady, 'function');
  await onReady();
  assert.deepEqual(fetchCalls.map(({ url }) => url), ['/version.json']);
  assert.equal(fetchCalls[0].options.cache, 'no-store');
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].children[0].textContent, `版本: Liberty ${packageJson.version}`);
  assert.match(inserted[0].children[1].textContent, /commit abcdef0/u);
});
