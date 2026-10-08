import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_PACKAGE_PATH = resolve(REPOSITORY_ROOT, 'package.json');
const DEFAULT_OUTPUT_PATH = resolve(REPOSITORY_ROOT, 'version.json');

function cleanValue(value, maxLength) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/[\u0000-\u001f\u007f]/gu, '');
  return clean ? clean.slice(0, maxLength) : null;
}

function cleanCommit(value) {
  const clean = cleanValue(value, 64);
  return clean && /^[0-9a-f]{7,64}$/iu.test(clean) ? clean.slice(0, 7) : null;
}

function gitValue(args) {
  try {
    return execFileSync('git', args, {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function createVersionManifest({
  packageJson,
  commit = null,
  branch = null,
  buildTime = null,
}) {
  const version = cleanValue(packageJson?.version, 100);
  if (!version) throw new TypeError('package.json version is required');
  return {
    name: 'Liberty',
    version,
    commit: cleanCommit(commit),
    branch: cleanValue(branch, 200),
    buildTime: cleanValue(buildTime, 100),
  };
}

export async function generateVersionManifest({
  packagePath = DEFAULT_PACKAGE_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  env = process.env,
  now = new Date(),
} = {}) {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  const manifest = createVersionManifest({
    packageJson,
    commit: env.CF_PAGES_COMMIT_SHA || gitValue(['rev-parse', 'HEAD']),
    branch: env.CF_PAGES_BRANCH || gitValue(['branch', '--show-current']),
    buildTime: Number.isFinite(now?.getTime?.()) ? now.toISOString() : null,
  });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await generateVersionManifest();
}
