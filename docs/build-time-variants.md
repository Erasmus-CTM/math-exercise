# Build-time variants

Requires Python 3 and PyYAML on the render machine (`python3 -m pip install PyYAML`).
No extra student-side runtime is required: Quarto builds ordinary math-exercise
pools. Existing explicit pools, checker signatures and grading options still work.

Put each reviewable exercise in a separate `.qmd` file and include it:

```markdown
{{< include exercises/triangle.qmd >}}
```

See `_includes/variants/triangle.qmd` for a complete expression example, and
`perpendicular.qmd`, `matrix.qmd`, `coupled.qmd`, `geometry.qmd` for custom checkers.
`generated-variants.qmd` includes all five with an optional author review panel.

## Definition

Add ordinary YAML `#|` options to a math-exercise block:

```yaml
#| parameters:
#|   ab: [3, 4, 5]
#|   offset: {start: 1, stop: 4}
#| derived:
#|   bc: ab + offset
#| constraints: [ab > 0]
```

Parameter choices are finite numbers; ranges are inclusive integers and accept
`step`. Generation takes the Cartesian product, with a limit of 10,000 candidate
combinations. Duplicate choices, unknown names, cyclic derived values, nonfinite
results and empty student selections are errors. Base-parameter constraints run
before derived expressions, so `x0 != p2` can guard a denominator. Constraints
requiring derived values run afterwards; derived calculations must themselves
be defined for every candidate that passes the base constraints.

Derived expressions use a restricted AST interpreter, not Python `eval`. It
accepts arithmetic (`+ - * / % ^ **`), comparisons, `and/or/not`, `pi`, and
`sqrt, sin, cos, tan, floor, ceil, exp, log, abs, min, max, round, sigfig`.
Derived numbers are floating-point; **keep exact checker answers symbolic**:
`_[{{bc}}/sqrt({{ab}}^2+{{bc}}^2)]`, rather than a decimal approximation.

Use `{{name}}` in the question, `solution`, `variant-context`, checker or tests.
For displayed rounding, use `{{value:.3f}}` or `{{value:.3g}}`. A `solution: |`
block contains normal Markdown and LaTeX, rendered during the build. It appears
in a collapsed solution block, or in an existing element named by
`solution-target`. No HTML is needed in the QMD. `variant-context` adds explicit
text to AI context; `context: none` suppresses it too. Solutions and test cases
are excluded from AI requests.

## Optional author review

Ordinary workflow: **edit QMD → render → publish**. All valid candidates are used.

Optional workflow: **render review → inspect/test → replace selection options in
the exercise QMD → render/publish**. Enable review with `#| review: true` in an
exercise, or `math-exercise-review: true` in an author page's front matter. The
review page shows all valid candidates, including excluded ones. Selecting a row
loads that candidate into the actual exercise, solution and connected figure.

Use **Run all authored tests** to run expected-correct and anticipated-wrong
fixtures through the same browser checker as student answers. It requires the
same Pyodide connection as ordinary Check. No tests means no automatic evidence
of correctness; visual and mathematical review remain the author's responsibility.

**Copy selection** provides `#| include-variants: [...]` and a
`#| reviewed-fingerprint: ...` line. Replace the previous selection lines in the
separate exercise QMD. Do not append competing include/exclude settings. Turn
off review for student builds. Alternatively author `exclude-variants: [...]`.
The UI does not write to the filesystem or GitHub. Keep review pages out of the
normal render list if you do not want them in student navigation.

IDs are hashes of canonical base parameter values, not row numbers. They survive
parameter reordering. A separate full definition fingerprint covers the question,
checker, options, solution and context templates. Changes make reviewed builds
fail; review mode remains available to inspect the new definition and replace
outdated approval. External context/figure files and extension upgrades are not
fingerprinted; review those changes separately.

## One variant protocol

After initialization, `cell.mathExercise.getVariant()` returns a fresh snapshot:

```javascript
{ id, parameters, derived, fingerprint, context }
```

The cell emits bubbling `math-exercise:variant-change` with
`event.detail = {label, variant}` after selection changes. Use `getVariant()` on
startup too, because listeners may attach after the initial event. The selected
stable ID is stored in sessionStorage; no browser-side generation occurs.
`cell.mathExercise.selectVariant(id)` selects an available variant by ID.

Custom checkers retain **`check(response, symbols)`**. For generated exercises,
`response['variant']` holds the same snapshot. This applies both to expression
responses (including named matrices) and JSXGraph responses. Generated custom
responses must be JSON objects; existing nongenerated arbitrary responses retain
their existing behavior. The engine overwrites any supplied `variant` property.
Never resample parameters inside a checker or figure.

Fixtures use either `answers: [...]` for expression fields, or `response: {...}`
for a custom JSON response, plus `expected: correct` (one custom result) or a list
of expected statuses (one per built-in field). Matrix fixture responses use the
existing `kind: expressions`, `inputs` and `raw` transport. Numeric raw fixture
values become strings, just like typed answers. Use `name` to identify failures.

The API for review invokes the actual checker, with the candidate record and
resolved checker source. Changing variants invalidates pending feedback and
clears student fields; adapters must similarly reset their own external state.
