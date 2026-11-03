# Offline rendering

Local StackEdit Wiki runs without a web server or cloud account. The offline distribution bundles Markdown rendering (marked), MathJax, Mermaid, ABCjs and Prism. No network access is needed when browsing or editing a wiki.

If a development copy displays a missing Mermaid or ABCjs warning, use the **Renderers** dialog to install the pinned vendor files into the **application folder** containing `index.html`, never into your wiki. Reload the page afterwards.

The exact distribution versions and integrity checks are defined in `tools/build-offline-release.py` and `tools/release-audit.py`. Ordinary end users do not need Python, npm, or a local server.

A renderer failure does not modify the Markdown source. Please keep a backup of your original wiki before testing file operations.
