-- Quarto/Pandoc adapter: YAML -> generator -> pre-rendered Markdown records.
local M = {}
local function html(source, markers)
  local fields = {}
  if markers then
    if source:find('CTMVARIANTFIELD', 1, true) then assert(false, 'Reserved template marker') end
    local function protect(marker)
      fields[#fields+1] = marker
      return 'CTMVARIANTFIELD' .. #fields .. 'END'
    end
    for _, pattern in ipairs({'(_+%b[])', '(vec%b[])', '(mat%b[])', '(mat%b{})'}) do
      source = source:gsub(pattern, protect)
    end
  end
  local doc = pandoc.read(source, 'markdown'):walk({Math = function(m)
    return pandoc.Span({m}, pandoc.Attr('', {}, {
      ['data-ai-feedback-tex'] = m.text,
      ['data-ai-feedback-display'] = m.mathtype == 'DisplayMath' and 'true' or 'false'
    }))
  end})
  local result = pandoc.write(doc, 'html', {html_math_method='mathjax', wrap_text='none'}):gsub('\n', ' ')
  return result:gsub('CTMVARIANTFIELD(%d+)END', function(i) return fields[tonumber(i)] end)
end
-- `environment()`: the environment variants.py runs in (it rounds with
-- ctm-checkers' numeric module: its wheel on PYTHONPATH).
function M.generate(raw, question, opts, review, environment)
  if not raw:match('#|%s*parameters:') then return nil end
  local generator = quarto.utils.resolve_path('variants.py')
  local input = quarto.json.encode({source=raw, review=review or false})
  local function run() return pandoc.pipe('python3', {generator}, input) end
  local output = environment and pandoc.system.with_environment(environment(), run) or run()
  local result = quarto.json.decode(output)
  for _, record in ipairs(result.variants) do
    record.question = html(record.question, true)
    record.solution = html(record.solution, false)
  end
  return result
end
return M
