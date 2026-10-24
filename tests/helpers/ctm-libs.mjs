// ctm-libs, the library of CTM Assessment that math-exercise loads: where it
// is installed for the tests, its browser files (Python runtime, message
// catalogue, AI feedback), and test projects that render with it.
import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { install as installCheckers } from './ctm-checkers.mjs';

// CTM_LIBS_EXTENSION (an _extensions/ctm-libs folder), else the installation
// in this repository: `quarto add Erasmus-CTM/ctm-libs` installs it under
// _extensions/Erasmus-CTM/ctm-libs, `quarto add ../ctm-libs` under
// _extensions/ctm-libs.
const extensions = fileURLToPath(new URL('../../_extensions/', import.meta.url));
function locate() {
  if (process.env.CTM_LIBS_EXTENSION) return process.env.CTM_LIBS_EXTENSION;
  const candidates = [join(extensions, 'ctm-libs'),
    ...(existsSync(extensions) ? readdirSync(extensions).map(owner => join(extensions, owner, 'ctm-libs')) : [])];
  const found = candidates.find(dir => existsSync(join(dir, 'lua', 'ctm.lua')));
  if (!found) {
    throw new Error('Install ctm-libs first (quarto add of a ctm-libs checkout at the commit of .github/pins.json), '
      + 'or set CTM_LIBS_EXTENSION to its _extensions/ctm-libs folder.');
  }
  return found;
}
export const ctmLibs = locate();
export const matrixInputSource = readFileSync(join(ctmLibs, "ui/ctm-matrix-input.js"), "utf8");

// Browser files of ctm-libs, each list in the order a page loads it.
export const FEEDBACK = ['feedback/feedback-core.js', 'feedback/feedback-dom.js', 'feedback/ai-feedback.js'];
export const RUNTIME = ['runtime/pyodide-runtime.js'];
export const LOCALE = ['locales/ctm-locale.js', 'locales/common.js', 'locales/math-exercise.js'];

export function sources(files) {
  return files.map(file => readFileSync(join(ctmLibs, file), 'utf8'));
}

// Runs ctm-libs files in a vm context.
export function runInContext(context, files) {
  for (const code of sources(files)) vm.runInContext(code, context);
}

// Copies ctm-libs into a test project's _extensions (or an owner folder), as
// `quarto add` does, and ctm-checkers, the checker library math-exercise
// grades with (as the CTM Assessment package installs both; `checkers: false`
// leaves it out).
export function install(dir, owner = '', { checkers = true } = {}) {
  const target = join(dir, '_extensions', owner, 'ctm-libs');
  cpSync(ctmLibs, target, { recursive: true });
  if (checkers) installCheckers(dir, owner);
  return target;
}

// Test projects have ctm-libs but not the CTM Assessment package, as in
// component development: the bootstrap is told so (CTM_COMPONENT_DEV=1).
export const renderEnv = { ...process.env, CTM_COMPONENT_DEV: '1' };
