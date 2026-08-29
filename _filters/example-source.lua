-- Add a collapsed, copyable source panel after every rendered example on the
-- documentation website. This filter runs before math-exercise.lua: the
-- original CodeBlock is left untouched for the extension, while the escaped
-- copy is emitted as inert HTML and therefore cannot become a second exercise.

local summary = "Show source"

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
  elseif base == "de" then
    summary = "Quellcode anzeigen"
  else
    summary = "Show source"
  end
  return meta
end

local function CodeBlock(el)
  if not quarto.doc.is_format("html") then return el end
  if not el.attr.classes:includes("{math-exercise}") then return el end

  local source = "```{math-exercise}\n" .. el.text .. "\n```"
  local panel = table.concat({
    '<details class="math-example-source">',
    '  <summary>' .. summary .. '</summary>',
    '  <pre><code class="language-markdown">' .. escapeHtml(source) .. '</code></pre>',
    '</details>'
  }, "\n")

  return { el, pandoc.RawBlock("html", panel) }
end

return {
  { Meta = Meta },
  { CodeBlock = CodeBlock }
}

