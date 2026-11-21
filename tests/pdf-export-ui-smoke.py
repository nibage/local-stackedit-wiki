"""Offline HTML export regression: a full Bases table precedes later diagrams and embedded PDF pages."""
from pathlib import Path
from base64 import b64encode
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent

def serve(route):
    url=urlsplit(route.request.url)
    path=(ROOT/unquote(url.path).lstrip('/')).resolve()
    if url.netloc!='wiki-pdf-export.test' or not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404,body='Not found')
        return
    kind='text/css' if path.suffix=='.css' else 'application/javascript' if path.suffix=='.js' else 'text/html'
    route.fulfill(status=200,content_type=kind,body=path.read_bytes())

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1300,'height':900})
    page.set_default_timeout(30000)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',serve)
    html=(ROOT/'index.html').read_text(encoding='utf-8').replace(
        '<head>','<head><base href="https://wiki-pdf-export.test/">',1)
    page.set_content(html,wait_until='load')
    pdf_data=b64encode((ROOT/'demo-wiki/Attachments/sample.pdf').read_bytes()).decode('ascii')
    page.evaluate("""pdfData=>{
      const preview=document.querySelector('#preview');
      const rows=Array.from({length:45},(_,i)=>
        '<tr><td>Long Base row '+i+'</td><td>Value '+i+'</td></tr>').join('');
      preview.innerHTML='<h1>Full Bases export</h1>'+
        '<div class="wiki-export-structured">'+
        '<div class="wiki-bases-viewer" style="height:513px;overflow:hidden">'+
        '<div class="bases-table-scroll" style="height:500px;overflow:auto">'+
        '<table class="bases-table"><thead><tr><th>Category</th><th>Value</th></tr></thead>'+
        '<tbody>'+rows+'</tbody></table></div></div></div>'+
        '<div class="visualization visualization-mermaid">'+
        '<svg width="600" height="110" viewBox="0 0 600 110">'+
        '<rect width="600" height="110" fill="#def"/>'+
        '<text x="20" y="40">After Base SVG</text></svg></div>'+
        '<p><span class="wiki-attachment-embed" style="height:580px">'+
        '<object type="application/not-a-pee-dee-eff-type"'+
        ' data="data:application/pdf;base64,'+pdfData+'"></object>'+
        '</span></p><h2>After embedded PDF</h2>';
    }""",pdf_data)
    exported=page.evaluate("""async()=>{
      return await window.LocalWikiPreviewExport.build(document.querySelector('#preview'),
        {title:'PDF export.md',theme:'current'});
    }""")
    assert '<object' not in exported.lower()
    assert 'wiki-export-pdf-pages' in exported
    assert 'Embedded PDF cannot be displayed' not in exported
    assert 'Embedded PDF · page 1' in exported
    assert 'data:image/jpeg;base64,' in exported
    target=browser.new_page(viewport={'width':1300,'height':900})
    network=[]
    target.route('**/*',lambda r:(network.append(r.request.url),r.abort()))
    target.set_content(exported,wait_until='load')
    assert target.locator('.bases-table tr').count()==46
    assert target.locator('.wiki-export-pdf-pages img').count()>=1
    locations=target.evaluate("""()=>{
      const t=document.querySelector('.bases-table').getBoundingClientRect();
      const svg=document.querySelector('.visualization svg').getBoundingClientRect();
      const pdf=document.querySelector('.wiki-export-pdf-pages').getBoundingClientRect();
      const after=document.querySelector('h2').getBoundingClientRect();
      return {tableBottom:t.bottom,svgTop:svg.top,svgBottom:svg.bottom,
        pdfTop:pdf.top,pdfBottom:pdf.bottom,afterTop:after.top};
    }""")
    assert locations['svgTop']>=locations['tableBottom']-2,locations
    assert locations['pdfTop']>=locations['svgBottom']-2,locations
    assert locations['afterTop']>=locations['pdfBottom']-2,locations
    assert not network,network
    target.close()
    assert not errors,errors
    print('PASS: fully expanded Base table, SVG and offline PDF pages flow sequentially')
    browser.close()
