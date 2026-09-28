"""Deterministic build-time variants. Uses PyYAML for authored options; no eval/exec."""
import ast
import hashlib
import itertools
import json
import math
import operator
import re
import sys

FUNCTIONS = {name: getattr(math, name) for name in ('sqrt', 'sin', 'cos', 'tan', 'floor', 'ceil', 'exp', 'log')}
FUNCTIONS.update(abs=abs, min=min, max=max, round=round, sigfig=lambda x, n: 0 if x == 0 else round(x, int(n)-1-int(math.floor(math.log10(abs(x))))))
OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Mod: operator.mod, ast.Pow: operator.pow}
CMP = {ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt, ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge}
TOKEN = re.compile(r'\{\{([A-Za-z][A-Za-z0-9_]*)(?::(\.[0-9]{1,2}[fg]))?\}\}')

def expression(source, values):
    def visit(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float, bool): return node.value
        if isinstance(node, ast.Name):
            if node.id in values: return values[node.id]
            if node.id == 'pi': return math.pi
            raise KeyError(node.id)
        if isinstance(node, ast.BinOp) and type(node.op) in OPS:
            a, b = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Pow) and abs(b) > 100: raise ValueError('Exponent exceeds 100')
            return OPS[type(node.op)](a, b)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd, ast.Not)):
            value = visit(node.operand)
            return -value if isinstance(node.op, ast.USub) else (+value if isinstance(node.op, ast.UAdd) else not value)
        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And): return all(visit(v) for v in node.values)
            return any(visit(v) for v in node.values)
        if isinstance(node, ast.Compare):
            left = visit(node.left)
            for op, right in zip(node.ops, node.comparators):
                value = visit(right)
                if type(op) not in CMP or not CMP[type(op)](left, value): return False
                left = value
            return True
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCTIONS and not node.keywords:
            return FUNCTIONS[node.func.id](*(visit(x) for x in node.args))
        raise ValueError('Unsupported expression syntax: ' + ast.dump(node))
    tree = ast.parse(str(source).replace('^', '**'), mode='eval')
    if sum(1 for _ in ast.walk(tree)) > 200: raise ValueError('Expression too large')
    result = visit(tree.body)
    if type(result) not in (int, float, bool) or not math.isfinite(result): raise ValueError('Non-finite expression result')
    if abs(result) > 1e100: raise ValueError('Expression result too large')
    return result

def canonical(value): return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def substitute(value, env):
    if isinstance(value, dict): return {k: substitute(v, env) for k, v in value.items()}
    if isinstance(value, list): return [substitute(v, env) for v in value]
    if not isinstance(value, str): return value
    def replace(match):
        v = env[match[1]]
        if match[2]: return format(v, match[2])
        return str(int(v)) if type(v) in (int, float) and v == int(v) else str(v)
    result = TOKEN.sub(replace, value)
    if '{{' in result: raise ValueError('Unknown or malformed template placeholder: ' + result)
    return result

def choices(spec):
    if isinstance(spec, dict):
        if set(spec) - {'start', 'stop', 'step'}: raise ValueError('Unknown range option')
        start, stop, step = spec['start'], spec['stop'], spec.get('step', 1)
        if any(type(x) is not int for x in (start, stop, step)) or step == 0: raise ValueError('Ranges require integers and nonzero step')
        spec = list(range(start, stop + (1 if step > 0 else -1), step)) if abs(stop-start)//abs(step) < 10000 else []
    if not isinstance(spec, list) or not spec: raise ValueError('Parameter choices must be a nonempty list or inclusive range')
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in spec): raise ValueError('Parameters must be finite numbers')
    # Treat mathematically identical integer/float choices as the same value.
    spec = [int(v) if v == int(v) else v for v in spec]
    if len(set(spec)) != len(spec): raise ValueError('Duplicate parameter choices')
    return spec

