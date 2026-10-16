local root=os.getenv('VARIANT_EXTENSION')
quarto={utils={resolve_path=function(p)return root..'/'..p end},json=pandoc.json}
return {{CodeBlock=function(el)
 local module=dofile(root..'/variants.lua')
 local opts,lines={},{}
 for line in (el.text..'\n'):gmatch('([^\n]*)\n') do if not line:match('^#|') then lines[#lines+1]=line end end
 local r=module.generate(el.text,table.concat(lines,'\n'),opts)
 return pandoc.CodeBlock(pandoc.json.encode(r))
end}}
