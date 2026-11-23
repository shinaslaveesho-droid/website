/* Laveesho homepage hero v4 — preloader, masked character reveal, cursor-weight headline, cursor work card, scribble, marquee, Lenis */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var root = document.documentElement;
  var preOn = root.classList.contains('pre-on');
  var body = document.querySelector('.hx-v4'); if (!body) return;
  var h1 = body.querySelector('.hx-h4');
  var sec = body.closest('section');

  // ---- split headline into word + character spans (each line is already a mask) ----
  var sansChars = [];
  var grad = [[74, 31, 209], [191, 13, 101], [47, 85, 240]];
  var mix = function (t) { var s = t < .5 ? [grad[0], grad[1], t * 2] : [grad[1], grad[2], (t - .5) * 2]; var k = s[2]; return 'rgb(' + s[0].map(function (c, i) { return Math.round(c + (s[1][i] - c) * k); }).join(',') + ')'; };
  var delay = preOn ? 1.2 : .25;
  if (h1) {
    Array.prototype.forEach.call(h1.querySelectorAll('.hl'), function (line, li) {
      var nodes = Array.prototype.slice.call(line.childNodes); line.textContent = '';
      var lineChars = [];
      nodes.forEach(function (n) {
        var isEm = n.nodeType === 1 && n.tagName === 'EM';
        var text = n.textContent;
        text.split(' ').forEach(function (word, wi, arr) {
          if (word) {
            var w = document.createElement('span'); w.className = 'w' + (isEm ? ' em' : '');
            word.split('').forEach(function (ch) { var c = document.createElement('span'); c.className = 'c'; c.textContent = ch; w.appendChild(c); lineChars.push(c); if (!isEm && !line.classList.contains('hl-serif')) sansChars.push(c); });
            line.appendChild(w);
          }
          if (wi < arr.length - 1) line.appendChild(document.createTextNode(' '));
        });
      });
      lineChars.forEach(function (c, i) { c.style.setProperty('--d', (delay + li * .16 + i * .022).toFixed(3) + 's'); });
      // gradient colour per character on the italic parts
      var gradChars = line.classList.contains('hl-serif') ? lineChars : Array.prototype.slice.call(line.querySelectorAll('.w.em .c'));
      gradChars.forEach(function (c, i, a) { c.style.color = mix(a.length > 1 ? i / (a.length - 1) : 0); });
    });
  }

  // ---- reveal sequence ----
  var start = function () {
    body.classList.add('on');
    setTimeout(function () { body.classList.add('settled'); }, (delay + 1.6) * 1000);
    var disc = body.querySelector('.hx-disc'); if (disc) setTimeout(function () { disc.classList.add('on'); }, (delay + 1.1) * 1000);
  };
  if (reduce) { body.classList.add('on', 'calm'); var d = body.querySelector('.hx-disc'); if (d) d.classList.add('on'); }
  else if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });

  // ---- letters near the cursor get bold, grow and push their neighbours, so the words visibly move (radius 400px, like the reference) ----
  var allChars = h1 ? Array.prototype.slice.call(h1.querySelectorAll('.c')) : [];
  if (fine && !reduce && allChars.length) {
    var cur = [], R = 400, mx = -1e4, my = -1e4, loopT = null, fs = 100, armed = false;
    cur = allChars.map(function () { return 0; });
    var frame = function () {
      fs = parseFloat(getComputedStyle(h1).fontSize) || 100;
      // read every position first (one layout), then write every style
      var rects = allChars.map(function (c) { var r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      var live = false;
      for (var i = 0; i < allChars.length; i++) {
        var dx = rects[i][0] - mx, dy = rects[i][1] - my, d = Math.sqrt(dx * dx + dy * dy);
        var t = d < R ? 1 - d / R : 0; t = t * t * (3 - 2 * t);
        cur[i] += (t - cur[i]) * .14; if (Math.abs(cur[i] - t) > .003) live = true; else cur[i] = t;
        var k = cur[i], c = allChars[i], s = c.style;
        s.webkitTextStroke = (k * fs * .055).toFixed(2) + 'px currentColor';
        s.marginLeft = s.marginRight = (k * fs * .06).toFixed(2) + 'px';
        s.transform = k > .002 ? 'translateY(' + (-k * fs * .05).toFixed(2) + 'px) scale(' + (1 + k * .12).toFixed(3) + ')' : '';
      }
      loopT = live ? requestAnimationFrame(frame) : null;
    };
    var kick = function () { if (armed && !loopT) loopT = requestAnimationFrame(frame); };
    sec.addEventListener('mousemove', function (e) { mx = e.clientX; my = e.clientY; kick(); });
    sec.addEventListener('mouseleave', function () { mx = my = -1e4; kick(); });
    window.addEventListener('scroll', function () { if (mx > -1e3) kick(); }, { passive: true });
    setTimeout(function () { armed = true; kick(); }, (delay + 1.6) * 1000); // after the reveal has settled
  }

  // ---- cursor work card: lags behind the pointer, cycles a new visual every 240px of travel ----
  var card = body.querySelector('.hx-card');
  if (card) {
    var imgs = Array.prototype.slice.call(card.querySelectorAll('video, img')), idx = 0, z = 1;
    var show = function (n) { idx = (n + imgs.length) % imgs.length; imgs.forEach(function (im, i) { im.classList.toggle('on', i === idx); if (im.tagName === 'VIDEO') { if (i === idx) { var pr = im.play(); pr && pr.catch && pr.catch(function () {}); } else if (!im.paused) im.pause(); } }); imgs[idx].style.zIndex = ++z; };
    show(0);
    if (fine && !reduce) {
      var tx = 0, ty = 0, cx = 0, cy = 0, vx = 0, vis = false, travel = 0, lx = 0, ly = 0, loop = null;
      var tick = function () {
        cx += (tx - cx) * .085; cy += (ty - cy) * .085; vx += ((tx - cx) * .06 - vx) * .12;
        card.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0) rotate(' + Math.max(-9, Math.min(9, vx)).toFixed(2) + 'deg)';
        if (vis && (Math.abs(tx - cx) > .3 || Math.abs(ty - cy) > .3 || Math.abs(vx) > .05)) loop = requestAnimationFrame(tick); else loop = null;
      };
      sec.addEventListener('mousemove', function (e) {
        var r = sec.getBoundingClientRect(); tx = e.clientX - r.left; ty = e.clientY - r.top;
        if (!vis) { vis = true; cx = tx; cy = ty; card.classList.add('vis'); }
        travel += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly); lx = e.clientX; ly = e.clientY;
        if (travel > 240) { travel = 0; show(idx + 1); }
        if (!loop) loop = requestAnimationFrame(tick);
      });
      sec.addEventListener('mouseleave', function () { vis = false; card.classList.remove('vis'); });
      // hide the card while over interactive things so it never covers a button
      sec.addEventListener('mouseover', function (e) { card.classList.toggle('dim', !!e.target.closest('a, button')); });
    } else {
      card.classList.add('vis', 'static');
      if (!reduce) setInterval(function () { show(idx + 1); }, 2200);
    }
  }

  // ---- marquee: duplicate the track so it loops seamlessly ----
  var mq = document.querySelector('.hx-marq-t'); if (mq) mq.innerHTML += mq.innerHTML;

  // ---- Lenis smooth scroll (desktop pointers only) ----
  var lenis = null;
  if (window.Lenis && fine && !reduce) {
    try {
      lenis = new Lenis({ lerp: .09, wheelMultiplier: 1, smoothWheel: true });
      var lraf = function (t) { lenis.raf(t); requestAnimationFrame(lraf); }; requestAnimationFrame(lraf);
      var burger = document.querySelector('.hx-burger');
      if (burger) new MutationObserver(function () { burger.getAttribute('aria-expanded') === 'true' ? lenis.stop() : lenis.start(); }).observe(burger, { attributes: true, attributeFilter: ['aria-expanded'] });
    } catch (e) { lenis = null; }
  }
  var disc = body.querySelector('.hx-disc');
  if (disc) disc.addEventListener('click', function (e) {
    var t = document.querySelector(disc.getAttribute('href')); if (!t) return; e.preventDefault();
    if (lenis) lenis.scrollTo(t, { offset: -10, duration: 1.4 }); else t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  });

})();
