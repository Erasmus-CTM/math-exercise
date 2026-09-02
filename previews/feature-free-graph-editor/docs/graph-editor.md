# Graph editor API reference

`JXG.QuartoGraphEditor` is the shared browser-side editor for exercises where
students construct a simple undirected graph. It owns vertex placement, edge
creation, dragging, deletion, the controls panel, and response serialization.
The companion Python helper `graph_from_response(...)` validates that response
and creates a NetworkX graph for a custom checker.

Both Quarto filters are required:

```yaml
filters:
  - jsxgraph
  - math-exercise
```

## Minimal editor

The standard board and editor need two statements:

```javascript
var editor = JXG.QuartoGraphEditor.createBoard();
editor.register();
```

`createBoard()` finds the current JSXGraph container, initializes a board, and
returns an editor. `register()` exposes `editor.response()` through the existing
JSXGraph assessment bridge.

The editor starts empty. Its interactions are:

| Action | Result |
|---|---|
| Click empty canvas | Add a vertex at that position. |
| Click two vertices | Add an edge between them. |
| Click an existing pair again | Remove their edge. |
| Drag a vertex | Change its displayed position without changing adjacency. |
| Click one vertex, then **Delete selected** | Remove the vertex and all incident edges. |
| Click **Clear graph** | Remove all vertices and edges. |
| Click **Show controls** | Open an instruction panel on the canvas; the same button hides it again. |

Self-loops and parallel edges cannot be created. Vertex identifiers are stable
until the graph is cleared; deleting a vertex does not renumber the others.

## `createBoard(options)`

`createBoard` supplies a standard board suitable for the graph-theory examples.
It accepts the editor options below plus:

| Option | Meaning |
|---|---|
| `container` | JSXGraph container element. By default, the `.jxgbox` in the current iframe. |
| `boardAttributes` | Attributes passed to `JXG.JSXGraph.initBoard`. Defaults to a fixed `[-5, 4, 5, -4]` board without axes, pan, zoom, navigation, or copyright text. |

For a board that already exists, call
`JXG.QuartoGraphEditor.create({board: board, ...options})` instead.

## Editor options

| Option | Default | Meaning |
|---|---|---|
| `controlsInitiallyVisible` | `false` | Show the instruction panel when the board opens. |
| `instructions` | Four standard interaction steps | Array of strings displayed in the instruction panel. |
| `labels` | English control labels | Overrides `deleteSelected`, `clearGraph`, `showControls`, or `hideControls`. |
| `editableBottom` | bottom of board plus `0.9` | Lowest y-coordinate where a blank click may add a vertex; reserves space for controls. |
| `pointAttributes` | standard draggable blue point | Additional JSXGraph point attributes. |
| `edgeAttributes` | standard fixed grey segment | Additional JSXGraph segment attributes. |
| `normalStyle` | blue fill and border | Normal vertex colors. |
| `selectedStyle` | orange fill and dark border | Selected vertex colors. |

## Editor methods

| Method | Result |
|---|---|
| `addVertex(x, y)` | Adds a vertex and returns its numeric identifier. |
| `toggleEdge(sourceId, targetId)` | Adds the edge, or removes it if already present. Returns `true` when added and `false` when removed. |
| `deleteSelected()` | Deletes the selected vertex and returns whether anything was deleted. |
| `clear()` | Restores the empty editor and resets the next identifier to 1. |
| `showControls(show)` | Shows or hides the instruction panel. With no argument, toggles it. |
| `resize()` | Synchronizes JSXGraph with the visible canvas size; this also happens automatically after a collapsed exercise opens. |
| `response()` | Returns the current JSON-serializable graph response. |
| `summarize(options)` | Returns the current topology summary used for AI feedback. |
| `register(spec)` | Registers the response with `JXG.QuartoAssessment`; optional `ai` configuration may be supplied in `spec`. |

## Response schema

```json
{
  "representation": "undirected-graph",
  "nodes": [
    {"id": 1, "x": -2.25, "y": 1.5},
    {"id": 2, "x": 0.75, "y": -0.5}
  ],
  "edges": [[1, 2]]
}
```

Coordinates describe only the drawing. Graph properties are determined from
the node identifiers and edges.

## AI-feedback context

