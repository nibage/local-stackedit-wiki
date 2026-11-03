# Publishing through a pull request

The repository is [nibage/local-stackedit-wiki](https://github.com/nibage/local-stackedit-wiki).

Prefer a feature branch and pull request against `main`, rather than overwriting `main` or force-pushing. The source checkout may contain placeholder Mermaid and ABCjs files; the **verified offline ZIP** is built by GitHub Actions from pinned upstream libraries.

## From an existing local clone

1. Ensure `git status` is clean and run `git pull --ff-only`.
2. Create a branch (`git switch -c release/rc5-english-dragdrop`).
3. Copy the contents of the `local-stackedit-wiki/` folder from the RC5 ZIP into your clone, preserving `.git/` and excluding personal wiki content.
4. Check `git status` and `git diff --check` before committing. **Do not accidentally commit user notes or secrets.**
5. Commit and push the branch, then open a pull request into `main`.

Example:

```sh
git switch -c release/rc5-english-dragdrop
git add -A
git diff --cached --check
git commit -m "Prepare RC5: English UI and safe drag-and-drop moves"
git push -u origin release/rc5-english-dragdrop
```

Run the GitHub Actions workflow **Build complete offline wiki ZIP** to obtain the fully bundled distribution, and test it against a copy of `demo-wiki` before using important notes. Never force-push to `main`.
