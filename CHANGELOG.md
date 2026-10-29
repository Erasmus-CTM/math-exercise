# Changes

## Unreleased

- Similar problems can change the givens of a custom-checked exercise.
  `#| similar-data: h, x0` names number or expression variables of the
  exercise's `variables` that a generated problem may replace. The model gives
  new values as mathematical text; ctm-checkers' `bind_data` admits them
  (restricted grammar, same kind as the original, exact-value codec), the
  question shows them through `{{name}}` with the LaTeX it returns, and the
  same authored checker grades the new problem. The bound data is saved with
  the practice problem and restores without AI or Python. Example 4 on the
  similar-problems page. Needs a ctm-checkers with `math_exercise.bind_data`.
- Math that spans several lines, and a bare `\begin{...}...\end{...}` without
  `$`, are typeset. Before, the line break became `<br>` inside the formula, and
  KaTeX's auto-render left such math (and bare environments) as raw TeX. This
  was common in AI-generated similar problems, especially matrices. Lua and JS
  rendering stay identical.
- The independent solve of a generated problem (and of a reported key) may take
  three minutes instead of ordinary feedback's 60 seconds.

- Declarative question tests run through the real grader in every mode at
  build time and through the direct question-tests.py command. Named fields,
  raw student strings and score/partial expectations share ctm-checkers'
  runner; legacy custom test(check, symbols) assertions remain supported.

- Math answers use CTM Assessment's shared browser store. Matching sources or
  deployed variant hashes restore fields and matrix sizes without running a
  check. Changed or withdrawn answers remain read-only; the last result is
  shown as historical until a new Check. Exercise labels are required for
  saving; duplicate or missing labels use the shared warning and remain unsaved.
- A visible Copy answer button uses CTM Assessment's shared copy helper.
  Components can export typed fields and matrices through the shared page
  export. Graphical responses are not restored. Checker requests and grading
  are unchanged.

- `ctm-bootstrap.lua` is ctm-libs' new copy (CTM Assessment consolidation
  step 3): the bootstrap takes options for pyodide-interaktiv 1.9. math-exercise
  passes none, so its messages and behaviour are unchanged.

## 0.11.0 (CTM Assessment 0.10.0)

math-exercise grades with ctm-checkers, the Python checker library of CTM
Assessment, instead of checker code of its own. Every verdict is unchanged.

### Changed for authors

- **The checks are ctm-checkers**, which CTM Assessment installs next to
  math-exercise: the Python of every check mode, custom checkers,
  `assess_basis` and `graph_from_response`, in the browser, in the
  build-time question tests and in the rounding of generated variants. A
  page with an exercise loads ctm-checkers' page script once
  (`ctm-checkers.js`, about 40 KB, cached with the page's other files), and
  `math-exercise.js` is about 20 KB smaller. Without ctm-checkers such a
  page stops with the CTM Assessment install command; with a ctm-libs that
  has no `ctm.checkers` (before CTM Assessment 0.10) it stops with the
  update command.
- **Builds without AI feedback and exercises without a static check**: an
  exercise in `mode: custom` without a `checker` (where its feedback is on)
  is assessed by AI feedback only. In a build without AI feedback,
  math-exercise asks ctm-libs (`ctm.policy.withoutAI`), and
  `ai-feedback: without-ai` decides: the build stops and names it (unset),
  the question is shown as text without answer fields and Check button,
  with a note (`text`, and `self-check` for now), or the exercise is left
  out (`drop`). The text keeps the question's maths, shows a pool's first
  task and a generated exercise's first variant. A generated exercise's
  checker in its YAML options counts. With a ctm-libs that has no
  `ctm.policy.withoutAI`, such exercises are rendered as before.

### Changed for learners

- **Stop**: a check waiting behind the one the learner stops is now stopped
  too and shows "Stopped. Python was restarted …" (the next Check runs on the
  restarted Python); in 0.10 it ran after the restart. Checks that were still
  loading Python were already stopped this way.
- A runtime that stops answering after Stop no longer holds up the next
  checks: they run on the restarted runtime.

### Fixed

- Learner code in a Pyodide cell that rebinds `__import__` or `globals` no
  longer stops every check on the page.

### Unchanged

Grading: the status, score, feedback and details of every check. CI grades
every exercise of the example site with math-exercise 0.10's code and with
this version's under Pyodide 0.28.3 (answer keys and their perturbations,
probes, authored responses, every variant's fixtures and the question
tests) and fails on any difference. The exercise syntax, the question-test
command (`question-tests.py`) with its output and exit status, generated
variants, every interface text and the exercise HTML.

### For maintainers

