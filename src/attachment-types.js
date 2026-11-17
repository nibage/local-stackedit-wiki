/* File types accepted by Obsidian; no external dependencies, safe on file://. */
(function (global) {
  'use strict';
  const extensions = Object.freeze({
    image: ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'],
    audio: ['flac', 'm4a', 'mp3', 'ogg', 'wav', '3gp'],
    video: ['mkv', 'mov', 'mp4', 'ogv', 'webm'],
    pdf: ['pdf'],
    canvas: ['canvas'],
    base: ['base'],
    drawio: ['drawio']
  });
  const known = new Map();
  for (const [type, list] of Object.entries(extensions)) for (const ext of list) known.set(ext, type);
  const mime = Object.freeze({
    avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png',
    svg: 'image/svg+xml', webp: 'image/webp', flac: 'audio/flac', m4a: 'audio/mp4', mp3: 'audio/mpeg',
    ogg: 'audio/ogg', wav: 'audio/wav', '3gp': 'audio/3gpp', mkv: 'video/x-matroska', mov: 'video/quicktime',
    mp4: 'video/mp4', ogv: 'video/ogg', webm: 'video/webm', pdf: 'application/pdf',
    canvas: 'application/json', base: 'text/yaml', drawio: 'application/xml'
  });
  function extension(path) { return /\.([a-z\d]+)$/i.exec(String(path || ''))?.[1]?.toLowerCase() || ''; }
  function kind(path) { return known.get(extension(path)) || null; }
  function isAttachment(path) { return kind(path) !== null; }
  function isImage(path) { return kind(path) === 'image'; }
  function isEmbeddable(path) { return ['image', 'audio', 'video', 'pdf'].includes(kind(path)); }
  function mediaKind(path, fileType) {
    if (extension(path) === 'webm' && /^audio\//i.test(fileType || '')) return 'audio';
    return kind(path);
  }
  global.LocalWikiAttachmentTypes = { kind, isAttachment, isImage, isEmbeddable, mediaKind, extension,
    mime: path => mime[extension(path)] || 'application/octet-stream', extensions };
})(typeof window !== 'undefined' ? window : globalThis);
