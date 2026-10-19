#!/usr/bin/env python3
"""Run trusted author assertions next to custom math-exercise checkers.

Usage: python _extensions/math-exercise/question-tests.py lesson.qmd [...]
Quarto invokes --stdin for a single exercise containing #| tests: |.

The tests run in ctm-checkers, the Python checker library of CTM Assessment
(ctm_checkers.math_exercise.authored): this script finds its wheel, puts it
first on sys.path and runs it, with the same output and exit status as
before. Run it as a script, never with `python -m`.
"""
import json
import os
from pathlib import Path
import sys

INSTALL = ('math-exercise question tests need ctm-checkers, part of CTM Assessment. '
           'Install CTM Assessment: quarto add https://erasmus-ctm.github.io/ctm-assessment/ctm-assessment.tar.gz')


def _wheel_in(folder):
    # The wheel that a ctm-checkers folder's checkers.json names, if it is there.
    try:
        wheel = folder / json.loads((folder / 'checkers.json').read_text(encoding='utf-8'))['wheel']
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return wheel if wheel.is_file() else None


def checkers_wheel():
    """CTM_CHECKERS_WHEEL; else the wheel of ../ctm-checkers next to this
    component (the CTM Assessment package, or one owner folder); else of the
    project's _extensions/[owner/]ctm-checkers (the _extensions folder that
    holds this component)."""
    if os.environ.get('CTM_CHECKERS_WHEEL'):
        wheel = Path(os.environ['CTM_CHECKERS_WHEEL'])
        return wheel if wheel.is_file() else None
    here = Path(__file__).resolve().parent
    found = _wheel_in(here.parent / 'ctm-checkers')
    if found:
        return found
    extensions = next((folder for folder in here.parents if folder.name == '_extensions'), None)
    if extensions is not None:
        for folder in [extensions / 'ctm-checkers'] + sorted(extensions.glob('*/ctm-checkers')):
            found = _wheel_in(folder)
            if found:
                return found
    return None


def main(argv):
    wheel = checkers_wheel()
    if wheel is None:
        print(INSTALL, file=sys.stderr)
        return 1
    sys.path.insert(0, str(wheel))
    try:
        from ctm_checkers.math_exercise import authored
    except ImportError as error:
        print(f'math-exercise question tests failed: {wheel}: {error}', file=sys.stderr)
        return 1
    return authored.main(argv)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
