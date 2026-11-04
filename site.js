/* Laveesho site interactions */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  // ---- smooth inertial wheel scrolling (home page) ----
  if (!reduce && document.querySelector('.rot')) {
    var se = document.scrollingElement || document.documentElement;
    var target = se.scrollTop, cur = target, loop = null;
    var step = function () {
      cur += (target - cur) * 0.11;
      if (Math.abs(target - cur) < 0.5) { cur = target; se.scrollTop = cur; loop = null; return; }
      se.scrollTop = cur; loop = requestAnimationFrame(step);
    };
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey || menuOpen) return;
      if (se.scrollHeight <= window.innerHeight + 4) return;
      e.preventDefault();
      if (!loop) { target = se.scrollTop; cur = target; }
      var d = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1);
      target = Math.max(0, Math.min(se.scrollHeight - window.innerHeight, target + d));
      if (!loop) loop = requestAnimationFrame(step);
    }, { passive: false });
    window.addEventListener('scroll', function () { if (!loop) { target = se.scrollTop; cur = target; } }, { passive: true });
  }
})();
