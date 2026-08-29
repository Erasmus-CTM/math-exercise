# Reliable AI feedback across OpenAI-compatible providers

## Problem statement

`math-exercise` can send feedback requests to many services that expose an
OpenAI-compatible chat-completions endpoint. The common endpoint shape does
not imply common behaviour. Testing with several providers and model families
revealed these user-facing problems:

1. **Reasoning models can be too slow for short educational feedback.** Some
   models spend most of the completion budget on internal reasoning, time out,
   return an empty answer, or expose reasoning text instead of concise feedback.
2. **Reasoning controls are provider-specific.** Sending an unsupported field
   such as `thinking` or `include_reasoning` can make an otherwise compatible
   provider reject the entire request.
3. **A model catalogue is not necessarily a chat-model catalogue.** Provider
   `/models` responses may include embedding models that cannot generate
   feedback. Long model identifiers combined with repeated status labels also
   made the native model selector hard to read.
4. **Models can drift into another language.** This was especially visible in
   smaller or reasoning-oriented multilingual models.
5. **Generated formatting is inconsistent.** A model may emit a Markdown table
   even when a short list would be clearer. The intentionally small safe
   Markdown renderer previously displayed table syntax as literal pipes.
6. **Errors could be labelled twice.** JavaScript's `Error` string already
   begins with `Error:`, while the interface also adds a localized error label.

The course exercises are short, structured mathematics problems. They benefit
more from prompt adherence, low latency, and a visible response than from a
large hidden reasoning budget.

## Proposed and implemented solution

The adapter keeps a portable request as the default and adds narrowly scoped
behaviour only when there is evidence that a model family supports it.

| Problem | Implemented approach |
|---|---|
| Provider-specific request fields | Start from `model`, `messages`, and `max_tokens` only. |
| Excess reasoning | Add known low-reasoning controls for Kimi K2.5/K2.6, GLM-5.2, and GPT-OSS. |
| Strict providers | On HTTP 400, 415, or 422, retry once without optional controls. |
| Repeated compatibility failures | Cache supported/unsupported status for 30 days per normalized base URL and model. |
| Image incompatibility | Negotiate image content separately from reasoning controls. |
| Slow requests | Abort after 60 seconds and show a localized, actionable message. |
| Unsuitable catalogue entries | Filter obvious embedding models from the picker. |
| Model choice | Rank likely instant/instruction models first and mark likely slow reasoning models as advisory groups. |
| Language drift | Name the requested language explicitly, keep the language guard last, and retry once after an obvious script mismatch. |
| Markdown tables | Ask for paragraphs/lists, but safely render a strict valid-table subset when needed. |
| Duplicate error labels | Normalize native and localized prefixes before adding the UI label. |

Unknown model names remain selectable. They receive the portable baseline
request without guessed provider fields. The extension never silently replaces
the model selected by the user.

## Request fallback sequence

1. Build the portable OpenAI-compatible request.
2. Add an optional control only for a recognized model family, unless that
   endpoint/model pair is cached as unsupported.
3. If image content is rejected, retry with the same accepted model controls
   but without the image.
4. If an optional model control is rejected with a compatibility status, retry
   with the portable body and cache the result.
5. Do not retry server failures, authentication failures, rate limits, or
   timeouts automatically. These are not evidence that a request field is
   unsupported.

This bounded sequence prevents retry loops and avoids switching models behind
the user's back.

## Safe feedback rendering

LLM output is escaped as HTML before any formatting is restored. The renderer
supports a deliberately small subset: paragraphs, ordered and unordered lists,
emphasis, inline code, display mathematics, and strict Markdown tables.

A table is recognized only when it has:

- at least two columns;
- a valid separator row;
- at least one data row; and
- the same number of cells in every row.

These conditions keep ordinary mathematical expressions such as `$|x|$` and
malformed pipe text from being interpreted as tables. Rendered tables use a
horizontally scrollable wrapper for narrow screens.

## Compatibility

- Existing Quarto source files require no changes.
- Existing `math-exercise` options and feedback controls are unchanged.
- Unknown OpenAI-compatible providers continue to receive the minimal request.
- Optional controls are removed automatically when rejected.
- Configuration and capability results remain local to the browser.
- The changes affect the feedback backend and settings UI, not exercise
  assessment or answer checking.

## Testing and review

Run the complete JavaScript regression suite with:

```bash
node --test tests/*.test.mjs
```

The tests cover:

- model classification and portable request bodies;
- accepted and rejected optional reasoning controls;
- independent image fallback;
- Norwegian language enforcement and retry behaviour;
- safe and malformed Markdown tables, HTML escaping, and mathematical pipes;
- localized error-label normalization; and
- prompt formatting requirements in English, German, and Norwegian Bokmål.

GitHub Actions also renders `examples.qmd` and `nb-render.qmd`. Feature-branch
examples are published at the
[model capability adapter preview](https://erasmus-ctm.github.io/math-exercise/previews/feature-model-capability-adapter/).

## Known limitations

- Model-name classification is advisory and intentionally conservative; it is
  not a substitute for provider capability metadata.
- A provider can change its accepted fields before the 30-day cache expires.
- The table fallback intentionally does not implement all GitHub-Flavoured
  Markdown features, such as alignment styling or multiline cells.
- A model that uses the requested Latin alphabet but the wrong Latin-script
  language may evade the lightweight script-mismatch check. The explicit
  language prompt remains the primary control.
