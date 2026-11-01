/* Background scene: a McDonnell Douglas MD-80 in a classic Italian-flag-carrier-style livery
   (white fuselage, green tail with a red band), cruising through soft clouds over a light green sky.
   Needs THREE (r128) loaded first. Renders once and stops if the viewer prefers reduced motion. */
(function () {
  if (!window.THREE) return;
  const T = THREE;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.createElement('canvas');
  canvas.id = 'bg3d';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  let renderer;
  try { renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' }); }
  catch (e) { canvas.remove(); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(28, 1, 1, 600);

  // --- soft environment for reflections: white sky above, pale green below ---
  (function env() {
    const envScene = new T.Scene();
    const g = new T.SphereGeometry(50, 32, 16);
    const cols = [];
    const pos = g.attributes.position;
    const top = new T.Color('#ffffff'), mid = new T.Color('#eef6ef'), bot = new T.Color('#9fc7a8');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 50;
      const c = y > 0 ? mid.clone().lerp(top, y) : mid.clone().lerp(bot, -y);
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    envScene.add(new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    const pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();
  })();

  scene.add(new T.HemisphereLight(0xffffff, 0x9fc4a7, 0.42));
  const sun = new T.DirectionalLight(0xfff4e2, 1.35);
  sun.position.set(18, 34, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 100 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new T.DirectionalLight(0xdff3e4, 0.5);
  rim.position.set(-30, 8, -20);
  scene.add(rim);

  // --- livery palette ---
  const GREEN = '#006f3c', RED = '#c41e2a', WHITE = '#f4f5f2', BELLY = '#c9cfd3', METAL = '#a7b0b6', DARK = '#16212b';
  const mat = {
    body: new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
    wing: new T.MeshPhysicalMaterial({ color: METAL, roughness: 0.42, metalness: 0.55, clearcoat: 0.3, side: T.DoubleSide }),
    white: new T.MeshPhysicalMaterial({ color: WHITE, roughness: 0.3, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.2, side: T.DoubleSide }),
    green: new T.MeshPhysicalMaterial({ color: GREEN, roughness: 0.35, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.15, side: T.DoubleSide }),
    red: new T.MeshPhysicalMaterial({ color: RED, roughness: 0.35, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.15, side: T.DoubleSide }),
    dark: new T.MeshStandardMaterial({ color: DARK, roughness: 0.25, metalness: 0.6 }),
    lip: new T.MeshStandardMaterial({ color: '#dfe4e7', roughness: 0.2, metalness: 0.9 }),
    nacelle: new T.MeshPhysicalMaterial({ color: '#e2e6e8', roughness: 0.3, metalness: 0.15, clearcoat: 0.6, side: T.DoubleSide }),
  };

  for (const m of Object.values(mat)) { m.envMapIntensity = 0.55; if (m.color && !m.vertexColors) m.color.convertSRGBToLinear(); }
  const plane = new T.Group();
  const add = (geo, m, fn) => { const mesh = new T.Mesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true; if (fn) fn(mesh); plane.add(mesh); return mesh; };

  // --- fuselage: 45 m long, 3.34 m wide, tail cone swept up (s = 0 tail tip ... 45 nose tip) ---
  const L = 45, R = 1.67;
  const radius = (s) => {
    if (s < 9) { const t = s / 9; return 0.32 + (R - 0.32) * Math.sin((t * Math.PI) / 2); }
    if (s > 37) { const t = (s - 37) / 8; return Math.max(0.03, R * Math.pow(1 - Math.pow(t, 2.1), 0.62)); }
    return R;
  };
  const prof = [];
  for (let i = 0; i <= 90; i++) { const s = (i / 90) * L; prof.push(new T.Vector2(radius(s), s)); }
  const fus = new T.LatheGeometry(prof, 64);
  fus.rotateZ(-Math.PI / 2); // axis Y -> X, nose at +X
  fus.translate(-L / 2, 0, 0);
  {
    const p = fus.attributes.position, cols = [];
    const white = new T.Color(WHITE).convertSRGBToLinear(), belly = new T.Color(BELLY).convertSRGBToLinear();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), s = x + L / 2;
      const y0 = p.getY(i);
      let y = y0;
      if (s < 10) { const t = (10 - s) / 10; y = y < 0 ? y * (1 - 0.45 * t) : y; y += t * t * 1.0; } // upswept tail cone
      if (s > 38) { const t = (s - 38) / 7; y -= t * t * 0.55; } // drooped, pointed nose
      p.setY(i, y);
      const c = y0 < -0.62 ? belly : white;
      cols.push(c.r, c.g, c.b);
    }
    fus.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    fus.computeVertexNormals();
  }
  add(fus, mat.body);

  // cabin windows (both sides) and cockpit glazing
  {
    const w = new T.BoxGeometry(0.26, 0.36, 0.06);
    const xs = [];
    for (let s = 12.2; s < 37.5; s += 0.86) xs.push(s - L / 2);
    const inst = new T.InstancedMesh(w, mat.dark, xs.length * 2);
    const m4 = new T.Matrix4();
    let k = 0;
    for (const x of xs) for (const side of [1, -1]) { m4.makeTranslation(x, 0.42, side * 1.615); inst.setMatrixAt(k++, m4); }
    plane.add(inst);
    // front passenger door outline
    for (const side of [1, -1]) add(new T.BoxGeometry(0.9, 1.75, 0.03), new T.MeshStandardMaterial({ color: new T.Color('#c7ccd0').convertSRGBToLinear(), roughness: 0.5 }), (m) => m.position.set(15.0, 0.05, side * 1.66));
    const cw = new T.BoxGeometry(0.62, 0.3, 0.08);
    for (const side of [1, -1]) {
      add(cw, mat.dark, (m) => { m.position.set(17.9, 0.78, side * 1.26); m.rotation.set(0, side * -0.16, 0); });
      add(cw, mat.dark, (m) => { m.position.set(18.55, 0.74, side * 1.16); m.rotation.set(0, side * -0.38, 0); });
      add(new T.BoxGeometry(0.5, 0.3, 0.08), mat.dark, (m) => { m.position.set(19.15, 0.62, side * 1.06); m.rotation.set(0, side * -0.8, side * 0.1); });
    }
  }

  // --- wings: low-mounted, 24.5° sweep, 32.9 m span, 3° dihedral ---
  const planform = (pts) => { const sh = new T.Shape(); pts.forEach(([a, b], i) => (i ? sh.lineTo(a, b) : sh.moveTo(a, b))); sh.closePath(); return sh; };
  const wingShape = planform([[1.6, 0.6], [-5.9, 16.45], [-7.4, 16.45], [-5.8, 4.2], [-5.6, 0.6]]);
  const extrude = (shape, depth, bevel) => new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  for (const side of [1, -1]) {
    const g = extrude(wingShape, 0.22, 0.12);
    g.rotateX(Math.PI / 2); // shape Y (span) -> +Z, extrusion -> -Y
    if (side < 0) g.scale(1, 1, -1);
    add(g, mat.wing, (m) => { m.position.set(0, -1.0, 0); m.rotation.x = side * -0.055; });
    // wing-root fairing
  }
  add(new T.SphereGeometry(1, 24, 12), mat.body.clone(), (m) => { m.material = new T.MeshPhysicalMaterial({ color: new T.Color(BELLY).convertSRGBToLinear(), roughness: 0.35, clearcoat: 0.5 }); m.scale.set(5.2, 0.75, 1.75); m.position.set(-1.8, -1.05, 0); });

  // --- rear-mounted engines (JT8D-200) on pylons ---
  const nac = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, s = t * 6.2;
    const r = 0.62 + 0.18 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2) - (t > 0.75 ? (t - 0.75) * 0.9 : 0);
    nac.push(new T.Vector2(r, s));
  }
  const nacG = new T.LatheGeometry(nac, 40);
  nacG.rotateZ(Math.PI / 2); // axis -> -X: intake (s=0) faces forward (+X), exhaust at -6.2
  for (const side of [1, -1]) {
    const cx = -9.2, cy = 0.75, cz = side * 2.75;
    add(nacG, mat.nacelle, (m) => m.position.set(cx, cy, cz));
    add(new T.TorusGeometry(0.66, 0.07, 10, 36), mat.lip, (m) => { m.position.set(cx + 0.02, cy, cz); m.rotation.y = Math.PI / 2; });
    add(new T.CircleGeometry(0.62, 32), mat.dark, (m) => { m.position.set(cx - 0.35, cy, cz); m.rotation.y = Math.PI / 2; });
    add(new T.CircleGeometry(0.5, 28), mat.dark, (m) => { m.position.set(cx - 6.1, cy, cz); m.rotation.y = -Math.PI / 2; });
    add(new T.BoxGeometry(2.6, 0.22, 1.3), mat.white, (m) => { m.position.set(cx - 2.9, cy + 0.05, side * 1.85); m.rotation.x = side * 0.18; });
  }

  // --- T-tail: green fin with a red band, white stabiliser on top ---
  const finPts = [[-14.6, 1.0], [-19.4, 8.15], [-22.2, 8.15], [-21.2, 1.0]];
  add(extrude(planform(finPts), 0.18, 0.1), mat.green, (m) => m.position.z = -0.09);
  const band = planform([[-16.0, 1.25], [-20.45, 7.9], [-21.35, 7.9], [-16.95, 1.25]]);
  for (const side of [1, -1]) add(new T.ShapeGeometry(band), mat.red, (m) => { m.position.z = side * 0.215; });
  const stab = planform([[-19.0, 0], [-22.6, 6.2], [-24.0, 6.2], [-22.4, 0]]);
  for (const side of [1, -1]) {
    const g = extrude(stab, 0.14, 0.08);
    g.rotateX(Math.PI / 2);
    if (side < 0) g.scale(1, 1, -1);
    add(g, mat.white, (m) => m.position.set(0, 8.25, 0));
  }
  add(new T.SphereGeometry(1, 20, 10), mat.green, (m) => { m.scale.set(2.0, 0.32, 0.32); m.position.set(-21.1, 8.2, 0); });

  plane.rotation.order = 'YXZ';
  scene.add(plane);

  // --- clouds: soft sprites drifting past to give a sense of flight ---
  const cloudTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    for (let i = 0; i < 7; i++) {
      const cx = 30 + Math.random() * 68, cy = 46 + Math.random() * 36, r = 22 + Math.random() * 26;
      const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
  })();
  const clouds = [];
  for (let i = 0; i < 12; i++) {
    const s = new T.Sprite(new T.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.55 + Math.random() * 0.35 }));
    const k = 10 + Math.random() * 18;
    s.scale.set(k * 2.1, k, 1);
    s.position.set(-130 + Math.random() * 260, -38 + Math.random() * 26, -50 - Math.random() * 110);
    s.userData.v = 2.5 + Math.random() * 3.5;
    clouds.push(s); scene.add(s);
  }

  // --- framing: plane in the upper part on phones, upper-right on wide screens ---
  function layout() {
    const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    const hfov = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * aspect);
    const want = aspect < 1 ? 44 : aspect > 1.5 ? 92 : 74; // scene width to fit
    const d = Math.max(70, (want / 2) / Math.tan(hfov / 2));
    camera.position.set(d * 0.55, d * 0.16, d * 0.84);
    camera.lookAt(0, 0, 0);
    // Shift the view so the aircraft sits high (and to the right on wide screens).
    const ox = aspect < 1 ? 0 : -w * (aspect > 1.5 ? 0.27 : 0.2), oy = aspect < 1 ? h * 0.26 : h * 0.24;
    camera.setViewOffset(w, h, ox, oy, w, h);
    camera.updateProjectionMatrix();
  }
  layout();
  window.addEventListener('resize', layout);

  let last = performance.now(), t0 = last, running = !reduce;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = (now - t0) / 1000;
    plane.rotation.y = -0.42 + Math.sin(t * 0.13) * 0.06;
    plane.rotation.z = -0.07 + Math.sin(t * 0.37) * 0.035;
    plane.rotation.x = Math.sin(t * 0.29) * 0.02;
    plane.position.y = Math.sin(t * 0.5) * 0.7;
    for (const c of clouds) { c.position.x -= c.userData.v * dt; if (c.position.x < -130) c.position.x = 130; }
    renderer.render(scene, camera);
    if (running) requestAnimationFrame(frame);
  }
  plane.rotation.y = -0.42; plane.rotation.z = -0.07;
  renderer.render(scene, camera);
  if (running) requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    if (reduce) return;
    if (document.hidden) running = false;
    else if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
  });
})();
