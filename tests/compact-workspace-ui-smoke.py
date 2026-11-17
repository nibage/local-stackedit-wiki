"""Chromium regression: compact shared chrome, centered writing, footer stats and scroll sync."""
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
def serve(route):
    uri=urlsplit(route.request.url)
    path=(ROOT/unquote(uri.path).lstrip('/')).resolve()
    if uri.netloc!='wiki-compact.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1880,'height':1000})
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_default_timeout(16000)
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-compact.test/">',1)
    page.set_content(html,wait_until='load')
    page.evaluate("""() => {
      const source='# A centred heading\\n\\n'+Array.from({length:165},(_,i)=>
        '## Paragraph '+i+'\\n\\nA moderately long line of text with words '+i+
        ' and a second sentence about a wiki document that should remain readable.').join('\\n\\n');
      const note={kind:'file',name:'Guide.md',body:source,lastModified:100,
        async getFile(){return new File([this.body],'Guide.md',{type:'text/markdown',lastModified:this.lastModified})},
        async createWritable(){let next;return{
          write:async value=>{next=value},
          close:async()=>{this.body=next;this.lastModified++},
          abort:async()=>{}
        }}
      };
      const entries=new Map([[note.name,note]]);
      window.showDirectoryPicker=async()=>({kind:'directory',name:'Wiki',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(name){return entries.get(name)}
      });
    }""")
    # A single top-level header includes both app identity and file controls.
    assert page.locator('header.topbar .brand').count()==1
    assert page.locator('header.topbar .editor-bar #view-preview').count()==1
    assert page.locator('main.main-area>.editor-bar').count()==0
    assert page.locator('main.main-area>.format-toolbar').count()==1
    assert page.locator('.edit-pane>.format-toolbar').count()==0
    assert page.locator('.edit-pane .pane-title').count()==0
    assert page.locator('.preview-pane .pane-title').count()==0
    assert page.locator('.format-toolbar #scroll-sync-toggle').count()==1
    header=page.locator('.topbar').bounding_box()
    assert header['height']<=75,header
    positions=page.evaluate("""() => ({
      brand:document.querySelector('.topbar .brand').getBoundingClientRect().toJSON(),
      controls:document.querySelector('.topbar .editor-bar').getBoundingClientRect().toJSON(),
      tools:document.querySelector('.format-toolbar').getBoundingClientRect().toJSON(),
      header:document.querySelector('.topbar').getBoundingClientRect().toJSON(),
      footer:document.querySelector('.statusbar').getBoundingClientRect().toJSON()
    })""")
    assert abs(positions['brand']['y']-positions['controls']['y'])<20,positions
    assert positions['tools']['y']>=positions['header']['bottom']-1,positions
    assert positions['footer']['height']<=30,positions

    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    page.locator('.tree-row[aria-label="Guide.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Guide.md'")
    page.wait_for_function("document.querySelector('#preview h2')")
    page.locator('#theme-select').select_option('stackedit')
    # Reader remains centered on large viewport and has an authoring-width
    # source column; line numbers must be actually visible, not only enabled.
    page.locator('#view-edit').click()
    width=page.locator('.CodeMirror-lines').evaluate('(e)=>e.getBoundingClientRect().toJSON()')
    cm=page.locator('.edit-pane .CodeMirror').evaluate('(e)=>e.getBoundingClientRect().toJSON()')
    assert width['width']<=902 and width['width']>=800,(width,cm)
    assert abs(width['x']+width['width']/2-(cm['x']+cm['width']/2))<25,(width,cm)  # CodeMirror gutter adds ~18px
    gutter=page.locator('.CodeMirror-linenumber').first
    gutter.wait_for(state='attached')
    assert gutter.evaluate('(el)=>getComputedStyle(el).visibility')=='visible'
    assert gutter.evaluate('(el)=>getComputedStyle(el).color')=='rgb(105, 105, 105)'
    assert gutter.bounding_box()['width']>=12,gutter.bounding_box()
    page.locator('#view-preview').click()
    article=page.locator('#preview').evaluate("""el=>({
      width:el.clientWidth,
      padLeft:parseFloat(getComputedStyle(el).paddingLeft),
      padRight:parseFloat(getComputedStyle(el).paddingRight),
      font:getComputedStyle(el).fontSize
    })""")
    assert article['font']=='18px',article
    assert abs(article['padLeft']-article['padRight'])<=2,article
    assert 840<=article['width']-article['padLeft']-article['padRight']<=905,article
    page.locator('#theme-select').select_option('dark')
    dark=page.locator('#preview').evaluate("""el=>({
      width:el.clientWidth,padLeft:parseFloat(getComputedStyle(el).paddingLeft),
      padRight:parseFloat(getComputedStyle(el).paddingRight)
    })""")
    assert abs(dark['padLeft']-dark['padRight'])<=2,dark
    assert 875<=dark['width']-dark['padLeft']-dark['padRight']<=925,dark
    page.locator('#theme-select').select_option('light')
    light=page.locator('#preview').evaluate("""el=>({
      padLeft:parseFloat(getComputedStyle(el).paddingLeft),
      padRight:parseFloat(getComputedStyle(el).paddingRight)
    })""")
    assert abs(light['padLeft']-light['padRight'])<=2,light

    page.locator('#view-split').click()
    assert page.locator('#scroll-sync-toggle').is_enabled()
    assert page.locator('#scroll-sync-toggle').get_attribute('aria-pressed')=='false'
    assert 'Markdown ' in page.locator('#stats').inner_text()
    assert ' bytes' in page.locator('#stats').inner_text()
    assert ' words' in page.locator('#stats').inner_text()
    assert ' lines' in page.locator('#stats').inner_text()
    assert 'Ln ' in page.locator('#stats').inner_text()
    assert 'Col ' in page.locator('#stats').inner_text()
    assert 'HTML ' in page.locator('#html-stats').inner_text()
    assert ' paragraphs' in page.locator('#html-stats').inner_text()
    assert 'Ctrl+F search' in page.locator('#editor-shortcuts').inner_text()
    assert 'Autosave 5s' in page.locator('#editor-shortcuts').inner_text()
    assert page.locator('#save-status').count()==1
    assert page.locator('#render-status').count()==1
    # Selection/caret activity drives Ln, Col without editing the source.
    page.evaluate("""() => window.LocalWikiDebug.editor.cm.setCursor({line:5,ch:3})""")
    page.wait_for_function("document.querySelector('#stats').textContent.includes('Ln 6, Col 3')")
    page.wait_for_function("document.querySelector('#preview').scrollHeight > document.querySelector('#preview').clientHeight")
    assert page.evaluate("""() => {
      const a=window.LocalWikiDebug.editor.cm.getScrollInfo();
      const b=document.querySelector('#preview');
      return a.height>a.clientHeight && b.scrollHeight>b.clientHeight
    }""")
    page.locator('#scroll-sync-toggle').click()
    assert page.locator('#scroll-sync-toggle').get_attribute('aria-pressed')=='true'
    page.evaluate("""() => {
      const cm=window.LocalWikiDebug.editor.cm,info=cm.getScrollInfo();
      cm.scrollTo(null,(info.height-info.clientHeight)*0.6);
    }""")
    page.wait_for_timeout(300)
    ratios=page.evaluate("""() => {
      const cm=window.LocalWikiDebug.editor.cm,info=cm.getScrollInfo(),el=document.querySelector('#preview');
      return [info.top/(info.height-info.clientHeight),el.scrollTop/(el.scrollHeight-el.clientHeight)];
    }""")
    assert abs(ratios[0]-ratios[1])<0.085,ratios
    page.evaluate("""() => {
      const el=document.querySelector('#preview');el.scrollTop=(el.scrollHeight-el.clientHeight)*0.3;
    }""")
    page.wait_for_timeout(300)
    ratios=page.evaluate("""() => {
      const info=window.LocalWikiDebug.editor.cm.getScrollInfo(),el=document.querySelector('#preview');
      return [info.top/(info.height-info.clientHeight),el.scrollTop/(el.scrollHeight-el.clientHeight)];
    }""")
    assert abs(ratios[0]-ratios[1])<0.085,ratios
    page.locator('#scroll-sync-toggle').click()
    assert page.locator('#scroll-sync-toggle').get_attribute('aria-pressed')=='false'
    page.locator('#view-edit').click()
    assert page.locator('#scroll-sync-toggle').is_disabled()
    assert page.locator('.format-toolbar').is_visible()
    assert not errors,errors
    print('PASS: shared compact chrome, centered themes, StackEdit line numbers, source/HTML stats, two-way scroll sync')
    context.close()
    browser.close()
