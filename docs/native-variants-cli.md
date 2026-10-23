# Local file authoring commands

The installed `question-variants.py` now accepts local file commands alongside
its unchanged version-1 `--stdin` JSON interface. All commands use the same
canonical Quarto source extraction, native resolver and isolated supervised
worker. Run them against a preparation project or ctm-demo; this does not
authorize changes to a live course or deployment.

```sh
python _extensions/math-exercise/question-variants.py \
  --project /path/to/course --file pages/lesson.qmd --label q-one \
  generate25more --html work/q-one-review.html

python _extensions/math-exercise/question-variants.py \
  --project /path/to/course --file pages/lesson.qmd --label q-one \
  review --html work/q-one-review.html

python _extensions/math-exercise/question-variants.py \
  --project /path/to/course --file pages/lesson.qmd --label q-one \
  apply /path/to/downloaded/variant-decisions.json --html work/q-one-review.html
```

`generate25more` appends at most 25 actually tested, valid and distinct resolved
notes, preserving previous proposals and decisions. It reads the current manifest
lease and uses the existing single atomic mutation. Exhaustion may produce fewer
than 25. Execution, grading, test and budget failures stop rather than resample.
It allocates no approval numbers and approves nothing automatically.

The default manifest is `_variants/LABEL.yml`. An unusual label that cannot be
used as a portable filename needs an explicit `--manifest` path inside the
project. `review` is read-only and requires saved proposals; run `generate25more`
first. The optional HTML file uses the shared disconnected native review UI,
with the selected project and manifest controls prefilled. Its preview is the
existing resolved Markdown text view, not a live component Check/render route.

Stage explicit decisions on that page, download one request and apply it with
the same project/file/label arguments. The file argument supplies the authored
source location missing from the disconnected download. The wrapper rebuilds
all current records and teacher data from that file. Downloaded records, source,
options and project selectors are ignored; the original `baseHash`, exact
id/hash decisions, label and selected manifest must still agree. A stale lease
or changed teacher/content hash fails without recording the decisions. Reload
the review after applying it. No approval number zero is invented.

Commands return the ordinary JSON result on stdout; diagnostics use stderr.
`--html` cannot overwrite the source, manifest or downloaded request. An output
failure after a completed native mutation can leave the manifest saved: rerun
the read-only `review --html` command rather than regenerating a batch blindly.
The existing timeout/transport uncertainty and source/editor race limits still
apply. The unchanged `--stdin` interface reads inside the supervised worker, so
a caller that sends no input and never closes its pipe cannot hang before the
whole-request deadline starts. No bot, live comment, merge, tag or deployment is
activated by these commands.

Focused installed-CLI checks use a copied canonical native/wheel/component tuple
from a hostile working directory, generate a two-value synthetic exercise,
produce HTML, apply an explicit synthetic decision while ignoring forged
downloaded records, and reject stale/source-changed requests without altering
saved history. These checks do not approve real course notes or establish course
acceptance.
