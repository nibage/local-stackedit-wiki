"""Tests internal heading navigation in browser with mocked file pick, not file:// permissions."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent

def local_route(route):
    rel=unquote(urlsplit(route.request.url).path).lstrip('/')
    target=(ROOT/rel).resolve()
    if not target.is_relative_to(ROOT) or not target.is_file():
        route.fulfill(status=404, body='missing');return
    mime='text/css' if target.suffix=='.css' else 'application/javascript' if target.suffix=='.js' else 'text/html'
    route.fulfill(status=200, content_type=mime, body=target.read_bytes())

def main():
  with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1300,'height':850})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('https://local-wiki.test/**',local_route)
    html=(ROOT/'index.html').read_text(encoding='utf8').replace('<head>','<head><base href="https://local-wiki.test/">')
    page.set_content(html,wait_until='load')
    page.evaluate('''() => {
      const texts={
        'index.md':'# Start\\n\\n[Otevři nadpis](Poznamky/Python.md#Instalace%20na%20Windows)\\n\\n[[Poznamky/Python#Úvod]]\\n',
        'Poznamky/Python.md':'# Úvod\\n\\nVítej\\n\\n## Instalace na Windows\\n\\nZde se nachází hledaný text.\\n\\n[[#Úvod]]\\n\\n[Opakování](#instalace-na-windows)\\n'
      };
      const python={name:'Python.md',kind:'file',async getFile(){return new File([texts['Poznamky/Python.md']],'Python.md',{lastModified:1})}};
      const index={name:'index.md',kind:'file',async getFile(){return new File([texts['index.md']],'index.md',{lastModified:1})}};
      const folder={name:'Poznamky',kind:'directory',async *values(){yield python;}};
      window.showDirectoryPicker=async()=>({name:'Wiki',kind:'directory',async *values(){yield index;yield folder;}});
      window.anchorEvents=[];
      window.Element.prototype.scrollIntoView=function(opts){window.anchorEvents.push(this.textContent.trim());};
    }''')
    page.locator('#open-folder').click()
    page.wait_for_function("() => document.querySelector('#root-name').textContent==='Wiki'")
    page.locator('.tree-row[aria-label="index.md"]').click()
    page.wait_for_function("() => document.querySelector('#filename').textContent==='index.md'")
    page.locator('#preview a').filter(has_text='Otevři nadpis').click()
    page.wait_for_function("() => window.anchorEvents.includes('Instalace na Windows')")
    assert page.locator('#filename').inner_text()=='Poznamky/Python.md'
    page.locator('.tree-row[aria-label="index.md"]').click()
    page.wait_for_function("() => document.querySelector('#filename').textContent==='index.md'")
    page.locator('#preview a').filter(has_text='Úvod').click()
    page.wait_for_function("() => window.anchorEvents.includes('Úvod')")
    assert page.locator('#filename').inner_text()=='Poznamky/Python.md'
    page.locator('#preview a').filter(has_text='Úvod').click()
    page.wait_for_function("() => window.anchorEvents.includes('Úvod')")
    page.locator('#preview a').filter(has_text='Opakování').click()
    page.wait_for_function("() => window.anchorEvents.filter(x=>x==='Instalace na Windows').length===2")
    assert not errors, errors
    print('PASS: cross-document #heading, Obsidian [[Page#Heading]], same-note anchors')
    browser.close()

if __name__=='__main__':main()
