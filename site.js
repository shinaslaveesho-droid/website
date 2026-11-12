/* Laveesho site interactions */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- account link: "Log in" becomes "My account" when a saved session exists ----
  // Reads only the presence of Supabase's session key, so no auth library loads on normal pages.
  try {
    for (var i = 0; i < localStorage.length; i++) {
      if (/^sb-.+-auth-token$/.test(localStorage.key(i) || '')) {
        document.querySelectorAll('[data-auth-link]').forEach(function (a) { a.textContent = 'My account'; a.href = '/account'; });
        break;
      }
    }
  } catch (e) { /* storage blocked: keep "Log in" */ }

  // ---- anonymous live-visitor heartbeat (admin dashboard) ----
  // A random id stays in this browser; no name, email or IP is sent. Pings every 30s while the tab is visible.
  (function () {
    if (navigator.webdriver || /bot|crawl|spider|lighthouse/i.test(navigator.userAgent)) return;
    var id;
    try { id = localStorage.getItem('lv-visitor'); } catch (e) {}
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
      try { localStorage.setItem('lv-visitor', id); } catch (e) {}
    }
    var KEY = 'sb_publishable_Epp3JeJzP42a1ORQAnLV_w_qZbEUX_M';
    function ping() {
      if (document.hidden) return;
      fetch('https://gmqcrxeylvexxlobavfo.supabase.co/rest/v1/rpc/track_visit', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: KEY },
        body: JSON.stringify({ p_visitor: id, p_path: location.pathname })
      }).catch(function () {});
    }
    setTimeout(ping, 1500);
    setInterval(ping, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) ping(); });
  })();

  function flag(name, on) {
    document.querySelectorAll('[data-if="' + name + '"]').forEach(function (el) {
      el.style.display = on ? 'contents' : 'none';
    });
  }

  // ---- menu ----
  var menuOpen = false;
  function setMenu(on) {
    menuOpen = on;
    flag('menuOpen', on);
    document.querySelectorAll('[data-on-click="toggleMenu"][aria-expanded]').forEach(function (b) {
      b.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    document.documentElement.style.overflow = on ? 'hidden' : '';
  }

  // ---- services ring ----
  var rot = 0;
  function turn(d) {
    rot += d;
    document.querySelectorAll('.rot').forEach(function (r) { r.style.setProperty('--rot', rot + 'deg'); });
  }

  // ---- contact form (sends the enquiry to WhatsApp) ----
  function submit(form) {
    var f = new FormData(form);
    var lines = ['New enquiry from laveesho.com', ''];
    [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['company', 'Company'], ['service', 'Service'], ['budget', 'Budget'], ['message', 'Project']].forEach(function (k) {
      var v = (f.get(k[0]) || '').toString().trim();
      if (v) lines.push(k[1] + ': ' + v);
    });
    window.open('https://wa.me/971503940721?text=' + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
    flag('sent', true); flag('notSent', false);
  }

  var actions = {
    toggleMenu: function () { setMenu(!menuOpen); },
    closeMenu: function () { setMenu(false); },
    toTop: function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); },
    prev: function () { turn(60); },
    next: function () { turn(-60); },
    reset: function () {
      document.querySelectorAll('form').forEach(function (f) { f.reset(); });
      flag('sent', false); flag('notSent', true);
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-on-click]');
    if (!el) return;
    var fn = actions[el.getAttribute('data-on-click')];
    if (fn) fn(e);
  });
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.getAttribute('data-on-submit') === 'submit') { e.preventDefault(); submit(form); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menuOpen) setMenu(false); });

  // ---- hero spotlight ----
  document.querySelectorAll('[data-on-mousemove="onMove"]').forEach(function (sec) {
    if (reduce) return;
    var raf = null, x = 50, y = 50;
    sec.addEventListener('mousemove', function (e) {
      var r = sec.getBoundingClientRect();
      x = Math.min(100, Math.max(0, (e.clientX - r.left) / r.width * 100));
      y = Math.min(100, Math.max(0, (e.clientY - r.top) / r.height * 100));
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = null; sec.style.setProperty('--spot', x.toFixed(1) + '% ' + y.toFixed(1) + '%'); });
    });
    sec.addEventListener('mouseleave', function () { sec.style.setProperty('--spot', '50% 50%'); });
  });

  // Native scrolling only: the earlier JS "inertial" wheel scroll fought Safari's own momentum and felt laggy.

  // ---- floating back-to-top: shows once the page is scrolled about halfway ----
  var toTopBtn = document.querySelector('.totop');
  if (toTopBtn) {
    var ttTick = false;
    var ttUpdate = function () {
      ttTick = false;
      var se = document.scrollingElement || document.documentElement;
      var max = se.scrollHeight - window.innerHeight;
      toTopBtn.classList.toggle('show', max > 0 && se.scrollTop > max * 0.5);
    };
    var ttQueue = function () { if (!ttTick) { ttTick = true; requestAnimationFrame(ttUpdate); } };
    window.addEventListener('scroll', ttQueue, { passive: true });
    window.addEventListener('resize', ttQueue);
    ttUpdate();
  }

  // ---- "How we work" sideways journey for browsers without scroll-driven animations (Safari 18 and older) ----
  // Mirrors the CSS version: the track slides left as the tall section scrolls through the sticky viewport.
  var hs = document.querySelector('.hs');
  var hsTrack = hs && hs.querySelector('.hs-track');
  var calm = document.documentElement.classList.contains('calm') || (document.body && document.body.classList.contains('calm'));
  if (hs && hsTrack && !reduce && !calm && !(window.CSS && CSS.supports && CSS.supports('animation-timeline: view()'))) {
    document.documentElement.classList.add('hs-js');
    var hsProg = hs.querySelector('.hs-prog > span');
    var hsTick = false;
    var hsUpdate = function () {
      hsTick = false;
      var range = hs.offsetHeight - window.innerHeight;
      var p = range > 0 ? Math.min(1, Math.max(0, -hs.getBoundingClientRect().top / range)) : 0;
      var dx = Math.max(0, hsTrack.scrollWidth - window.innerWidth) * p;
      hsTrack.style.transform = 'translate3d(' + (-dx).toFixed(1) + 'px,0,0)';
      if (hsProg) hsProg.style.transform = 'scaleX(' + (0.08 + 0.92 * p).toFixed(3) + ')';
    };
    var hsQueue = function () { if (!hsTick) { hsTick = true; requestAnimationFrame(hsUpdate); } };
    window.addEventListener('scroll', hsQueue, { passive: true });
    window.addEventListener('resize', hsQueue);
    hsUpdate();
  }
})();
