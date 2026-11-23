/* Laveesho page transition — one royal loop stroke covers the screen on the way out and unwinds on the way in (first visit of a session too) */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var pre = document.querySelector('.pre'), sp = pre && pre.querySelector('.pre-s path');
  if (!pre || !sp) return;
  var L = sp.getTotalLength();
  var ease = function (t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }; // power2.inOut
  // dir 1 = unwind (erase from the start, 30% -> 5%); dir -1 = cover (draw from the start, 5% -> 30%)
  var anim = function (dir, D, done) {
    var start = null;
    var step = function (now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / D), e = ease(t), k = dir === 1 ? e : 1 - e, x = k * L;
      sp.style.strokeDasharray = (L - x) + ' ' + (x + 2);
      sp.style.strokeDashoffset = -x;
      sp.style.strokeWidth = (30 - 25 * k) + '%';
      if (t < 1) requestAnimationFrame(step); else if (done) done();
    };
    requestAnimationFrame(step);
  };

  // ---- arriving: solid screen, then the loop unwinds ----
  if (root.classList.contains('pre-on')) {
    var fromTrans = false;
    try { fromTrans = !!sessionStorage.getItem('lv-trans'); sessionStorage.setItem('lv-pre', '1'); sessionStorage.removeItem('lv-trans'); } catch (e) {}
    var t0 = performance.now(), ready = document.readyState === 'complete', went = false, minWait = fromTrans ? 350 : 900;
    if (!ready) window.addEventListener('load', function () { ready = true; }, { once: true });
    var go = function () {
      if (went) return; went = true;
      pre.classList.add('go');
      anim(1, 1250, function () { pre.classList.remove('go'); pre.classList.add('done'); root.classList.remove('pre-on'); });
    };
    (function wait() { var el = performance.now() - t0; if ((el >= minWait && ready) || el >= 2600) go(); else setTimeout(wait, 40); })();
  }

  // ---- leaving: cover the screen, then load the next page ----
  var leaving = false;
  if (!reduce) document.addEventListener('click', function (e) {
    if (leaving || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a[href]'); if (!a) return;
    if ((a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-no-trans')) return;
    var u; try { u = new URL(a.getAttribute('href'), location.href); } catch (x) { return; }
    if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return;
    if (u.pathname === location.pathname && u.search === location.search) return; // same page (anchors)
    e.preventDefault(); leaving = true;
    var dest = u.href;
    sp.style.strokeDasharray = '0 ' + (L + 2); sp.style.strokeDashoffset = -L; sp.style.strokeWidth = '5%';
    pre.classList.remove('done'); pre.classList.add('go');
    try { sessionStorage.setItem('lv-trans', '1'); } catch (x) {}
    anim(-1, 900, function () { pre.classList.add('solid'); setTimeout(function () { location.href = dest; }, 40); });
  }, true);
  window.addEventListener('pageshow', function (e) { if (e.persisted) { leaving = false; pre.classList.remove('go', 'solid'); pre.classList.add('done'); root.classList.remove('pre-on'); } });
})();