Use `JXG.QuartoGraphEditor.summarize(data, options)` to turn a graph response
into a compact, deterministic topology description. The instance method
`editor.summarize(options)` summarizes the editor's current response. The
summary contains:

- vertex and edge counts;
- sorted vertex identifiers and edges;
- every vertex degree;
- connected components and isolated vertices;
- whether the graph is connected; and
- the undirected cycle rank $|E|-|V|+c$, where $c$ is the number of connected
  components.

Coordinates are deliberately omitted: adjacency describes the mathematical
graph, while an optional rendered image shows its current drawing. Add an
author-controlled feedback policy with `options.feedbackPolicy`, and optional
JSON metadata under `options.extra`.

```javascript
var editor = JXG.QuartoGraphEditor.createBoard();
editor.register({
  ai: {
    render: true,
    summary: function (data) {
      return JXG.QuartoGraphEditor.summarize(data, {
        feedbackPolicy: 'Discuss degrees and connectedness without proposing a finished graph.'
      });
    }
  }
});
```

When the student requests AI feedback, context is assembled in separate
channels:

| Prompt part | Contents |
|---|---|
| Task | Exercise caption and question text. |
| Learning context | Automatic section context or explicitly referenced `.math-exercise-context` blocks. |
| Student response | The escaped JSON topology summary inside `<jsxgraph_response>`. |
| Private assessment | The custom checker's status, numeric score, and feedback. The model is instructed not to quote assessment metadata. |
| Image | A PNG of the current board when `ai.render: true`; providers that reject images are retried with text only. |

The full graph response is used locally by the custom checker but is not sent
to the AI. The textual summary is limited to 4,000 characters. Summary values
are XML-escaped before prompt assembly, and the iframe's image and summary are
requested only when the student selects **Feedback**.

## Partial-credit checkers

Graph exercises use custom checkers, so partial credit is determined by the
checker return value rather than by geometry or the `partial-credit` option.
The examples use a deliberately simple three-level rule: zero until all
required vertex and edge counts are met, one half when those counts are met but
the defining property is not, and one only for a complete construction:

```python
def check(response, symbols):
    import networkx as nx
    graph = graph_from_response(response)
    if graph.number_of_nodes() < 5:
        return {"score": 0, "feedback": "Use at least five vertices."}
    if nx.is_tree(graph):
        return {"score": 1, "feedback": "This graph is a tree."}
    return {"score": 0.5, "feedback": "Make the graph connected and acyclic."}
```

`#| partial-credit: true` is recommended in the exercise declaration to make
the grading intent explicit, although custom checker scores are honored
regardless of that option.

## `graph_from_response(response, *, directed=False)`

This Python helper is available inside every custom checker. For the undirected
editor, use the default `directed=False`. It:

- requires the matching representation name;
- requires unique integer vertex identifiers and finite coordinates;
- rejects unknown endpoints, self-loops, duplicate edges, and malformed data;
- returns `networkx.Graph` with each vertex position stored as `x` and `y` node
  attributes.

Declare NetworkX as an exercise package before using the helper:

```yaml
#| mode: custom
#| packages: networkx
```

Invalid input raises `ValueError`. A checker should catch it and return a
student-facing result:

```python
def check(response, symbols):
    import networkx as nx
    try:
        graph = graph_from_response(response)
    except ValueError:
        return {"score": 0, "feedback": "The board returned a malformed graph."}
    return nx.is_tree(graph)
```

## Complete Quarto pattern

The JSXGraph and exercise blocks remain siblings so each Quarto filter can
process its own block type:

````markdown
```{.jsxgraph assessment_id="tree-board" width="800" height="520"}
var editor = JXG.QuartoGraphEditor.createBoard();
editor.register();
```

```{math-exercise}
#| mode: custom
#| packages: networkx
#| response: jsxgraph:tree-board
#| embed-response: true
#| checker: |
#|   def check(response, symbols):
#|       import networkx as nx
#|       try:
#|           graph = graph_from_response(response)
#|       except ValueError:
#|           return False
#|       return graph.number_of_nodes() >= 5 and nx.is_tree(graph)

Construct a tree with at least five vertices.
```
````

The checker and package names are delivered to the browser and are visible to
students, like every other custom checker in `math-exercise`. This mechanism is
for formative assessment rather than secure examinations.
