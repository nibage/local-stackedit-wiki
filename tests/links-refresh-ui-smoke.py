"""End-to-end Links/back, Refresh tree state, unobtrusive status and diagnostics."""
import argparse
from pathlib import Path
from urllib.parse import unquote,urlsplit
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--chromium',default=None)
args=parser.parse_args()

def serve(route):
    req=urlsplit(route.request.url)
    file=(ROOT/unquote(req.path).lstrip('/')).resolve()
    if req.netloc!='wiki-ux.test' or not file.is_relative_to(ROOT) or not file.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if file.suffix=='.css' else 'application/javascript' if file.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=file.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1450,'height':900})
    page.set_default_timeout(18000)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('https://wiki-ux.test/**',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace('<head>','<head><base href="https://wiki-ux.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      function file(name,body) {return {kind:'file',name,body,lastModified:123,
        async getFile(){return new File([this.body],name,{lastModified:this.lastModified})},
        async createWritable(){let next;return{write:async x=>next=x,
          close:async()=>{this.body=next;this.lastModified++},abort:async()=>{}}}
      }}
      function dir(name,items=[]){const entries=new Map(items.map(x=>[x.name,x]));
        return {kind:'directory',name,entries,
          async *values(){yield* entries.values()},
          async getDirectoryHandle(n){const x=entries.get(n);if(!x||x.kind!=='directory')throw Error('missing');return x},
          async getFileHandle(n){const x=entries.get(n);if(!x||x.kind!=='file')throw Error('missing');return x}
        }}
      window.mockWiki=dir('Wiki',[
        file('Home.md','# Home\\n\\n[Other](Docs/Other.md)\\n'),
        file('Orphan.md','# Orphan\\n\\n## Section\\n\\n### Subsection\\n'),
        dir('Docs',[file('Other.md','# Other\\n\\n[[Home]]\\n')])
      ]);
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    assert page.locator('#diagnostics').count()==0, 'Do not show protocol diagnostics below the tree'
    assert page.locator('#backlinks-run').count()==0, 'Backlinks must load automatically'
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    page.locator('.tree-row[aria-label="Home.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Home.md'")
    page.locator('[data-side="links"]').click()
    page.wait_for_function("document.querySelector('#backlinks-results .result-item')!==null")
    assert page.locator('#outlinks-results .result-item').count()==1
    page.locator('#outlinks-results .result-item').click()
    assert page.evaluate("document.querySelector('.CodeMirror').CodeMirror.getCursor().line")==2
    assert page.locator('#preview a.wiki-link-location').count()==1
    page.locator('[data-side="toc"]').click()
    assert page.locator('#toc .toc-item').count()==1
    assert page.locator('#side-toc h3').inner_text()=='Table of contents'
    page.locator('#toc .toc-item').first.click()
    assert page.evaluate("document.querySelector('.CodeMirror').CodeMirror.getCursor().line")==0
    page.locator('[data-side="links"]').click()
    assert 'Other.md' in page.locator('#backlinks-results').inner_text()
    page.locator('#backlinks-results .result-item').first.click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Docs/Other.md'")
    assert page.evaluate("document.querySelector('.CodeMirror').CodeMirror.getCursor().line")==2
    assert page.locator('#preview a.wiki-link-location').count()==1
    assert page.locator('#nav-back').is_visible()
    page.locator('#nav-back').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Home.md'")
    assert not page.locator('#nav-back').is_visible()
    page.locator('[data-side="files"]').click()
    page.locator('.tree-row[aria-label="Orphan.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Orphan.md'")
    page.locator('[data-view="preview"]').click()
    page.locator('[data-side="toc"]').click()
    assert page.locator('#toc .toc-item').count()==3
    cursor_before=page.evaluate("document.querySelector('.CodeMirror').CodeMirror.getCursor().line")
    page.locator('#toc .toc-item').nth(2).click()
    assert page.locator('[data-view="preview"]').get_attribute('class')=='active'
    assert page.evaluate("document.querySelector('.CodeMirror').CodeMirror.getCursor().line")==cursor_before
    page.locator('#view-edit').click()
    page.locator('#toc .toc-item').nth(2).click()
    assert page.locator('[data-view="edit"]').get_attribute('class')=='active'
    assert page.evaluate("document.querySelector('.CodeMirror').CodeMirror.getCursor().line")==4
    page.locator('#toc .toc-item').nth(0).click()
    assert page.evaluate("document.querySelector('.CodeMirror').CodeMirror.getCursor().line")==0
    assert page.evaluate("document.querySelector('.CodeMirror').contains(document.activeElement)")
    page.locator('[data-side="links"]').click()
    page.wait_for_function("document.querySelector('#notice').textContent.includes('No other notes link')")
    assert page.locator('#backlinks-results').inner_text().strip()==''
    page.locator('[data-side="search"]').click()
    page.locator('#fulltext-query').fill('obviously-nonexistent-phrase-123')
    page.locator('#fulltext-run').click()
    page.wait_for_function("document.querySelector('#fulltext-status').textContent.includes('0 matches')")
    assert not page.locator('#fulltext-results').inner_text().strip()

    page.locator('[data-side="files"]').click()
    page.locator('.tree-row[aria-label="Docs"]').click()
    assert page.locator('.tree-row[aria-label="Docs/Other.md"]').count()==1
    page.locator('#refresh').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Orphan.md'")
    assert page.locator('.tree-row[aria-label="Docs/Other.md"]').count()==1, 'Refresh collapsed expanded folders'
    assert page.locator('#search').input_value()==''

    page.locator('#rename-file').click()
    page.wait_for_function("document.querySelector('#notice').textContent.includes('Move mode enabled')")
    assert page.evaluate("""() => {
      const notice=document.querySelector('#notice');
      const n=notice.getBoundingClientRect();
      const header=document.querySelector('.topbar').getBoundingClientRect();
      const actions=document.querySelector('.topbar .actions').getBoundingClientRect();
      return n.bottom <= header.bottom + 1 && n.right <= actions.left + 1 &&
        getComputedStyle(notice).webkitLineClamp === '2';
    }"""), 'Notice must use two lines, stay centered and end before toolbar controls'
    page.locator('#renderer-check').click()
    assert page.locator('#diag-api').is_visible()
    assert 'File System API' in page.locator('#diag-api').inner_text()
    page.locator('#renderer-close').click()
    assert not errors,errors
    print('PASS: Links auto-backlinks, Back, Refresh preserves folder state, topbar notices, diagnostics moved')
    browser.close()
