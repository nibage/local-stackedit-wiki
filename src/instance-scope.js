/* Separate installation preferences by the absolute index.html URL, not by browser
 * origin. Some Chrome/Edge file:// configurations share a storage origin across
 * unrelated local apps. This module makes that sharing harmless for our keys.
 * Moving/copying an installation to a different location starts with fresh prefs.
 * The original legacy keys/databases are left untouched, never imported.
 */
(function (global) {
  'use strict';
  const location = global.location;
  // Query parameters and anchors are UI navigation, not new installations.
  // Use the exact URL rather than hashing: no accidental scope collisions.
  const href = location && typeof location.href === 'string'
    ? location.href.split(/[?#]/, 1)[0] : 'test://no-location/index.html';
  const PREFIX = 'local-stackedit-wiki::' + href + '::';
  function storageKey(name) { return PREFIX + String(name); }
  function databaseName(base) { return PREFIX + String(base); }
  global.LocalWikiScope = Object.freeze({ storageKey, databaseName });
})(typeof window !== 'undefined' ? window : globalThis);
