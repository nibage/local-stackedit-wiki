"""Offline Chromium regression: compressed/uncompressed multi-page .drawio,
graph rendering, page switching, safe untrusted XML and zero remote loads.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--chromium', default=None)
options = parser.parse_args()
diagram = (ROOT / 'demo-wiki' / 'Attachments' / 'example.drawio').read_text(encoding='utf-8')
bad_label = ('<mxfile><diagram name="Untrusted"><mxGraphModel><root>'
             '<mxCell id="0"/><mxCell id="1" parent="0"/>'
             '<mxCell id="v" vertex="1" parent="1"'
             ' value="&lt;img src=&quot;https://evil.example/x&quot; onerror=&quot;alert(1)&quot;&gt;"'
             ' style="shape=image;image=https://evil.example/stencil.svg;fillColor=red;">'
             '<mxGeometry x="10" y="10" width="200" height="80" as="geometry"/>'
             '</mxCell></root></mxGraphModel></diagram></mxfile>')

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=options.chromium, headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1450, 'height': 900})
    page.set_default_timeout(17000)
    errors, unexpected = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def serve(route):
        parsed = urlsplit(route.request.url)
        if parsed.netloc != 'wiki-drawio.test':
            unexpected.append(route.request.url)
            route.abort()
            return
        filepath = (ROOT / unquote(parsed.path).lstrip('/')).resolve()
        if not filepath.is_relative_to(ROOT) or not filepath.is_file():
            route.fulfill(status=404, body='Not found')
            return
        mime = 'text/css' if filepath.suffix == '.css' else (
            'application/javascript' if filepath.suffix == '.js' else 'text/html')
        route.fulfill(status=200, content_type=mime, body=filepath.read_bytes())

    page.route('**/*', serve)
    html = (ROOT / 'index.html').read_text(encoding='utf-8').replace(
        '<head>', '<head><base href="https://wiki-drawio.test/">', 1)
    page.set_content(html, wait_until='load')
    page.evaluate(r"""([diagram, bad]) => {
      function file(name, body, mime='application/xml') {
        return {kind:'file',name,body,mime,lastModified:123,
          async getFile(){return new File([this.body],name,{type:this.mime,lastModified:this.lastModified})},
          async createWritable(){let content;return{
            write:async v=>{content=v},close:async()=>{this.body=content;this.lastModified++},
            abort:async()=>{}
          }}
        };
      }
      const entries=new Map([
        file('Notes.md','[Open graph](example.drawio)\n\n![[example.drawio]]','text/markdown'),
        file('example.drawio',diagram),
        file('unsafe.drawio',bad)
      ].map(f=>[f.name,f]));
      window.mockWiki={kind:'directory',name:'Wiki',entries,
        async *values(){yield* entries.values()},
        async getFileHandle(n){if(!entries.has(n))throw Error('missing');return entries.get(n)}
      };
      window.showDirectoryPicker=async()=>window.mockWiki;
    }""", [diagram,bad_label])
    page.locator('#open-folder').click()
    page.wait_for_function("document.querySelector('#root-name').textContent==='Wiki'")
    assert page.locator('.tree-row[aria-label="example.drawio"]').count()==1

    page.locator('.tree-row[aria-label="example.drawio"]').click()
    page.wait_for_function("document.querySelector('#attachment-dialog').open")
    page.wait_for_function("document.querySelector('#attachment-dialog-viewer .drawio-shape ellipse')!==null")
    assert page.locator('.drawio-tabs button').count()==2
    assert page.locator('.drawio-tab').first.get_attribute('aria-pressed')=='true'
    assert 'Start' in page.locator('.drawio-graph').text_content()
    assert page.locator('.drawio-graph .drawio-edges path').count()==2
    assert page.locator('.drawio-graph polygon').count()==1
    assert not page.locator('.drawio-graph script, .drawio-graph foreignObject, .drawio-graph img').count()

    # User interaction must show the second page, encoded as raw-deflated base64.
    page.locator('.drawio-tab').nth(1).click()
    page.wait_for_function("""() => {
        const g=document.querySelector('.drawio-graph');
        return g && g.textContent.includes('Databáze') && g.textContent.includes('Webová aplikace');
    }""")
    assert page.locator('.drawio-tab').nth(1).get_attribute('aria-pressed')=='true'
    assert 'complex / custom shapes' in page.locator('.drawio-warning').inner_text()
    scale_before = page.locator('.drawio-zoom').inner_text()
    page.locator('.drawio-control', has_text='+').click()
    scale_after = page.locator('.drawio-zoom').inner_text()
    assert scale_before != scale_after, (scale_before,scale_after)
    page.locator('.drawio-control', has_text='Fit').click()
    assert page.evaluate("document.querySelector('.drawio-board').style.transform.includes('scale(')")
    assert page.evaluate("window.mockWiki.entries.get('example.drawio').body") == diagram
    page.locator('#attachment-close').click()

    # Stored XML/labels cannot create active HTML nodes, load images, or execute code.
    page.locator('.tree-row[aria-label="unsafe.drawio"]').click()
    page.wait_for_function("document.querySelector('#attachment-dialog-viewer .drawio-graph')!==null")
    assert page.locator('.drawio-warning').is_visible()
    assert not page.locator('#attachment-dialog-viewer img, #attachment-dialog-viewer script, #attachment-dialog-viewer foreignObject').count()
    assert page.evaluate("typeof window.drawioInjected === 'undefined'")
    page.locator('#attachment-close').click()
    rejected = page.evaluate("""() => {
      try { window.LocalWikiDrawio.parseFile('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><mxfile/>'); return false; }
      catch (_) { return true; }
    }""")
    assert rejected, 'DTD/ENTITY input must be rejected'

    # Markdown links and embeds should lead to the same read-only viewer.
    page.locator('.tree-row[aria-label="Notes.md"]').click()
    page.wait_for_function("document.querySelector('#filename').textContent==='Notes.md'")
    page.wait_for_function("document.querySelector('#preview .wiki-structured-embed .drawio-graph')!==null")
    assert page.locator('#preview .wiki-structured-embed .drawio-tab').count()==2
    page.locator('#preview .wiki-structured-embed .drawio-tab').nth(1).click()
    page.wait_for_function("document.querySelector('#preview .drawio-graph')?.textContent.includes('Databáze')")
    # The ordinary Markdown hyperlink still opens the larger read-only dialog.
    page.locator('#preview a', has_text='Open graph').click()
    page.wait_for_function("document.querySelector('#attachment-dialog .drawio-tab')!==null")
    page.locator('#attachment-close').click()
    assert not unexpected, unexpected
    assert not errors, errors
    print('PASS: draw.io multi-page XML, raw DEFLATE, core shapes/edges, zoom, inert XML and wiki links')
    browser.close()
