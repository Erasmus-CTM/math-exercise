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
--   custom               – author-supplied SymPy/Python checker, run once for
--                          all expression fields in the exercise
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
-- Optional human-readable labels for multi-field feedback:
--   #| field-labels: S, E, M
--
-- Partial credit (opt-in for built-in modes; custom checkers always may score):
--   #| partial-credit: true
--   #| form-credit: 0.5
--
-- Custom checker (trusted author code; student input is parsed separately):
--   #| mode: custom
--   #| packages: networkx                   -- optional Pyodide packages
--   #| response: jsxgraph:board-iframe-id   -- optional external JSON source
--   #| checker: |
--   #|   def check(response, symbols):
--   #|       return {"score": 1.0, "feedback": "Well done."}
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
--   vec[a,b,c]  → bracketed vector with one field per component
--   mat[a,b;c,d] → bracketed matrix; semicolons separate rows
--   mat{name=A, rows=3, cols=auto, ...} → named resizable matrix for custom mode
--
-- Vector orientation defaults to a column and can be changed per exercise:
--   #| vecdir: row
--
-- Context for AI feedback (hybrid: automatic + optional explicit):
--
--   By default, every exercise auto-collects the prose (paragraphs, lists,
--   its own section heading) since the last heading as background context
--   for the "Feedback" button's LLM prompt. No authoring changes needed:
--   just explain the scheme in normal text above the exercise(s). This part
--   is resolved here, at render time, from the Pandoc document tree.
--
--   For context that lives outside the current section, or that several
--   exercises across the page should share, tag it explicitly and list its
--   id(s) (comma-separated) on the exercise. This part is resolved lazily,
--   client-side (see math-exercise.js), so blocks may appear anywhere on
--   the page and in any order relative to the exercises that use them:
--
--   ::: {#fp16 .math-exercise-context}
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
--   #| context: none   – opt out of context entirely
--
--   Auto-collected context is capped at ~1500 characters (keeping the most
--   recent part); explicit context has a combined 6000-character budget
--   enforced client-side (see MAX_FEEDBACK_CONTEXT_CHARS in the JS file).
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
  ["de"] = true,
  ["nb"] = true
}

