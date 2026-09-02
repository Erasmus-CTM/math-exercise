(function () {
  'use strict';

  function merge(base, extra) {
    return Object.assign({}, base, extra || {});
  }

  function createGraphEditor(options) {
    options = options || {};
    var board = options.board;
    if (!board || typeof board.create !== 'function') {
      throw new TypeError('Graph editor requires a JSXGraph board');
    }

    var labels = merge({
      deleteSelected: 'Delete selected',
      clearGraph: 'Clear graph',
      showControls: 'Show controls',
      hideControls: 'Hide controls'
    }, options.labels);
    var instructions = options.instructions || [
      'Click empty space to add a vertex.',
      'Click two vertices to add or remove their edge.',
      'Drag a vertex to move it.',
      'Select a vertex, then choose Delete selected to remove it.'
    ];
    var pointAttributes = merge({
      size: 6,
      fixed: false,
      showInfobox: false,
      highlight: false
    }, options.pointAttributes);
    var edgeAttributes = merge({
      strokeColor: '#475569',
      strokeWidth: 3,
      fixed: true,
      highlight: false
    }, options.edgeAttributes);
    var normalStyle = merge({ fillColor: '#2563eb', strokeColor: '#1d4ed8' }, options.normalStyle);
    var selectedStyle = merge({ fillColor: '#f59e0b', strokeColor: '#92400e' }, options.selectedStyle);
    var bounds = board.getBoundingBox();
    var editableBottom = options.editableBottom === undefined ? bounds[3] + 0.9 : Number(options.editableBottom);
    var vertices = [];
    var edges = [];
    var selectedVertex = null;
    var nextVertexId = 1;
    var controlsVisible = false;

    function setSelected(vertex) {
      if (selectedVertex) selectedVertex.point.setAttribute(normalStyle);
      selectedVertex = vertex;
      if (selectedVertex) selectedVertex.point.setAttribute(selectedStyle);
      board.update();
    }

    function addVertex(x, y) {
      x = Number(x);
      y = Number(y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError('Vertex coordinates must be finite numbers');
      }
      var vertex = { id: nextVertexId++ };
      vertex.point = board.create('point', [x, y], merge(pointAttributes, merge(normalStyle, {
        name: String(vertex.id)
      })));
      vertices.push(vertex);
      setSelected(null);
      return vertex.id;
    }

    function findVertex(id) {
      return vertices.find(function (vertex) { return vertex.id === id; }) || null;
    }

    function edgeKey(a, b) {
      return a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
    }

    function toggleEdgeVertices(a, b) {
      if (!a || !b || a === b) return false;
      var key = edgeKey(a, b);
      var index = edges.findIndex(function (edge) { return edge.key === key; });
      if (index >= 0) {
        board.removeObject(edges[index].segment);
        edges.splice(index, 1);
        setSelected(null);
        return false;
      }
      edges.push({
        key: key,
        source: a,
        target: b,
        segment: board.create('segment', [a.point, b.point], edgeAttributes)
      });
      setSelected(null);
      return true;
    }

    function toggleEdge(sourceId, targetId) {
      var source = findVertex(sourceId);
      var target = findVertex(targetId);
      if (!source || !target) throw new Error('Cannot connect an unknown vertex');
      return toggleEdgeVertices(source, target);
    }

    function handleVertexClick(vertex) {
      if (!selectedVertex) setSelected(vertex);
      else if (selectedVertex === vertex) setSelected(null);
      else toggleEdgeVertices(selectedVertex, vertex);
    }

    function deleteSelected() {
      if (!selectedVertex) return false;
      var doomed = selectedVertex;
      edges.slice().forEach(function (edge) {
        if (edge.source === doomed || edge.target === doomed) {
          board.removeObject(edge.segment);
          edges.splice(edges.indexOf(edge), 1);
        }
      });
      board.removeObject(doomed.point);
      vertices.splice(vertices.indexOf(doomed), 1);
      selectedVertex = null;
      board.update();
      return true;
    }

    function clear() {
      setSelected(null);
      edges.forEach(function (edge) { board.removeObject(edge.segment); });
      vertices.forEach(function (vertex) { board.removeObject(vertex.point); });
      edges = [];
      vertices = [];
      nextVertexId = 1;
      board.update();
    }

    function response() {
      return {
        representation: 'undirected-graph',
        nodes: vertices.map(function (vertex) {
          return {
            id: vertex.id,
            x: Number(vertex.point.X().toFixed(4)),
            y: Number(vertex.point.Y().toFixed(4))
          };
        }),
        edges: edges.map(function (edge) { return [edge.source.id, edge.target.id]; })
      };
    }

    var panel = document.createElement('div');
    panel.setAttribute('role', 'note');
    panel.setAttribute('aria-label', 'Graph editor controls');
    panel.setAttribute('data-graph-editor-control', 'true');
    panel.style.cssText = [
      'position:absolute', 'top:48px', 'right:12px', 'z-index:20',
      'display:none', 'width:min(270px,calc(100% - 24px))',
      'box-sizing:border-box', 'padding:10px 12px', 'border:1px solid #94a3b8',
      'border-radius:7px', 'background:rgba(255,255,255,0.96)',
      'color:#1e293b', 'font:14px/1.35 sans-serif', 'box-shadow:0 3px 12px rgba(15,23,42,0.18)'
    ].join(';');
    var list = document.createElement('ol');
    list.style.cssText = 'margin:0;padding-left:1.35rem';
    instructions.forEach(function (instruction) {
      var item = document.createElement('li');
      item.textContent = instruction;
      list.appendChild(item);
    });
    panel.appendChild(list);
    board.containerObj.style.position = board.containerObj.style.position || 'relative';
    board.containerObj.appendChild(panel);

    var controlBar = document.createElement('div');
    controlBar.setAttribute('data-graph-editor-control', 'true');
    controlBar.style.cssText = [
      'position:absolute', 'left:12px', 'bottom:10px', 'z-index:20',
      'display:flex', 'gap:8px', 'flex-wrap:wrap', 'font:14px/1.2 sans-serif'
    ].join(';');
    board.containerObj.appendChild(controlBar);

    function createControl(label, handler) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = [
        'padding:6px 10px', 'border:1px solid #94a3b8', 'border-radius:5px',
        'background:#fff', 'color:#1e293b', 'cursor:pointer'
      ].join(';');
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        handler();
      });
      controlBar.appendChild(button);
      return button;
    }

    var toggleButton;
    function showControls(show) {
      controlsVisible = show === undefined ? !controlsVisible : !!show;
      panel.style.display = controlsVisible ? 'block' : 'none';
      if (toggleButton) toggleButton.textContent = controlsVisible ? labels.hideControls : labels.showControls;
      board.update();
      return controlsVisible;
    }

    createControl(labels.deleteSelected, deleteSelected);
    createControl(labels.clearGraph, clear);
    toggleButton = createControl(labels.showControls, function () { showControls(); });

    function isControlEvent(event) {
      return !!(event.target && event.target.closest &&
        event.target.closest('button, input, [data-graph-editor-control]'));
    }

    function vertexAt(screen) {
      for (var i = vertices.length - 1; i >= 0; i--) {
        if (vertices[i].point.hasPoint(screen[0], screen[1])) return vertices[i];
      }
      return null;
    }

    function userPosition(screen) {
      var width = board.containerObj.clientWidth || board.canvasWidth;
      var height = board.containerObj.clientHeight || board.canvasHeight;
      if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        return [
          bounds[0] + screen[0] / width * (bounds[2] - bounds[0]),
          bounds[1] - screen[1] / height * (bounds[1] - bounds[3])
        ];
      }
      var coords = new JXG.Coords(JXG.COORDS_BY_SCREEN, screen, board);
      return [coords.usrCoords[1], coords.usrCoords[2]];
    }

    var pressStart = null;

    function canvasMouseDown(event) {
      if (isControlEvent(event)) return;
      if (event.button !== undefined && event.button !== 0) return;
      var screen = board.getMousePosition(event);
      var vertex = vertexAt(screen);
      if (vertex) {
        pressStart = { screen: screen, vertex: vertex };
      } else {
        var position = userPosition(screen);
        if (position[1] > editableBottom) addVertex(position[0], position[1]);
      }
    }

    function canvasMouseUp(event) {
      if (!pressStart || isControlEvent(event)) {
        pressStart = null;
        return;
      }
      var screen = board.getMousePosition(event);
      var dx = screen[0] - pressStart.screen[0];
      var dy = screen[1] - pressStart.screen[1];
      if (dx * dx + dy * dy <= 64) handleVertexClick(pressStart.vertex);
      pressStart = null;
    }

    // Create a blank-space vertex on mouse-down, before JSXGraph can suppress
    // the later SVG click. Delay vertex selection until mouse-up so dragging a
    // point does not also create or remove an edge.
    board.containerObj.addEventListener('mousedown', canvasMouseDown, true);
    document.addEventListener('mouseup', canvasMouseUp, true);

    board.containerObj.setAttribute('data-graph-editor-ready', 'true');

    if (options.controlsInitiallyVisible) showControls(true);

    var api = {
      board: board,
      addVertex: addVertex,
      toggleEdge: toggleEdge,
      deleteSelected: deleteSelected,
      clear: clear,
      response: response,
      showControls: showControls,
      register: function (spec) {
        if (!JXG.QuartoAssessment || typeof JXG.QuartoAssessment.register !== 'function') {
          throw new Error('Graph editor registration requires the Quarto assessment bridge');
        }
        JXG.QuartoAssessment.register(merge(spec, { board: board, response: response }));
        return api;
      }
    };
    return api;
  }

  function createBoard(options) {
    options = options || {};
    var container = options.container || document.querySelector('.jxgbox');
    if (!container) throw new Error('Graph editor could not find its JSXGraph container');
    var board = JXG.JSXGraph.initBoard(container.id, merge({
      boundingbox: [-5, 4, 5, -4],
      axis: false,
      pan: { enabled: false },
      zoom: { enabled: false },
      showNavigation: false,
      showCopyright: false
    }, options.boardAttributes));
    var editor = createGraphEditor(merge(options, { board: board }));

    function resizeToVisibleContainer() {
      var width = container.clientWidth;
      var height = container.clientHeight;
      if (!(width > 0 && height > 0) || typeof board.resizeContainer !== 'function') return false;
      if (Math.abs((board.canvasWidth || 0) - width) > 1 ||
          Math.abs((board.canvasHeight || 0) - height) > 1) {
        board.resizeContainer(width, height);
        if (typeof board.fullUpdate === 'function') board.fullUpdate();
      }
      return true;
    }

    editor.resize = resizeToVisibleContainer;
    if (typeof ResizeObserver !== 'undefined') {
      var observer = new ResizeObserver(resizeToVisibleContainer);
      observer.observe(container);
      editor.resizeObserver = observer;
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        resizeToVisibleContainer();
        requestAnimationFrame(resizeToVisibleContainer);
      });
    }
    resizeToVisibleContainer();
    return editor;
  }

  JXG.QuartoGraphEditor = {
    create: createGraphEditor,
    createBoard: createBoard
  };
})();
