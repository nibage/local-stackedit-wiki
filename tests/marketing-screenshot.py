#!/usr/bin/env python3
"""Capture a REAL, dark-themed Local StackEdit Wiki UI from the verified offline ZIP.

The screenshot is produced by Chromium running the actual application bundles,
using an in-memory example wiki solely to avoid writing user files. No mocked
UI drawing, image composition, network requests, or fake rendered diagrams.
"""
import argparse
import base64
import hashlib
import mimetypes
from pathlib import Path
import tempfile
from urllib.parse import urlsplit, unquote
import zipfile
from playwright.sync_api import sync_playwright

MARKDOWN = """# The knowledge workspace

Create and connect ideas with **local Markdown**, rich diagrams and instant navigation.

> [!TIP] Offline first
> Your notes live in your own folder — no account or cloud needed.

## Idea to insight

```mermaid
graph LR
  A[Capture] --> B[Organize]
  B --> C[Connect]
  C --> D[Discover]
```

## From source to preview

```mermaid
graph LR
  M[Markdown] --> R[Live renderer]
  R --> D[Diagrams]
  R --> K[Math & links]
```

Mathematics is selectable, too: $E=mc^2$.

Explore linked notes using [[Engineering/Architecture|Architecture]].
"""

def extract_verified_zip(archive_path, destination):
    with zipfile.ZipFile(archive_path) as zf:
        for info in zf.infolist():
            target = (destination / info.filename).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise AssertionError("Unsafe path in ZIP: " + info.filename)
        if zf.testzip():
            raise AssertionError("Corrupt offline ZIP")
        zf.extractall(destination)
    root = destination / "local-stackedit-wiki"
    assert (root / "index.html").is_file(), "Expected offline app root missing"
    return root


