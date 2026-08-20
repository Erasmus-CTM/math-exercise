----
-- math-exercise.lua
--
-- Quarto filter for interactive math exercises evaluated via SymPy in Pyodide.
-- Works standalone or alongside coatless-quarto/pyodide.
--
-- Single-task syntax:
--
--   ```{math-exercise}
--   #| label: circle
--   #| caption: Area
--   #| vars: r
--   #| mode: equivalent
--   #| reject: (x+1)**2
--   Calculate ... A = _[pi * 9] cm²
--   ```
--
-- Modes (#| mode:):
--   equivalent (default) – any algebraically equivalent expression
--   exact                – only the canonical SymPy form of the answer
--   numeric              – numeric closeness; see tolerance/decplaces/sigfigs
--   string / string_ci   – exact / case-insensitive text comparison
--   set                  – comma-separated list, compared as a multiset
--                          (each item checked via equivalent-mode matching)
--
-- Extra options for mode: numeric (pick at most one; default: small abs. tol.):
--   #| tolerance: 0.5     – absolute, or "5%" for relative to the correct value
--   #| decplaces: 2       – round both sides to N decimal places before comparing
--   #| sigfigs: 3         – round both sides to N significant figures
--
-- Form option (combinable with mode: equivalent/exact) requires the answer be
-- correct AND already written in the given canonical form:
--   #| form: factored | expanded | single_fraction | lowest_terms
--
-- Pool syntax  (#| pool: true, tasks separated by lines containing only ---):
--
--   ```{math-exercise}
--   #| label: circle-pool
--   #| pool: true
--   Task variant A: _[pi*9]
--   ---
--   Task variant B: _[pi*25]
--   ```
--
-- Input field markers:
--   _[answer]   → short  input
--   __[answer]  → medium input
--   ___[answer] → 2-row  textarea
--
-- Context for AI feedback (hybrid: automatic + optional explicit):
--
--   By default, every exercise auto-collects the prose (paragraphs, lists,
--   its own section heading) since the last heading as background context
--   for the "Feedback" button's LLM prompt. No authoring changes needed:
--   just explain the scheme in normal text above the exercise(s).
--
--   For context that lives in a different section than the exercises using
--   it, define it explicitly and reference it by id (must appear *before*
--   the exercises that use it):
--
--   ::: {.math-exercise-context #fp16}
--   IEEE-754 half precision: 1 sign bit, 5 exponent bits (bias 15),
--   10 mantissa bits.
--   :::
--
--   ```{math-exercise}
--   #| label: fp-decode
--   #| context: fp16
--   Decode 0x3C00 as a half-precision float: _[1]
--   ```
--
--   #| context: none   – opt out of the automatic section context entirely
--
--   Context text is capped at ~1500 characters (keeping the most recent
--   part) to bound prompt size/cost.
----

local hasSetup      = false
local exerciseCount = 0
local MAX_CONTEXT_CHARS = 1500

----
-- Localization (i18n)
--
-- Active UI language, resolved per render pass from `math-exercise: lang:` or
-- Quarto's own `lang:` (see Meta below). Default: English.
----
local lang = "en"

-- Supported locales. Extend this set together with LOCALES in math-exercise.js.
local supportedLangs = {
  ["en"] = true,
  ["de"] = true
}

-- Button labels rendered by this filter. Everything else lives in the
-- LOCALES table of math-exercise.js.
local uiText = {
  en = {
    check      = "Check",
    legend     = "Input help",
    feedback   = "Feedback",
    reconfig   = "Change AI configuration",
    poolReload = "Load a new random task"
  },
  de = {
    check      = "Überprüfen",
    legend     = "Eingabe-Hilfe",
    feedback   = "Feedback",
    reconfig   = "KI-Konfiguration ändern",
    poolReload = "Neue Zufallsaufgabe laden"
  }
}

-- Named uiT (not t) so it does not shadow the local `t` used further below.
local function uiT(key)
  local active = uiText[lang] or uiText.en
  return active[key] or uiText.en[key]
end

local function readFile(filename)
  local path = quarto.utils.resolve_path(filename)
  local f = io.open(path, "r")
  if not f then error("math-exercise: cannot open '" .. filename .. "'") end
  local content = f:read("*a")
  f:close()
  return content
end

local function ensureSetup()
  if hasSetup then return end
  hasSetup = true
  local css = readFile("math-exercise.css")
  quarto.doc.include_text("in-header",
    "<style type=\"text/css\">\n" .. css .. "\n</style>")
  local js = readFile("math-exercise.js")
  quarto.doc.include_text("after-body",
    "<script type=\"text/javascript\">\n" .. js .. "\n</script>")
end

----
-- Parse #| key: value lines; return opts table + remaining content
----
local function parseOptions(raw)
  local opts  = {}
  local lines = {}
  for line in (raw .. "\n"):gmatch("([^\r\n]*)\n") do
    local k, v = line:match("^#|%s*(.-):%s*(.-)%s*$")
    if k and v then opts[k] = v
    else            table.insert(lines, line) end
  end
  return opts, table.concat(lines, "\n"):match("^%s*(.-)%s*$")
end

----
-- HTML-attribute-safe escaping
----
local function attrEsc(s)
  return s:gsub("&","&amp;"):gsub('"',"&quot;"):gsub("<","&lt;"):gsub(">","&gt;")
end

----
-- JSON helpers
----
local function jsonEsc(s)
  return s:gsub('\\','\\\\'):gsub('"','\\"'):gsub('\n','\\n'):gsub('\r','\\r'):gsub('\t','\\t')
end

-- Build a JSON array of strings safe for use inside a double-quoted HTML attribute
-- (inner " are encoded as &quot; so the HTML parser reconstructs valid JSON for JS)
local function jsonArrAttr(t)
  if #t == 0 then return "[]" end
  local parts = {}
  for _, v in ipairs(t) do
    table.insert(parts, '"' .. jsonEsc(v) .. '"')
  end
  return ("[" .. table.concat(parts, ",") .. "]"):gsub('"', '&quot;')
end

-- Same idea as jsonArrAttr, but for a single string (used for data-context).
local function jsonStrAttr(s)
  return ('"' .. jsonEsc(s) .. '"'):gsub('"', '&quot;')
end

----
-- AI-feedback context helpers
--
-- collapseWs: flattens a stringified block to a single line of normalized
-- whitespace, so accumulated context reads as compact prose rather than
-- preserving the source markdown's line breaks/indentation.
--
-- truncate: keeps the *tail* of long context (the part closest to the
-- exercise it precedes) instead of the head, since that is the most likely
-- to be relevant, and bounds prompt size/cost.
----
local function collapseWs(s)
  return (s:gsub("%s+", " "):match("^%s*(.-)%s*$"))
end

local function truncate(text, n)
  if #text <= n then return text end
  return "…" .. text:sub(#text - n + 1)
end

----
-- Replace _+[answer] markers with HTML input/textarea elements.
-- Returns: processed HTML string, list of generated field IDs.
----
local function processMarkers(text, exerciseId, vars)
  local count    = 0
  local fieldIds = {}

  local result = text:gsub("(_+)%[(.-)%]", function(underscores, answer)
    count = count + 1
    local fid  = exerciseId .. "-f" .. count
    table.insert(fieldIds, fid)
    local n    = #underscores
    local base = ' id="'          .. fid             .. '"'
               .. ' data-answer="' .. attrEsc(answer) .. '"'
               .. ' data-vars="'   .. attrEsc(vars)   .. '"'
               .. ' autocomplete="off" autocorrect="off" spellcheck="false"'
    if n >= 3 then
      return '<textarea' .. base .. ' class="math-input math-input-large" rows="2"></textarea>'
    elseif n == 2 then
      return '<input type="text"' .. base .. ' class="math-input math-input-medium">'
    else
      return '<input type="text"' .. base .. ' class="math-input math-input-small">'
    end
  end)

  return result, fieldIds
end

----
-- Split text into pool tasks on lines that contain only ---
----
local function splitTasks(text)
  local tasks   = {}
  local current = {}
  for line in (text .. "\n"):gmatch("([^\r\n]*)\n") do
    if line:match("^%s*---%s*$") then
      local t = table.concat(current, "\n"):match("^%s*(.-)%s*$")
      if t ~= "" then table.insert(tasks, t) end
      current = {}
    else
      table.insert(current, line)
    end
  end
  local t = table.concat(current, "\n"):match("^%s*(.-)%s*$")
  if t ~= "" then table.insert(tasks, t) end
  return tasks
end

----
-- Shared controls HTML (same for single and pool mode)
----
local function controlsHtml()
  return table.concat({
    '<div class="math-exercise-controls">',
    '  <button type="button" class="btn btn-primary math-check-btn">&#10003;&nbsp;' .. uiT("check") .. '</button>',
    '  <button type="button" class="btn btn-light math-legend-btn">&#9432;&nbsp;' .. uiT("legend") .. '</button>',
    '  <div class="btn-group">',
    '    <button type="button" class="btn btn-light math-feedback-btn">&#128172;&nbsp;' .. uiT("feedback") .. '</button>',
    '    <button type="button" class="btn btn-light math-reconfig-btn" title="' .. uiT("reconfig") .. '">&#9881;</button>',
    '  </div>',
    '</div>',
  }, "\n")
end

----
-- AI-feedback context resolution
--
-- Precedence: `#| context: none` disables it; `#| context: <id>` looks up an
-- explicit `.math-exercise-context` div (must be defined earlier in the
-- document); otherwise falls back to the auto-collected section context.
----
local function resolveContext(opts, state, label)
  local ref = opts["context"]
  if ref == "none" then return "" end
  if ref and ref ~= "" then
    local found = state.namedCtx[ref]
    if not found then
      quarto.log.warning("math-exercise: context '" .. ref .. "' not found for '" ..
        label .. "' (it must be defined, via .math-exercise-context, before this exercise)")
      return ""
    end
    return found
  end
  return truncate(state.sectionCtx, MAX_CONTEXT_CHARS)
end

----
-- Exercise cell builder (formerly the CodeBlock filter; now called from the
-- document-order block walk below so it can read the accumulated context).
----
local function buildExercise(el, state)
  ensureSetup()
  exerciseCount = exerciseCount + 1
  local eid = "math-exercise-" .. exerciseCount

  local opts, questionText = parseOptions(el.text)

  local caption   = opts["caption"]   or nil
  local label     = opts["label"]     or eid
  local vars      = opts["vars"]      or ""
  local mode      = opts["mode"]      or "equivalent"
  local reject    = opts["reject"]    or ""
  local tolerance = opts["tolerance"] or ""
  local decplaces = opts["decplaces"] or ""
  local sigfigs   = opts["sigfigs"]   or ""
  local form      = opts["form"]      or ""
  local isPool    = (opts["pool"]     == "true")
  local context   = resolveContext(opts, state, label)

  local captionHtml = ""
  if caption then
    captionHtml = '<div class="math-exercise-caption math-exercise-toggle" role="button" tabindex="0">'
               .. '<span class="math-chevron" aria-hidden="true"></span>'
               .. caption .. '</div>\n'
  end

  -- Base data attributes shared by both modes
  local attrs = 'id="'             .. eid                .. '"'
             .. ' data-label="'     .. attrEsc(label)     .. '"'
             .. ' data-mode="'      .. attrEsc(mode)      .. '"'
             .. ' data-reject="'    .. attrEsc(reject)    .. '"'
             .. ' data-vars="'      .. attrEsc(vars)      .. '"'
             .. ' data-tolerance="' .. attrEsc(tolerance) .. '"'
             .. ' data-decplaces="' .. attrEsc(decplaces) .. '"'
             .. ' data-sigfigs="'   .. attrEsc(sigfigs)   .. '"'
             .. ' data-form="'      .. attrEsc(form)      .. '"'
             .. ' data-context="'   .. jsonStrAttr(context) .. '"'

  local questionHtml

  if isPool then
    local tasks = splitTasks(questionText)
    attrs        = attrs .. ' data-pool="'   .. jsonArrAttr(tasks) .. '"'
                         .. ' data-fields="[]"'
    questionHtml = '<button type="button" class="math-pool-reload" title="' .. uiT("poolReload") .. '">&#8635;</button>\n'
                .. '<div class="math-exercise-question"></div>'
  else
    local body, fieldIds = processMarkers(questionText, eid, vars)
    body         = body:gsub("\n", "<br>\n")
    attrs        = attrs .. ' data-fields="' .. jsonArrAttr(fieldIds) .. '"'
    questionHtml = '<div class="math-exercise-question">' .. body .. '</div>'
  end

  local bodyHtml = table.concat({
    questionHtml,
    controlsHtml(),
    '<div class="math-legend-panel" style="display:none;"></div>',
    '<div class="math-feedback-area"></div>',
  }, "\n")

  local html
  if caption then
    html = table.concat({
      '<div class="math-exercise-cell" ' .. attrs .. '>',
      captionHtml,
      '<div class="math-exercise-body" style="display:none;">',
      bodyHtml,
      '</div>',
      '</div>',
    }, "\n")
  else
    html = table.concat({
      '<div class="math-exercise-cell" ' .. attrs .. '>',
      bodyHtml,
      '</div>',
    }, "\n")
  end

  return pandoc.RawBlock("html", html)
end

----
-- Meta filter: resolve the UI language and hand it to the JavaScript side.
--
-- Order of precedence:
--   1. `math-exercise: lang: xx`  – explicit override
--   2. Quarto's own `lang:`       – set per profile in a multilingual project
--   3. "en"                       – fallback
--
-- Region subtags are dropped ("de-DE" -> "de"); unsupported languages fall
-- back to English instead of failing the render.
----
local function resolveLang(meta)
  local raw = nil

  local cfg = meta["math-exercise"]
  if cfg and cfg["lang"] then
    raw = pandoc.utils.stringify(cfg["lang"])
  elseif meta["lang"] then
    raw = pandoc.utils.stringify(meta["lang"])
  end

  if raw == nil or raw == "" then
    return "en"
  end

  local base = raw:lower():match("^(%a+)")
  if base and supportedLangs[base] then
    return base
  end

  return "en"
end

local function Meta(meta)
  lang = resolveLang(meta)

  -- math-exercise.js reads this to pick its LOCALES entry.
  quarto.doc.include_text("before-body",
    '<script>window.__mathExerciseConfig = ' ..
    quarto.json.encode({ lang = lang }) .. ';</script>')

  return meta
end

----
-- Document-order block walk
--
-- Needed (instead of a plain per-type CodeBlock filter) so exercise cells can
-- see prose that appeared earlier in the same document: tracks `sectionCtx`
-- (prose collected since the last heading) and `namedCtx` (id -> text for
-- explicit `.math-exercise-context` divs) as it goes, in document order.
--
-- Recurses into plain Divs/BlockQuotes (callouts, columns, …) so exercises or
-- headings nested inside them are still found; list/table content is only
-- captured as flattened text (a nested exercise inside a bullet list would
-- be missed – an accepted, documented limitation).
----
local function walkBlocks(blocks, state)
  local out = pandoc.Blocks({})
  for _, b in ipairs(blocks) do
    if b.t == "Header" then
      -- Seed the new section's context with its own heading text.
      state.sectionCtx = collapseWs(pandoc.utils.stringify(b))
      out:insert(b)

    elseif b.t == "CodeBlock" and b.attr.classes:includes("{math-exercise}") then
      out:insert(buildExercise(b, state))

    elseif b.t == "CodeBlock" then
      out:insert(b) -- code isn't useful prose context; don't accumulate

    elseif b.t == "Div" and b.attr.classes:includes("math-exercise-context") then
      local text = truncate(collapseWs(pandoc.utils.stringify(b)), MAX_CONTEXT_CHARS)
      if b.attr.identifier ~= "" then state.namedCtx[b.attr.identifier] = text end
      state.sectionCtx = (state.sectionCtx == "" and text) or (state.sectionCtx .. " " .. text)
      out:insert(b) -- still rendered normally; students should see it too

    elseif b.t == "Div" or b.t == "BlockQuote" then
      b.content = walkBlocks(b.content, state)
      out:insert(b)

    else
      -- Para, Plain, BulletList, OrderedList, DefinitionList, Table, … :
      -- flatten to plain text and fold into the running section context.
      local text = collapseWs(pandoc.utils.stringify(b))
      if text ~= "" then
        state.sectionCtx = (state.sectionCtx == "" and text) or (state.sectionCtx .. " " .. text)
      end
      out:insert(b)
    end
  end
  return out
end

local function Pandoc(doc)
  doc.meta = Meta(doc.meta)

  if quarto.doc.is_format("html") then
    local state = { sectionCtx = "", namedCtx = {} }
    doc.blocks = walkBlocks(doc.blocks, state)
  end

  return doc
end

return {
  { Pandoc = Pandoc },
}
