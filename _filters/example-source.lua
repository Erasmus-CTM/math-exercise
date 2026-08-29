-- Add a collapsed, copyable source panel after every rendered example on the
-- documentation website. This filter runs before math-exercise.lua: the
-- original CodeBlock is left untouched for the extension, while the escaped
-- copy is emitted as inert HTML and therefore cannot become a second exercise.

local summary = "Show source"
local jsxSummary = "Show JSXGraph source"

local function escapeHtml(text)
  return text:gsub("&", "&amp;")
             :gsub("<", "&lt;")
             :gsub(">", "&gt;")
             :gsub('"', "&quot;")
end

local function Meta(meta)
  local raw = meta.lang and pandoc.utils.stringify(meta.lang):lower() or "en"
  local base = raw:match("^(%a+)") or "en"
  if base == "nb" or base == "no" then
    summary = "Vis kildekode"
    jsxSummary = "Vis JSXGraph-kildekode"
  elseif base == "de" then
    summary = "Quellcode anzeigen"
    jsxSummary = "JSXGraph-Quellcode anzeigen"
  else
    summary = "Show source"
    jsxSummary = "Show JSXGraph source"
  end
  return meta
end

local function CodeBlock(el)
  if not quarto.doc.is_format("html") then return el end
  local isExercise = el.attr.classes:includes("{math-exercise}")
  local isJsxGraph = el.attr.classes:includes("jsxgraph")
  if not isExercise and not isJsxGraph then return el end

  local opening = "{math-exercise}"
  local panelSummary = summary
  if isJsxGraph then
    local args = { ".jsxgraph" }
    if el.attr.identifier and el.attr.identifier ~= "" then
      table.insert(args, "#" .. el.attr.identifier)
    end
    for _, className in ipairs(el.attr.classes) do
      if className ~= "jsxgraph" then table.insert(args, "." .. className) end
    end
    for key, value in pairs(el.attr.attributes) do
      table.insert(args, key .. '="' .. tostring(value):gsub('"', '\\"') .. '"')
    end
    opening = "{" .. table.concat(args, " ") .. "}"
    panelSummary = jsxSummary
  end

  local source = "```" .. opening .. "\n" .. el.text .. "\n```"
  local panel = table.concat({
    '<details class="math-example-source">',
    '  <summary>' .. panelSummary .. '</summary>',
    '  <pre><code class="language-markdown">' .. escapeHtml(source) .. '</code></pre>',
    '</details>'
  }, "\n")

  return { el, pandoc.RawBlock("html", panel) }
end

return {
  { Meta = Meta },
  { CodeBlock = CodeBlock }
}
