/* Prevent stale asynchronous reads and overlapping disk mutations.
 * This is a UI coordination guard, not an OS-level file lock. */
(function (global) {
  'use strict';
  function create() {
    let generation = 0;
    let mutation = null;
    return {
      beginRead() { if (mutation) return null; return ++generation; },
      isCurrentRead(ticket) { return ticket !== null && !mutation && ticket === generation; },
      invalidateReads() { generation++; },
      acquire(name) {
        if (mutation) return false;
        mutation = name;
        generation++;
        return true;
      },
      release(name) {
        if (mutation !== name) throw new Error('Nesouhlasící ukončení diskové operace.');
        mutation = null;
      },
      isBusy() { return mutation !== null; },
      currentOperation() { return mutation; }
    };
  }
  global.LocalWikiOperationGuard = { create };
})(typeof window !== 'undefined' ? window : globalThis);
