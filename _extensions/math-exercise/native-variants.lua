-- Component transport to the installed native authoring service. No approval
-- or generation rules live in Lua; the native resolver verifies this parse.
local M = {}
local function trim(value) return value:match('^%s*(.-)%s*$') end

function M.parseSource(raw)
  raw = raw:gsub('\r\n','\n'):gsub('\r','\n')
  local lines, opts, index = {}, {}, 1
  for line in (raw .. '\n'):gmatch('([^\r\n]*)\n') do lines[#lines+1] = line end
  while index <= #lines do
    local key, value = lines[index]:match('^#|%s*([^:]+):%s*(.-)%s*$')
    if not key then break end
    assert(opts[key] == nil, 'Duplicate exercise option: ' .. key)
    index = index + 1
    if value == '|' or (key == 'tests' and value == '') then
      local block = {}
      while index <= #lines do
        local line = lines[index]
        if line:sub(1,5) == '#|   ' then block[#block+1] = line:sub(6)
        elseif line:match('^#|%s*$') then block[#block+1] = ''
        else break end
        index = index + 1
      end
      value = table.concat(block, '\n')
    end
    opts[key] = value
  end
  local sections, language, part = {['']={question={},solution={}}}, '', 'question'
  while index <= #lines do
    local line = lines[index]
    local nextLanguage = line:match('^#|%s*lang:%s*([%a][%w%-]*)%s*$')
    if line:match('^#|%s*solution%s*$') then part = 'solution'
    elseif nextLanguage then
      assert(sections[nextLanguage] == nil, 'Duplicate exercise translation: ' .. nextLanguage)
      language, part = nextLanguage, 'question'
      sections[language] = {question={},solution={}}
    else
      local target = sections[language][part]
      target[#target+1] = line
    end
    index = index + 1
  end
  for _, section in pairs(sections) do
    section.question = trim(table.concat(section.question, '\n'))
    section.solution = trim(table.concat(section.solution, '\n'))
  end
  local default = sections['']; sections[''] = nil
  if default.solution ~= '' then opts.solution = default.solution end
  if next(sections) then opts.translations = sections end
  return opts, default.question
end

local function solutionHtml(source)
  local document = pandoc.read(source, 'markdown'):walk({Math=function(math)
    return pandoc.Span({math}, pandoc.Attr('', {}, {
      {'data-ai-feedback-tex',math.text},
      {'data-ai-feedback-display',math.mathtype == 'DisplayMath' and 'true' or 'false'}
    }))
  end, RawInline=function() return {} end, RawBlock=function() return {} end})
  return pandoc.write(document, 'html', {html_math_method='mathjax',wrap_text='none'}):gsub('\n',' ')
end

function M.generate(raw, question, opts, ctm, language)
  assert(ctm.variants and ctm.variants.approval and ctm.variants.renderMode,
    'math-exercise variants need the shared authoring settings. Update CTM Assessment.')
  local label = opts.label
  assert(type(label) == 'string' and label ~= '', 'Generated variables require an explicit stable label.')
  local file = quarto.doc.input_file
  local project = quarto.project.directory or pandoc.path.directory(file)
  local approval, renderMode = ctm.variants.approval(), ctm.variants.renderMode()
  local reviewCandidate = os.getenv('CTM_VARIANTS_REVIEW_CANDIDATE')
  local reviewLanguage = os.getenv('CTM_VARIANTS_REVIEW_LANGUAGE')
  assert(not (reviewCandidate or reviewLanguage) or renderMode == 'review',
    'Internal review candidate/language selectors require explicit review mode.')
  assert(not reviewLanguage or reviewLanguage == 'default' or reviewLanguage == 'en'
    or reviewLanguage == 'de' or reviewLanguage == 'nb', 'Unsupported internal review language.')
  if reviewLanguage then language = reviewLanguage == 'default' and '' or reviewLanguage end
  local payload = {version=1,action='resolve',source=raw,question=question,options=opts,
    projectRoot=project,file=file,label=label,manifest='_variants/' .. label .. '.yml',
    approval=approval,renderMode=renderMode,solutionTarget=opts['solution-target']}
  local python = os.getenv('MATH_EXERCISE_PYTHON') or (pandoc.system.os == 'mingw32' and 'python' or 'python3')
  local script = quarto.utils.resolve_path('question-variants.py')
  local environment = ctm.checkers.environment()
  environment.CTM_VARIANTS_QUARTO = quarto.config.cli_path()
  local ok, output = pcall(pandoc.system.with_environment, environment, function()
    return pandoc.pipe(python,{script,'--stdin'},quarto.json.encode(payload))
  end)
  assert(ok, file .. ': ' .. label .. ': native variant resolution failed: ' .. tostring(output))
  -- Quarto's JSON decoder discards null fields. The exact context codec must
  -- retain variant:null and undecided n:null across the Lua/HTML boundary.
  local response = pandoc.json.decode(output)
  assert(response.version == 1 and type(response.records) == 'table', 'Invalid native variant response')
  local selected = {}
  for _, id in ipairs(response.deployableIds) do selected[id] = true end
  local records, unapproved = {}, false
  for _, record in ipairs(response.records) do
    if selected[record.id] and (not reviewCandidate or record.id == reviewCandidate) then
      local content = record.options.translations and record.options.translations[language]
      local numbered = type(record.context.variant) == 'table'
        and type(record.context.variant.n) == 'number' and record.context.variant.n > 0
      records[#records+1] = {id=record.id,hash=record.hash,n=numbered and record.n or pandoc.json.null,
        proposal=not numbered,status=record.status,state=record.state,context=record.context,
        values=record.values,
        question=content and content.question or record.question,
        solution=solutionHtml(content and content.solution or record.solution),
        checker=record.options.checker or '', ['variant-context']=record.options['context-text'] or '',
        fingerprint=record.hash}
      if record.status ~= 'approved' then unapproved = true end
    end
  end
  assert(not reviewCandidate or #records == 1, 'The requested review candidate is no longer available; rebuild review.')
  assert(#records > 0, file .. ': ' .. label .. ': no deployable variants; generate and review candidates first.')
  for _, warning in ipairs(response.warnings) do io.stderr:write(file .. ': ' .. label .. ': ' .. warning .. '\n') end
  local studentOptions = {}
  for key,value in pairs(opts) do
    if key ~= 'variables' and key ~= 'tests' and key ~= 'translations' and key ~= 'solution'
        and key ~= 'note' and key ~= 'context-text' then studentOptions[key]=value end
  end
  ctm.variants.use()
  return {version=1,native=true,options=studentOptions,variants=records,unapproved=unapproved,
    approval=approval,renderMode=renderMode,solutionTarget=opts['solution-target']}
end

return M
