// ctm-checkers, the Python checker library of CTM Assessment that
// math-exercise grades with: where it is installed for the tests, its page
// script, its wheel for native Python, test projects that render with it, and
// the call texts of ctm-libs' MathExerciseRuntime.callCheckers.
import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// CTM_CHECKERS_EXTENSION (an _extensions/ctm-checkers folder), else the
// installation in this repository (`quarto add` of a ctm-checkers checkout
// at the commit of .github/pins.json installs it under _extensions/ctm-checkers).
const extensions = fileURLToPath(new URL('../../_extensions/', import.meta.url));
function locate() {
  if (process.env.CTM_CHECKERS_EXTENSION) return process.env.CTM_CHECKERS_EXTENSION;
  const candidates = [join(extensions, 'ctm-checkers'),
    ...(existsSync(extensions) ? readdirSync(extensions).map(owner => join(extensions, owner, 'ctm-checkers')) : [])];
  const found = candidates.find(dir => existsSync(join(dir, 'checkers.json')));
  if (!found) {
    throw new Error('Install ctm-checkers first (quarto add of a ctm-checkers checkout at the commit of .github/pins.json), '
      + 'or set CTM_CHECKERS_EXTENSION to its _extensions/ctm-checkers folder.');
  }
  return found;
}
export const ctmCheckers = locate();
export const manifest = JSON.parse(readFileSync(join(ctmCheckers, 'checkers.json'), 'utf8'));
export const wheel = process.env.CTM_CHECKERS_WHEEL || join(ctmCheckers, manifest.wheel);
// The page script (globalThis.CTMCheckers), as ctm-libs loads it in the head.
export const script = readFileSync(join(ctmCheckers, manifest.script), 'utf8');

// The environment of native Python that imports ctm_checkers from the wheel,
// as math-exercise's build-time Python runs (ctm.checkers.environment).
export const pythonEnv = { ...process.env, PYTHONPATH: [wheel, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  CTM_CHECKERS_WHEEL: wheel };

// Copies ctm-checkers into a test project's _extensions (or an owner folder), as `quarto add` does.
export function install(dir, owner = '') {
  const target = join(dir, '_extensions', owner, 'ctm-checkers');
  cpSync(ctmCheckers, target, { recursive: true });
  return target;
}

// Fake runtimes recognize math-exercise's grading calls by ctm-libs' call
// text: `….call("math_exercise.check", …)` and `….call("math_exercise.check_custom", …)`.
export const CHECK = '.call("math_exercise.check"';
export const CHECK_CUSTOM = '.call("math_exercise.check_custom"';
export const ANY_CHECK = '.call("math_exercise.check';
