# Detailed functionality reference

[Start here](../README.md) · [Authoring guide](authoring.md)

## Basic syntax

````markdown
```{math-exercise}
#| label: my-task
#| caption: Task title
#| vars: x
Question text with an input field: _[correct_answer]
```
````

---

## Formatting the question text

The question text is Markdown-like text, not HTML:

- Math in `$...$`, `$$...$$`, `\(...\)`, `\[...\]` or `\begin{...}...\end{...}`
  is passed to the math renderer unchanged, so `$a<b<c$` works.
- Outside math, `**bold**`, `*italic*` and `` `code` `` are formatted. `\*` and
  `` \` `` give a literal `*` and `` ` ``.
- A line break in the source is a line break on the page; a blank line leaves
  an empty line. A backslash at the end of a line (Markdown's hard break) is
  the same as a plain line break.
- HTML tags and entities (`<strong>`, `&nbsp;`, `<br>`) are shown as text. Use
  the Markdown above instead: put several answer fields on separate lines
  rather than spacing them with `&nbsp;`.

Generated variants (`#| variants:`) are rendered by Pandoc, so their text
supports Markdown in full.

---

## Input fields in the question text

| Marker | Width | Element |
|--------|-------|---------|
| `_[answer]` | narrow (~10 chars) | `<input>` |
| `__[answer]` | medium (~20 chars) | `<input>` |
| `___[answer]` | wide, 2-row | `<textarea>` |
| `vec[a,b,c]` | bracketed vector | one `<input>` per component |
| `mat[a,b;c,d]` | bracketed matrix | one `<input>` per cell |
| `mat{name=A, rows=2, cols=auto, ...}` | resizable matrix | student chooses an `auto` dimension |

Multiple fields in one exercise are checked together when clicking **Check**.
The answer inside `[...]` is a SymPy expression, e.g. `pi * 9`, `x**2 + 2*x + 1`.

Vector components are separated by commas. Matrix columns are separated by
commas and rows by semicolons. Separators nested inside parentheses, brackets,
or braces are preserved, so `vec[atan2(y,x),sqrt(x)]` has two components.
Vectors are columns by default; add `#| vecdir: row` for a row vector. Each
component or cell is checked independently, highlighted independently, and
receives a localized label in feedback. Explicit `field-labels` override those
generated labels.

Dynamic matrices use `mat{...}` and currently require `mode: custom`. Each
matrix needs a unique `name`; `rows` and `cols` are either a fixed non-negative
integer or `auto`. For an automatic axis, configure `initial-rows` or
`initial-cols` and optional `min-*`/`max-*` bounds. A minimum of zero lets the
student select the single canonical empty matrix.

```{math-exercise}
#| mode: custom
#| checker: |
#|   def check(response, symbols):
#|       Z = response["inputs"]["Z"]["matrix"]
#|       return Z == Matrix(0, 0, [])
#| tests: |
#|   def test(check, symbols):
#|       assert check({"inputs": {"Z": {"matrix": zeros(0,0)}}}, symbols)
#|       assert not check({"inputs": {"Z": {"matrix": zeros(3,1)}}}, symbols)

Enter a matrix whose number of columns is part of the answer:
mat{name=Z, rows=3, cols=auto, initial-cols=1, min-cols=0, max-cols=3}
```

The checker receives a SymPy `Matrix` at
`response["inputs"][name]["matrix"]`, plus `rows`, `cols`, `raw`, and parsed
`expressions` in the same named input record. The legacy flattened
`response["expressions"]` remains available for backward compatibility.

```{math-exercise}
#| vars: x
Enter a vector: vec[x+1,2*x]
Enter a matrix: mat[1,0;0,x]
```

### Optional starting answers

Fields are empty by default. Only an activity that intentionally asks students to
revise an existing draft should declare `initial-values`:

````markdown
```{math-exercise}
#| initial-values: ["40"]
What is $6\cdot7$? _[42]
```
````

The JSON array contains one string per answer field, in displayed order (matrix
entries row by row). Use `""` for a field that should remain empty. These are
starting responses, never replacement answer keys. The array must match the
initial fields; pooled tasks reapply it when another task is selected. Omit the
option for ordinary exercises. No page script or MutationObserver is needed.


---

## Options (`#|`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `label` | string | `math-exercise-N` | Unique ID of the exercise |
| `caption` | string | — | Title shown above the exercise |
| `vars` | comma-separated | — | SymPy variables, e.g. `x, y, r` |
| `mode` | see [Check modes](#check-modes) | `equivalent` | Check mode |
| `reject` | SymPy expression | — | Reject this expression (even if correct) — only for `mode: equivalent`/`exact` |
| `tolerance` | number or `N%` | — | only for `mode: numeric`: absolute or relative tolerance |
| `decplaces` | integer | — | only for `mode: numeric`: round both sides to N decimal places before comparing |
| `sigfigs` | integer | — | only for `mode: numeric`: round both sides to N significant figures before comparing |
| `form` | `factored` / `expanded` / `single_fraction` / `lowest_terms` | — | representation additionally required for correctness — only for `mode: equivalent`/`exact` |
| `checker` | multiline Python | — | trusted author checker for `mode: custom`; define `check(response, symbols)` |
| `tests` | multiline Python or `.py` path | — | optional build-time assertions; define `test(check, symbols)` |
| `packages` | comma-separated package names | — | Pyodide packages to load lazily before checking, e.g. `networkx`; intended for `mode: custom` |
| `response` | `jsxgraph:iframe-id` | — | obtain arbitrary JSON from a JSXGraph assessment iframe instead of expression fields |
| `embed-response` | `true` / `false` | `false` | move the referenced JSXGraph iframe into the exercise card, between the question and controls |
| `partial-credit` | `true` / `false` | `false` | average multiple fields, partially score sets, and award `form-credit` for equivalent answers in the wrong form |
| `form-credit` | number from `0` to `1` | `0.5` | score for an equivalent answer that fails `mode: exact` or the requested `form` |
| `pool` | `true` / `false` | `false` | enable a task pool |
| `vecdir` | `col` / `row` | `col` | orientation of every `vec[...]` marker in the exercise |
| `field-labels` | comma-separated | — | optional human-readable labels for answer fields, e.g. `S, E, M`; missing labels fall back to `Answer` or numbered field names |
| `context` | comma-separated element IDs, or `none` | — | AI-feedback context: reference explicit `.math-exercise-context` block(s) by id, or `none` to disable the automatic context. See [AI feedback context](#ai-feedback-context) |

---

## Document options (YAML front matter)

```yaml
math-exercise:
  lang: de        # UI language (default: en)
  feedback: auto  # auto (default) | true | false
```

`feedback: auto` shows the **Feedback** button when the
[ai-feedback](https://github.com/Erasmus-CTM/ai-feedback) extension is installed
and otherwise renders the exercises without it, with one render message saying
what to install. `true` makes ai-feedback required (rendering fails with the
install command if it is missing); `false` never loads it.

---

## Interface language

Currently supported: **English (`en`)**, **German (`de`)**, and
**Norwegian Bokmål (`nb`; `no` is accepted as an alias)**.
**Default is English** – without any setting, the interface appears in English.

The extension resolves the language in this order:

1. `math-exercise: lang:` – explicit override
2. **Quarto's own `lang:`** – the normal case
3. `en` – fallback

Quarto's own key is therefore enough; no extra option is needed:

```yaml
---
title: "Math Exercises"
lang: de
filters:
  - Erasmus-CTM/math-exercise
---
```

Regional variants are shortened (`de-DE` → `de`). An unsupported language
(e.g. `fr`) silently falls back to English instead of breaking the render.

Translated: the buttons (**Check**, **Input help**, **Feedback**), the
input-help table, all answer feedback messages, the settings dialog, and the
instruction given to the AI: on a Norwegian Bokmål page, the tutor responds
in Norwegian Bokmål.

**Not** translated: the exercise text itself – that lives in the code block
and stays exactly as you write it.

### Multilingual projects

Since the language comes from Quarto's own `lang:`, the extension works with
multilingual setups without any extra effort. With a Quarto-profile-based
setup, one `lang:` per profile is enough:

```yaml
# _quarto-de.yml
project:
  output-dir: docs/de
lang: de
```

```yaml
# _quarto-en.yml
project:
  output-dir: docs/en
lang: en
```

Each language is its own render pass; the text is then fixed in the
respective HTML output. A language switcher linking to the other version
therefore also switches the extension's language automatically.

### Adding another language

This extension generates the button labels in the Lua filter, everything
else in JavaScript – so two places need updating:

1. In `_extensions/math-exercise/math-exercise.js`, add a new `LOCALES` block
   modeled on `de`.
2. In `math-exercise.lua`, add the language code to `supportedLangs` **and**
   add the button labels to the `uiText` table.

---

## Check modes

### `mode: equivalent` *(default)*

Accepts **any mathematically equivalent** representation.
`pi*9`, `9*pi`, `3**2 * pi` are all correct for `[pi * 9]`.

### `mode: equivalent` + `reject: expression`

Equivalent terms are accepted – **except** the given expression.
Useful for simplification tasks: the student can't just type the original.
The comparison uses SymPy's normalised form of that one expression, so other
unfinished forms (for example `(-x-1)^2` below) are still accepted. Use
`form: expanded` or `form: factored` when the whole task depends on the form.

```yaml
#| mode: equivalent
#| reject: (x+1)**2
```

→ `(x+1)^2` and `(1+x)^2` are rejected; `x^2 + 2x + 1` is accepted.

### `mode: exact`

The **strictest** check mode: accepts only the canonical SymPy representation
of the answer expression. Useful when exactly one specific form is required.

```yaml
#| mode: exact
Give 6/8 fully reduced: _[3/4]
```

→ `3/4` is accepted. `6/8` is rejected – **even though** SymPy reduces `6/8`
and `3/4` to the same internal object on parse (so a plain string comparison
of the two couldn't tell them apart): `mode: exact` additionally checks the
**raw text you originally typed** for un-reduced numeric fractions (including
ones hidden inside expressions like `1/4 + 2/4`) and rejects them.

For algebraic expressions, `exact` is equally strict via the canonical string
comparison, e.g. factored vs. expanded:

```yaml
#| mode: exact
#| vars: x
Give the factored form of x² + 2x + 1: __[(x+1)**2]
```

→ `(x+1)**2` is accepted; `x**2+2*x+1` (mathematically equivalent, but a
different representation) is rejected.

### `mode: numeric`

Compares **numeric values** instead of symbolic expressions – useful for
rounding, measurement, or approximation tasks. Exactly one of the following
options controls the allowed deviation (without one, a small fixed tolerance
applies):

| Option | Meaning |
|--------|---------|
| `tolerance: 0.5` | absolute tolerance: \|answer − correct\| ≤ 0.5 |
| `tolerance: 5%` | relative tolerance: 5% of the correct value |
| `decplaces: 2` | round both values to 2 decimal places, then compare (school rounding of the decimal value: 5.395 → 5.40, 0.125 → 0.13) |
| `sigfigs: 3` | round both values to 3 significant figures, then compare (same school rounding) |

```yaml
#| mode: numeric
#| tolerance: 0.005
Approximate π to two decimal places: _[pi]
```

→ `3.14` is accepted (|3.14 − π| ≈ 0.0016); `3.15` (≈ 0.0084) and `3.13`
(≈ 0.0116) are not. With `tolerance: 0.01`, the wrongly rounded `3.15` would
also be accepted, so choose a tolerance no larger than half a unit in the last
requested digit.

### `mode: string` / `mode: string_ci`

Compares the entered text **literally** (`string`) or **case-insensitively**
(`string_ci`) – no SymPy parsing. Useful for terms, units, or free-text
answers that aren't mathematical expressions.

```yaml
#| mode: string_ci
What is the name of pi? __[Pi]
```

→ `pi`, `Pi`, `PI` are accepted; `3.14` is not.

### `mode: set`

The answer is a **comma-separated list**; order doesn't matter, each element
is checked individually like `equivalent`. Useful for "list all solutions"
tasks.

```yaml
#| mode: set
#| vars: x
Solve x² = 4. All solutions: __[2, -2]
```

→ `-2, 2`, `2,-2`, `sqrt(4), -2` are all accepted; a missing or duplicate
solution is rejected.

### `mode: custom`

Runs trusted, instructor-authored SymPy/Python once for the complete exercise
response. Expression fields and external interactive responses use the same
checker contract.

The checker must define `check(response, symbols)`. For ordinary expression
fields, `response` contains `kind`, `raw`, and an ordered `expressions` list of
parsed SymPy values. `symbols` maps names from `vars` to SymPy symbols. Normal
SymPy names such as `diff`, `minimum`, `Interval`, and `Matrix` are available.
Named dynamic matrices additionally appear in `response["inputs"]`; their
current shape and entries are preserved while they are nonempty. Removing the
final row or column produces the canonical empty `Matrix(0, 0, [])`. AI feedback
receives the matrix name, dimensions, and entries as structured answer data.
The function may return a boolean, a score from `0` to `1`, or a dictionary
containing `score` (or `correct`) and optional plain-text `feedback`. A checker
can assess complete row or column vectors with, for example,
`assessment: {"Z": {"columns": [True, False, True]}}` or
`assessment: {"R": {"rows": [True, False]}}`; the corresponding vectors are
marked as units, and the structured statuses are also available to AI feedback.
Besides booleans and numeric scores, an assessment entry may be `correct`,
`dependent`, `partial`, `incorrect`, `empty`, or `invalid`.

Custom result dictionaries may also set `show_score: False`. The numeric score
is still returned for assessment, but a partial result is displayed as
“Partially correct” without a percentage. This is useful when a percentage
would disclose a hidden property of the answer.

#### Matrix basis assessment

For basis problems, use the shared `assess_basis(...)` helper instead of
duplicating rank, dependence, scoring, coloring, and feedback logic in every
checker. See the **[complete `assess_basis` API reference](../docs/assess-basis.md)**
for its parameters, callback contract, scoring rule, statuses, edge cases, and
row/column examples.

#### Graph construction assessment

For graph-theory construction problems, use the shared free-placement
`JXG.QuartoGraphEditor` API and convert its response with the browser-side
`graph_from_response(...)` helper. See the **[complete graph-editor API
reference](../docs/graph-editor.md)** for interactions, configuration, response
schema, NetworkX validation, and a complete Quarto example.

#### General custom-checker example

The following example demonstrates a custom checker that assesses a property
of one symbolic expression. It does not use the matrix basis helper.

````markdown
```{math-exercise}
#| label: monotone-increasing
#| vars: x
#| mode: custom
#| checker: |
#|   def check(response, symbols):
#|       from sympy.calculus.util import continuous_domain
#|       f = response["expressions"][0]
#|       x = symbols["x"]
#|       interval = Interval(0, 1)
#|       try:
#|           derivative = diff(f, x)
#|           regular = (f.free_symbols <= {x}
#|                      and f.subs(x, 0).is_real is True
#|                      and continuous_domain(f, x, interval) == interval
#|                      and continuous_domain(derivative, x, interval) == interval)
#|           lower = minimum(derivative, x, interval) if regular else S.NegativeInfinity
#|           rise = simplify(f.subs(x, 1) - f.subs(x, 0))
#|           valid = regular and lower.is_nonnegative is True and rise.is_positive is True
#|       except (NotImplementedError, ValueError, TypeError):
#|           valid = False
#|       return {"correct": valid,
#|               "feedback": "Require a real function with a continuous derivative, non-negative derivative throughout [0,1], and a positive endpoint rise. Use an expression whose domain and derivative sign SymPy can establish."}
#| tests: |
#|   def test(check, symbols):
#|       x = symbols["x"]
#|       for f in (x, x**2, exp(x), x**3+x):
#|           assert check({"expressions": [f]}, symbols)["correct"]
#|       for f in (S.One, -x, x-1/(100*(x-Rational(1,2))), I*x):
#|           assert not check({"expressions": [f]}, symbols)["correct"]

Give a real function with a continuous derivative that is non-decreasing on $[0,1]$ and satisfies $f(1)>f(0)$:
$f(x)=$ ___[]
```
````

Custom checker code is shipped in the generated HTML, is visible to students,
and executes in browser-side Pyodide. It must therefore come only from trusted
document authors. Student strings go through the extension's existing SymPy
expression parser and are never concatenated into the custom checker source;
invalid expressions and checker exceptions are shown as errors.

#### Tests belong to the exercise

See the [question-test guide](question-tests.md) for both formats and runner commands.

For `mode: custom`, an optional `tests: |` block lives directly beside the
checker. Define `test(check, symbols)` and use ordinary Python assertions to
cover valid answers, invalid answers, and important edge cases. SymPy names
and the same assessment helpers as the browser checker are available.

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

When an exercise contains tests, `quarto render` runs them using native
Python and stops the build on failure, identifying the exercise label. Install
SymPy in that build environment, plus any packages imported by the checker
(for example, NetworkX). Set `MATH_EXERCISE_PYTHON` to choose a Python
executable. Exercises without a tests block retain their existing build
requirements.

Run the same tests directly, without rendering, with:

```bash
python _extensions/math-exercise/question-tests.py lesson.qmd
```

Pass the files that contain exercise blocks, including any included QMD files.
For longer fixtures, keep the question readable with one line:
`#| tests: _includes/tests/tree.py`. That file defines the same
`test(check, symbols)` function. Paths are relative to the Quarto project root,
or the document directory outside a project; run the standalone command from
that directory too. Each test file belongs to its named exercise. The examples'
source panels show referenced test files in a separate collapsed section, so
authors can copy the exercise and its tests together.

This repository's `npm test` and GitHub action call that same runner. Tests
travel with the copied exercise and remain visible in its documentation source
panel; they are excluded from the browser's checker payload. They are trusted
author code executed during the build. Native tests exercise checker logic;
they do not replace browser interaction checks or certify Pyodide parity.

### Arbitrary JSON from JSXGraph

Graphical answers use the MIT-licensed
[`jsxgraph-quarto`](https://github.com/jsxgraph/jsxgraph-quarto) extension
(version 1.1.0 or later, which contains the generic assessment bridge). It is a
separate dependency: install it with `quarto add jsxgraph/jsxgraph-quarto` (the
CTM Assessment umbrella already includes it) and enable both filters, in either
order:

```yaml
filters:
  - jsxgraph
  - math-exercise
```

Give a JSXGraph iframe an `assessment_id` and register a response provider:

````markdown
```{.jsxgraph assessment_id="my-board"}
var board = JXG.JSXGraph.initBoard(BOARDID, {axis: true});
var point = board.create('point', [0, 0]);

JXG.QuartoAssessment.register({
  board: board,
  response: function () {
    // Any JSON-serializable value is allowed.
    return { point: [point.X(), point.Y()] };
  },
  ai: {
    render: true,
    summary: function (data) {
      return { point: data.point };
    }
  }
});
```

```{math-exercise}
#| mode: custom
#| response: jsxgraph:my-board
#| embed-response: true
#| checker: |
#|   def check(response, symbols):
#|       x, y = response["point"]
#|       return {"score": 1 if y > x else 0}
#| tests: |
#|   def test(check, symbols):
#|       assert check({"point": [1,2]}, symbols)["score"] == 1
#|       assert check({"point": [2,1]}, symbols)["score"] == 0
#|       assert check({"point": [1,1]}, symbols)["score"] == 0

Move the point above the line $y=x$.
```
````

`embed-response: true` changes only the rendered placement: the JSXGraph block
remains a separate source block, but its iframe is moved into the exercise card
between the question and the controls. Leaving the option unset preserves the
standalone board placement.

The two fenced blocks deliberately remain siblings rather than being nested.
This lets the JSXGraph and `math-exercise` Quarto filters parse their own block
types independently; the browser relocates the already-rendered iframe after
the page loads.

The payload has no required educational schema: objects, arrays, numbers,
strings, booleans, and null values are decoded into ordinary Python types.
Functions, cyclic structures, DOM nodes, and live JSXGraph objects are not JSON
and must be converted by the response provider. The transport validates the
iframe window and request id, times out after five seconds, and has a 1 MB
accidental-overload limit.

Custom checkers that need another package included with Pyodide may list it in
the exercise options. Packages are downloaded only before the first check that
needs them and are shared by later exercises on the page:

```yaml
#| mode: custom
#| packages: networkx
```

The optional `ai` configuration is independent of local assessment:

- `summary` may be a JSON value or a function of the response. It is capped
  before inclusion in the AI prompt.
- `render: true` converts the current JSXGraph board to a PNG and attaches it
  for vision-capable providers.
- Providers that reject image input with a format/capability error are retried
  once with the textual summary only.
- The full arbitrary response JSON stays local and is not sent to the AI.

Because the generated JSXGraph iframe is sandboxed with an opaque origin, the
bridge communicates with `postMessage`; the parent never attempts direct DOM
access. Custom checker code and board source remain visible in the generated
page and must come from trusted document authors.

### Partial credit

Partial credit is opt-in for built-in modes:

```yaml
#| partial-credit: true
#| form-credit: 0.5
```

- Multiple fields are averaged, with empty fields counting as zero.
- `set` uses `max(0, M − (S − M)) / E`, where `M` is the number of matched
  elements, `E` the number expected, and `S` the number submitted: each extra
  guess cancels one match. For an expected set of four, `1, 2` scores 0.5 and
  `1, 2, 5` scores 0.25.
- A mathematically equivalent answer that fails `mode: exact` or `form`
  receives `form-credit`.
- Other individual built-in checks remain binary.
- Custom checkers may always return any score from `0` to `1`.

The default remains binary, so existing documents keep their current behavior.

### Form checking (`form`)

In addition to correctness, the answer can be required to be in a specific
**representation** (combinable with `mode: equivalent` or `mode: exact`):

| Value | Required form |
|-------|---------------|
| `factored` | fully factored, e.g. `(x+1)*(x+2)` |
| `expanded` | fully expanded, e.g. `x**2 + 3*x + 2` |
| `single_fraction` | a single fraction instead of a sum of fractions |
| `lowest_terms` | a fully reduced fraction |

```yaml
#| mode: equivalent
#| vars: x
#| form: factored
Factor x² + 3x + 2: __[(x+1)*(x+2)]
```

→ `(x+1)*(x+2)` is accepted; `x**2 + 3*x + 2` is mathematically correct but
not factored, so it's reported as "correct, but not in factored form".

`form: lowest_terms` works both for algebraic fractions (via SymPy's
`cancel()`) and for **plain numeric fractions** – there, the raw text is
checked directly against `numerator/denominator`, independent of SymPy's
automatic reduction at parse time:

```yaml
#| mode: equivalent
#| form: lowest_terms
Reduce 6/8 fully: _[3/4]
```

→ `3/4` is accepted; `6/8` (mathematically equal, but not fully reduced) is
rejected as "not in reduced form".

Difference from `mode: exact`: `form: lowest_terms` + `mode: equivalent`
accepts **any** value-equal, fully reduced notation (e.g. `3/4` or `0.75`)
without requiring the exact string of the `correct` field. `mode: exact`
additionally requires that exact string.

---

## Task pool

With `#| pool: true` and `---` as a separator, you can define **multiple
variants**. One variant is picked randomly per page load and stored for the
session.

````markdown
```{math-exercise}
#| label: circle-pool
#| caption: Circle area
#| pool: true

Compute the area of a circle with r = 3 cm.
A = _[pi * 9] cm²

---

Compute the area of a circle with r = 5 cm.
A = _[pi * 25] cm²

---

Compute the area of a circle with r = 7 cm.
A = _[pi * 49] cm²
```
````

- All variants share the same options (`vars`, `mode`, `reject`).
- The chosen variant stays stable within the browser session (no change on
  re-render).
- A **↻ button** in the top-right of the exercise loads a new (different)
  random variant.

---

## AI feedback

With ai-feedback installed, every exercise has a **Feedback** button using the shared
[ai-feedback runtime](https://github.com/Erasmus-CTM/ai-feedback). By default it
builds a copyable prompt without an API account. The cogwheel opens the shared
settings dialog for copy/API mode, base URL, model, API key and browser storage.
No provider presets are bundled. Existing math credentials are available through
an explicit import in that dialog; they are never selected silently.

**Check** runs the mathematical checker. **Feedback** does not run Python or the
checker: it collects the current response and reuses only matching prior Check
results. Editing, resizing or selecting another pool variant invalidates that
evidence and pending feedback. Graph payloads stay local; only the explicitly
provided AI summary and optional image are sent for feedback.

Install ai-feedback once with `quarto add Erasmus-CTM/ai-feedback`. The math
filter loads that shared installation automatically; no runtime is bundled here.
An explicit ai-feedback filter also works, in either order. Without it, see
`feedback` under [Document options](#document-options-yaml-front-matter).

All context collection and teaching instructions now belong to ai-feedback.
Omitted `context` collects preceding section prose; `context: none` opts out;
`context: id1,id2` selects reusable `.ai-context` blocks shared with text and both
Python integrations. See the [shared guide](https://github.com/Erasmus-CTM/ai-feedback/blob/main/README.md).
Tests use the installed dependency through `AI_FEEDBACK_EXTENSION=/absolute/path/to/ai-feedback/_extensions/ai-feedback`.

### Progressive hints

Each further Feedback click on the same exercise (on the same page) makes
the feedback more concrete:

| Attempt | Behavior |
|---------|----------|
| 1st | One diagnostic question pointing toward the first likely mistake; no formula, method, intermediate value, or answer |
| 2nd | A conceptual hint naming what to inspect; no formulas, calculations, substitutions, intermediate values, or answer |
| 3rd | Procedural guidance in at most three steps; a general formula is allowed, but task values, arithmetic, and the final answer remain hidden |
| 4th+ | A concise complete worked solution with substitutions, calculations, and the final answer |

The attempt count is stored per page path and exercise label in
`sessionStorage`, so it survives a page reload within the browser session.
Failed, cancelled and stale requests do not consume a hint.

Before producing any hint, the tutor is instructed to treat the exact task and
learning context as authoritative. It must preserve stated givens, grouping,
signs, operators, notation, units, domains, assumptions, and constraints; avoid
silently importing conventions from a familiar problem type; and verify factual
and mathematical claims against the supplied material. Unsupported claims about
"typical" values, plausible ranges, magnitudes, or likely error causes are
forbidden. When the source is genuinely ambiguous, the tutor should ask a
guiding question rather than invent an interpretation.

### How the feedback prompt is assembled

The shared API builds a structured request with task, materials, labelled current
responses, private checker evidence, localized teaching criteria and an explicit
hint step. Mathematics retains its English, German and Norwegian Bokmål teaching
instructions: exact givens and notation, private assessment, short feedback,
LaTeX formatting and the four levels above. Step four permits a full solution;
earlier steps prohibit it.

Evidence includes only statuses, finite scores and known matrix row/column
assessments from an unchanged earlier Check. Expected answers, checker code,
checker messages, arbitrary result properties and Python errors are excluded.
Copy mode exposes the same prompt policy as API mode. Images must be attached
separately when using a copied prompt.

### Provider and model portability

The shared runtime owns provider negotiation, the 60-second timeout,
cancellation, capability caching and safe Markdown/LaTeX rendering. Mathematics
adds a language-script validation retry and allows an image-unsupported endpoint
to retry using the explicit graphical summary. Errors never consume hint steps.
See the [shared API](https://github.com/Erasmus-CTM/ai-feedback/blob/main/docs/api.md)
for current settings, request limits and transport behavior. The
[original provider design note](../docs/model-capability-adapter.md) is historical.

### AI feedback context

By default, the LLM only saw the exercise text itself – it had no idea that,
say, "convert to binary" actually means "convert to 8-bit two's complement",
because that rule was explained in a paragraph above the exercise, not inside
it. `math-exercise` sends that surrounding context along automatically, with
an explicit option for context that doesn't live in the same section.

**Automatic (no authoring changes needed).** Every exercise collects the
prose (paragraphs, lists, its own section heading) written since the last
heading in the document, and sends it to the LLM as background context. Just
explain the scheme in normal text above the exercise(s) – as many exercises
as you like can share the same explanation. This part is resolved once, at
render time.

**Explicit, for context outside the current section.** Tag any Quarto
content with a unique id and the `.math-exercise-context` class, and
reference it from any exercise – anywhere on the page, in any order – via
`#| context: id1, id2, ...`:

````markdown
::: {#fp16 .math-exercise-context}
IEEE-754 half precision: 1 sign bit, 5 exponent bits (bias 15),
10 mantissa bits.
:::

```{math-exercise}
#| label: fp-decode
#| context: fp16
Decode 0x3C00 as a half-precision float: _[1]
```
````

The block renders as normal, visible content on the page (styled as a light
callout) – students see the same explanation the AI gets. Unlike the
automatic case, this part is resolved lazily, client-side, when Feedback is
clicked, using the current prose and preserved LaTeX source. The Quarto filter
attaches source metadata to formulas in explicit context blocks. Dynamically
generated mathematics can also be recovered from MathJax 3/4 (HTML or SVG) and
KaTeX. Inline and display mathematics retain their delimiters; rendered glyphs
are never flattened into a substitute formula.

Context rules for explicit references:

- Several ids may be supplied as a comma-separated list; their order becomes
  the order in the AI request, and the same block may be reused by several
  exercises.
- Missing ids, elements without the `.math-exercise-context` class, empty
  blocks, and blocks that exceed the remaining budget are skipped with a
  browser console warning rather than failing the request.
- Combined budget: 6,000 characters across all of an exercise's explicit
  context blocks; a block that would exceed it is omitted whole (never cut
  mid-block). The automatic case has its own, separate 1,500-character cap
  (keeping the most recent whole blocks, since those are closest to the
  exercise). Collection stops before a block that would exceed the cap; a
  single oversized final block therefore leaves automatic context empty.
  Use explicit references for longer explanations. Neither path cuts through
  a formula to meet its budget.

To opt an exercise out of context entirely, use `#| context: none`.

**Question and caption mathematics.** The filter also preserves the question
and caption before typesetting. Pool questions refresh that source on every
draw. Correct-answer attributes are removed from the saved question source;
inputs become their current field labels in the request, and dynamic matrices
remain named placeholders. Student work is sent separately. When reading page
content, the serializer excludes hidden elements, controls and previous feedback.

If rendered mathematics has neither saved source nor a supported renderer's
source, the request contains `[Mathematical source unavailable]` and the browser
console reports it. This avoids silently turning, for example, `\frac{N}{l}`
into `Nl`. Re-rendering a document with the updated extension adds the source
metadata; existing published HTML is not changed by updating the extension alone.

The [AI feedback examples](https://erasmus-ctm.github.io/math-exercise/ai-feedback.html)
include a solenoid example. To inspect a request, open the browser's Network
panel, request feedback, and examine the chat-completions request's
`messages[1].content`, especially `<learning_context>` and `<task>`.

For local regression tests, install Node dependencies with `npm ci`, install
the two extension dependencies (`quarto add Erasmus-CTM/ai-feedback` and
`quarto add jsxgraph/jsxgraph-quarto`; both are git-ignored here) and run
`npm test` with `AI_FEEDBACK_EXTENSION` set to the installed ai-feedback folder
(for example `_extensions/Erasmus-CTM/ai-feedback`; the tests read this
variable). Set `JSXGRAPH_EXTENSION` if JSXGraph is installed outside
`_extensions/`. The checker tests also
require Python with SymPy 1.13 or later and NetworkX 3.4 or later (CI uses the
browser's SymPy 1.13.3). Install Quarto (or set
`QUARTO_BIN`) to run the rendered-document tests; they are skipped when Quarto
is unavailable. CI requires and runs them.
The tests use local renderers and a mocked AI endpoint; no model or credentials
are needed.
In VS Code, **Terminal → Run Task…** offers the same commands (`.vscode/tasks.json`): the default test task runs the tests, the default build task renders and then tests.

The AI request contains the selected context, the task, and the student's
current response as individually labelled fields. A separate private assessment
list, when a matching Check exists, contains only the corresponding checker statuses and normalized scores
(`correct`, `partial`, `incorrect`, `empty`, or `invalid`) and is labelled as internal evidence that must
never be quoted or summarized to the student. Everything is clearly delimited
and accompanied by an instruction to treat it as data rather than as
instructions (a prompt-injection mitigation, given that both course content and
the student's own answer end up inside the prompt). It does **not** include the
expected answer. The limited private status metadata lets feedback acknowledge
correct work and focus on the next mathematical idea without exposing the
solution or repeating information already shown by the interface.

For clearer multi-field feedback, authors can provide labels explicitly:

```yaml
#| field-labels: S, E, M
```

Without this option, existing documents remain compatible: a single input is
labelled `Answer`, while multiple inputs become `Answer field 1`, `Answer field
2`, and so on. Too few supplied labels are completed with these fallbacks;
extra labels are ignored with a browser console warning. Empty fields are kept
in the AI request so feedback can identify what is still missing.

### Privacy

The base URL, API key, and model configuration remain in the student's
browser. However, requesting feedback sends the resolved context, exercise
text, and student response to the configured AI provider. Course authors
should reference only material they are comfortable sending to that
provider, and students should follow the provider's applicable privacy
policy.

---

## Input syntax for students

The collapsible **input help** shows all the important notations:

| Expression | Input |
|------------|-------|
| x² | `x^2` or `x**2` |
| √x | `sqrt(x)` |
| ⁿ√x | `root(x, n)` |
| π | `pi` |
| e | `E` |
| sin(x) | `sin(x)` |
| ln(x) | `ln(x)` |
| \|x\| | `Abs(x)` |
| ∞ | `oo` |
| ∫f dx | `integrate(f, x)` |
| d/dx f | `diff(f, x)` |

Basic operators: `+` `-` `*` `/`
Power: `^` or `**`
Brackets: `(` `)`

---

## Interaction with a Pyodide extension

The extension works **with and without** a `{pyodide}` code block:

- **With a block:** the Pyodide extension initializes the runtime;
  math-exercise waits for that instance and reuses it.
- **Without a block:** Pyodide starts loading in the background when the page
  opens; SymPy is loaded on the first **Check** (that click takes a few seconds
  longer).

The checker helpers run in their own Python module, so learner code in Pyodide
cells that rebinds names such as `symbols`, `Matrix` or `sqrt` no longer breaks
checks; if other code removes that module, the next Check installs it again.
Answers are parsed by SymPy, which evaluates Python: input containing `__`
is rejected, and interpreter state that an answer or a custom checker changes
(`builtins`, standard streams, recursion limit, `sys.path`, working directory,
CTM modules) is restored after each check, so other exercises on the page keep
working. Grading still runs in the learner's browser and is not tamper-proof.

If the Pyodide extension restarts its runtime, the next Check sets SymPy up
again, and a check that was running (also during SymPy's setup) is repeated
once on the new runtime. With a runtime in a worker (pyodide-interaktiv), a
check that takes longer than 20 s, for example an answer such as `9**9**9**9`,
offers **Stop** (the time to load SymPy and packages is not counted; a load that has not finished after 180 s also offers Stop), which restarts Python for the whole page; a stopped check (from
any component's Stop) is not repeated. Change the time with
`math-exercise: {stop-after: 30}` (seconds), or for all CTM components of a
project with `ctm-assessment: {stop-after: 30}`. Python running on the page itself cannot be interrupted; the
page then has to be reloaded.

Combination with
[pyodide-interaktiv](https://github.com/Erasmus-CTM/pyodide-interaktiv):

```yaml
filters:
  - pyodide-interaktiv
  - math-exercise
```

## Rendered examples

The examples from `main` are published as a small navigable
[math-exercise examples site](https://erasmus-ctm.github.io/math-exercise/),
with focused pages for basic exercise features, expressions and equivalence,
AI feedback and context, open-ended assessment, graphical JSXGraph responses,
graph-theory constructions, and Norwegian vector/matrix input. Every rendered
exercise and graph has a collapsed panel containing its complete source. The
graphics page includes
pooled point selection, a draggable one-period window, movable piecewise-linear
graphs, and freehand-curve assessment. The original all-in-one regression page remains
available from the site. The complete Quarto project is rebuilt automatically
whenever `main` changes. Feature branches matching `feature/**` are published under
`previews/<branch-slug>/`; obsolete previews are removed by the next main
deployment.

---

## Configurable shared teaching policies

AI Feedback 0.8 loads named definitions from `ai-feedback.policy-files` and
`page-policy-files` (one path or an ordered list, relative to the project root).
Files contain `ai-feedback.policies` and optional targeted `exercises` entries.
Loading a file alone does not change the baseline. Explicitly select
`project-policy` or `page-policy`; use `#| feedback-policy: name` on a cell for
an exercise specialization.

A named policy can `extend` another using `extends: parent-name`. Omitted fields
inherit from its parent and effective integration baseline. `base-prompt`
applies throughout the activity; each step adds its `step-prompt`. A supplied
`steps` list replaces the complete inherited sequence; `steps: []` selects review
mode. Step limits and solution permissions override policy-level values.
Run/Check resets by default; select `reset-on-run: false` to preserve progression.
Explicit Reset always restarts it. The old `prompt`, authored `defaults` and
`integrations` forms are rejected.

See the [shared policy guide](https://github.com/Erasmus-CTM/ai-feedback/blob/main/docs/feedback-policies.md).

### Standalone example

`example.qmd` demonstrates this package with shared feedback. Install `Erasmus-CTM/ai-feedback@main`, then run `quarto render example.qmd`. No other integration extension is required. The example builds automatically on pushes and pull requests; download the `standalone-example` Actions artifact. Feedback defaults to copy mode, which needs no API key.

### Page and exercise feedback policies

Put teaching policy definitions in YAML files and activate them explicitly with
`project-policy`, `page-policy` or a cell's `#| feedback-policy: name`. A policy
file registers definitions; `page-policy-files` alone does not change page
behavior. The same named policy can be reused across integrations.

YAML `ai-feedback.exercises.<integration>.<label>` targets one authored label;
an explicit named selection takes precedence over that entry. Omitted settings
inherit; `steps` replaces the entire list. See the
[shared policy guide](https://github.com/Erasmus-CTM/ai-feedback/blob/main/docs/feedback-policies.md).
# Reusable matrix-input API

`_extensions/math-exercise/matrix-input.js` and `matrix-input.css` expose the
existing dynamic editor independently of the exercise runtime, Python checker,
and AI feedback. Include both assets and use the classic browser global:

```js
const renderer = MatrixInput.create({
  idPrefix: 'question1',
  zeroDimensions: 'reject',
  maxEntries: 64,
  labels: { matrixRows: 'Rows', matrixColumns: 'Columns' },
  onChange({ kind, value }) {
    // Invalidate validation, grading and feedback evidence on every change.
    // kind is edit, resize, or write; value contains untouched raw strings.
  },
});
const spec = {
  name: 'A',
  rows: { auto: true, initial: 2, min: 1, max: 8 },
  cols: { auto: false, initial: 2, min: 2, max: 2 },
};
host.innerHTML = renderer.renderHTML(spec).html;
const editor = renderer.mount(host.firstElementChild);
editor.write({ rows: 2, cols: 2, raw: ['x+x', '0.1', '1/2', ''] });
const response = editor.read(); // {type: 'matrix', rows: 2, cols: 2, raw: [...]}
editor.resize(3, 2);
editor.setState({ status: 'incorrect', cells: [['invalid']] });
editor.reset();
editor.destroy(); // Call before removing/replacing the editor.
```

Dimensions and bounds are integers up to 20. Fixed axes have equal `initial`,
`min` and `max`; resizable axes use `auto: true`. `maxEntries`, when supplied,
bounds the product of the configured axis maxima, so every selectable shape
fits. Invalid writes and resizes are rejected before changing the DOM.
`resize` preserves surviving cells by row/column; removed cells are discarded.
`write` requires exactly `rows * cols` raw strings in row-major order. No
trimming, scalar parsing, decimal normalization or algebraic rewriting occurs.
`reset` restores the mounted shape and raw values. `destroy` removes component
listeners and is idempotent. Remounting destroys the previous instance.

The default `zeroDimensions: 'reject'` requires positive axes. The explicit
`'canonical'` policy collapses any shape with a zero axis to 0 by 0 and restores
the other configured axis when adding a row/column. Math-exercise opts into
this historical policy and retains its custom-checker transport's whitespace
trimming; other consumers must choose their own zero-dimension contract.

Optional labels are `matrixRows`, `matrixColumns`, `matrixAddRow`,
`matrixRemoveRow`, `matrixAddColumn`, `matrixRemoveColumn`, and `emptyMatrix`.
Existing math-exercise locales supply them through its adapter. Each consumer
should choose a distinct `idPrefix` for each editor group.

`setState` accepts an overall `status`, optional `rows`/`columns` arrays and
optional `cells` rows of statuses. A cell overrides its column, then its row,
then the overall status. Supported presentation statuses are `correct`,
`incorrect`, `invalid` (or `error`), `partial`, `dependent`, `empty`, and `''`.
Supplied coordinates must fit the current shape. This only displays a
consumer's assessment; it computes no score or partial-credit policy. Edits,
resizes and writes clear supplied states before notifying the consumer.

The source of this editor is math-exercise. Independent consumers may vendor
these two files under their licenses, recording the upstream repository,
commit and file hashes. Updates should replace the pinned files together;
consumer parsing and grading remain outside the component.
