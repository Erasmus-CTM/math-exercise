-- Documentation-only source panels, emitted before the exercise filters.
local policyFiles = {}
local summary, jsxSummary, policySummary = 'Show Quarto exercise source', 'Show JSXGraph code', 'Show policy YAML'
local function escape(text)
  return text:gsub('&','&amp;'):gsub('<','&lt;'):gsub('>','&gt;'):gsub('"','&quot;')
end
local function policySummaryTarget(source)
  local maxIssues=source:match('max%-issues="(%d+)"') or ''
  local integration='plain-text'
  if source:find('```{math%-exercise}') then integration='math-exercise'
  elseif source:find('```{py%-exercise}') then integration='py-exercise'
  elseif source:find('```{pyodide%-python}') then integration='pyodide-interaktiv' end
  local id=source:match('#|%s*label:%s*([^\n]+)') or source:match('{[^}]*#([%w_%-]+)') or ''
  local name=source:match('#|%s*feedback%-policy:%s*([^\n]+)') or source:match('feedback%-policy="([^"]+)"') or ''
  id=id:gsub('^%s*["\']',''):gsub('["\']%s*$','')
  name=name:gsub('^%s*["\']',''):gsub('["\']%s*$','')
  return '<div class="ai-feedback-policy-summary" data-max-issues="'..maxIssues..'" data-integration="'..integration..'" data-exercise="'..escape(id)..'" data-policy="'..escape(name)..'"></div>'
end
local function panel(source, title, testsPanel, jsx)
  local pieces = {'<div class="example-author-notes ai-feedback-ignore"><details class="math-example-source" data-source-kind="'..(jsx and 'jsxgraph' or 'exercise')..'"><summary>'..title..'</summary><pre><code class="language-markdown">'..escape(source)..'</code></pre>'}
  if testsPanel then table.insert(pieces, testsPanel) end
  table.insert(pieces, '</details>')
  if not jsx and #policyFiles > 0 then
    table.insert(pieces, '<details class="math-example-policy" data-source-kind="policy"><summary>'..policySummary..'</summary>'..policySummaryTarget(source))
    for _, file in ipairs(policyFiles) do
      table.insert(pieces, '<p><strong>'..escape(file.name)..'</strong></p><pre><code class="language-yaml">'..escape(file.content)..'</code></pre>')
    end
    table.insert(pieces, '</details>')
  end
  table.insert(pieces, '</div>')
  return pandoc.RawBlock('html',table.concat(pieces,'\n'))
end
local function defaultPolicySource(base)
  local extensions = pandoc.path.join({base,'_extensions'})
  local candidates = {pandoc.path.join({extensions,'ai-feedback','feedback-defaults.yml'})}
  local ok, entries = pcall(pandoc.system.list_directory, extensions)
  if ok then
    for _, owner in ipairs(entries) do
      table.insert(candidates,pandoc.path.join({extensions,owner,'ai-feedback','feedback-defaults.yml'}))
    end
  end
  for _, path in ipairs(candidates) do
    local file=io.open(path,'r')
    if file then
      local content=file:read('*a');file:close()
      return {name='AI Feedback defaults (feedback-defaults.yml)',content=content}
    end
  end
  error('Cannot read installed AI Feedback policy defaults')
end
local function meta(m)
  policyFiles = {}
  local lang=pandoc.utils.stringify(m.lang or 'en'):lower():match('^(%a+)')
  if lang=='nb' or lang=='no' then summary,jsxSummary,policySummary='Vis Quarto-kildekode for oppgaven','Vis JSXGraph-kode','Vis policy-YAML'
  elseif lang=='de' then summary,jsxSummary,policySummary='Quarto-Aufgabenquellcode anzeigen','JSXGraph-Code anzeigen','Policy-YAML anzeigen'
  else summary,jsxSummary,policySummary='Show Quarto exercise source','Show JSXGraph code','Show policy YAML' end
  local base=quarto.project.directory or pandoc.path.directory(quarto.doc.input_file)
  table.insert(policyFiles,defaultPolicySource(base))
  local cfg=m['ai-feedback'] or {}
  for _, key in ipairs({'policy-files','page-policy-files'}) do
    local files=cfg[key]
    if files then
      if pandoc.utils.type(files)~='List' then files={files} end
      for _, name in ipairs(files) do
        name=pandoc.utils.stringify(name)
        local base=quarto.project.directory or pandoc.path.directory(quarto.doc.input_file)
        local path=pandoc.path.is_absolute(name) and name or pandoc.path.join({base,name})
        local f=assert(io.open(path,'r'),'Cannot read example policy source: '..path)
        table.insert(policyFiles,{name=name,content=f:read('*a')});f:close()
      end
    end
  end
end
local function code(el)
  if not quarto.doc.is_format('html') then return end
  local opening
  for _, name in ipairs({'math-exercise','py-exercise','pyodide-python'}) do
    if el.classes:includes('{'..name..'}') or el.classes:includes(name) then opening='{'..name..'}' end
  end
  local jsx=el.classes:includes('jsxgraph')
  if jsx then
    local args={'.jsxgraph'}
    for _,class in ipairs(el.classes) do if class~='jsxgraph' then table.insert(args,'.'..class) end end
    if el.identifier~='' then table.insert(args,'#'..el.identifier) end
    for key,value in pairs(el.attributes) do table.insert(args,key..'="'..tostring(value):gsub('"','\\"')..'"') end
    opening='{'..table.concat(args,' ')..'}'
  end
  if not opening then return end
  local testsPanel
  local tests=el.text:match('#|%s*tests:%s*([^\r\n]+)')
  if opening=='{math-exercise}' and tests and tests:match('%.py$') then
    local base=quarto.project.directory or pandoc.path.directory(quarto.doc.input_file)
    local f=assert(io.open(pandoc.path.join({base,tests}),'r'),'Cannot read author tests: '..tests)
    local contents=f:read('*a');f:close()
    testsPanel='<details class="math-example-tests"><summary>Author tests: '..escape(tests)..'</summary><pre><code class="language-python">'..escape(contents)..'</code></pre></details>'
  end
  return {el,panel('```'..opening..'\n'..el.text..'\n```',jsx and jsxSummary or summary,testsPanel,jsx)}
end
local function div(el)
  if not quarto.doc.is_format('html') or not el.classes:includes('ai-feedback') then return end
  local source=pandoc.write(pandoc.Pandoc({el}),'markdown',{wrap_text='none'})
  return {el,panel(source,summary)}
end
return {{Meta=meta},{CodeBlock=code,Div=div}}
