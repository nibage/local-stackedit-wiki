"""Independent file:// compatibility diagnostic UI, tested under HTTPS with mock handles.
A real file:// test must be performed on the target desktop: this container's
Chromium blocks all file:// navigation by administrator policy.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / 'tools/test-file-access.html').read_text(encoding='utf-8')
INIT = r'''(() => {
  window.testOps = { created: [], deleted: [], stored: {}, failRemove: false, cancel: false };
  window.showDirectoryPicker = async () => {
    if (window.testOps.cancel) throw new DOMException('cancel', 'AbortError');
    return {
      async getFileHandle(name, { create } = {}) {
        if (!create) throw new DOMException('not found', 'NotFoundError');
        window.testOps.created.push(name);
        return {
          async createWritable() {
            return {
              async write(text) { window.testOps.stored[name] = text; },
              async close() {}, async abort() {}
            };
          },
          async getFile() {
            return { async text() { return window.testOps.stored[name]; } };
          }
        };
      },
      async removeEntry(name) {
        if (window.testOps.failRemove) throw new Error('delete disabled');
        window.testOps.deleted.push(name);
        delete window.testOps.stored[name];
      }
    };
  };
})();'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page()
    failures = []
    page.on('pageerror', lambda e: failures.append(str(e)))
    page.evaluate(INIT)
    page.set_content(HTML, wait_until='load')
    assert page.locator('#api').inner_text() == 'Dostupné'
    page.locator('#start').click()
    page.wait_for_function("document.querySelector('#result').textContent.startsWith('Úspěch:')")
    result = page.evaluate('''() => ({created: testOps.created, deleted: testOps.deleted, stored: testOps.stored})''')
    assert len(result['created']) == 1 and result['created'] == result['deleted']
    assert result['stored'] == {}
    assert page.evaluate("document.querySelector('#result').textContent.includes('Úspěch')")
    page.evaluate('testOps.failRemove = true')
    page.locator('#start').click()
    page.wait_for_function("document.querySelector('#result').textContent.includes('VAROVÁNÍ:')")
    assert page.locator('#result').inner_text().startswith('VAROVÁNÍ:')
    page.evaluate('testOps.failRemove = false; testOps.cancel = true')
    page.locator('#start').click()
    page.wait_for_function("document.querySelector('#result').textContent.includes('zrušen')")
    assert not failures, failures
    print('PASS: standalone folder diagnostic verifies read/write/cleanup, warns on cleanup failure, handles cancelled pick')
    browser.close()
