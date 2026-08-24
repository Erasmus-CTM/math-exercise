# math-exercise – Quarto Extension

**Interactive math exercises evaluated entirely in the browser** — no server, no Python kernel.
Students type symbolic answers (e.g. `pi*9`, `x^2 + 2*x + 1`) and get instant feedback powered by
[SymPy](https://www.sympy.org) running in [Pyodide](https://pyodide.org) (Python via WebAssembly).
Optional AI feedback gives progressive hints via any OpenAI-compatible API.

---

## Installation

```bash
quarto add Erasmus-CTM/math-exercise
```

Then enable the extension in your document:

```yaml
filters:
  - Erasmus-CTM/math-exercise
```

No `{pyodide}` code block needed – Pyodide and SymPy are loaded automatically
on the first click of **Check**, unless they're already available through
another Pyodide extension.

---

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

## Input fields in the question text

| Marker | Width | Element |
|--------|-------|---------|
| `_[answer]` | narrow (~10 chars) | `<input>` |
| `__[answer]` | medium (~20 chars) | `<input>` |
| `___[answer]` | wide, 2-row | `<textarea>` |

Multiple fields in one exercise are checked together when clicking **Check**.
The answer inside `[...]` is a SymPy expression, e.g. `pi * 9`, `x**2 + 2*x + 1`.

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
| `response` | `jsxgraph:iframe-id` | — | obtain arbitrary JSON from a JSXGraph assessment iframe instead of expression fields |
| `embed-response` | `true` / `false` | `false` | move the referenced JSXGraph iframe into the exercise card, between the question and controls |
| `partial-credit` | `true` / `false` | `false` | average multiple fields, partially score sets, and award `form-credit` for equivalent answers in the wrong form |
| `form-credit` | number from `0` to `1` | `0.5` | score for an equivalent answer that fails `mode: exact` or the requested `form` |
| `pool` | `true` / `false` | `false` | enable a task pool |
| `field-labels` | comma-separated | — | optional human-readable labels for answer fields, e.g. `S, E, M`; missing labels fall back to `Answer` or numbered field names |
| `context` | comma-separated element IDs, or `none` | — | AI-feedback context: reference explicit `.math-exercise-context` block(s) by id, or `none` to disable the automatic context. See [AI feedback context](#ai-feedback-context) |

---

## Document options (YAML front matter)

```yaml
math-exercise:
  lang: de        # UI language (default: en)
```

---

## Interface language

Currently supported: **German (`de`)** and **English (`en`)**.
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
instruction given to the AI: on an English page, the tutor responds in
English.

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
| `decplaces: 2` | round both values to 2 decimal places, then compare |
| `sigfigs: 3` | round both values to 3 significant figures, then compare |

```yaml
#| mode: numeric
#| tolerance: 0.01
Approximate π: _[3.14159]
```

→ `3.14`, `3.15` (with tolerance 0.01, only `3.14`) are accepted depending on
the chosen tolerance.

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
The function may return a boolean, a score from `0` to `1`, or a dictionary
containing `score` (or `correct`) and optional plain-text `feedback`.

````markdown
```{math-exercise}
#| label: strongly-monotone
#| vars: x
#| mode: custom
#| checker: |
#|   def check(response, symbols):
#|       f = response["expressions"][0]
#|       x = symbols["x"]
#|       lower = minimum(diff(f, x), x, Interval(0, 1))
#|       if lower.is_positive is True:
#|           return {"score": 1, "feedback": "The derivative has a positive lower bound."}
#|       return {"score": 0, "feedback": "No positive derivative lower bound was established."}

Give an example of a strongly monotonically increasing function on $[0,1]$:
$f(x) =$ ___[]
```
````

Custom checker code is shipped in the generated HTML, is visible to students,
and executes in browser-side Pyodide. It must therefore come only from trusted
document authors. Student strings go through the extension's existing SymPy
expression parser and are never concatenated into the custom checker source;
invalid expressions and checker exceptions are shown as errors.

### Arbitrary JSON from JSXGraph

This repository includes a local fork of the MIT-licensed
[`jsxgraph-quarto`](https://github.com/jsxgraph/jsxgraph-quarto) filter with a
generic assessment bridge. Enable both filters:

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

Move the point above the line $y=x$.
```
````

`embed-response: true` changes only the rendered placement: the JSXGraph block
remains a separate source block, but its iframe is moved into the exercise card
between the question and the controls. Leaving the option unset preserves the
standalone board placement.

The payload has no required educational schema: objects, arrays, numbers,
strings, booleans, and null values are decoded into ordinary Python types.
Functions, cyclic structures, DOM nodes, and live JSXGraph objects are not JSON
and must be converted by the response provider. The transport validates the
iframe window and request id, times out after five seconds, and has a 1 MB
accidental-overload limit.

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
- `set` uses `2M / (E + S)`, where `M` is the number of matched elements,
  `E` the number expected, and `S` the number submitted. Missing elements and
  extra guesses both reduce the score.
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

Every exercise has a **Feedback** button. On the first click, the
**"Set up AI feedback"** dialog opens:

| Field | Meaning |
|-------|---------|
| Provider preset | fills in the base URL + example model for Cerebras, OpenRouter, OpenAI, or Ollama |
| Base URL | the API endpoint, e.g. `https://api.cerebras.ai/v1` |
| API key | stays strictly local in the browser |
| Model | freely editable (e.g. `gpt-oss-120b`); **"Fetch models"** lists the provider's available models |

Credentials are stored in `localStorage` and available on **all pages of the
same project** – set up once, use everywhere.

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
`localStorage`, so it survives a page reload.

Before producing any hint, the tutor is instructed to treat the exact task and
learning context as authoritative. It must preserve stated givens, grouping,
signs, operators, notation, units, domains, assumptions, and constraints; avoid
silently importing conventions from a familiar problem type; and verify factual
and mathematical claims against the supplied material. Unsupported claims about
"typical" values, plausible ranges, magnitudes, or likely error causes are
forbidden. When the source is genuinely ambiguous, the tutor should ask a
guiding question rather than invent an interpretation.

### How the feedback prompt is assembled

The extension builds two messages for the OpenAI-compatible chat-completions
request. The **system message** is assembled in this order:

1. **Private assessment rules** – checker statuses may guide the response but
   must never be quoted, summarized, or described as fields being "marked"
   correct or incorrect. Correct work may be acknowledged naturally; the tutor
   should otherwise move directly to the next mathematical idea.
2. **Mathematical grounding rules** – the exact task and learning context are
   authoritative. Givens, structure, notation, signs, units, domains,
   assumptions, and constraints must be preserved, and unsupported plausibility
   claims or imported conventions are forbidden.
3. **Output rules** – use the document language, remain concise, render
   mathematics with LaTeX delimiters, and output student-facing feedback only;
   chain-of-thought, scratch work, hidden analysis, and reasoning tags are
   forbidden.
4. **Context rules** *(when context is present)* – use it to select the right
   method and notation, but do not copy worked examples or prematurely reveal
   formulas and values.
5. **Current hint level** – the attempt-specific instruction is deliberately
   placed last for stronger compliance. Levels 1–3 prohibit progressively less
   information; only level 4 permits a complete solution.

The **user message** contains clearly separated blocks:

```xml
<learning_context>...</learning_context>
<task>...</task>
<student_response>
  <field label="...">student input</field>
</student_response>
<private_field_assessment never_quote="true">
  <field label="..." score="...">correct | partial | incorrect | empty | invalid | submitted</field>
  <exercise status="..." score="...">optional custom-checker feedback</exercise>
</private_field_assessment>
```

There may be several `<learning_context>` and `<field>` blocks. The expected
answer is never included. Built-in checks may include a private normalized score.
For `mode: custom`, fields are marked only as submitted or empty and a single
exercise-level assessment carries the joint result, because the checker may
depend on all expressions together.

Before display, the extension rejects empty responses and responses truncated
by the provider's completion limit. It also detects leaked `<think>`,
`<analysis>`, or `<reasoning>` tags. Such a response is never shown: the request
is retried once with a corrective student-facing-only instruction. If the retry
still leaks internal reasoning, a localized error is displayed instead. Failed
requests do not consume a hint attempt. The automatic retry can result in one
additional provider request.

Compatible with any **OpenAI-compatible API** (Cerebras, OpenRouter, OpenAI,
Ollama, …). AI responses support a small safe Markdown subset and render
LaTeX written with `\(...\)` or `\[...\]`.

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
clicked, directly from the rendered page – so it also picks up KaTeX-rendered
math cleanly (as its original `$...$` source).

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
  (keeping the most recent part, since that's closest to the exercise).

To opt an exercise out of context entirely, use `#| context: none`.

The AI request contains the selected context, the task, and the student's
current response as individually labelled fields. A separate private assessment
block contains only the corresponding checker statuses and normalized scores
(`correct`, `partial`, `incorrect`, `empty`, `submitted`, or `invalid`) and is explicitly marked as internal evidence that must
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
- **Without a block:** Pyodide and SymPy are loaded on the first check
  (the first click takes a few seconds longer).

Recommended filter combination with
[Erasmus-CTM/Pyodide-Feedback](https://github.com/Erasmus-CTM/Pyodide-Feedback):

```yaml
filters:
  - Erasmus-CTM/pyodide-feedback
  - Erasmus-CTM/math-exercise
```

---

## Funding

Part of this work was funded by the Erasmus+ project “Computational Thinking
makes sense of Mathematics” (2023-1-NO01-KA220-HED-000166744).

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
