-- Capture the real component's registrations during a Quarto render.
local fragments = {}
_G.__ctmAuthorImports = {add = function(spec)
  fragments[#fragments + 1] = spec
  local file = assert(io.open(os.getenv("MATH_IMPORT_CAPTURE"), "w"))
  file:write(quarto.json.encode(fragments)); file:close()
end}
return {}