def generate(spec):
    if not isinstance(spec, dict): raise ValueError('Exercise definition must be a mapping')
    if type(spec.get('review', False)) is not bool: raise ValueError('review must be boolean')
    if not isinstance(spec.get('derived', {}), dict): raise ValueError('derived must be a mapping')
    for key in ('question','solution','variant-context','checker'):
        if not isinstance(spec.get(key,''), str): raise ValueError(key + ' must be text')
    constraints = spec.get('constraints', [])
    if not isinstance(constraints, (str,list)) or isinstance(constraints,list) and not all(isinstance(c,str) for c in constraints): raise ValueError('constraints must contain expressions')
    tests = spec.get('tests', [])
    if not isinstance(tests,list): raise ValueError('tests must be a list')
    statuses = {'correct','wrong','partial','empty','error','rejected','not_exact','not_form'}
    for test in tests:
        if not isinstance(test,dict) or ('answers' in test)==('response' in test): raise ValueError('Each test needs exactly one of answers or response')
        expected = test.get('expected')
        expected = expected if isinstance(expected,list) else [expected]
        if not expected or any(e not in statuses for e in expected): raise ValueError('Each test needs valid expected statuses')
        if 'answers' in test and not isinstance(test['answers'],list): raise ValueError('Test answers must be a list')
        if 'response' in test and not isinstance(test['response'],dict): raise ValueError('Custom test response must be an object')
    parameters = spec.get('parameters', {})
    if not isinstance(parameters, dict) or not parameters: raise ValueError('parameters must be a nonempty mapping')
    derived = spec.get('derived', {})
    for name in [*parameters, *derived]:
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', name) or name in FUNCTIONS or name == 'pi': raise ValueError('Invalid/reserved parameter name: ' + name)
    if parameters.keys() & derived.keys(): raise ValueError('Derived name shadows a parameter')
    names = sorted(parameters)
    domains = [choices(parameters[n]) for n in names]
    if math.prod(map(len, domains)) > 10000: raise ValueError('At most 10000 candidate combinations are allowed')
    fingerprint = digest({k: v for k,v in spec.items() if k not in ('include-variants','exclude-variants','review','reviewed-fingerprint')})
    stale = bool(spec.get('reviewed-fingerprint') and spec['reviewed-fingerprint'] != fingerprint)
    if stale and not spec.get('review'): raise ValueError('Reviewed definition changed; enable review, then replace the selection block')
    records = []
    constraints = spec.get('constraints', [])
    if isinstance(constraints, str): constraints = [constraints]
    for combination in itertools.product(*domains):
        params = dict(zip(names, combination)); env = dict(params)
        pending_constraints = []
        valid = True
        for rule in constraints:
            try:
                if not expression(rule, env): valid = False; break
            except KeyError: pending_constraints.append(rule)
        if not valid: continue
        pending = dict(derived)
        while pending:
            progressed = False
            for name, formula in list(pending.items()):
                try: env[name] = expression(formula, env)
                except KeyError: continue
                del pending[name]; progressed = True
            if not progressed: raise ValueError('Unresolved/cyclic derived expressions: ' + ', '.join(pending))
        if not all(expression(rule, env) for rule in pending_constraints): continue
        record = {'id': 'v-' + digest(params)[:20], 'parameters': params, 'derived': {k:env[k] for k in derived}, 'fingerprint': fingerprint}
        for key in ('question', 'solution', 'variant-context', 'checker', 'tests'):
            record[key] = substitute(spec.get(key, [] if key == 'tests' else ''), env)
        for test in record['tests']:
            if 'answers' in test: test['answers'] = [str(x) for x in test['answers']]
            if 'response' in test:
                response=test['response']
                if 'raw' in response: response['raw']=[str(x) for x in response['raw']]
                for matrix in response.get('inputs',{}).values():
                    if isinstance(matrix,dict) and 'raw' in matrix: matrix['raw']=[str(x) for x in matrix['raw']]
        records.append(record)
    ids = {r['id'] for r in records}
    if len(ids) != len(records): raise ValueError('Variant ID collision')
    included, excluded = spec.get('include-variants'), spec.get('exclude-variants', [])
    if included is not None and excluded: raise ValueError('Use include-variants OR exclude-variants')
    for selection in (included, excluded):
        if selection is not None and (not isinstance(selection, list) or any(not isinstance(x,str) for x in selection) or len(set(selection)) != len(selection) or (any(x not in ids for x in selection) and not (stale and spec.get('review')))):
            raise ValueError('Selection contains unknown or duplicate variant IDs')
    for r in records: r['included'] = (included is None or r['id'] in included) and r['id'] not in excluded
    if not records or (not spec.get('review') and not any(r['included'] for r in records)): raise ValueError('No selected variants remain')
    return {'schema': 1, 'staleReview': stale, 'fingerprint': fingerprint, 'variants': records if spec.get('review') else [r for r in records if r['included']]}

def compile_request(request):
    if 'source' not in request: return generate(request)
    import yaml
    header, body = [], []
    for line in request['source'].splitlines():
        if line.startswith('#|'):
            text = line[2:]
            header.append(text[1:] if text.startswith(' ') else text)
        else: body.append(line)
    spec = yaml.safe_load('\n'.join(header))
    if not isinstance(spec, dict): raise ValueError('Expected YAML exercise options')
    spec['question'] = '\n'.join(body).strip()
    if request.get('review'): spec['review'] = True
    result = generate(spec)
    result['options'] = {k: str(v).lower() if isinstance(v, bool) else str(v)
                         for k,v in spec.items() if type(v) in (str, int, float, bool)}
    for k in ('packages', 'field-labels'):
        if isinstance(spec.get(k), list): result['options'][k] = ', '.join(map(str,spec[k]))
    result['review'] = spec.get('review', False)
    result['solutionTarget'] = spec.get('solution-target')
    return result

if __name__ == '__main__':
    try: print(json.dumps(compile_request(json.load(sys.stdin)), allow_nan=False))
    except Exception as error: sys.exit('math-exercise variants: ' + str(error))
