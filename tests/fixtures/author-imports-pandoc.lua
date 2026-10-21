-- Run the production adapter in Pandoc's Lua runtime without loading assets.
local adapter = dofile(os.getenv("MATH_IMPORT_ADAPTER"))
return {{Pandoc = function(doc)
  local calls = {}
  local mode = pandoc.utils.stringify(doc.meta.mode or "cdn")
  local absent = doc.meta.absent == true
  local ctm = {assets = {mode = function() return mode end},
    fail = function(message) assert(false, message) end}
  if absent then _G.__ctmAuthorImports = nil
  else _G.__ctmAuthorImports = {add = function(spec) calls[#calls + 1] = spec end} end
  local packages = {"networkx", "scipy"}
  adapter(ctm, "import networkx", packages, "plain")
  adapter(ctm, "", packages, "built-in")
  adapter(ctm, "INVALID {{template}}", packages, "generated", {variants = {
    {id = "v-one", checker = "import numpy\nvalue = 1"},
    {id = "v-two", checker = "import scipy\nvalue = 2"}
  }})
  if not absent then
    assert(#calls == 4, "every actual checker must be registered")
    for _, spec in ipairs(calls) do assert(spec.packages == packages, "reuse parsed package array") end
  end
  return pandoc.Pandoc({pandoc.CodeBlock(pandoc.json.encode(calls))}, doc.meta)
end}}
