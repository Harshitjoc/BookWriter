/* ==========================================================================
   motion.js  -  the runtime for a book that asked for motion.
   --------------------------------------------------------------------------
   Loaded by build-book.mjs only when book.json names a motion pack, and only
   alongside motion.css. It does three jobs and no more:

     1. Tag the things that animate. It finds the parts of a page the packs know
        how to move — bands, explainer lines, action boxes, SVG strokes, cards,
        stick-cast limbs — and gives them the classes motion.css keys on. It
        never adds, removes or rewrites content, and never touches the page's
        own markup or text.

     2. Reveal on scroll. An IntersectionObserver adds .m-in as each tagged
        element enters view, which starts its keyframe. With no JS, or before
        an element is seen, it is simply at rest and visible — the frozen pose
        is the default, so nothing is ever hidden from a reader without JS.

     3. Freeze and play on demand. window.__proofpressFreeze() stops all motion
        and puts every animated element at its rest frame; __proofpressPlay()
        lets it run. check.mjs and shot.mjs open with motion frozen so the page
        they measure is the page paper will get. make-video.mjs drives
        __proofpressSeek() to step a page to an exact frame.

   It is deliberately small, dependency-free and side-effect-free outside the
   page it is loaded into.
   ========================================================================== */
(function () {
  var root = document.documentElement;
  var packs = (root.getAttribute('data-motion') || '').split(/\s+/).filter(Boolean);
  if (!packs.length) return;

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var frozen = reduced;                 // reduced-motion starts frozen and stays frozen

  function has(pack) { return packs.indexOf(pack) !== -1; }

  /* ---- 1. tag what animates. Structure only; no content is touched. ---- */
  function tag() {
    document.querySelectorAll('.sheet').forEach(function (sheet) {
      // Bands and text blocks rise or fade as a unit.
      sheet.querySelectorAll('.diagram, .photo, .explain > p, .ask')
        .forEach(function (el) { el.classList.add('m-anim'); });

      // Isometric pack: cards inside the diagram tilt.
      if (has('isometric')) {
        sheet.querySelectorAll('.diagram [data-iso], .diagram .card')
          .forEach(function (el) { el.classList.add('m-iso'); });
      }

      // Draw-on pack: every real stroke gets measured and tagged.
      if (has('draw')) {
        sheet.querySelectorAll('svg path, svg line, svg polyline, svg circle, svg rect')
          .forEach(function (s) {
            if (s.classList.contains('m-arm') || s.classList.contains('m-leg')) return;
            s.classList.add('m-draw');
            try {
              var len = s.getTotalLength ? s.getTotalLength() : 1000;
              s.style.setProperty('--m-len', String(Math.ceil(len)));
            } catch { s.style.setProperty('--m-len', '1000'); }
          });
      }

      // Stick cast: limbs and body are authored as separate shapes already
      // tagged .m-arm / .m-leg / .m-body in the SVG. Nothing to do here.
    });
  }

  /* ---- 2. reveal on scroll, once. ---- */
  var io = null;
  function observe() {
    if (!('IntersectionObserver' in window)) {
      // No observer: show everything at rest. Never leave a reader with a
      // blank page because the browser is old.
      document.querySelectorAll('.m-anim, .m-iso, .m-draw').forEach(function (el) { el.classList.add('m-in'); });
      return;
    }
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (frozen) return;
        if (e.isIntersecting) {
          e.target.classList.add('m-in');
          io.unobserve(e.target);
        }
      });
    }, { root: null, threshold: 0.15 });
    document.querySelectorAll('.m-anim, .m-iso, .m-draw').forEach(function (el) {
      io.observe(el);
    });
  }

  /* ---- 3. freeze / play / seek, for tests, print and video. ---- */

  // Everything the CSS animates, as a flat list, for freeze/play/seek.
  function animated() {
    return document.querySelectorAll(
      '.m-anim, .m-iso, .m-draw, .m-arm, .m-leg, .m-body'
    );
  }

  function freeze() {
    frozen = true;
    if (io) io.disconnect();
    animated().forEach(function (el) {
      el.classList.add('m-in');
      // Pin the rest frame: the first keyframe of every pack.
      el.style.animationPlayState = 'paused';
      el.style.animationDelay = '0s';
      el.style.animationDuration = '0s';
      el.style.animationName = 'none';
      el.style.transition = 'none';
    });
    root.setAttribute('data-motion-frozen', '1');
  }

  function play() {
    frozen = false;
    root.removeAttribute('data-motion-frozen');
    animated().forEach(function (el) {
      el.style.animationPlayState = '';
      el.style.animationDelay = '';
      el.style.animationDuration = '';
      el.style.animationName = '';
      el.style.transition = '';
    });
    // Re-observe whatever has not been revealed yet.
    observe();
  }

  // Seek drives a page to a deterministic instant, for frame capture. t is in
  // milliseconds since the page's motion started. It pauses every animation at
  // that offset so two captures of the same t are identical.
  function seek(tMs) {
    frozen = true;
    if (io) io.disconnect();
    animated().forEach(function (el) {
      el.classList.add('m-in');
      el.style.animationPlayState = 'paused';
      el.style.animationDelay = '0s';
      el.style.animationDuration = '';
      el.style.animationName = '';
      try {
        var anims = el.getAnimations ? el.getAnimations() : [];
        anims.forEach(function (a) {
          try { a.currentTime = tMs; a.pause(); } catch { /* older engine */ }
        });
      } catch { /* no WAAPI */ }
    });
    root.setAttribute('data-motion-frozen', '1');
  }

  window.__proofpressFreeze = freeze;
  window.__proofpressPlay = play;
  window.__proofpressSeek = seek;
  window.__proofpressMotion = { packs: packs.slice(), frozen: function () { return frozen; } };

  function boot() {
    tag();
    if (frozen) freeze(); else observe();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
