"""Chromium regression for preview scroll, end-of-note follow, selected-tree reveal and favicon."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--chromium', default=None)
args=parser.parse_args()

favicon=ET.parse(ROOT/'assets/favicon.svg').getroot()
assert favicon.tag.endswith('svg') and favicon.attrib.get('viewBox')=='0 0 64 64'

def serve(route):
    parsed=urlsplit(route.request.url)
    target=(ROOT/unquote(parsed.path).lstrip('/')).resolve()
    if parsed.netloc!='wiki-scroll.test' or not target.is_relative_to(ROOT) or not target.is_file():
        route.fulfill(status=404,body='Not found');return
    mime='text/css' if target.suffix=='.css' else 'image/svg+xml' if target.suffix=='.svg' else 'application/javascript'
    route.fulfill(status=200,content_type=mime,body=target.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=args.chromium,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1430,'height':820})
    page.set_default_timeout(14000)
    errors=[]
    page.on('pageerror',lambda err:errors.append(str(err)))
    page.route('https://wiki-scroll.test/**',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>', '<head><base href="https://wiki-scroll.test/">',1)
    page.set_content(html,wait_until='load')
    assert page.locator('link[rel="icon"][type="image/svg+xml"]').get_attribute('href')=='assets/favicon.svg'
    page.evaluate("""() => {
      function file(name,body){return{kind:'file',name,body,lastModified:100,
        async getFile(){return new File([this.body],name,{type:'text/markdown',lastModified:this.lastModified})},
        async createWritable(){let next;return{write:async x=>next=x,
          close:async()=>{this.body=next;this.lastModified++},abort:async()=>{}}}
      }}
      function dir(name,items=[]){const entries=new Map(items.map(x=>[x.name,x]));return{
        kind:'directory',name,entries,
        async *values(){yield* entries.values()},
        async getDirectoryHandle(n){const c=entries.get(n);if(!c)throw Error('Missing directory '+n);return c},
        async getFileHandle(n){const c=entries.get(n);if(!c)throw Error('Missing file '+n);return c}
      }}
      const paragraphs=Array.from({length:94},(_,i)=>
        '## Section '+i+'\\n\\n'+('A long paragraph for reliable preview scrolling. '.repeat(5)));
      const dirs=Array.from({length:45},(_,i)=>
        dir('Group-'+String(i).padStart(2,'0'),[file('Child.md','# Child '+i)]));
      window.mockWiki=dir('Wiki',[file('Intro.md',paragraphs.join('\\n\\n')), ...dirs]);
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""")
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    page.locator('#expand-all').click()
    page.locator('.tree-row[aria-label="Group-40/Child.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Group-40/Child.md'")
    page.locator('#collapse-all').click()
    page.evaluate("document.querySelector('#tree').scrollTop=0")
    page.locator('#expand-all').click()
    page.wait_for_function("""() => {
      const tree=document.querySelector('#tree').getBoundingClientRect();
      const row=document.querySelector('.tree-row[aria-label="Group-40/Child.md"]')?.getBoundingClientRect();
      return row && row.top>=tree.top && row.bottom<=tree.bottom &&
        document.querySelector('#tree').scrollTop>0;
    }""")

    # Explicitly choosing a folder must take precedence over the open file.
    page.locator('.tree-row[aria-label="Group-35"]').click()
    page.locator('#collapse-all').click()
    page.evaluate("document.querySelector('#tree').scrollTop=0")
    page.locator('#expand-all').click()
    page.wait_for_function("""() => {
      const tree=document.querySelector('#tree').getBoundingClientRect();
      const row=document.querySelector('.tree-row[aria-label="Group-35"]')?.getBoundingClientRect();
      return row && row.top>=tree.top && row.bottom<=tree.bottom &&
        document.querySelector('#tree').scrollTop>0;
    }""")

    page.locator('.tree-row[aria-label="Intro.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Intro.md'")
    page.wait_for_function("document.querySelector('#preview').scrollHeight > document.querySelector('#preview').clientHeight+500")
    page.evaluate("""() => {
      const preview=document.querySelector('#preview');
      preview.scrollTop=(preview.scrollHeight-preview.clientHeight)*0.55;
      const cm=window.LocalWikiDebug.editor.cm;
      cm.setCursor(65, 4);
      cm.replaceRange(' EDITED', {line:65,ch:7});
    }""")
    # A three-second trailing delay avoids unnecessary re-renders while typing.
    page.wait_for_timeout(650)
    assert 'EDITED' not in page.locator('#preview').inner_text()
    page.wait_for_function("document.querySelector('#preview').textContent.includes('EDITED')",timeout=8000)
    # The preview should NOW follow the modified paragraph, rather than
    # preserving unrelated old preview position or jumping to the beginning.
    on_screen=page.evaluate("""() => {
      const p=document.querySelector('#preview');
      const paragraph=[...p.querySelectorAll('p')].find(el=>el.textContent.includes('EDITED'));
      const a=p.getBoundingClientRect(),b=paragraph.getBoundingClientRect();
      return {visible:!!paragraph&&b.bottom>a.top&&b.top<a.bottom,top:p.scrollTop};
    }""")
    assert on_screen['visible'] and on_screen['top']>0,on_screen

    # When typing at the last line, the preview follows the last paragraph
    # instead of jumping back to the document beginning.
    page.evaluate("""() => {
      const cm=window.LocalWikiDebug.editor.cm;
      const last=cm.lastLine(), end=cm.getLine(last).length;
      cm.setCursor(last,end);
      cm.replaceRange('\\n\\nFinal newly typed paragraph for preview-follow check.',{line:last,ch:end});
    }""")
    page.wait_for_function("document.querySelector('#preview').textContent.includes('Final newly typed paragraph')")
    page.wait_for_function("""() => {
      const p=document.querySelector('#preview');
      return p.scrollHeight-p.clientHeight-p.scrollTop<45;
    }""")
    assert not errors,errors
    print('PASS: SVG favicon, Expand all reveals file/folder, preview debounce, caret location and end follow')
    browser.close()
