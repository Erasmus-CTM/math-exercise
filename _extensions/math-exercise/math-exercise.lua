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
----

local hasSetup      = false
local exerciseCount = 0

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
-- CodeBlock filter
----
function CodeBlock(el)
  if not quarto.doc.is_format("html") then return el end
  if not el.attr.classes:includes("{math-exercise}") then return el end

  ensureSetup()
  exerciseCount = exerciseCount + 1
  local eid = "math-exercise-" .. exerciseCount

  local opts, questionText = parseOptions(el.text)

  local caption         = opts["caption"]         or nil
  local label           = opts["label"]           or eid
  local vars            = opts["vars"]            or ""
  local mode            = opts["mode"]            or "equivalent"
  local reject          = opts["reject"]          or ""
  local tolerance       = opts["tolerance"]       or ""
  local decplaces       = opts["decplaces"]       or ""
  local sigfigs         = opts["sigfigs"]         or ""
  local form            = opts["form"]            or ""
  local feedbackContext = opts["feedback-context"] or ""
  local isPool          = (opts["pool"]           == "true")

  local captionHtml = ""
  if caption then
    captionHtml = '<div class="math-exercise-caption math-exercise-toggle" role="button" tabindex="0">'
               .. '<span class="math-chevron" aria-hidden="true"></span>'
               .. caption .. '</div>\n'
  end

  -- Base data attributes shared by both modes
  local attrs = 'id="'                    .. eid                      .. '"'
             .. ' data-label="'           .. attrEsc(label)           .. '"'
             .. ' data-mode="'            .. attrEsc(mode)            .. '"'
             .. ' data-reject="'          .. attrEsc(reject)          .. '"'
             .. ' data-vars="'            .. attrEsc(vars)            .. '"'
             .. ' data-tolerance="'       .. attrEsc(tolerance)       .. '"'
             .. ' data-decplaces="'       .. attrEsc(decplaces)       .. '"'
             .. ' data-sigfigs="'         .. attrEsc(sigfigs)         .. '"'
             .. ' data-form="'            .. attrEsc(form)            .. '"'
             .. ' data-feedback-context="' .. attrEsc(feedbackContext) .. '"'

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

function Meta(meta)
  lang = resolveLang(meta)

  -- math-exercise.js reads this to pick its LOCALES entry.
  quarto.doc.include_text("before-body",
    '<script>window.__mathExerciseConfig = ' ..
    quarto.json.encode({ lang = lang }) .. ';</script>')

  return meta
end

-- Meta runs before CodeBlock so the language is known while cells are built.
return {
  { Meta = Meta },
  { CodeBlock = CodeBlock },
}
