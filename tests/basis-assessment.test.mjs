import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(
  new URL('../_extensions/math-exercise/math-exercise.js', import.meta.url),
  'utf8',
);

function sympyBootstrap() {
  const match = source.match(/runPythonAsync\(\[\n([\s\S]*?)\n    \]\.join\('\\n'\)\)/);
  assert.ok(match, 'could not locate the embedded SymPy bootstrap');
  return vm.runInNewContext(`[${match[1]}]`).join('\n');
}

test('basis assessment is symmetric, supports rows, and handles empty bases', () => {
  const cases = String.raw`
def col_result(matrix, dimension, belongs=lambda vector: True):
    return assess_basis(matrix, axis="columns", target_dimension=dimension,
                        belongs=belongs, name="B", space_name="test space")

dependent_columns = [Matrix([1, 0]), Matrix([0, 1]), Matrix([1, 1])]
for order in ((0, 1, 2), (2, 0, 1), (1, 2, 0)):
    result = col_result(Matrix.hstack(*(dependent_columns[i] for i in order)), 2)
    assert abs(result["score"] - 2/3) < 1e-12
    assert result["assessment"]["B"]["columns"] == ["dependent"] * 3

incomplete = col_result(Matrix([[1], [0]]), 2)
assert incomplete["score"] == 0.5
assert incomplete["assessment"]["B"]["columns"] == ["correct"]

mixed = col_result(Matrix.eye(3), 2, lambda vector: vector[2, 0] == 0)
assert abs(mixed["score"] - 2/3) < 1e-12
assert mixed["assessment"]["B"]["columns"] == ["correct", "correct", "incorrect"]

rows = assess_basis(Matrix([[1, 0], [0, 1], [1, 1]]), axis="rows",
                    target_dimension=2, belongs=lambda vector: True,
                    name="R", space_name="test row space")
assert rows["assessment"]["R"]["rows"] == ["dependent"] * 3

empty_nontrivial = col_result(Matrix(0, 0, []), 2)
assert empty_nontrivial["score"] == 0
assert empty_nontrivial["assessment"]["B"]["columns"] == []

empty_trivial = col_result(Matrix(0, 0, []), 0)
assert empty_trivial["score"] == 1
assert empty_trivial["assessment"]["B"]["columns"] == []
`;
  const result = spawnSync(process.env.PYTHON || 'python3', ['-c', `${sympyBootstrap()}\n${cases}`], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
