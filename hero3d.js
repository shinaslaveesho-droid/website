// Homepage hero: real-time 3D brand objects (three.js). Loads after the page has painted, so it
// never slows the first view. If WebGL is missing or anything fails, the CSS orb stays as the fallback.
const box = document.getElementById('h3d');
const hero = box && box.parentElement;
const stage = hero && hero.querySelector('.hf');

function start() {
  if (!box || !stage) return;
  import('three').then(async (THREE) => {
    const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
    run(THREE, RoomEnvironment);
  }).catch(() => {});
}

function run(THREE, RoomEnvironment) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  box.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 6, 8); scene.add(key);
  const rim = new THREE.DirectionalLight(0xD94FC4, 2.2); rim.position.set(-6, -2, -4); scene.add(rim);
  const fill = new THREE.DirectionalLight(0x2F55F0, 1.4); fill.position.set(6, -4, 2); scene.add(fill);

  const mat = {
    iris: new THREE.MeshPhysicalMaterial({ color: 0x6B3BFF, metalness: 0.35, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 820] }),
    gold: new THREE.MeshPhysicalMaterial({ color: 0xF2C94C, metalness: 1, roughness: 0.22, clearcoat: 0.6 }),
    pink: new THREE.MeshPhysicalMaterial({ color: 0xD94FC4, metalness: 0.2, roughness: 0.18, clearcoat: 1, sheen: 1, sheenColor: new THREE.Color(0xFFC6F0) }),
    blue: new THREE.MeshPhysicalMaterial({ color: 0x2F55F0, metalness: 0.4, roughness: 0.2, clearcoat: 1 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xE9E2FF, metalness: 1, roughness: 0.06, iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [300, 900] }),
  };

  // Each object: geometry, material, where it sits (relative to the stage / hero), size in px.
  const defs = [
    { id: 'knot', g: new THREE.TorusKnotGeometry(1, 0.34, coarse ? 160 : 260, coarse ? 32 : 48), m: mat.iris, size: 1, spin: [0.18, 0.26, 0] },
    { id: 'sphere', g: new THREE.SphereGeometry(1, 64, 64), m: mat.gold, size: 0.2, spin: [0, 0.3, 0] },
    { id: 'ring', g: new THREE.TorusGeometry(1, 0.36, 48, 128), m: mat.pink, size: 0.26, spin: [0.5, 0.35, 0.1] },
    { id: 'pill', g: new THREE.CapsuleGeometry(0.55, 1.1, 16, 48), m: mat.blue, size: 0.2, spin: [0.2, 0.1, 0.4] },
    { id: 'glass', g: new THREE.SphereGeometry(1, 64, 64), m: mat.glass, size: 0.16, spin: [0, 0, 0] },
    { id: 'gem', g: new THREE.IcosahedronGeometry(1, 0), m: mat.iris, size: 0.12, spin: [0.6, 0.5, 0] },
  ];
  const group = new THREE.Group(); scene.add(group);
  const objs = defs.map((d, i) => {
    const mesh = new THREE.Mesh(d.g, d.m);
    mesh.rotation.set(i * 0.7, i * 1.1, i * 0.3);
    const holder = new THREE.Group(); holder.add(mesh); group.add(holder);
    return Object.assign(d, { mesh, holder, phase: i * 1.7, base: new THREE.Vector3(), scale: 1, born: 0.25 + i * 0.12 });
  });

  // Layout in CSS pixels; 1 world unit = 100px on the z=0 plane.
  let W = 1, H = 1;
  function layout() {
    const hr = hero.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    W = hr.width; H = hr.height;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.position.set(0, 0, (H / 100 / 2) / Math.tan(THREE.MathUtils.degToRad(15)));
    camera.updateProjectionMatrix();
    const cx = sr.left - hr.left + sr.width / 2, cy = sr.top - hr.top + sr.height / 2;
    const sh = sr.height, mobile = W < 720;
    const at = (px, py) => new THREE.Vector3(px / 100 - W / 200, H / 200 - py / 100, 0);
    const k = mobile ? Math.min(sh * 0.6, W * 0.55) : Math.min(sh * 0.78, W * 0.62);           // knot diameter in px
    const spread = mobile ? W * 0.4 : Math.min(W * 0.36, 560);
    const place = {
      knot:   [cx, cy, k / 3.3],
      sphere: [cx - spread, cy - sh * (mobile ? 0.1 : 0.18), k * (mobile ? 0.13 : 0.14)],
      ring:   [cx + spread, cy + sh * (mobile ? 0.05 : -0.28), k * (mobile ? 0.13 : 0.16)],
      pill:   [cx - spread * 0.78, cy + sh * 0.3, k * 0.09],
      glass:  [cx + spread * 0.8, cy + sh * 0.28, k * 0.11],
      gem:    [mobile ? W * 0.5 : cx - spread * 1.18, mobile ? cy + sh * 0.44 : cy - sh * 0.62, k * 0.06],
    };
    objs.forEach((o) => {
      const [x, y, r] = place[o.id];
      o.base.copy(at(x, y)); o.scale = r / 100;
    });
  }

  // Pointer parallax (desktop) and scroll spin.
  let tx = 0, ty = 0, px = 0, py = 0;
  if (!coarse) hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5;
  });
  hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; });

  const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  const clock = new THREE.Clock();
  let visible = true, raf = 0;
  function frame() {
    raf = 0;
    const t = clock.getElapsedTime();
    const scrollK = Math.min(1, Math.max(0, -hero.getBoundingClientRect().top / H));
    px += (tx - px) * 0.05; py += (ty - py) * 0.05;
    group.rotation.y = px * 0.35; group.rotation.x = py * 0.25;
    objs.forEach((o, i) => {
      const grow = reduce ? 1 : ease((t - o.born) / 1.4);
      const bob = reduce ? 0 : Math.sin(t * 0.9 + o.phase) * 0.12;
      o.holder.position.set(o.base.x + px * (i ? 0.5 : 0.2), o.base.y + bob - py * (i ? 0.4 : 0.15) + (i ? scrollK * (i % 2 ? 1.2 : -0.8) : 0), o.base.z);
      o.holder.scale.setScalar(o.scale * grow);
      if (!reduce) { o.mesh.rotation.x += o.spin[0] * 0.01; o.mesh.rotation.y += o.spin[1] * 0.01 + (i ? 0 : scrollK * 0.02); o.mesh.rotation.z += o.spin[2] * 0.01; }
    });
    renderer.render(scene, camera);
    if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }
  const go = () => { if (!raf) raf = requestAnimationFrame(frame); };

  layout();
  new ResizeObserver(() => { layout(); go(); }).observe(hero);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) go(); }).observe(hero);
  document.addEventListener('visibilitychange', go);
  frame();
  box.classList.add('on');
  const orb = stage.querySelector('.hf-orb'); if (orb) orb.style.opacity = '0';
}

// Wait until the page has loaded and the browser is idle, then fetch three.js.
const later = () => ('requestIdleCallback' in window ? requestIdleCallback(start, { timeout: 2500 }) : setTimeout(start, 600));
if (document.readyState === 'complete') later(); else addEventListener('load', later, { once: true });
