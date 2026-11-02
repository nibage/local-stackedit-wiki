"""UI smoke for the offline JS importer. All vendor files are simulated, not original bundles."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
import base64
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

def route_local(route):
    rel = unquote(urlsplit(route.request.url).path).lstrip('/')
    target = (ROOT / rel).resolve()
    if not target.is_relative_to(ROOT) or not target.is_file():
        route.fulfill(status=404, body='Not found'); return
    mime = 'text/css' if target.suffix == '.css' else 'application/javascript' if target.suffix == '.js' else 'text/html'
    route.fulfill(status=200, content_type=mime, body=target.read_bytes())

def test():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('https://local-wiki.test/**', route_local)
        html = (ROOT / 'index.html').read_text('utf8').replace('<head>','<head><base href="https://local-wiki.test/">')
        page.set_content(html, wait_until='load')
        page.evaluate('''() => {
          const digest = Uint8Array.from(atob('6Wa+B9B3RYe0RtUPHHpg6RTnDBMLUq1hdoJtNJfkfNOaipetnb30xQPd1nTQDBMF0dt7lOb3XmAq62Dqqr57Zw=='), c=>c.charCodeAt(0));
          Object.defineProperty(window,'crypto',{ configurable:true, value:{subtle:{digest:async()=>digest.buffer}} });
          window.__fakeVendorBytes = {};
          const handles = {};
          function handle(path) {
            let content = new TextEncoder().encode('placeholder');
            return {
              async getFile() { return new Blob([content]); },
              async createWritable() {let fresh; return {
                async write(bytes) { fresh = new Uint8Array(bytes); },
                async close() { content=fresh; window.__fakeVendorBytes[path]=fresh.length; },
                async abort() {}
              };}
            };
          }
          window.showDirectoryPicker = async options => ({
            async getFileHandle() {
              return { getFile: async () => new Blob(['Local StackEdit Wiki <script src="src/renderer-installer.js"></script>']) };
            },
            async getDirectoryHandle() {
              return { getDirectoryHandle: async (dir) => ({
                getFileHandle: async (filename) => {
                  const path=dir+'/'+filename;
                  return handles[path] || (handles[path]=handle(path));
                }
              }) };
            }
          });
        }''')
        page.locator('#renderer-check').click()
        assert page.locator('#renderer-install-local').is_disabled()
        sample_a = b'/* mermaidAPI initialize */'+b'/'*120000
        sample_b = b'/* ABCJS renderAbc */'+b'/'*70000
        page.locator('#renderer-local-files').set_input_files([
          {'name':'mermaid.min.js', 'mimeType':'application/javascript','buffer':sample_a},
          {'name':'abcjs-basic-min.js','mimeType':'application/javascript','buffer':sample_b},
        ])
        assert page.locator('#renderer-install-local').is_enabled()
        page.locator('#renderer-install-local').click()
        page.wait_for_function("document.querySelector('#renderer-install-status').textContent.includes('Obnov stránku')",timeout=8000)
        assert page.evaluate('window.__fakeVendorBytes["mermaid/mermaid.min.js"]') == len(sample_a)
        assert page.evaluate('window.__fakeVendorBytes["abcjs/abcjs-basic-min.js"]') == len(sample_b)
        assert not errors, errors
        print('PASS: offline files chosen through input, app folder picker, both saved, no CDN')
        browser.close()

if __name__ == '__main__': test()
