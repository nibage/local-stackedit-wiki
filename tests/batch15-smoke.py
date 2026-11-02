"""Chromium functional renderer self-test: absence and real API invocation with fakes.
Does not pretend to test actual Mermaid/ABCjs libraries; no network, no wiki contents.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent

def local_route(route):
    rel=unquote(urlsplit(route.request.url).path).lstrip('/')
    target=(ROOT/rel).resolve()
    if not target.is_relative_to(ROOT) or not target.is_file():
        route.fulfill(status=404,body='missing'); return
    mime='text/css' if target.suffix=='.css' else 'application/javascript' if target.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=mime,body=target.read_bytes())

def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1400,'height':850})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('https://local-wiki.test/**',local_route)
        html=(ROOT/'index.html').read_text(encoding='utf8').replace('<head>','<head><base href="https://local-wiki.test/">')
        page.set_content(html,wait_until='load')
        page.locator('#renderer-check').click()
        page.locator('#renderer-smoke').click()
        page.wait_for_function("() => document.querySelector('#renderer-smoke-result').textContent.includes('Knihovna ABCjs není načtena')")
        msg=page.locator('#renderer-smoke-result').inner_text()
        assert 'Mermaid' in msg and 'ABCjs' in msg, msg
        assert 'Knihovna Mermaid není načtena' in msg, msg
        # Fake a documented public API, but insist on actual rendering attempts.
        page.evaluate('''() => {
          window.testMermaidCalls=0;window.testAbcCalls=0;
          window.mermaid = {initialize(){},mermaidAPI:{render(id, text, cb){
             window.testMermaidCalls++;
             if(!text.includes('graph TD'))throw Error('Unexpected diagram');
             cb('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1"/></svg>');
          }}};
          window.ABCJS={renderAbc(element,text){
             window.testAbcCalls++;
             if(!text.includes('K:C'))throw Error('Unexpected score');
             element.innerHTML='<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1"/></svg>';
          }};
        }''')
        page.locator('#renderer-smoke').click()
        page.wait_for_function("() => document.querySelector('#renderer-smoke-result').textContent.includes('Zkušební notová osnova')")
        msg=page.locator('#renderer-smoke-result').inner_text()
        assert 'Zkušební flowchart' in msg, msg
        assert page.evaluate('testMermaidCalls')==1
        assert page.evaluate('testAbcCalls')==1
        assert page.evaluate('window.LocalWikiRendererSmoke.lastStatus()')=={'mermaid':'ok','abc':'ok'}
        assert page.evaluate('window.LocalWikiDiagnostics.collect().libraries.smokeTest')=={'mermaid':'ok','abc':'ok'}
        assert not page.locator('.renderer-smoke-result svg').count()
        assert not errors,errors
        print('PASS: missing libs, real renderer calls with fakes, valid SVG check, DOM cleanup, no wiki changes')
        browser.close()
if __name__=='__main__': main()