- The 385 lines of checker Python in `math-exercise.js` are gone; its checks
  send one JSON request, `_ctm_request`, through ctm-libs'
  `MathExerciseRuntime.callCheckers` (`math_exercise.check`,
  `math_exercise.check_custom`), which installs ctm-checkers once per
  runtime and again after learner code removed it or after a restart. The
  request carries the values 0.10 set as `_math_*` globals; nothing of a
  check stays in the namespace learner code shares.
- Checks are no longer queued for the whole page: ctm-libs runs the checks
  of one runtime one after another, so a runtime that stops answering holds
  up no check on the next one (the Stop changes under *Changed for
  learners*).
- `question-tests.py` finds ctm-checkers' wheel (`CTM_CHECKERS_WHEEL`, the
  `ctm-checkers` folder next to math-exercise, or the project's
  `_extensions/[owner/]ctm-checkers`) and runs
  `ctm_checkers.math_exercise.authored`; Quarto runs it and `variants.py`
  with the wheel on `PYTHONPATH` (`ctm.checkers.environment()`).
  `CTM_CHECKERS_WHEEL` naming a missing file stops the command with a message
  that says so. `variants.py` rounds with ctm-checkers' `round_places`.
- CI and the tests install ctm-libs and ctm-checkers at the commits of
  `.github/pins.json` (`CTM_LIBS_EXTENSION`, `CTM_CHECKERS_EXTENSION`,
  `CTM_CHECKERS_WHEEL`; before, CI used ctm-libs `main`), or those of a review
  commit's `CTM-Review-Refs` trailer, read by the umbrella's
  `tools/ci/review-dependencies.py` (the umbrella commit is pinned there
  too; `.github/review-dependencies.py` is removed). The basis assessment
  tests moved to ctm-checkers. New workflow `parity.yml` (grading parity
  with the pull request's base, the umbrella's parity harness).

## 0.10.0 (CTM Assessment 0.9.0)

math-exercise is a part of CTM Assessment and loads its library ctm-libs for
settings, languages, the page's Python runtime and AI feedback.

### Changed for authors

- **Install CTM Assessment**: a page with math-exercise stops rendering with
  the CTM Assessment install command when the package is missing (component
  development builds set `CTM_COMPONENT_DEV=1`).
- **`feedback: auto` gives every exercise the Feedback button**: AI feedback
  is part of CTM Assessment. Before, `auto` showed the button only when the
  separate ai-feedback extension was installed. `feedback: false` hides it; a
  site built without AI feedback (`ai-feedback: enabled: false` or
  `CTM_FEEDBACK=off`) has none, and a page with `feedback: true` is named in
  one build message.
- **Settings combine key by key** across `_quarto.yml`, profiles,
  `_quarto.yml.local`, `_metadata.yml` and the page: a page that sets one
  `math-exercise:` option keeps the project's other options.
- **Languages**: `ctm-assessment: lang` sets the language of every component;
  Nynorsk (`nn`) pages get the Bokmål interface, like `no` and `nb`.
- **Explicit context** (`#| context: id`) is followed by the prose of the
  exercise's own section, without the listed blocks, so the task's data
  stated in the section reaches the feedback too.
- Teaching policies: `policy-files` and `policy` replace `page-policy-files`,
  `page-policy` and `project-policy`, which keep working with a warning.
- **Pyodide 0.28.3** (Python 3.13; SymPy 1.13.3 as before) for the page's
  Python runtime.

### Unchanged

The exercise syntax, the checkers and grading, every interface text, and the
exercise HTML apart from the explicit context above.

### For maintainers

- Scripts and styles are cacheable HTML dependencies, loaded once per page:
  `math-exercise` (`matrix-input.css`, `math-exercise.css`; `matrix-input.js`
  and `math-exercise.js` at the end of the body), and from ctm-libs the
  runtime (`ctm-runtime`) and the message catalogue (`ctm-locale`,
  `ctm-locale-math-exercise`). Before, about 140 KB were inlined in every page.
- Inline JSON (`window.__mathExerciseConfig`) is written with `<`, `>` and
  `&` as `\u` escapes, so text in it cannot end its `<script>`; catalogue
  texts in `title` attributes are escaped.
- `ctm-bootstrap.lua` is a byte-for-byte copy of ctm-libs'
  `bootstrap/ctm-bootstrap.lua`. Removed: `feedback-loader.lua` and
  `shared/pyodide-runtime.js` (now in ctm-libs), the LOCALES table and the
  language resolver (now ctm-libs' catalogue), the ai-feedback version gates
  (0.5.0, 0.7.0) and the "install ai-feedback" message.
- CI and the tests build against ctm-libs (`CTM_LIBS_EXTENSION`,
  `CTM_COMPONENT_DEV=1`); `CTM-Review-Refs` trailers name `ctm-libs` (the old
  name `ai-feedback` is read as `ctm-libs`).
