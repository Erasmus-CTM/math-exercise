# Connected local review

After `question-variants.py --project . --file lesson.qmd --label q generate25more`,
start the installed component's helper:

```sh
python _extensions/math-exercise/variants-review.py --project . --file lesson.qmd --label q
```

It prints and opens a random-token URL on `127.0.0.1` with an automatically
selected port. `--no-browser` prints the URL without opening it; `--port NUMBER`
selects a port. Stop with Ctrl-C. The helper offers lazy student previews rendered by the actual math-exercise
filter and consumer, with the worked solution and Check controls. The default
source question and each declared en/de/nb translation have separate previews.
`--language en|de|nb` selects the review interface language. Ordinary Quarto
preview detection is not supplied here.

Each individual or bulk decision is sent to the same-origin helper and saved
through the canonical wrapper. The wrapper rereads the selected authored file,
resolves current candidates, validates the entire batch and performs one leased
atomic manifest write. The browser supplies only the original lease and explicit
decisions; it cannot select project/source/manifest paths or supply trusted
candidate records. The only writable manifest is `_variants/LABEL.yml` for the
known safe label. Existing native restrictions still apply.

Successful save rebuilds the page from current source and manifest. An uncertain
or rejected response leaves decisions disabled and offers **Rebuild review**;
the page does not assert that a dropped response means no write occurred. A
changed source or stale lease must be reviewed afresh. Files are not watched.

Only the capability URL is served. Requests require its exact path and local
Host; decisions also require the exact local Origin and bounded JSON. The helper
serves no project files, offers no CORS exception and logs no request URLs.
The capability is local to this process and should not be shared.

Focused checks: `python -m unittest discover -s tests -p
test_variants_review_server.py`; `tests/browser/variants-review.mjs` uses an actual
installed canonical wrapper/native distribution and Chromium to verify save,
rebuild, stale lease and changed-source rejection. Set `CTM_CHECKERS_EXTENSION`
to the checker payload, `CTM_NATIVE_AUTHORING_SOURCE` to the canonical checkers
checkout and optionally `CTM_PLAYWRIGHT_MODULE` to a Playwright module. No browser
Python, CDN, JSXGraph or grading acceptance is implied.

Student previews render one currently tested candidate by its exact locator,
including undecided proposals with null identity. Internal selectors are rejected
outside explicit review mode. Each preview uses an isolated temporary project:
only the selected source block, copied retained manifest and installed packages;
no authored project filters, execution hooks or unrelated pages are rendered.
Default controls inherit the course language through Quarto metadata inspection.
Diagrams and ambient course context are not copied into this isolated exercise;
review those separately in the course's explicit review build.

Only generated output is served below the random-token preview route. Source,
manifests and copied packages are removed after rendering and cannot be requested;
traversal and output symlinks are rejected. Previews are built on demand and cached
until rebuilding the review or changing source/history. A render is supervised for
330 seconds and an observed 16 MiB output limit (50 ms polling permits disk
overshoot), with a 256 MiB retained session limit. POSIX descendants are terminated
on completion or failure. Windows timeout teardown is best effort and untested.
Stop/restart the helper after upgrading installed extensions.

Generate25more and decisions both preserve the page's original manifest lease.
An outdated page must rebuild; a failed authored test is never silently resampled.
The live Check control uses the normal browser runtime. Source/DOM and stubbed
browser checks do not establish CDN/engine or final-course acceptance.
