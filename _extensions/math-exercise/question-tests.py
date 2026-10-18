#!/usr/bin/env python3
"""Run trusted author assertions next to custom math-exercise checkers.

Usage: python _extensions/math-exercise/question-tests.py lesson.qmd [...]
Quarto invokes --stdin for a single exercise containing #| tests: |.
"""
import ast
import json
from pathlib import Path
import re
import sys


def runtime_namespace():
    # Decode only the literal Python string array already shipped to Pyodide.
    # Sharing it keeps the build tests on the same helper implementations.
    source = Path(__file__).with_name('math-exercise.js').read_text()
    match = re.search(r"var source = \[\n(.*?)\n    \]\.join\('\\n'\);", source, re.S)
    if not match:
        raise ValueError('Cannot locate the math-exercise Python bootstrap')
    lines = ast.literal_eval('[' + match[1] + ']')
    if not all(isinstance(line, str) for line in lines):
        raise ValueError('Expected a literal Python bootstrap')
    namespace = {}
    exec('\n'.join(lines), namespace)
    return namespace


def run_question(options, runtime, base):
    if options.get('mode') != 'custom' or not options.get('checker', '').strip():
        raise ValueError('Authored tests currently require mode: custom and checker: |')
    namespace = dict(runtime)
    runtime['_math_vars'] = options.get('vars', '')
    symbols = {k: v for k, v in runtime['_build_locals']().items()
               if isinstance(v, runtime['Symbol'])}
    exec(options['checker'], namespace)
    tests = options['tests']
    if '\n' not in tests and tests.endswith('.py'):
        tests = (base / tests).read_text()
    exec(tests, namespace)
    test = namespace.get('test')
    if not callable(test):
        raise ValueError('tests: | must define test(check, symbols)')
    test(namespace['check'], symbols)


def authored_questions(path):
    for block in re.findall(r'^```\{math-exercise\}\n(.*?)^```\s*$', path.read_text(), re.M | re.S):
        options = {}
        lines = block.splitlines()
        i = 0
        while i < len(lines):
            match = re.match(r'^#\|\s*([^:]+):\s*(.*?)\s*$', lines[i])
            i += 1
            if not match:
                continue
            key, value = match.groups()
            if value == '|':
                body = []
                while i < len(lines) and (lines[i].startswith('#|   ') or lines[i].strip() == '#|'):
                    body.append(lines[i][5:] if lines[i].startswith('#|   ') else '')
                    i += 1
                value = '\n'.join(body)
            options[key] = value
        yield options


def main():
    runtime = runtime_namespace()
    if sys.argv[1:] == ['--stdin']:
        questions = [(None, json.load(sys.stdin))]
    else:
        if len(sys.argv) == 1:
            raise ValueError(__doc__.strip())
        questions = [(path, question) for path in map(Path, sys.argv[1:]) for question in authored_questions(path)]
    tested = untested = 0
    for path, options in questions:
        if not options.get('tests', '').strip():
            untested += options.get('mode') == 'custom'
            continue
        label = options.get('label', '(unlabelled exercise)')
        try:
            run_question(options, runtime, Path(options.get('tests-base', Path.cwd())))
        except Exception as error:
            raise RuntimeError(f'{path or "Quarto"}: {label}: {type(error).__name__}: {error}') from error
        tested += 1
    print(f'{tested} authored question tests passed; {untested} custom questions without tests.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'math-exercise question tests failed: {error}', file=sys.stderr)
        sys.exit(1)
