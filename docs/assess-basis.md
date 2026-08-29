# `assess_basis` API reference

`assess_basis(...)` is the shared checker helper for exercises in which a
student submits basis vectors as the rows or columns of a dynamic matrix. It
handles the generic basis logic so that an exercise author only has to define
the target subspace.

Use it inside a `mode: custom` checker. SymPy and `assess_basis` are already
available in the checker namespace.

## Signature

```python
assess_basis(
    matrix,
    *,
    axis,
    target_dimension,
    belongs,
    name,
    space_name="space",
)
```

All arguments after `matrix` are keyword-only.

## Parameters

| Parameter | Type | Meaning |
|---|---|---|
| `matrix` | SymPy `Matrix` | The submitted matrix. Each selected row or column is treated as one proposed basis vector. The canonical submission with no entries is `Matrix(0, 0, [])`. |
| `axis` | `"columns"` or `"rows"` | Selects whether vectors are stored as columns or rows. |
| `target_dimension` | non-negative integer | Dimension of the target subspace. The checker normally computes this from the defining matrix or constraints. |
| `belongs` | callable | Receives one nonzero submitted vector and returns whether it belongs to the target subspace. |
| `name` | string | Must match the name in `mat{name=..., ...}`. The helper stores structured row or column assessment under this name. |
| `space_name` | string | Student-facing noun phrase used in qualitative feedback, such as `"null space"`, `"row space"`, or `"eigenspace"`. Defaults to `"space"`. |

## Membership callback

The helper rejects zero vectors before calling `belongs`. The callback therefore
tests membership only; it does not need to test nonzeroness, independence,
completeness, or rank.

For `axis="columns"`, the callback receives a column matrix. For `axis="rows"`,
it receives a row matrix.

If a matrix operation requires a particular vector length, put the shape check
first. Python then short-circuits before an incompatible multiplication or
join:

```python
belongs=lambda vector: (
    submitted.rows == C.cols
    and C * vector == zeros(C.rows, 1)
)
```

The callback result is converted with `bool(...)`. It should therefore return a
definite truth value, not an unresolved symbolic relation.

## Minimal column-basis example

````markdown
```{math-exercise}
#| mode: custom
#| checker: |
#|   def check(response, symbols):
#|       Z = response["inputs"]["Z"]["matrix"]
#|       C = Matrix([[1, 2, 3], [2, 4, 6]])
#|       return assess_basis(
#|           Z,
#|           axis="columns",
#|           target_dimension=C.cols - C.rank(),
#|           belongs=lambda vector: (
#|               Z.rows == C.cols
#|               and C * vector == zeros(C.rows, 1)
#|           ),
#|           name="Z",
#|           space_name="null space",
#|       )

Give a basis for the null space of C:
Z = mat{name=Z, rows=3, cols=auto, initial-cols=1, min-cols=0, max-cols=3}
```
````

The outer `markdown` fence above displays the complete exercise source rather
than executing it on GitHub.

## Row-basis example

```python
def check(response, symbols):
    R = response["inputs"]["R"]["matrix"]
    A = Matrix([
        [1, 0, 1, 2],
        [0, 1, 1, 1],
        [1, 1, 2, 3],
    ])
    return assess_basis(
        R,
        axis="rows",
        target_dimension=A.rank(),
        belongs=lambda vector: (
            R.cols == A.cols
            and A.col_join(vector).rank() == A.rank()
        ),
        name="R",
        space_name="row space",
    )
```

## Vector assessment semantics

Assessment is invariant under every permutation of the submitted vectors.
There is no special “last” or “redundant” vector.

| Status | Color | Meaning |
|---|---|---|
| `correct` | green | The vector is nonzero, belongs to the target space, and the complete locally valid submitted family is independent. |
| `dependent` | yellow | The vector is nonzero and belongs to the target space, but the complete locally valid submitted family is dependent. Every vector in that family receives this status. |
| `incorrect` | red | The vector is zero or does not belong to the target space. |

Invalid vectors remain red. The helper computes dependence from the remaining
locally valid vectors. If that valid family is dependent, all of its members are
yellow; otherwise they are green.

## Exercise score

For a nontrivial target, let:

- $d$ be the target dimension;
- $n$ be the number of submitted vectors;
- $v$ be the number of nonzero submitted vectors that belong to the target;
- $r$ be the rank of those locally valid vectors.

For $n>0$, the internal score is:

$$
\frac{\min(r,d)}{d}
\cdot
\frac{v}{n}
\cdot
\frac{r}{v}.
$$

The final factor is defined as zero when $v=0$. The three factors represent
coverage of the target, local validity, and independence.

The result is fully correct only when all submitted vectors are valid and form
a basis of the target space.

## Empty submission

All matrices without entries use the single canonical value `Matrix(0, 0, [])`.
Configured row or column dimensions are intentionally not encoded in that
value.

- If `target_dimension > 0`, an empty submission scores zero and the feedback
  asks the student to add basis vectors.
- If `target_dimension == 0`, the empty submission is correct.
- If `target_dimension == 0` but vectors were submitted, they are red and the
  feedback asks the student to remove them.

## Student feedback and score privacy

The returned dictionary contains the numeric score for grading but also sets
`show_score: False`. Consequently, the student sees “Partially correct” without
a percentage.

Standard feedback is qualitative. It may say that vectors should be removed,
replaced, or added, but it does not state the score, rank, target dimension, or
number of missing vectors. This prevents the assessment from revealing the
dimension that the exercise asks the student to determine.

Structured row or column statuses are still passed to AI feedback. They identify
valid, dependent, and invalid submitted families without choosing a privileged
vector order.

## Return value

The helper returns the custom-checker result dictionary directly:

```python
{
    "score": 0.0,              # internal number from 0 to 1
    "show_score": False,       # hide partial percentages from students
    "feedback": "...",         # qualitative plain text
    "assessment": {
        name: {
            axis: ["correct", "dependent", "incorrect", ...]
        }
    },
}
```

The normalized exercise status is derived from `score`: zero is incorrect, one
is correct, and a score strictly between them is partial.

## Errors and author responsibilities

The helper raises an author-facing checker error when:

- `axis` is neither `"rows"` nor `"columns"`;
- `target_dimension` is negative;
- `belongs` is not callable; or
- the membership callback or its matrix operations fail.

The author is responsible for computing the correct target dimension, writing a
membership predicate consistent with that target, matching `name` to the
dynamic matrix marker, and choosing matrix-size bounds suitable for the task.

See the [dynamic matrix example page](https://erasmus-ctm.github.io/math-exercise/dynamic-matrix-tests.html)
for null-space, column-space, row-space, eigenspace, and polynomial-subspace
exercises.
