# Tests owned by an exercise

A custom checker can accept many different answers. Keep its tests with the
exercise so that an author can review, change, and copy the assessment as one
unit. Tests are optional: older exercises without a `tests` option render as
before and do not require native Python.

Use short inline assertions for small exercises. Put larger fixtures in a
neighboring Python file and reference it from the exercise. Both formats use
the same runner, `question-tests.py` in the extension; no separate
question-test schema or test service is needed.

## Inline tests

Add `tests: |` beside a `mode: custom` checker and define
`test(check, symbols)`:

````markdown
```{math-exercise}
#| label: positive-integer
#| mode: custom
#| checker: |
#|   def check(response, symbols):
#|       n = response["expressions"][0]
#|       return {"correct": n.is_integer is True and n.is_positive is True}
#| tests: |
#|   def test(check, symbols):
#|       assert check({"expressions": [Integer(3)]}, symbols)["correct"]
#|       assert not check({"expressions": [Rational(3,2)]}, symbols)["correct"]
#|       assert not check({"expressions": [Integer(-1)]}, symbols)["correct"]

Give a positive integer: _[]
```
````

`check` is the exercise's actual checker function. `symbols` contains the
declared `vars` symbols, just as it does when the checker runs in the browser.
Normal SymPy names (`Integer`, `Rational`, `Matrix`, `simplify`, and others)
and the extension's `assess_basis` and `graph_from_response` helpers are
available. Use ordinary `assert` statements, optionally with a helpful failure
message. An exception or a failed assertion fails the test.

These assertions call the checker with already parsed mathematical objects.
For example, use `{"expressions": [Rational(3,2)]}`, rather than the raw string
`"3/2"`. To test named matrices, supply
`{"inputs": {"B": {"matrix": Matrix([[1,0],[0,1]])}}}`. Tests can assert exact
partial-credit scores and assessment details as well as full correctness.

## A separate file for larger cases

Keep a short reference inside the exercise:

```text
#| tests: exercises/tests/tree.py
```

The referenced file defines the same function:

```python
def test(check, symbols):
    nodes = [{"id": i, "x": i, "y": 0} for i in range(5)]
    path = [[0,1], [1,2], [2,3], [3,4]]
    response = {"representation": "undirected-graph", "nodes": nodes, "edges": path}
    assert check(response, symbols)["score"] == 1
    response["edges"] = path + [[0,4]]
    assert check(response, symbols)["score"] < 1, "A cycle is not a tree"
```

Paths are relative to the **Quarto project root**, or the document directory
outside a project. This also applies to exercises in included QMD files. Run
the direct command below from that same directory. Use an unquoted path ending
in `.py`. Keep the test file with the exercise when copying it to another
project. The documentation examples expose referenced tests in a separate
collapsed section inside the source panel.

## Running in VS Code, Quarto, or GitHub Actions

Install Python with SymPy on the build machine. Install any additional native
packages imported by your checker, such as NetworkX. The browser still loads
its own Pyodide packages as before.

```bash
python -m pip install 'sympy>=1.13' 'networkx>=3.4'
python _extensions/math-exercise/question-tests.py exercises/tree.qmd
quarto render
```

The direct runner accepts several QMD filenames. Pass the actual files
containing the exercises, including included QMD files; it does not expand
Quarto includes itself. If Quarto installed the extension under a namespace,
use its actual path, for example
`_extensions/Erasmus-CTM/math-exercise/question-tests.py`.

When a rendered exercise contains tests, the Quarto filter automatically calls
the same runner for that exercise. Set `MATH_EXERCISE_PYTHON` if Quarto should
use a particular Python executable. A failed test identifies the exercise
label and exits with a nonzero status. VS Code shows the error in the render
output or terminal; GitHub Actions marks the command and action as failed.

### Where the runner lives

The tests run in ctm-checkers, the Python checker library of CTM Assessment,
which also grades the exercises in the browser
(`ctm_checkers.math_exercise.authored`). `question-tests.py` finds
ctm-checkers' wheel and runs the tests with it: the wheel named by
`CTM_CHECKERS_WHEEL`, else the `ctm-checkers` folder next to the math-exercise
folder (as in CTM Assessment), else the project's `_extensions/ctm-checkers`
or `_extensions/<owner>/ctm-checkers`. A test's `check` is therefore the
browser's checker, with the same SymPy names and helpers. The command, its
output and its exit status are those of earlier versions; without ctm-checkers
it stops with the command that installs CTM Assessment. Run the file as a
script, as above, not with `python -m`.

An existing action can run either `quarto render`, the direct test command, or
both. In this repository `npm test` calls the direct runner for the example
sources, and the rendering action also exercises the build-time checks. Tests
are not embedded in the page's grading data. They remain visible as author
source in the demonstration's source panels.

## Useful cases for a custom checker

Include a few genuinely different valid answers, a plausible wrong answer,
and an important boundary case. For a basis, check an incomplete basis,
dependent vectors, and a reordered valid basis. For graphical answers, use the
same JSON shape the board submits. A graph's mathematical checker can be
tested with a path, a cycle, a disconnected graph, or an invalid edge without
simulating clicks or drags.

Tests and checkers are trusted author Python code executed during a build.
These Python assertion blocks currently target `mode: custom`. Generated
parameter variants retain their existing YAML fixture-list format; see
[build-time variants](build-time-variants.md). They check the authored
assessment logic using the same Python helpers shipped to the browser, but
they do not test expression-entry parsing, UI gestures, network loading, or
complete CPython/Pyodide parity. Keep those browser checks separate.

For controls and pointer gestures, see the separate [browser-test guide](browser-tests.md).


## Python versions for native tests

Native tests need SymPy 1.13 or later (1.13 changed how floats compare) and,
for graph checkers, NetworkX 3.4 or later. The browser grades with the
versions its Pyodide ships (Pyodide 0.28.3: SymPy 1.13.3, NetworkX 3.4.2);
a newer SymPy on the build machine can occasionally grade an edge case
differently, so CI runs the native tests with the browser's versions.
