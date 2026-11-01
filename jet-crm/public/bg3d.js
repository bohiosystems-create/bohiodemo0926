/* Background scene: a McDonnell Douglas MD-80 parked on the apron, seen from the front-left looking
   aft along the fuselage, in a classic Italian-flag-carrier-style livery (white, green window band,
   green tail with a red stripe). Polished JT8D nacelles, landing gear, concrete apron, mountains and sky.
   Needs THREE (r128) loaded first. Renders a single frame if the viewer prefers reduced motion. */
(function () {
  if (!window.THREE) return;
  const T = THREE;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lin = (hex) => new T.Color(hex).convertSRGBToLinear();

  const canvas = document.createElement('canvas');
  canvas.id = 'bg3d';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  let renderer;
  try { renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }); }
  catch (e) { canvas.remove(); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.setClearColor(lin('#5b9ad8'));
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new T.Scene();
  scene.fog = new T.Fog(lin('#dbe6ee'), 140, 1100);
  const camera = new T.PerspectiveCamera(30, 1, 0.5, 3000);

  // ---------- environment for reflections (blue sky, bright horizon, grey ground) ----------
  (function env() {
    const es = new T.Scene();
    const g = new T.SphereGeometry(50, 32, 16);
    const cols = [], pos = g.attributes.position;
    const top = lin('#5b9ad8'), hor = lin('#e9f0f4'), gnd = lin('#8f9498');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 50;
      const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.7)) : hor.clone().lerp(gnd, Math.min(1, -y * 3));
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    es.add(new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
    const pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(es, 0.02).texture;
    pm.dispose();
  })();

  // ---------- lights ----------
  scene.add(new T.HemisphereLight(lin('#cfe3f6'), lin('#8a8f93'), 0.55));
  const sun = new T.DirectionalLight(lin('#fff3df'), 2.1);
  sun.position.set(26, 58, 34);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 10, far: 160 });
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  // ---------- livery ----------
  const GREEN = '#065a30', GREEN_DARK = '#043d20', RED = '#b3141f', WHITE = '#f4f5f2', BELLY = '#c7ccd0';
  const L = 45, R = 1.67;

  // Fuselage paint: canvas texture in lathe UV space (x = around, y = along the length).
  const skin = (() => {
    const W = 2048, H = 4096;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = WHITE; x.fillRect(0, 0, W, H);
    const row = (s) => (1 - s / L) * H;
    // belly: lower third, fading out at nose and tail
    {
      const u0 = 0.0908, u1 = 0.409;
      const g = x.createLinearGradient(u0 * W - 40, 0, u0 * W + 10, 0);
      g.addColorStop(0, 'rgba(199,204,208,0)'); g.addColorStop(1, 'rgba(199,204,208,1)');
      x.fillStyle = g; x.fillRect(u0 * W - 40, row(41), 50, row(5) - row(41));
      x.fillStyle = BELLY; x.fillRect(u0 * W + 10, row(41), (u1 - u0) * W - 20, row(5) - row(41));
      const g2 = x.createLinearGradient(u1 * W - 10, 0, u1 * W + 40, 0);
      g2.addColorStop(0, 'rgba(199,204,208,1)'); g2.addColorStop(1, 'rgba(199,204,208,0)');
      x.fillStyle = g2; x.fillRect(u1 * W - 10, row(41), 50, row(5) - row(41));
    }
    // panel lines (frames every 1.25 m, a few stringers)
    x.strokeStyle = 'rgba(60,70,80,0.085)'; x.lineWidth = 2;
    for (let s = 4; s < 43; s += 1.25) { x.beginPath(); x.moveTo(0, row(s)); x.lineTo(W, row(s)); x.stroke(); }
    for (const u of [0.06, 0.19, 0.31, 0.44, 0.69, 0.81, 0.94]) { x.beginPath(); x.moveTo(u * W, row(3)); x.lineTo(u * W, row(42)); x.stroke(); }
    // helper: paint on one side of the fuselage with (s, y) coordinates; port = +1 (z>0), starboard = -1
    const paintSide = (side, draw) => {
      const col = (y) => { const phi = Math.asin(Math.max(-1, Math.min(1, -y / R))); return ((side > 0 ? phi : Math.PI - phi) / (2 * Math.PI)) * W; };
      for (const off of side > 0 ? [0, W] : [0]) { x.save(); x.translate(off, 0); draw((s, y) => [col(y), row(s)]); x.restore(); }
    };
    const band = (s) => { // cheatline edges along the length, tapering to a point under the cockpit
      if (s < 1.2) return null;
      if (s < 38) return [0.1, 0.9];
      const t = Math.min(1, (s - 38) / 4.2);
      return t >= 1 ? null : [0.1 + 0.4 * t, 0.9 - 0.4 * t];
    };
    for (const side of [1, -1]) paintSide(side, (P) => {
      // green window band
      x.beginPath();
      let first = true;
      for (let s = 1.2; s <= 42.2; s += 0.25) { const b = band(s); if (!b) break; const [cx, cy] = P(s, b[1]); first ? x.moveTo(cx, cy) : x.lineTo(cx, cy); first = false; }
      for (let s = 42.2; s >= 1.2; s -= 0.25) { const b = band(s); if (!b) continue; const [cx, cy] = P(s, b[0]); x.lineTo(cx, cy); }
      x.closePath(); x.fillStyle = GREEN; x.fill();
      // darker lower edge of the band
      x.beginPath(); first = true;
      for (let s = 1.2; s <= 42.2; s += 0.25) { const b = band(s); if (!b) break; const [cx, cy] = P(s, b[0] + 0.02); first ? x.moveTo(cx, cy) : x.lineTo(cx, cy); first = false; }
      x.strokeStyle = GREEN_DARK; x.lineWidth = 7; x.stroke();
      // doors: port has two passenger doors, starboard the service doors
      const door = (s, w, h, yc) => { const [c0, r0] = P(s - w / 2, yc + h / 2), [c1, r1] = P(s + w / 2, yc - h / 2); x.strokeStyle = 'rgba(40,50,60,0.45)'; x.lineWidth = 3; x.strokeRect(Math.min(c0, c1), Math.min(r0, r1), Math.abs(c1 - c0), Math.abs(r1 - r0)); };
      if (side > 0) { door(38.6, 0.86, 1.85, 0.05); door(12.9, 0.78, 1.75, 0.05); } else { door(38.3, 0.8, 1.3, 0.3); door(13.2, 0.7, 1.2, 0.3); }
      // cargo doors low on the starboard side
      if (side < 0) { door(31, 1.3, 1.1, -0.95); door(19, 1.3, 1.1, -0.95); }
    });
    // radome
    { const g = x.createLinearGradient(0, row(43.2), 0, row(45)); g.addColorStop(0, 'rgba(205,210,212,0)'); g.addColorStop(0.4, 'rgba(205,210,212,1)'); x.fillStyle = g; x.fillRect(0, row(45), W, row(43.2) - row(45)); }
    // faint weathering speckle
    x.fillStyle = 'rgba(80,90,100,0.035)';
    for (let i = 0; i < 2500; i++) { const px = Math.random() * W, py = Math.random() * H; x.fillRect(px, py, 1 + Math.random() * 3, 1 + Math.random() * 14); }
    const tex = new T.CanvasTexture(c);
    tex.encoding = T.sRGBEncoding; tex.anisotropy = maxAniso; tex.wrapS = T.RepeatWrapping;
    return tex;
  })();

  const mat = {
    skin: new T.MeshPhysicalMaterial({ map: skin, roughness: 0.3, metalness: 0.0, clearcoat: 0.85, clearcoatRoughness: 0.14, envMapIntensity: 0.8 }),
    white: new T.MeshPhysicalMaterial({ color: lin(WHITE), roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15, side: T.DoubleSide, envMapIntensity: 0.8 }),
    grey: new T.MeshPhysicalMaterial({ color: lin('#d9dddf'), roughness: 0.38, metalness: 0.2, clearcoat: 0.4, side: T.DoubleSide, envMapIntensity: 0.8 }),
    green: new T.MeshPhysicalMaterial({ color: lin(GREEN), roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12, side: T.DoubleSide, envMapIntensity: 0.8 }),
    red: new T.MeshPhysicalMaterial({ color: lin(RED), roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12, side: T.DoubleSide, envMapIntensity: 0.8 }),
    chrome: new T.MeshStandardMaterial({ color: lin('#e8ecef'), roughness: 0.14, metalness: 1.0, envMapIntensity: 1.25 }),
    steel: new T.MeshStandardMaterial({ color: lin('#9aa2a8'), roughness: 0.45, metalness: 0.9, envMapIntensity: 0.9 }),
    glass: new T.MeshPhysicalMaterial({ color: lin('#1b2836'), roughness: 0.08, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.3 }),
    frame: new T.MeshStandardMaterial({ color: lin('#cfd4d7'), roughness: 0.5, metalness: 0.1 }),
    dark: new T.MeshStandardMaterial({ color: lin('#121820'), roughness: 0.6, metalness: 0.3 }),
    rubber: new T.MeshStandardMaterial({ color: lin('#15181a'), roughness: 0.92, metalness: 0 }),
  };

  const plane = new T.Group();
  const add = (geo, m, fn, parent = plane) => { const mesh = new T.Mesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true; if (fn) fn(mesh); parent.add(mesh); return mesh; };

  // ---------- fuselage (s = 0 tail tip … 45 nose tip; x = s - 22.5) ----------
  const radius = (s) => {
    if (s < 9) { const t = s / 9; return 0.3 + (R - 0.3) * Math.sin((t * Math.PI) / 2); }
    if (s > 37) { const t = (s - 37) / 8; return Math.max(0.03, R * Math.pow(1 - Math.pow(t, 2.1), 0.62)); }
    return R;
  };
  const prof = [];
  for (let i = 0; i <= 140; i++) { const s = (i / 140) * L; prof.push(new T.Vector2(radius(s), s)); }
  const fus = new T.LatheGeometry(prof, 96);
  fus.rotateZ(-Math.PI / 2);
  fus.translate(-L / 2, 0, 0);
  {
    const p = fus.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = p.getX(i) + L / 2;
      let y = p.getY(i);
      if (s < 10) { const t = (10 - s) / 10; if (y < 0) y *= 1 - 0.45 * t; y += t * t * 1.0; }
      if (s > 38) { const t = (s - 38) / 7; y -= t * t * 0.55; }
      p.setY(i, y);
    }
    fus.computeVertexNormals();
  }
  add(fus, mat.skin);
  add(new T.CircleGeometry(0.22, 24), mat.dark, (m) => { m.position.set(-22.45, 1.0, 0); m.rotation.y = -Math.PI / 2; }); // APU exhaust

  // cabin windows: dark glass with a light frame, tangent to the skin
  {
    const yW = 0.5, zW = Math.sqrt(R * R - yW * yW), tilt = Math.atan2(yW, zW);
    const xs = [];
    for (let s = 12.4; s < 37.6; s += 0.86) xs.push(s - L / 2);
    const glass = new T.InstancedMesh(new T.BoxGeometry(0.23, 0.33, 0.08), mat.glass, xs.length * 2);
    const frame = new T.InstancedMesh(new T.BoxGeometry(0.29, 0.4, 0.05), mat.frame, xs.length * 2);
    const o = new T.Object3D(); let k = 0;
    for (const x of xs) for (const side of [1, -1]) {
      o.position.set(x, yW, side * zW); o.rotation.set(side * -tilt, 0, 0); o.updateMatrix();
      glass.setMatrixAt(k, o.matrix); frame.setMatrixAt(k, o.matrix); k++;
    }
    glass.castShadow = frame.castShadow = true;
    plane.add(frame, glass);
  }
  // cockpit windows
  {
    const cw = new T.BoxGeometry(0.62, 0.3, 0.08);
    for (const side of [1, -1]) {
      add(cw, mat.glass, (m) => { m.position.set(17.9, 0.78, side * 1.26); m.rotation.set(0, side * -0.16, 0); });
      add(cw, mat.glass, (m) => { m.position.set(18.55, 0.74, side * 1.16); m.rotation.set(0, side * -0.38, 0); });
      add(new T.BoxGeometry(0.5, 0.3, 0.08), mat.glass, (m) => { m.position.set(19.15, 0.62, side * 1.06); m.rotation.set(0, side * -0.8, side * 0.1); });
    }
  }

  // ---------- wings: low, swept, polished leading edges ----------
  const planform = (pts) => { const sh = new T.Shape(); pts.forEach(([a, b], i) => (i ? sh.lineTo(a, b) : sh.moveTo(a, b))); sh.closePath(); return sh; };
  const extrude = (shape, depth, bevel) => new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  const wingShape = planform([[1.6, 0.6], [-5.9, 16.45], [-7.4, 16.45], [-5.8, 4.2], [-5.6, 0.6]]);
  const ledge = planform([[1.6, 0.6], [-5.9, 16.45], [-6.35, 16.45], [1.05, 0.6]]);
  for (const side of [1, -1]) {
    const g = extrude(wingShape, 0.22, 0.12); g.rotateX(Math.PI / 2); if (side < 0) g.scale(1, 1, -1);
    add(g, mat.grey, (m) => { m.position.set(0, -1.0, 0); m.rotation.x = side * -0.055; });
    const e = extrude(ledge, 0.26, 0.1); e.rotateX(Math.PI / 2); if (side < 0) e.scale(1, 1, -1);
    add(e, mat.chrome, (m) => { m.position.set(0.02, -0.98, 0); m.rotation.x = side * -0.055; });
  }
  add(new T.SphereGeometry(1, 28, 14), new T.MeshPhysicalMaterial({ color: lin(BELLY), roughness: 0.35, clearcoat: 0.5 }), (m) => { m.scale.set(5.4, 0.8, 1.8); m.position.set(-1.8, -1.05, 0); });

  // ---------- rear engines: polished nacelles with intake, fan and pylon ----------
  const nacPts = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28, s = t * 6.2;
    const r = 0.62 + 0.18 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2) - (t > 0.75 ? (t - 0.75) * 0.9 : 0);
    nacPts.push(new T.Vector2(r, s));
  }
  const nacG = new T.LatheGeometry(nacPts, 48); nacG.rotateZ(Math.PI / 2);
  const fanTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    x.fillStyle = '#2a3138'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = '#9aa3aa'; x.lineWidth = 2;
    for (let i = 0; i < 34; i++) { const a = (i / 34) * Math.PI * 2; x.beginPath(); x.moveTo(128 + Math.cos(a) * 30, 128 + Math.sin(a) * 30); x.lineTo(128 + Math.cos(a + 0.35) * 124, 128 + Math.sin(a + 0.35) * 124); x.stroke(); }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
  })();
  for (const side of [1, -1]) {
    const cx = -9.2, cy = 0.78, cz = side * 2.78;
    add(nacG, mat.chrome, (m) => m.position.set(cx, cy, cz));
    add(new T.TorusGeometry(0.64, 0.075, 12, 48), mat.chrome, (m) => { m.position.set(cx + 0.02, cy, cz); m.rotation.y = Math.PI / 2; });
    add(new T.CylinderGeometry(0.58, 0.58, 0.5, 40, 1, true), mat.dark, (m) => { m.position.set(cx - 0.3, cy, cz); m.rotation.z = Math.PI / 2; });
    add(new T.CircleGeometry(0.58, 40), new T.MeshStandardMaterial({ map: fanTex, roughness: 0.5, metalness: 0.6 }), (m) => { m.position.set(cx - 0.55, cy, cz); m.rotation.y = Math.PI / 2; });
    add(new T.ConeGeometry(0.14, 0.42, 20), mat.chrome, (m) => { m.position.set(cx - 0.3, cy, cz); m.rotation.z = -Math.PI / 2; });
    add(new T.CylinderGeometry(0.34, 0.5, 0.5, 32, 1, true), mat.dark, (m) => { m.position.set(cx - 6.1, cy, cz); m.rotation.z = Math.PI / 2; });
    add(new T.BoxGeometry(2.8, 0.26, 1.35), mat.white, (m) => { m.position.set(cx - 2.9, cy + 0.02, side * 1.9); m.rotation.x = side * 0.16; });
  }

  // ---------- T-tail ----------
  add(extrude(planform([[-14.6, 1.0], [-19.4, 8.15], [-22.2, 8.15], [-21.2, 1.0]]), 0.18, 0.1), mat.green, (m) => m.position.z = -0.09);
  const stripe = planform([[-16.0, 1.25], [-20.45, 7.9], [-21.35, 7.9], [-16.95, 1.25]]);
  for (const side of [1, -1]) add(new T.ShapeGeometry(stripe), mat.red, (m) => { m.position.z = side * 0.215; });
  const stab = planform([[-19.0, 0], [-22.6, 6.2], [-24.0, 6.2], [-22.4, 0]]);
  for (const side of [1, -1]) { const g = extrude(stab, 0.14, 0.08); g.rotateX(Math.PI / 2); if (side < 0) g.scale(1, 1, -1); add(g, mat.white, (m) => m.position.set(0, 8.25, 0)); }
  add(new T.SphereGeometry(1, 20, 10), mat.green, (m) => { m.scale.set(2.0, 0.32, 0.32); m.position.set(-21.1, 8.2, 0); });

  // ---------- landing gear (aircraft centreline sits 2.9 m above the apron) ----------
  const GROUND = -2.9;
  const wheel = (r, w) => { const g = new T.CylinderGeometry(r, r, w, 28); g.rotateX(Math.PI / 2); return g; };
  const gear = (x, z, topY, r, w, twin) => {
    add(new T.CylinderGeometry(0.1, 0.12, topY - (GROUND + r), 16), mat.steel, (m) => m.position.set(x, (topY + GROUND + r) / 2, z));
    for (const dz of twin ? [-w * 0.6, w * 0.6] : [0]) {
      add(wheel(r, w), mat.rubber, (m) => m.position.set(x, GROUND + r, z + dz));
      add(wheel(r * 0.55, w + 0.02), mat.steel, (m) => m.position.set(x, GROUND + r, z + dz));
    }
  };
  gear(17.2, 0, -1.2, 0.38, 0.22, true);
  for (const side of [1, -1]) gear(-0.9, side * 2.55, -1.15, 0.5, 0.3, true);

  plane.position.y = 0;
  scene.add(plane);

  // ---------- apron: concrete slabs with joints, tyre marks and a yellow lead-in line ----------
  const concrete = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 1024; const x = c.getContext('2d');
    x.fillStyle = '#aaa79d'; x.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 26000; i++) { x.fillStyle = `rgba(${60 + Math.random() * 60 | 0},${60 + Math.random() * 55 | 0},${55 + Math.random() * 50 | 0},${0.05 + Math.random() * 0.12})`; x.fillRect(Math.random() * 1024, Math.random() * 1024, 1 + Math.random() * 3, 1 + Math.random() * 3); }
    for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(90,88,80,${0.05 + Math.random() * 0.08})`; x.beginPath(); x.ellipse(Math.random() * 1024, Math.random() * 1024, 30 + Math.random() * 120, 10 + Math.random() * 50, Math.random() * 3, 0, Math.PI * 2); x.fill(); }
    x.strokeStyle = 'rgba(70,68,62,0.55)'; x.lineWidth = 5;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 256, 0); x.lineTo(i * 256, 1024); x.stroke(); x.beginPath(); x.moveTo(0, i * 256); x.lineTo(1024, i * 256); x.stroke(); }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(60, 60); t.anisotropy = maxAniso; return t;
  })();
  const ground = new T.Mesh(new T.PlaneGeometry(2400, 2400), new T.MeshStandardMaterial({ map: concrete, roughness: 0.95, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = GROUND; ground.receiveShadow = true;
  scene.add(ground);
  const line = new T.Mesh(new T.PlaneGeometry(140, 0.16), new T.MeshStandardMaterial({ color: lin('#e3b52a'), roughness: 0.8 }));
  line.rotation.x = -Math.PI / 2; line.rotation.z = 0.25; line.position.set(4, GROUND + 0.01, -9.5); line.receiveShadow = true;
  scene.add(line);

  // ---------- backdrop: sky, clouds, mountain ranges, distant fields ----------
  const backdrop = (() => {
    const W = 2048, H = 1024, HZ = 0.62 * H; // horizon row
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, HZ);
    sky.addColorStop(0, '#4f93d6'); sky.addColorStop(0.55, '#8dbbe6'); sky.addColorStop(1, '#dde8f0');
    x.fillStyle = sky; x.fillRect(0, 0, W, HZ + 2);
    // cumulus clusters
    const puff = (cx, cy, r, a) => { const g = x.createRadialGradient(cx, cy - r * 0.2, r * 0.1, cx, cy, r); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.7, `rgba(248,250,252,${a * 0.6})`); g.addColorStop(1, 'rgba(240,245,250,0)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); };
    for (const [cx, cy, s] of [[1500, 330, 1.3], [1750, 300, 1.0], [300, 380, 0.8], [900, 420, 0.7], [1200, 460, 0.6], [600, 470, 0.5]]) {
      for (let i = 0; i < 14; i++) puff(cx + (Math.random() - 0.5) * 300 * s, cy + (Math.random() - 0.3) * 60 * s, (26 + Math.random() * 44) * s, 0.5 + Math.random() * 0.3);
    }
    // mountain ridges, far to near
    const ridge = (base, amp, seed, color, step) => {
      x.fillStyle = color; x.beginPath(); x.moveTo(0, H);
      for (let px = 0; px <= W; px += step) { const y = base - amp * (0.55 + 0.45 * Math.sin(px * 0.0031 + seed) * Math.cos(px * 0.0017 + seed * 2.3)) - amp * 0.35 * Math.abs(Math.sin(px * 0.011 + seed * 5)); x.lineTo(px, y); }
      x.lineTo(W, H); x.closePath(); x.fill();
    };
    ridge(HZ - 10, 170, 1.3, '#9fb3c6', 10);
    ridge(HZ - 4, 120, 4.1, '#7d93a8', 8);
    ridge(HZ + 2, 70, 7.7, '#5f7a7c', 6);
    // distant fields and tree line
    const land = x.createLinearGradient(0, HZ - 30, 0, HZ + 40); land.addColorStop(0, 'rgba(93,126,88,0)'); land.addColorStop(0.5, '#6f8f66'); land.addColorStop(1, '#8aa07c');
    x.fillStyle = land; x.fillRect(0, HZ - 30, W, 70);
    x.fillStyle = '#4c6b4a'; for (let px = 0; px < W; px += 6) x.fillRect(px, HZ - 6 - Math.random() * 10, 7, 14);
    // apron far edge blends into fog colour
    const g = x.createLinearGradient(0, HZ + 8, 0, H); g.addColorStop(0, '#9a9d9a'); g.addColorStop(0.08, '#b8bcbc'); g.addColorStop(1, '#dbe6ee');
    x.fillStyle = g; x.fillRect(0, HZ + 8, W, H - HZ - 8);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = maxAniso;
    const mesh = new T.Mesh(new T.PlaneGeometry(3400, 1700), new T.MeshBasicMaterial({ map: t, fog: false }));
    mesh.userData.hz = 0.62;
    return mesh;
  })();
  scene.add(backdrop);

  // ---------- framing ----------
  const look = new T.Vector3();
  function layout() {
    const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    // Starboard side, beside the forward door, looking aft: fuselage on the left, tail to the right.
    if (aspect < 0.8) { camera.fov = 60; camera.position.set(19, 2.3, -5.6); look.set(-15, 5.6, 0.3); }
    else if (aspect < 1.3) { camera.fov = 48; camera.position.set(18, 2.4, -5.0); look.set(-15, 5.4, 0.3); }
    else { camera.fov = 38; camera.position.set(17, 2.4, -4.4); look.set(-15, 5.0, 0.3); }
    camera.lookAt(look);
    const oy = aspect < 0.8 ? h * 0.37 : aspect < 1.3 ? h * 0.3 : h * 0.3;
    camera.setViewOffset(w, h, aspect < 0.8 ? 0 : w * 0.03, oy, w, h);
    camera.updateProjectionMatrix();
    // backdrop faces the camera, far away, with its horizon at eye level
    const dir = look.clone().sub(camera.position).setY(0).normalize();
    backdrop.position.copy(camera.position).add(dir.multiplyScalar(1500));
    backdrop.position.y = camera.position.y + (0.5 - (1 - backdrop.userData.hz)) * 1700;
    backdrop.lookAt(camera.position.x, backdrop.position.y, camera.position.z);
  }
  layout();
  window.addEventListener('resize', layout);

  const base = camera.position.clone();
  let last = performance.now(), t0 = last, running = !reduce;
  function frame(now) {
    const t = (now - t0) / 1000; last = now;
    camera.position.set(base.x + Math.sin(t * 0.11) * 0.18, base.y + Math.sin(t * 0.17) * 0.05, base.z + Math.cos(t * 0.09) * 0.12);
    camera.lookAt(look);
    renderer.render(scene, camera);
    if (running) requestAnimationFrame(frame);
  }
  renderer.render(scene, camera);
  if (running) requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => {
    if (reduce) return;
    if (document.hidden) running = false;
    else if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
  });
})();
