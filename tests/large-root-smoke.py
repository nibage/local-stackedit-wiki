"""Browser test: large mixed directory root is not silently lost on one inaccessible child.
Uses mock File System Access API, does not access user's wiki or network.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent

def serve(route):
    p = unquote(urlsplit(route.request.url).path).lstrip('/')
    path = (ROOT / p).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        route.fulfill(status=404, body='missing'); return
    mime = 'text/css' if path.suffix == '.css' else 'application/javascript' if path.suffix == '.js' else 'text/html'
    route.fulfill(status=200, content_type=mime, body=path.read_bytes())

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1400, 'height': 900})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('https://local-wiki.test/**', serve)
        html = (ROOT / 'index.html').read_text(encoding='utf-8').replace('<head>', '<head><base href="https://local-wiki.test/">')
        page.set_content(html, wait_until='load')
        page.evaluate('''() => {
          const file = (name) => ({
             kind: 'file', name,
             async getFile() { const text = '# File '+name+'\\n';
               return new File([text], name, {type:'text/markdown'}); }
          });
          const dir = (name, list, locked=false) => ({
            kind: 'directory', name,
            async *values() {
              if (locked) throw new DOMException('Folder permission denied', 'NotAllowedError');
              for (const item of list) yield item;
            }
          });
          const groups = Array.from({length:15}, (_,i) =>
            dir('Folder'+i, Array.from({length:70}, (_,n)=>file('note'+n+'.md'))));
          window.showDirectoryPicker = async () => dir('knowledge-base', [
            dir('.obsidian',[],true), dir('.git',[],true),
            dir('unreadable',[],true),
            dir('knowledge', [dir('home-server-devops-wiki', [file('README.md')])]),
            ...groups
          ]);
        }''')
        page.locator('#open-folder').click()
        page.wait_for_function("document.querySelector('#count').textContent.includes('1051 .md')", timeout=20000)
        message = page.locator('#notice').inner_text()
        assert '1 podsložek' in message and 'unreadable' in message, message
        assert page.locator('#root-name').inner_text() == 'knowledge-base'
        page.get_by_role('button', name='knowledge', exact=True).click()
        page.get_by_role('button', name='knowledge/home-server-devops-wiki', exact=True).click()
        page.get_by_role('button', name='knowledge/home-server-devops-wiki/README.md', exact=True).click()
        page.wait_for_function("document.querySelector('#filename').textContent.endsWith('README.md')")
        assert not errors, errors
        print('PASS: root with 1051 MD files, unreadable subdir, nested navigation and preview')
        browser.close()
if __name__=='__main__': main()