-- Quarto projects in Norway commonly use either `nb` or the older/general
-- `no` code.  The student-facing wording is Bokmål in both cases.
local langAliases = {
  ["no"] = "nb"
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
  },
  nb = {
    check      = "Sjekk",
    legend     = "Inntastingshjelp",
    feedback   = "Tilbakemelding",
    reconfig   = "Endre KI-oppsett",
    poolReload = "Last inn en ny tilfeldig oppgave"
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
  local opts, lines, source = {}, {}, {}
  for line in (raw .. "\n"):gmatch("([^\r\n]*)\n") do
    table.insert(source, line)
  end

  local i = 1
  while i <= #source do
    local line = source[i]
    local k, v = line:match("^#|%s*(.-):%s*(.-)%s*$")
    if k and v then
      if v == "|" then
        local block = {}
        i = i + 1
        while i <= #source do
          local blockLine = source[i]
          if blockLine:match("^#|%s*$") then
            table.insert(block, "")
          elseif blockLine:sub(1, 5) == "#|   " then
            table.insert(block, blockLine:sub(6))
          else
            break
          end
          i = i + 1
        end
        opts[k] = table.concat(block, "\n")
      else
        opts[k] = v
        i = i + 1
      end
    else
      table.insert(lines, line)
      i = i + 1
    end
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

local function splitCsv(s)
  local result = {}
  for item in (s or ""):gmatch("[^,]+") do
    local trimmed = item:match("^%s*(.-)%s*$")
    if trimmed ~= "" then table.insert(result, trimmed) end
  end
  return result
end

-- Split on a separator only at the top nesting level. This preserves commas
-- inside expressions such as atan2(y, x).
local function splitTop(s, sep)
  local parts, depth, current = {}, 0, {}
  for i = 1, #s do
    local ch = s:sub(i, i)
    if ch == "(" or ch == "[" or ch == "{" then
      depth = depth + 1
    elseif ch == ")" or ch == "]" or ch == "}" then
      depth = depth - 1
    end
    if ch == sep and depth == 0 then
      table.insert(parts, table.concat(current):match("^%s*(.-)%s*$"))
      current = {}
    else
      table.insert(current, ch)
    end
  end
  table.insert(parts, table.concat(current):match("^%s*(.-)%s*$"))
  return parts
end

----
-- AI-feedback auto-context helpers
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
local function scalarFieldHtml(fid, answer, vars, underscoreCount)
  local base = ' id="'          .. fid             .. '"'
             .. ' data-answer="' .. attrEsc(answer) .. '"'
             .. ' data-vars="'   .. attrEsc(vars)   .. '"'
             .. ' autocomplete="off" autocorrect="off" spellcheck="false"'
  if underscoreCount >= 3 then
    return '<textarea' .. base .. ' class="math-input math-input-large" rows="2"></textarea>'
  elseif underscoreCount == 2 then
    return '<input type="text"' .. base .. ' class="math-input math-input-medium">'
  end
  return '<input type="text"' .. base .. ' class="math-input math-input-small">'
end

local function matrixCellHtml(fid, answer, vars)
  return '<input type="text" id="' .. fid .. '"'
       .. ' data-answer="' .. attrEsc(answer) .. '"'
       .. ' data-vars="'   .. attrEsc(vars)   .. '"'
       .. ' autocomplete="off" autocorrect="off" spellcheck="false"'
       .. ' class="math-input math-mat-cell">'
end

local MAX_DYNAMIC_DIMENSION = 12

local function parseDynamicMatrixSpec(content)
  local spec = {}
  for _, part in ipairs(splitTop(content, ",")) do
    local key, value = part:match("^%s*([%w%-]+)%s*=%s*(.-)%s*$")
    if not key or value == "" then
      error("math-exercise: mat{...} entries must use key=value")
    end
    if spec[key] ~= nil then
      error("math-exercise: duplicate mat{...} option " .. key)
    end
    spec[key] = value
  end

  local allowed = {
    name=true, rows=true, cols=true,
    ["initial-rows"]=true, ["initial-cols"]=true,
    ["min-rows"]=true, ["max-rows"]=true,
    ["min-cols"]=true, ["max-cols"]=true,
  }
  for key, _ in pairs(spec) do
    if not allowed[key] then
      error("math-exercise: unknown mat{...} option " .. key)
    end
  end

  local name = spec.name or ""
  if not name:match("^[A-Za-z][A-Za-z0-9_%-]*$") then
    error("math-exercise: mat{...} requires name beginning with a letter")
  end

  local function integerOption(key, default)
    if spec[key] == nil then return default end
    local value = tonumber(spec[key])
    if not value or value % 1 ~= 0 or value < 0 or value > MAX_DYNAMIC_DIMENSION then
      error("math-exercise: " .. key .. " must be an integer from 0 to " .. MAX_DYNAMIC_DIMENSION)
    end
    return value
  end

  local function axis(name)
    local raw = spec[name]
    if raw == nil then error("math-exercise: mat{...} requires " .. name) end
    if raw ~= "auto" then
      local fixed = integerOption(name, nil)
      return { auto=false, initial=fixed, min=fixed, max=fixed }
    end
    local min = integerOption("min-" .. name, 0)
    local max = integerOption("max-" .. name, 8)
    if min > max then error("math-exercise: min-" .. name .. " cannot exceed max-" .. name) end
    local initial = integerOption("initial-" .. name, math.min(max, math.max(1, min)))
    if initial < min or initial > max then
      error("math-exercise: initial-" .. name .. " must lie between min-" .. name .. " and max-" .. name)
    end
    return { auto=true, initial=initial, min=min, max=max }
  end

  return { name=name, rows=axis("rows"), cols=axis("cols") }
end

local function dynamicMatrixCellHtml(exerciseId, spec, row, column, vars)
  local fid = exerciseId .. "-dm-" .. spec.name .. "-" .. row .. "-" .. column
  local label = "dm:" .. spec.name .. ":" .. row .. "," .. column
  local html = '<input type="text" id="' .. fid .. '"'
             .. ' data-answer="" data-vars="' .. attrEsc(vars) .. '"'
             .. ' data-dynamic-matrix-name="' .. attrEsc(spec.name) .. '"'
             .. ' data-matrix-row="' .. row .. '" data-matrix-column="' .. column .. '"'
             .. ' data-structural-label="' .. attrEsc(label) .. '"'
             .. ' autocomplete="off" autocorrect="off" spellcheck="false"'
             .. ' class="math-input math-mat-cell">'
  return html, fid, label
end

local function buildDynamicMatrix(exerciseId, content, vars, mode)
  if mode ~= "custom" then
    error("math-exercise: mat{...} currently requires mode: custom")
  end
  local spec = parseDynamicMatrixSpec(content)
  local configuredRows, configuredCols = spec.rows.initial, spec.cols.initial
  local rows, cols = configuredRows, configuredCols
  if rows == 0 or cols == 0 then rows, cols = 0, 0 end
  local ids, labels, cells = {}, {}, {}
  for row = 1, rows do
    for column = 1, cols do
      local html, fid, label = dynamicMatrixCellHtml(exerciseId, spec, row, column, vars)
      table.insert(cells, html)
      table.insert(ids, fid)
      table.insert(labels, label)
    end
  end
  local matrix = '<span class="math-mat math-dynamic-mat"'
               .. ' style="--cols:' .. math.max(cols, 1) .. '"'
               .. ' data-matrix-name="' .. attrEsc(spec.name) .. '"'
               .. ' data-rows="' .. rows .. '" data-cols="' .. cols .. '"'
               .. ' data-auto-rows="' .. tostring(spec.rows.auto) .. '"'
               .. ' data-auto-cols="' .. tostring(spec.cols.auto) .. '"'
               .. ' data-min-rows="' .. spec.rows.min .. '" data-max-rows="' .. spec.rows.max .. '"'
               .. ' data-min-cols="' .. spec.cols.min .. '" data-max-cols="' .. spec.cols.max .. '"'
               .. ' data-last-rows="' .. configuredRows .. '" data-last-cols="' .. configuredCols .. '">'
               .. table.concat(cells) .. '</span>'
  local controls = '<span class="math-dynamic-matrix-controls" aria-label="Matrix size controls">'
                 .. '<span class="math-dynamic-axis" data-dynamic-axis="row"><span class="math-dynamic-axis-label"></span>'
                 .. '<button type="button" data-dynamic-action="remove-row">−</button><output></output>'
                 .. '<button type="button" data-dynamic-action="add-row">+</button></span>'
                 .. '<span class="math-dynamic-axis" data-dynamic-axis="col"><span class="math-dynamic-axis-label"></span>'
                 .. '<button type="button" data-dynamic-action="remove-col">−</button><output></output>'
                 .. '<button type="button" data-dynamic-action="add-col">+</button></span>'
                 .. '</span>'
  local html = '<span class="math-dynamic-matrix-wrap" data-matrix-name="' .. attrEsc(spec.name) .. '">'
             .. matrix .. controls .. '</span>'
  return html, ids, labels
end

local function buildVector(exerciseId, count, content, vars, vecdir)
  local components = splitTop(content, ",")
  local ids, labels, cells = {}, {}, {}
  for index, answer in ipairs(components) do
    count = count + 1
    local fid = exerciseId .. "-f" .. count
    table.insert(ids, fid)
    table.insert(labels, "v" .. index)
    table.insert(cells, matrixCellHtml(fid, answer, vars))
  end
  local rowClass = vecdir == "row" and " math-vec-row" or ""
  local html = '<span class="math-vec' .. rowClass .. '" style="--n:' .. #components .. '">'
            .. table.concat(cells) .. '</span>'
  return html, ids, labels, count
end

local function buildMatrix(exerciseId, count, content, vars)
  local rawRows = splitTop(content, ";")
  local rows, columnCount = {}, nil
  for _, rawRow in ipairs(rawRows) do
    local columns = splitTop(rawRow, ",")
    if columnCount == nil then
      columnCount = #columns
    elseif #columns ~= columnCount then
      error("math-exercise: mat[...] rows must have the same number of columns")
    end
    table.insert(rows, columns)
  end

  local ids, labels, cells = {}, {}, {}
  for row, columns in ipairs(rows) do
    for column, answer in ipairs(columns) do
      count = count + 1
      local fid = exerciseId .. "-f" .. count
      table.insert(ids, fid)
      table.insert(labels, "m" .. row .. "," .. column)
      table.insert(cells, matrixCellHtml(fid, answer, vars))
    end
  end
  local html = '<span class="math-mat" style="--cols:' .. columnCount .. '">'
            .. table.concat(cells) .. '</span>'
  return html, ids, labels, count
end

local function atWordBoundary(text, position)
  if position <= 1 then return true end
  return not text:sub(position - 1, position - 1):match("[%w_]")
end

-- Exercise bodies are inserted as raw HTML, outside Pandoc's Markdown math
-- parser. Canonical delimiters keep page-level MathJax from consuming a bare
-- \\begin{...} environment and leaving literal dollar signs behind.
local function normalizeTaskMathDelimiters(text)
  text = text:gsub("%$%$(.-)%$%$", "\\[%1\\]")
  return text:gsub("%$(.-)%$", "\\(%1\\)")
end

-- Replace scalar, vector, and matrix markers with HTML input elements.
-- The third return value contains structural label tokens used by the browser
-- for localized component/cell feedback. Author-supplied field-labels still
-- take precedence.
----
local function processMarkers(text, exerciseId, vars, vecdir, mode)
  text = normalizeTaskMathDelimiters(text)
  local count, fieldIds, structuralLabels = 0, {}, {}
  local dynamicNames = {}
  local output, position = {}, 1

  while position <= #text do
    local rest = text:sub(position)
    local scalarHead = rest:match("^_+%[")
    local vectorHead, matrixHead, dynamicMatrixHead
    if not scalarHead and atWordBoundary(text, position) then
      vectorHead = rest:match("^vec%[")
      if not vectorHead then matrixHead = rest:match("^mat%[") end
      if not vectorHead and not matrixHead then dynamicMatrixHead = rest:match("^mat{") end
    end
    local head = scalarHead or vectorHead or matrixHead or dynamicMatrixHead
    local bracket = head and text:sub(position + #head - 1):match("^%b[]")
    local brace = dynamicMatrixHead and text:sub(position + #dynamicMatrixHead - 1):match("^%b{}")

    if bracket or brace then
      local balanced = bracket or brace
      local content = balanced:sub(2, -2)
      local html, ids, labels
      if scalarHead then
        count = count + 1
        local fid = exerciseId .. "-f" .. count
        html, ids, labels = scalarFieldHtml(fid, content, vars, #scalarHead - 1), { fid }, { "" }
      elseif vectorHead then
        html, ids, labels, count = buildVector(exerciseId, count, content, vars, vecdir)
      elseif matrixHead then
        html, ids, labels, count = buildMatrix(exerciseId, count, content, vars)
      else
        local dynamicSpec = parseDynamicMatrixSpec(content)
        if dynamicNames[dynamicSpec.name] then
          error("math-exercise: duplicate dynamic matrix name " .. dynamicSpec.name)
        end
        dynamicNames[dynamicSpec.name] = true
        html, ids, labels = buildDynamicMatrix(exerciseId, content, vars, mode)
      end
      for _, fid in ipairs(ids) do table.insert(fieldIds, fid) end
      for _, label in ipairs(labels) do table.insert(structuralLabels, label) end
      table.insert(output, html)
      position = position + #head - 1 + #balanced
    else
      table.insert(output, text:sub(position, position))
      position = position + 1
    end
  end

  return table.concat(output), fieldIds, structuralLabels
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
-- AI-feedback context mode for this exercise.
--   "none"     – #| context: none
--   "explicit" – #| context: id1, id2, ...  (resolved client-side, see JS)
--   "auto"     – no #| context: option, falls back to the auto section text
----
local function contextMode(opts)
  local ref = opts["context"]
  if ref == "none" then return "none" end
  if ref and ref ~= "" then return "explicit" end
  return "auto"
end

----
-- Exercise cell builder (called from the document-order block walk below so
-- it can read the auto-collected section context).
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
  local checker   = opts["checker"]   or ""
  local packages  = splitCsv(opts["packages"] or "")
  local response  = opts["response"]  or ""
  local embedResponse = (opts["embed-response"] == "true")
  local partialCredit = (opts["partial-credit"] == "true")
  local formCredit = opts["form-credit"] or "0.5"
  local fieldLabels = splitCsv(opts["field-labels"] or "")
  local isPool    = (opts["pool"]     == "true")
  local vecdir    = opts["vecdir"] == "row" and "row" or "col"

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
             .. ' data-checker="'   .. jsonStrAttr(checker) .. '"'
             .. ' data-packages="'  .. jsonArrAttr(packages) .. '"'
             .. ' data-response="'  .. attrEsc(response) .. '"'
             .. ' data-embed-response="' .. tostring(embedResponse) .. '"'
             .. ' data-partial-credit="' .. tostring(partialCredit) .. '"'
             .. ' data-form-credit="' .. attrEsc(formCredit) .. '"'
             .. ' data-field-labels="' .. jsonArrAttr(fieldLabels) .. '"'
             .. ' data-vecdir="' .. vecdir .. '"'
             .. ' data-context-mode="' .. contextMode(opts) .. '"'
             .. ' data-context-refs="' .. attrEsc(opts["context"] or "") .. '"'
             .. ' data-context="'      .. jsonStrAttr(truncate(state.sectionCtx, MAX_CONTEXT_CHARS)) .. '"'

  local questionHtml

  if isPool then
    local tasks = splitTasks(questionText)
    attrs        = attrs .. ' data-pool="'   .. jsonArrAttr(tasks) .. '"'
                         .. ' data-fields="[]"'
                         .. ' data-structural-field-labels="[]"'
    questionHtml = '<button type="button" class="math-pool-reload" title="' .. uiT("poolReload") .. '">&#8635;</button>\n'
                .. '<div class="math-exercise-question"></div>'
  else
    local body, fieldIds, structuralLabels = processMarkers(questionText, eid, vars, vecdir, mode)
    body         = body:gsub("\n", "<br>\n")
    attrs        = attrs .. ' data-fields="' .. jsonArrAttr(fieldIds) .. '"'
                         .. ' data-structural-field-labels="' .. jsonArrAttr(structuralLabels) .. '"'
    questionHtml = '<div class="math-exercise-question">' .. body .. '</div>'
  end

  local bodyHtml = table.concat({
    questionHtml,
    embedResponse and '<div class="math-exercise-response-slot"></div>' or '',
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
  base = langAliases[base] or base
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
-- see prose that appeared earlier in the same document: tracks `sectionCtx`,
-- the prose collected since the last heading, in document order.
--
-- Recurses into plain Divs/BlockQuotes (callouts, columns, …) so exercises or
-- headings nested inside them are still found; list/table content is only
-- captured as flattened text (a nested exercise inside a bullet list would
-- be missed – an accepted, documented limitation).
--
-- `.math-exercise-context` divs are explicit-context blocks: their id is
-- referenced from `#| context:`, but resolution happens client-side (JS),
-- not here – this walk only folds their text into sectionCtx (so they also
-- count as ambient auto-context for neighboring exercises) and otherwise
-- leaves them untouched, still visible on the page.
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
      local text = collapseWs(pandoc.utils.stringify(b))
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
    local state = { sectionCtx = "" }
    doc.blocks = walkBlocks(doc.blocks, state)
  end

  return doc
end

return {
  { Pandoc = Pandoc },
}
