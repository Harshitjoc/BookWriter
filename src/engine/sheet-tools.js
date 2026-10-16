/* ==========================================================================
   sheet-tools.js  -  screen-only overflow detector
   --------------------------------------------------------------------------
   Each .sheet is a rigid box that clips its content. If something is too tall
   to fit on the page, this flags the sheet with a red outline and a "N mm
   over" badge so you catch it while editing, never in the PDF.

   It does nothing in print (sheet.css hides the badge and the outline).
   engine/tools/check.mjs is the same check as a command, and that one is
   authoritative: a page is not done until it reads 0 mm there.
   ========================================================================== */
(function () {
  var PX_PER_MM = 96 / 25.4;          // CSS reference: 96px = 1 inch = 25.4mm
  var TOLERANCE_MM = 1;               // ignore sub-millimetre rounding

  function overflowMm(el) {
    return Math.max(0, (el.scrollHeight - el.clientHeight) / PX_PER_MM);
  }

  function check() {
    document.querySelectorAll('.sheet').forEach(function (el) {
      var over = overflowMm(el);
      var bad = over > TOLERANCE_MM;
      el.classList.toggle('is-overflowing', bad);

      var badge = el.querySelector(':scope > .of-badge');
      if (bad) {
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'of-badge';
          el.appendChild(badge);     // absolutely positioned -> doesn't affect layout
        }
        badge.textContent = '⚠ ' + Math.round(over) + ' mm over';
      } else if (badge) {
        badge.remove();
      }
    });
  }

  window.addEventListener('load', check);
  window.addEventListener('resize', check);
  // re-check once web fonts have loaded (they change text height)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(check);

  // expose for manual re-runs from the console
  window.checkSheets = check;
})();
