"""Chromium smoke: StackEdit reading mode and complete offline Markdown/asset toolbar."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def serve(route):
    uri=urlsplit(route.request.url)
    path=(ROOT/unquote(uri.path).lstrip('/')).resolve()
    if uri.netloc!='wiki-stackedit-mode.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1480,'height':950})
    page.set_default_timeout(16000)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-stackedit-mode.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      function file(name,body){return {kind:'file',name,body,lastModified:100,
        async getFile(){return new File([this.body],name,{lastModified:this.lastModified})},
        async createWritable(){let next;return{
          write:async value=>{next=value},
          close:async()=>{this.body=next;this.lastModified++},
          abort:async()=>{}
        }}};
      }
      const names=[
        file('Note.md','# Heading\\n\\nThis is a readable page.'),
        file('photo.png','PNG'),
        file('movie.mp4','MP4'),
        file('sound.wav','WAV'),
        file('paper.pdf','PDF'),
        file('board.canvas','{"nodes":[],"edges":[]}'),
        file('example.base','views:\\n  - type: table\\n    name: All'),
        file('flow.drawio','<mxfile><diagram/></mxfile>')
      ];
      const entries=new Map(names.map(f=>[f.name,f]));
      window.mockWiki={kind:'directory',name:'Wiki',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(name){return entries.get(name)}
      };
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    assert page.locator('#theme-select option[value="stackedit"]').count()==1
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    page.locator('.tree-row[aria-label="Note.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Note.md'")
    page.locator('#theme-select').select_option('stackedit')
    assert page.locator('html').get_attribute('data-theme')=='stackedit'
    assert page.locator('#preview').evaluate('(el)=>getComputedStyle(el).fontSize')=='18px'
    assert page.locator('.edit-pane .CodeMirror').evaluate('(el)=>getComputedStyle(el).fontSize')=='18px'
    assert page.locator('.format-toolbar').evaluate('(el)=>getComputedStyle(el).flexWrap')=='nowrap'
    assert page.locator('.format-toolbar').evaluate('(el)=>el.scrollHeight')<=40
    assert page.locator('.format-toolbar button[data-asset-kind]').count()==7
    page.locator('#theme-select').select_option('dark')
    assert page.locator('html').get_attribute('data-theme')=='dark'
    page.locator('#theme-select').select_option('stackedit')

    page.evaluate("""() => {
      const cm=window.LocalWikiDebug.editor.cm;
      cm.setValue('Line one\\nLine two');
      cm.setSelection({line:0,ch:0},{line:1,ch:8});
    }""")
    page.locator('[data-format="ordered"]').click()
    assert page.evaluate('window.LocalWikiDebug.editor.getValue()')=='1. Line one\n2. Line two'
    page.evaluate("""() => {
      const cm=window.LocalWikiDebug.editor.cm;
      cm.setValue('Item');
      cm.setCursor({line:0,ch:0});
    }""")
    page.locator('[data-format="checklist"]').click()
    assert page.evaluate('window.LocalWikiDebug.editor.getValue()')=='- [ ] Item'
    page.locator('[data-format="quote"]').click()
    assert '> ' in page.evaluate('window.LocalWikiDebug.editor.getValue()')
    page.evaluate("""() => {
      const cm=window.LocalWikiDebug.editor.cm;
      cm.setValue('word');
      cm.setSelection({line:0,ch:0},{line:0,ch:4});
    }""")
    page.locator('[data-format="strike"]').click()
    assert page.evaluate('window.LocalWikiDebug.editor.getValue()')=='~~word~~'
    page.evaluate("""() => {
      const cm=window.LocalWikiDebug.editor.cm;cm.setValue('');cm.setCursor({line:0,ch:0});
    }""")
    page.locator('[data-format="table"]').click()
    assert '| Column 1 | Column 2 |' in page.evaluate('window.LocalWikiDebug.editor.getValue()')
    page.locator('[data-format="code-block"]').click()
    assert '\u0060\u0060\u0060text' in page.evaluate('window.LocalWikiDebug.editor.getValue()')
    page.locator('[data-format="mermaid"]').click()
    assert 'graph TD' in page.evaluate('window.LocalWikiDebug.editor.getValue()')
    page.locator('[data-format="abc"]').click()
    assert 'T:New tune' in page.evaluate('window.LocalWikiDebug.editor.getValue()')
    page.evaluate("""() => {
      const cm=window.LocalWikiDebug.editor.cm;
      cm.setValue('E=mc^2');
      cm.setSelection({line:0,ch:0},{line:0,ch:6});
    }""")
    page.locator('[data-format="math"]').click()
    assert page.evaluate('window.LocalWikiDebug.editor.getValue()')=='$E=mc^2$'

    for kind,filename in [('image','photo.png'),('video','movie.mp4'),('audio','sound.wav'),
                          ('pdf','paper.pdf'),('canvas','board.canvas'),('base','example.base'),
                          ('drawio','flow.drawio')]:
        page.locator(f'.format-toolbar button[data-asset-kind="{kind}"]').click()
        assert page.locator('#toolbar-asset-dialog').is_visible(),kind
        assert page.locator('#toolbar-asset-results button').count()==1,kind
        assert page.locator('#toolbar-asset-results button').inner_text()==filename
        page.locator('#toolbar-asset-results button').click()
        assert not page.locator('#toolbar-asset-dialog').is_visible()
        source=page.evaluate('window.LocalWikiDebug.editor.getValue()')
        if kind=='image':assert '![photo](photo.png)' in source,source
        else:assert '![[{}]]'.format(filename) in source,source
    page.locator('.format-toolbar button[data-asset-kind="audio"]').click()
    page.locator('#toolbar-asset-search').fill('nonexistent')
    assert page.locator('#toolbar-asset-results button').count()==0
    assert 'No matching' in page.locator('#toolbar-asset-results').inner_text()
    page.locator('#toolbar-asset-close').click()
    assert not errors,errors
    print('PASS: StackEdit theme, single-row toolbar, Markdown formatting and seven safe attachment pickers')
    browser.close()
