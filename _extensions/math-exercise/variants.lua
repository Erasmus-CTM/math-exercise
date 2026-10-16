-- Quarto/Pandoc adapter: YAML -> generator -> pre-rendered Markdown records.
local M = {}
local function html(source, markers)
  local fields = {}
  if markers then
    if source:find('CTMVARIANTFIELD', 1, true) then error('Reserved template marker') end
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
function M.generate(raw, question, opts, review)
  if not raw:match('#|%s*parameters:') then return nil end
  local generator = quarto.utils.resolve_path('variants.py')
  local result = quarto.json.decode(pandoc.pipe('python3', {generator}, quarto.json.encode({source=raw, review=review or false})))
  for _, record in ipairs(result.variants) do
    record.question = html(record.question, true)
    record.solution = html(record.solution, false)
  end
  return result
end
return M
