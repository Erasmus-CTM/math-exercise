# Native variant component adapter (WIP)

`_extensions/math-exercise/question-variants.py --stdin` is the component-owned
version-1 JSON adapter described by ctm-checkers' native authoring interface.
It is not yet activated by the Lua filter or the student UI. This slice does
not complete teacher authoring or establish course readiness.

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
authored file inside the project. It currently supports one uniquely labelled
top-level exact fenced `{math-exercise}` block, with backtick or tilde fences.
Indented/list-nested blocks and alternate fence attributes are not supported by
this file adapter: they fail to locate the current source. A downloaded request
is resolved against that file again; stale teacher/hash selections fail. The
same block is re-read immediately before writing to detect edits during native
resolution. This is optimistic checking, not a filesystem transaction with the
author's editor. Include authors must supply the include file's `sourceFile`.

The component resolver owns ordered mathematical and raw-placeholder identity,
exact teacher marker transport and grading semantics. It returns the existing
exact-context codec with `variant: null` until a decision; no number zero is
invented. The native collector runs real teacher and authored declarative tests.
Translation copies of the same mathematical sequence do not duplicate identity.

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
acceptance. The shared chooser, Lua bridge, review UI/bot and course migration
remain separate work.
