const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = name => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const scope = { window: {} };
vm.runInNewContext(src('attachment-types.js'), scope.window);
const types = scope.window.LocalWikiAttachmentTypes;

test('recognizes every accepted Obsidian attachment extension with case-insensitive names', () => {
  const groups = {
    image: ['avif','bmp','gif','jpeg','jpg','png','svg','webp'],
    audio: ['flac','m4a','mp3','ogg','wav','3gp'],
    video: ['mkv','mov','mp4','ogv','webm'],
    pdf: ['pdf'], canvas:['canvas'], base:['base'], drawio:['drawio']
  };
  for (const [kind, extensions] of Object.entries(groups)) for (const ext of extensions) {
    assert.equal(types.kind('Wiki/File.' + ext.toUpperCase()), kind, ext);
    assert.ok(types.isAttachment('Wiki/File.' + ext), ext);
  }
  assert.equal(types.kind('notes.md'), null);
  assert.equal(types.kind('malware.exe'), null);
  assert.equal(types.kind('file.svg.html'), null);
  assert.equal(types.mediaKind('recording.webm', 'audio/webm'), 'audio');
  assert.equal(types.mediaKind('clip.webm', 'video/webm'), 'video');
});

test('File System Access scans all formats in readwrite and readonly fallback', async () => {
  const context = { console, TextDecoder, TextEncoder, setTimeout }; context.window = context;
  vm.runInNewContext(src('attachment-types.js'), context);
  vm.runInNewContext(src('file-system.js'), context);
  const names = ['One.md','pic.svg','music.flac','music.3gp','clip.mp4','clip.webm','doc.pdf','board.canvas','data.base','process.drawio'];
  const entries = names.map(name => ({ kind:'file', name, async getFile(){return {type:'',size:0,arrayBuffer:async()=>new Uint8Array().buffer}} }));
  const root = {kind:'directory',name:'Wiki',async *values(){yield* entries;}};
  context.showDirectoryPicker=async()=>root;
  const bridge=context.LocalWikiFS.createBridge();
  await bridge.openWritable();
  assert.deepEqual(Array.from(bridge.getAssetPaths()).sort(), names.slice(1).sort());
  const kinds = bridge.getTree().children.map(n=>[n.name,n.kind]);
  assert.ok(kinds.some(([p,k])=>p==='pic.svg'&&k==='image'));
  assert.ok(kinds.some(([p,k])=>p==='music.flac'&&k==='audio'));
  assert.ok(kinds.some(([p,k])=>p==='clip.mp4'&&k==='video'));
  assert.ok(kinds.some(([p,k])=>p==='board.canvas'&&k==='canvas'));
  assert.ok(kinds.some(([p,k])=>p==='data.base'&&k==='base'));
  assert.ok(kinds.some(([p,k])=>p==='process.drawio'&&k==='drawio'));
  const files = names.map(name => ({name,webkitRelativePath:'Wiki/'+name}));
  const fallback=context.LocalWikiFS.createBridge();
  fallback.openReadOnly(files);
  assert.equal(fallback.getMode(),'readonly');
  assert.deepEqual(Array.from(fallback.getAssetPaths()).sort(), names.slice(1).sort());
});

test('Obsidian embeds convert media without changing note embeds or inline code',()=>{
  const context={window:{}};
  vm.runInNewContext(src('renderer.js'),context);
  const r=context.window.LocalWikiRender;
  assert.match(r.convertEmbeds('![[song.mp3]]'),/obsidian-attachment:song.mp3/);
  assert.match(r.convertEmbeds('![[dir\/movie.webm]]'),/obsidian-attachment:dir%2Fmovie.webm/);
  assert.match(r.convertEmbeds('![[pdf document.pdf]]'),/obsidian-attachment:pdf%20document.pdf/);
  assert.match(r.convertEmbeds('![[diagram.svg]]'),/obsidian-asset:diagram.svg/);
  assert.match(r.convertEmbeds('![[process.drawio]]'),/obsidian-attachment:process.drawio/);
  assert.equal(r.convertEmbeds('![[other.md]]'),'![[other.md]]');
  const parsed=r.prepareSource('`![[audio.mp3]]`\n```md\n![[movie.mp4]]\n```\n![[audio.mp3]]');
  assert.match(parsed.prepared,/`!\[\[audio.mp3\]\]`/);
  assert.match(parsed.prepared,/```md\n!\[\[movie.mp4\]\]\n```/);
  assert.match(parsed.prepared,/obsidian-attachment:audio.mp3/);
});

test('attachment links migrate conservatively across asset moves',()=>{
  const context={console,TextDecoder,TextEncoder};context.window=context;
  for(const name of ['attachment-types.js','file-system.js','wiki-index.js','link-migration.js']) vm.runInNewContext(src(name),context);
  const notes=new Map([['Notes.md',{text:'![[file.mp3]] [PDF](file.mp3) ![[picture.svg]] `![[file.mp3]]`',fingerprint:'f'}]]);
  const plan=context.LocalWikiMigration.planAsset(notes,'file.mp3','Media/file.mp3',['file.mp3','picture.svg']);
  assert.equal(plan.totalLinks,2);
  assert.equal(plan.changes[0].after,'![[Media/file.mp3]] [PDF](Media/file.mp3) ![[picture.svg]] `![[file.mp3]]`');
});
