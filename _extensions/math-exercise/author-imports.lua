-- Register the component's already-parsed checker code and package array.
-- The package collector owns Python import analysis and local subset checks.
return function(ctm, checker, packages, label, variants)
  local imports = rawget(_G, "__ctmAuthorImports")
  if not imports or type(imports.add) ~= "function" then
    if ctm.assets and ctm.assets.mode() == "local" then
      ctm.fail("math-exercise: local assets need CTM Assessment's author Python collector. Update CTM Assessment: quarto add https://erasmus-ctm.github.io/ctm-assessment/ctm-assessment.tar.gz; include the ctm-assessment filter before math-exercise.")
    end
    return
  end
  if variants then
    -- These are the actual substituted checkers sent to the learner, rather
    -- than the template (whose placeholders need not be valid Python).
    for _, record in ipairs(variants.variants) do
      imports.add{source = record.checker, packages = packages,
        origin = "math-exercise " .. label .. " variant " .. record.id .. " checker"}
    end
  else
    -- Register the package declaration even for a built-in mode with no
    -- custom checker: it is still an authored runtime package requirement.
    imports.add{source = checker, packages = packages,
      origin = "math-exercise " .. label .. " checker"}
  end
end
