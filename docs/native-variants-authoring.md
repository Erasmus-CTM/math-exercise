# Native variant component adapter (WIP)

`_extensions/math-exercise/question-variants.py --stdin` is the component-owned
version-1 JSON adapter described by ctm-checkers' native authoring interface.
The Lua filter now resolves `variables` questions through this adapter. The
student consumer uses resolved Markdown, exact custom-checker context, the shared
chooser and P17 storage. Focused module tests exercise real installed checker
grading alongside UI stubs; this is not final-artifact browser grading acceptance.
The draft does not establish course readiness or authorize student deployment.

Install the canonical checker extension and produce its separate
`ctm-checkers/native-authoring` directory with ctm-checkers'
`tools/build_authoring.py --install-extension PATH`. The checker wheel stays
unchanged. `CTM_VARIANTS_NATIVE` and `CTM_CHECKERS_WHEEL` are explicit engineering
selectors. The wrapper verifies the complete native manifest and the checker's
wheel checksum before importing either, and starts Python in isolated mode so a
lesson directory cannot shadow them.

Requests supply `source`, its component-parsed `options` and `question`, plus
`projectRoot`, `file`, `label`, `manifest`, `approval`, `renderMode` and `action`.
The native parser checks the source/options/question agree. New syntax uses a
`variables` block and mandatory default-language `field-labels`; `#| solution`
and `#| lang: xx` are body separators. `approval` remains `required` by default;
the explicitly chosen OPEN exception is existing `optional`, with warnings.
`renderMode` is explicitly `publish`, `preview` or `review`.

`resolve` is read-only. Empty preview/review and explicit optional publishing
resolve one bounded, actually tested initial batch without saving it. Required
publishing with zero approvals fails. `generate` appends up to 25 tested,
note-distinct candidates, preserving history. Constraint failures and duplicate
notes do not count; grading/execution failures stop. `decide` and `decide-many`
use the shared native decision engine. Every mutation requires the original
manifest `baseHash` and performs one leased atomic write after validation.

For a mutation, `sourceFile` (falling back to `file`) must identify the actual
authored file inside the project. Quarto's bundled Pandoc reads that raw file as
`commonmark_x` and finds one uniquely labelled `{math-exercise}` CodeBlock in its
AST, excluding code examples inside comments, raw HTML or enclosing fences.
This reads source only, without project/component filters or execution. Quarto
must be on PATH, or explicitly selected by `CTM_VARIANTS_QUARTO`. A downloaded request
is resolved against that file again; stale teacher/hash selections fail. The
same block is re-read immediately before writing to detect edits during native
resolution. This is optimistic checking, not a filesystem transaction with the
author's editor. Include authors must supply the include file's `sourceFile`.

The component resolver owns ordered mathematical and raw-placeholder identity,
exact teacher marker transport and grading semantics. It returns the existing
exact-context codec with `variant: null` until a decision; no number zero is
invented. The native collector runs real teacher and authored declarative tests.
Translation copies of the same mathematical sequence do not duplicate identity.
Translated answer markers must retain the same ordered fields and exact teacher
answers as the default language. The actual Quarto Lua/HTML boundary uses
`pandoc.json` to retain `variant: null`; Quarto's JSON decoder drops null fields.

The approved variants design §3.6.i requires ordinary inline Markdown question
rendering with raw HTML shown as text, and Pandoc solutions with raw HTML removed.
The build emits resolved Markdown questions and strips raw HTML tokens from
solution HTML, preserving surrounding text. Required is the ordinary build
default; `CTM_VARIANTS=optional` explicitly selects OPEN. `CTM_VARIANTS=review`
selects the nonstudent review route. Quarto 1.8.27 exposes no verified stable Lua
preview signal, so ordinary `quarto preview` is not inferred to bypass publishing
gates. This explicit-preview integration remains unfinished.

Legacy `parameters` now fails with a migration message on this authoring branch;
there is no legacy alias or converter. The earlier loading branch is unchanged.
Native generation is never invoked for an ordinary question without `variables`.

The trusted native CI producer can separately request `check-pool` for a
handwritten `pool: true` question. This read-only supervised action checks every
task's teacher answers and supplied authored tests through the ordinary canonical
grader, naming the task on failure. It creates no variants manifest or approvals
and generates no values. Ordinary Quarto pool rendering remains Python-free;
this authoring check is a separate CI operation.

The outer supervisor bounds a whole native request to 300 seconds and observes
a 16 MiB aggregate stdout/stderr limit, with bounded returned buffers. Output is
spooled to temporary files and checked every 50 ms, so disk output can overshoot
the threshold before termination. POSIX process groups retire descendants on
both timeout and completion; Windows uses best-effort task-tree termination on
timeout with a separate two-second taskkill bound. Windows teardown has not been tested. A timeout/transport failure can
race with the final atomic write: reload the manifest hash before retrying.

Focused source validation covers exact B1 identity and real teacher grading,
isolated installed imports, initial preview/optional batches, stable decisions,
required/optional publish gates, stale leases and downloaded-source changes,
native tamper checks, bootstrap deadlines and stalled-checker descendant
termination. These are native/component tests, not browser or final-artifact
acceptance. Connected review UI/bot integration and course migration have
separate validation gates. A focused real Quarto fixture verifies required/
OPEN/review builds, proposal nulls across Lua, explicit positive decision identity,
changed approval refusal and raw HTML solution removal; this is source/build
evidence only.

Explicit `boards` names iframe IDs for optional variant figure messages (design
§3.6.j and amendment 780). The Lua payload exposes separate public `values`:
safe JSON numbers where exact, other exact scalars as input strings, and recursive
arrays/maps with null preserved. The exact grading codec remains unchanged.
Figure transport cannot delay Check or Python readiness. Handwritten pools use
the shared chooser without starting the native authoring process.

Each rendered question exposes `<label>-question` with `ai-feedback-context`
(design §3.6.j). Labels containing whitespace and generated IDs colliding with
an authored AST ID, quoted/unquoted HTML ID, or another question fail the build.

Review-only `teacherDisplay` is computed late from the decoded exact teacher
values, without parsing strings or changing candidate data, identity or history.
The shared overview validates printer output through one strict MathML Core
sanitizer and retains the escaped canonical input beside it. Unsupported or
malformed presentation falls back to that input. This sidecar is not included
in the student payload; checklist math uses the same validator.
