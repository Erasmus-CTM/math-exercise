# Installation and setup

[Start here](../README.md) · [Authoring guide](authoring.md)

## Installation

These examples currently use the integration preview. For AI feedback, install
the shared extension once in the same Quarto project:

```sh
quarto add Erasmus-CTM/ai-feedback@feature/scoped-policies
```

Then install this extension:

```bash
quarto add Erasmus-CTM/math-exercise@feature/shared-feedback-integration
```

Then enable the extension in your document:

```yaml
filters:
  - Erasmus-CTM/math-exercise
```

No `{pyodide}` code block needed – Pyodide and SymPy are loaded automatically
on the first click of **Check**, unless they're already available through
another Pyodide extension.

---


## Feedback setup

For feedback directly on the page, follow the [shared connection guide](https://github.com/Erasmus-CTM/ai-feedback/blob/feature/scoped-policies/docs/installation.md#provider-settings-and-data-sent). Without a connection, Feedback prepares a message to copy into an AI chat.
