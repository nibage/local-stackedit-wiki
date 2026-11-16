# GitHub source and release workflow

This codebase is already versioned in https://github.com/nibage/local-stackedit-wiki.

Use a feature branch and Pull Request for changes. Do not run an initial-import script or force-push over `main`.

The repository contains the real pinned Mermaid and ABCjs bundles, so a normal `git clone` or `git pull` can run the app offline. To verify them locally:

```sh
python tools/vendor-renderers-for-repo.py --check
python tools/release-audit.py --require-renderers
node --test tests/*.test.cjs
```

The GitHub Actions workflow `.github/workflows/offline-release.yml` builds and tests the complete downloadable ZIP, including the renderer, layout and attachment smoke tests. The accompanying docs describe limitations of Canvas/Bases and browser codecs.
