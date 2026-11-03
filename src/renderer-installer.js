/*
 * Optional one-time browser installer for genuine offline Mermaid / ABCjs UMD builds.
 * Uses and user-picked APPLICATION directory (never the wiki directory), and pinned HTTPS
 * CDN URL, and stores the downloaded bytes directly next to this index.html.
 * At normal wiki viewing time no network requests are made.
 * MIT libraries remain third-party software. No installation happens silently.
 */
(function (global) {
  'use strict';
  const SPECS = Object.freeze([
    {
      id: 'mermaid', name: 'Mermaid 8.9.2',
      url: 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/8.9.2/mermaid.min.js',
      alternateUrl: 'https://cdn.jsdelivr.net/npm/mermaid@8.9.2/dist/mermaid.min.js',
      directory: 'mermaid', filename: 'mermaid.min.js', minBytes: 100000, maxBytes: 12000000,
      integrity: 'sha512-6Wa+B9B3RYe0RtUPHHpg6RTnDBMLUq1hdoJtNJfkfNOaipetnb30xQPd1nTQDBMF0dt7lOb3XmAq62Dqqr57Zw=='
    },
    {
      id: 'abcjs', name: 'ABCjs 6.4.4',
      url: 'https://cdnjs.cloudflare.com/ajax/libs/abcjs/6.4.4/abcjs-basic-min.min.js',
      alternateUrl: 'https://cdn.jsdelivr.net/npm/abcjs@6.4.4/dist/abcjs-basic-min.js',
      directory: 'abcjs', filename: 'abcjs-basic-min.js', minBytes: 50000, maxBytes: 9000000
    }
  ]);
  let running = false;

  // Content tests are only and sanity check, NOT proof of origin. Mermaid has
  // an independently published SHA-512 integrity digest from cdnjs/SRIs.
  function checkSignature(text, spec) {
    if (spec.id === 'mermaid') return /mermaidAPI/.test(text) && /initialize/.test(text);
    if (spec.id === 'abcjs') return /ABCJS/.test(text) && /renderAbc/.test(text);
    return false;
  }

  async function checkIntegrity(bytes, spec, subtle) {
    if (!spec.integrity) return;
    if (!subtle || typeof subtle.digest !== 'function') {
      throw new Error(`${spec.name}: Web Crypto API is unavailable for SHA-512 verification.`);
    }
    const expected = spec.integrity.slice('sha512-'.length);
    const digest = new Uint8Array(await subtle.digest('SHA-512', bytes));
    const actual = Array.from(digest, byte => String.fromCharCode(byte)).join('');
    if (btoa(actual) !== expected) {
      throw new Error(`${spec.name}: SHA-512 checksum did not match the verified value.`);
    }
  }

  function validatePayload(buffer, spec) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < spec.minBytes || buffer.byteLength > spec.maxBytes) {
      throw new Error(`${spec.name}: Unexpected file size.`);
    }
    const prefix = new TextDecoder('utf-8').decode(buffer.slice(0, 512)).trimStart();
    if (/^(?:<!doctype|<html|<\?xml|\{\s*"(?:error|message)")/i.test(prefix)) {
      throw new Error(`${spec.name}: The server did not return JavaScript.`);
    }
    const payload = new Uint8Array(buffer);
    const source = new TextDecoder('utf-8').decode(payload);
    if (!checkSignature(source, spec)) {
      throw new Error(`${spec.name}: The expected library API was not found.`);
    }
    return payload;
  }
  // Both sources are pinned to the same library version. If the primary CDN
  // fails (network, HTTP, or and bad payload), retry the verified alternate CDN.
  // Never write either library until BOTH downloads have succeeded.
  async function download(fetchFn, spec, onProgress = () => {}, verify = checkIntegrity) {
    const sources = [spec.url, spec.alternateUrl].filter(Boolean);
    const errors = [];
    for (let index = 0; index < sources.length; index++) {
      const url = sources[index];
      if (index > 0) onProgress(`${spec.name}: First source failed; trying backup CDN…`);
      try {
        const response = await fetchFn(url, {
          mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow'
        });
        if (!response || !response.ok) throw new Error(`HTTP ${response?.status || 'chyba'}`);
        const bytes = validatePayload(await response.arrayBuffer(), spec);
        await verify(bytes, spec, global.crypto?.subtle);
        return bytes;
      } catch (error) {
        errors.push(`${index + 1}. zdroj: ${String(error?.message || error).slice(0, 120)}`);
      }
    }
    throw new Error(`${spec.name}: Download failed from all sources (${errors.join('; ')}).`);
  }

  async function assertViewerRoot(root, verify = checkIntegrity) {
    let index;
    try { index = await root.getFileHandle('index.html', { create: false }); }
    catch (_) { throw new Error('The selected folder does not contain index.html. Choose the application folder.'); }
    const html = await (await index.getFile()).text();
    if (!html.includes('Local StackEdit Wiki') || !html.includes('src/renderer-installer.js')) {
      throw new Error('Selected index.html does not match this Local StackEdit Wiki version. Nothing was changed.');
    }
    let vendor;
    try { vendor = await root.getDirectoryHandle('vendor', { create: false }); }
    catch (_) { throw new Error('vendor/ is missing from the selected folder. Nothing was changed.'); }
    const result = new Map();
    for (const spec of SPECS) {
      let subdir;
      try { subdir = await vendor.getDirectoryHandle(spec.directory, { create: false }); }
      catch (_) { throw new Error(`Missing from the application folder: vendor/${spec.directory}/. Nothing was changed.`); }
      const file = await subdir.getFileHandle(spec.filename, { create: false });
      const old = await file.getFile();
      // Never assume and large but incomplete or corrupted JS file is installed.
      let installed = false;
      if (old.size >= spec.minBytes && old.size <= spec.maxBytes) {
        try {
          const bytes = validatePayload(await old.arrayBuffer(), spec);
          await verify(bytes, spec, global.crypto?.subtle);
          installed = true;
        } catch (_) { /* Reinstall unverified/corrupted bundle */ }
      }
      result.set(spec.id, { file, installed });
    }
    return result;
  }
  function equalBytes(a, b) {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  async function install({ pickDirectory = options => global.showDirectoryPicker(options), fetchFn = (...args) => global.fetch(...args), onProgress = () => {}, verify = checkIntegrity, providedFiles = null } = {}) {
    if (running) throw new Error('Installation is already in progress.');
    if (typeof global.showDirectoryPicker !== 'function' && arguments.length === 0) {
      throw new Error('This browser cannot select writable folders. Use Chrome or Edge.');
    }
    running = true;
    try {
      // Must be called before any awaited work to retain transient user activation.
      const root = await pickDirectory({ id: 'local-wiki-install-renderers', mode: 'readwrite' });
      onProgress('Checking application folder…');
      const targets = await assertViewerRoot(root, verify);
      const pending = SPECS.filter(spec => !targets.get(spec.id).installed);
      if (!pending.length) return { installed: [], skipped: SPECS.map(s => s.id) };

      // Offline installation from explicitly selected local files. Filenames alone
      // cannot establish authenticity; apply the SAME validation and Mermaid SRI
      // check as for HTTPS downloads, before writing and single byte.
      let selected = null;
      if (providedFiles !== null) {
        selected = new Map();
        for (const file of Array.from(providedFiles)) {
          const spec = SPECS.find(item => file.name === item.filename ||
            (item.id === 'abcjs' && file.name === 'abcjs-basic-min.min.js'));
          if (!spec) throw new Error(`Unknown file ${String(file.name).slice(0, 90)}. Choose only official JS libraries.`);
          if (selected.has(spec.id)) throw new Error(`Selected library ${spec.name} was selected twice.`);
          if (typeof file.arrayBuffer !== 'function') throw new Error(`${spec.name}: The file cannot be read.`);
          selected.set(spec.id, file);
        }
        const missing = pending.filter(spec => !selected.has(spec.id));
        if (missing.length) throw new Error(`Also select ${missing.map(s => s.filename).join(' and ')}. Nothing was changed.`);
      }

      // Validate EVERY asset before modifying any. Failure = zero writes.
      const buffers = new Map();
      for (const spec of pending) {
        if (selected) {
          onProgress(`Checking selected file ${spec.name}…`);
          const bytes = validatePayload(await selected.get(spec.id).arrayBuffer(), spec);
          await verify(bytes, spec, global.crypto?.subtle);
          buffers.set(spec.id, bytes);
        } else {
          onProgress(`Downloading ${spec.name} over HTTPS…`);
          buffers.set(spec.id, await download(fetchFn, spec, onProgress, verify));
        }
      }
      const installed = [];
      const backups = new Map();
      const changed = [];
      async function writeAndVerify(target, bytes, spec) {
        const stream = await target.createWritable({ keepExistingData: false });
        try { await stream.write(bytes); await stream.close(); }
        catch (error) { try { await stream.abort(); } catch (_) { /* Closed already */ } throw error; }
        const written = new Uint8Array(await (await target.getFile()).arrayBuffer());
        if (!equalBytes(bytes, written)) throw new Error(`${spec.name}: Written file contents do not match the expected data.`);
      }
      // Save all old files before modifying any. Restore all touched files if
      // and later write, checksum, or readback fails. This is best-effort, not a
      // filesystem transaction; incomplete rollback is explicitly reported.
      for (const spec of pending) {
        const old = await targets.get(spec.id).file.getFile();
        backups.set(spec.id, new Uint8Array(await old.arrayBuffer()));
      }
      try {
        for (const spec of pending) {
          onProgress(`Saving ${spec.name} into vendor/${spec.directory}/…`);
          changed.push(spec);
          await writeAndVerify(targets.get(spec.id).file, buffers.get(spec.id), spec);
          installed.push(spec.id);
        }
      } catch (error) {
        const restorationFailures = [];
        for (const spec of changed.reverse()) {
          try { await writeAndVerify(targets.get(spec.id).file, backups.get(spec.id), spec); }
          catch (restoreError) { restorationFailures.push(`${spec.name}: ${restoreError.message}`); }
        }
        if (restorationFailures.length) {
          throw new Error(`Installation failed: ${error.message}. ROLLBACK INCOMPLETE: ${restorationFailures.join('; ')}. Inspect vendor/.`);
        }
        throw new Error(`Installation failed and original files were restored: ${error.message}`);
      }
      onProgress('Libraries installed. Reload the page to use them offline.');
      return { installed, skipped: SPECS.filter(s => !pending.includes(s)).map(s => s.id) };
    } finally { running = false; }
  }
  async function installFromFiles({ files, ...options } = {}) {
    if (!files || !files.length) throw new Error('Select both JavaScript files first.');
    return install({ ...options, providedFiles: files });
  }
  global.LocalWikiRendererInstaller = { install, installFromFiles, validatePayload, checkIntegrity, SPECS };
})(typeof window !== 'undefined' ? window : globalThis);