def capture(root, output, chromium=None):
    origin = "https://marketing-wiki.test"
    failures = []
    with sync_playwright() as playwright:
        opts = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        if chromium: opts["executable_path"] = chromium
        browser = playwright.chromium.launch(**opts)
        page = browser.new_page(viewport={"width": 1720, "height": 1024}, device_scale_factor=1)
        page.set_default_timeout(22000)
        page.on("pageerror", lambda error: failures.append("JS: "+str(error)))

        def serve_local(route):
            u = urlsplit(route.request.url)
            if u.scheme != "https" or u.netloc != "marketing-wiki.test":
                failures.append("External request: "+route.request.url)
                route.abort()
                return
            target = (root / unquote(u.path).lstrip("/")).resolve()
            if not target.is_relative_to(root) or not target.is_file():
                failures.append("Missing app asset: "+u.path)
                route.fulfill(status=404, body="missing")
                return
            mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            route.fulfill(status=200, content_type=mime, body=target.read_bytes())

        page.route("**/*", serve_local)
        html = (root / "index.html").read_text(encoding="utf-8").replace(
            "<head>", '<head><base href="'+origin+'/">', 1)
        page.set_content(html, wait_until="load", timeout=40000)
        page.wait_for_function("Boolean(window.LocalWikiRender && window.LocalWikiDiagrams)")
        caps = page.evaluate("window.LocalWikiDiagrams.capabilities()")
        assert caps == {"mermaid": True, "abc": True}, caps

        # Exercise the SAME picker and virtual folder tree that the real app uses.
        # Only the sample file contents below are synthetic demo data.
        page.evaluate("""(markdown) => {
          function file(name, body) { return {
            name, kind:'file', body, lastModified:100,
            async getFile() {
              return new File([this.body], this.name, {
                type:this.name.endsWith('.md') ? 'text/markdown' : 'text/plain',
                lastModified:this.lastModified
              });
            },
            async createWritable() { let next;
              return {write:async b=>next=b,
                close:async()=>{this.body=next;this.lastModified++;},
                abort:async()=>{}};
            }
          }; }
          function dir(name, children=[]) {
            const entries=new Map(children.map(c=>[c.name,c]));
            return {name,kind:'directory',entries,
              async *values(){yield* entries.values()},
              async getFileHandle(n){
                const e=entries.get(n);
                if(!e||e.kind!=='file')throw Error('Missing file '+n);
                return e;
              },
              async getDirectoryHandle(n){
                const e=entries.get(n);
                if(!e||e.kind!=='directory')throw Error('Missing directory '+n);
                return e;
              }
            };
          }
          window.demoWiki=dir('knowledge-base', [
            file('Knowledge-dashboard.md', markdown),
            file('Getting-started.md','# Getting started\\n\\nOffline notes.'),
            file('Daily-notes.md','# Daily notes\\n\\nIdeas and research.'),
            dir('Engineering',[
              file('Architecture.md','# Architecture\\n\\n[[Knowledge-dashboard]]'),
              file('JavaScript.md','# JavaScript\\n\\nLocal source code.')
            ]),
            dir('Research', [
              file('Reading-list.md','# Reading list\\n\\nBooks and links.'),
              file('Experiments.md','# Experiments\\n\\nMermaid graphs.')
            ]),
            dir('Attachments', [
              file('roadmap.canvas','{"nodes":[],"edges":[]}'),
              file('notes.base','views:\\n  - type: table\\n    name: Notes'),
              file('workflow.drawio','<mxfile/>')
            ])
          ]);
          window.showDirectoryPicker=async()=>window.demoWiki;
        }""", MARKDOWN)
        page.locator("#theme-select").select_option("dark")
        page.locator("#open-folder").click()
        page.wait_for_function("document.querySelector('#root-name').textContent==='knowledge-base'")
        page.locator(".tree-row[aria-label='Knowledge-dashboard.md']").click()
        page.wait_for_function(
            "document.querySelector('#filename').textContent==='Knowledge-dashboard.md'")
        # Open folders only to showcase real file-tree controls/asset icons.
        page.locator(".tree-row[aria-label='Engineering']").click()
        page.locator(".tree-row[aria-label='Research']").click()
        page.locator(".tree-row[aria-label='Attachments']").click()
        page.wait_for_function("""() =>
          document.querySelectorAll('#preview .visualization-mermaid svg').length===2
        """, timeout=30000)
        page.wait_for_function("document.querySelector('#notice').hidden",timeout=10000)
        assert page.evaluate("document.documentElement.dataset.theme")=="dark"
        assert page.locator("#preview .visualization-mermaid svg").count()==2
        assert page.locator("#preview .visualization-mermaid .diagram-export").count()==2
        assert page.locator(".tree-row[aria-label='Knowledge-dashboard.md'] .glyph-note").inner_text()=="📝"
        assert page.locator(".tree-row[aria-label='Getting-started.md'] .glyph-note").inner_text()=="📄"
        assert page.locator(".tree-row[aria-label='Engineering'] .glyph-folder").inner_text()=="📂"
        page.wait_for_timeout(700)  # allow fonts/math layout to settle

        # Compact presentation viewport while showing BOTH rendered Mermaid diagrams.
        previews=page.evaluate("""() => [...document.querySelectorAll(
          '#preview .visualization-mermaid svg')].map(e=>{
            const x=e.getBoundingClientRect(),p=document.querySelector('#preview').getBoundingClientRect();
            return {top:x.top,bottom:x.bottom,inside:x.top>=p.top&&x.bottom<=p.bottom};
          })""")
        if not all(p["inside"] for p in previews):
            raise AssertionError("Both diagrams must be visible in the screenshot: "+str(previews))
        if failures:
            raise AssertionError("App preview requested unexpected resources: "+str(failures))
        output.parent.mkdir(parents=True, exist_ok=True)
        data = page.screenshot(type="jpeg", quality=83, full_page=False,
                               animations="disabled")
        assert data.startswith(b"\xff\xd8") and len(data)>35_000
        output.write_bytes(data)
        print("Captured actual current app: dark theme, two Mermaid diagrams, "
              "real offline renderer, folder icons, selected note; "
              f"image {len(data)} bytes", flush=True)
        browser.close()
    return data


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--zip",type=Path,required=True)
    parser.add_argument("--out",type=Path,default=Path("marketing-current.jpg"))
    parser.add_argument("--chromium",default=None)
    parser.add_argument("--emit-base64",action="store_true")
    args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="local-wiki-shot-") as directory:
        root=extract_verified_zip(args.zip,Path(directory))
        data=capture(root,args.out,args.chromium)
    if args.emit_base64:
        # Temporary internal PR handoff only. CI logs are NOT user content.
        b64=base64.b64encode(data).decode("ascii")
        digest=hashlib.sha256(data).hexdigest()
        print("WIKI_IMAGE_START:"+digest+":"+str(len(data)),flush=True)
        for i in range(0,len(b64),3500):
            print("WIKI_IMAGE_CHUNK:"+b64[i:i+3500],flush=True)
        print("WIKI_IMAGE_END",flush=True)


if __name__=="__main__":
    main()
