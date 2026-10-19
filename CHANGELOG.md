# Changes

## Unreleased

### Changed for authors

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
