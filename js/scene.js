/* Scroll-driven flight through a monochrome wireframe world.
   Stars + a navigation grid form the pattern in the empty areas. A car drives
   the grid road ahead of you; a neural network, a robot, a CubeSat and a
   dish satellite pass by. Each model resolves from a point cloud into a
   wireframe as you approach — a nod to single-view 3D reconstruction. */
(function () {
  if (!window.THREE) return;
  var canvas = document.getElementById('scene');
  if (!canvas) return;

  var THREE = window.THREE;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var small = window.matchMedia('(max-width: 720px)').matches;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch (e) {
    canvas.remove();
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(58, 1, 0.1, 320);
  var PATH = 210;              // world units flown over the whole page
  var GRID_Y = -3.2;

  var ink = new THREE.Color('#f2f2f0');
  var bg = new THREE.Color('#0b0b0c');
  scene.fog = new THREE.Fog(bg, 12, 130);

  // Soft round sprite for points
  function dot(size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  var sprite = dot(64);

  var materials = [];
  function pointsMat(size, opacity) {
    var m = new THREE.PointsMaterial({ size: size, map: sprite, transparent: true, opacity: opacity, depthWrite: false, sizeAttenuation: true, alphaTest: 0.02 });
    materials.push(m);
    return m;
  }
  function lineMat(opacity) {
    var m = new THREE.LineBasicMaterial({ transparent: true, opacity: opacity, depthWrite: false });
    materials.push(m);
    return m;
  }

  var seed = 7;
  function rand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  // Stars ---------------------------------------------------------------
  var starCount = small ? 900 : 1800;
  var sp = new Float32Array(starCount * 3);
  for (var i = 0; i < starCount; i++) {
    sp[i * 3] = (rand() - 0.5) * 140;
    sp[i * 3 + 1] = (rand() - 0.35) * 70;
    sp[i * 3 + 2] = -rand() * (PATH + 160) + 30;
  }
  var starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  scene.add(new THREE.Points(starGeo, pointsMat(0.28, 0.85)));

  // Navigation grid (the road) -------------------------------------------
  var gridPts = [];
  var W = 90, L = PATH + 200, STEP = 3, z0 = 40;
  for (var x = -W; x <= W; x += STEP) {
    for (var zz = z0; zz > z0 - L; zz -= 30) gridPts.push(x, GRID_Y, zz, x, GRID_Y, Math.max(zz - 30, z0 - L));
  }
  for (var z = z0; z >= z0 - L; z -= STEP) gridPts.push(-W, GRID_Y, z, W, GRID_Y, z);
  var gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
  scene.add(new THREE.LineSegments(gridGeo, lineMat(0.16)));

  // Model builder: every part is drawn as edges + vertex points -----------
  var models = [];
  function Model(pos, rot, resolve) {
    this.group = new THREE.Group();
    this.group.position.set(pos[0], pos[1], pos[2]);
    if (rot) this.group.rotation.set(rot[0], rot[1], rot[2]);
    this.edges = [];   // { mat, base }
    this.points = [];  // { mat, base, size }
    this.resolve = resolve !== false;
    this.radius = 4;
    scene.add(this.group);
    models.push(this);
  }
  Model.prototype.part = function (geo, pos, rot, opacity, parent) {
    var op = opacity == null ? 0.5 : opacity;
    var em = lineMat(op);
    var e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 12), em);
    if (pos) e.position.set(pos[0], pos[1], pos[2]);
    if (rot) e.rotation.set(rot[0], rot[1], rot[2]);
    (parent || this.group).add(e);
    this.edges.push({ mat: em, base: op });
    // vertex cloud (deduplicated from the edge geometry)
    var pm = pointsMat(0.16, 0.85);
    var p = new THREE.Points(e.geometry, pm);
    p.position.copy(e.position);
    p.rotation.copy(e.rotation);
    (parent || this.group).add(p);
    this.points.push({ mat: pm, base: 0.85, size: 0.16 });
    return e;
  };
  Model.prototype.lines = function (arr, opacity, parent) {
    var op = opacity == null ? 0.4 : opacity;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    var m = lineMat(op);
    var l = new THREE.LineSegments(g, m);
    (parent || this.group).add(l);
    this.edges.push({ mat: m, base: op });
    return l;
  };
  Model.prototype.dots = function (arr, size, opacity, parent) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    var m = pointsMat(size, opacity);
    var p = new THREE.Points(g, m);
    (parent || this.group).add(p);
    this.points.push({ mat: m, base: opacity, size: size });
    return p;
  };

  // Car — drives the road ahead of the camera ----------------------------
  var car = new Model([5, GRID_Y, -16], [0, 0, 0], false);
  (function () {
    var s = new THREE.Shape();           // side profile: x = length, y = height
    s.moveTo(-2.2, 0.35); s.lineTo(2.2, 0.35); s.lineTo(2.25, 0.8); s.lineTo(1.35, 0.9);
    s.lineTo(0.7, 1.45); s.lineTo(-0.85, 1.48); s.lineTo(-1.6, 0.95); s.lineTo(-2.25, 0.85); s.lineTo(-2.2, 0.35);
    var bodyGeo = new THREE.ExtrudeGeometry(s, { depth: 1.9, bevelEnabled: false });
    bodyGeo.translate(0, 0, -0.95);
    var body = car.part(bodyGeo, [0, 0, 0], [0, -Math.PI / 2, 0], 0.7);
    // windows: belt line + pillars
    car.lines([
      -0.95, 0.9, 1.35, -0.95, 0.9, -0.85,   // belt left
       0.95, 0.9, 1.35,  0.95, 0.9, -0.85,   // belt right
      -0.95, 0.9, 1.35, -0.95, 1.45, 0.7,    // A pillar
       0.95, 0.9, 1.35,  0.95, 1.45, 0.7,
      -0.95, 0.9, -0.85, -0.95, 1.48, -0.85, // C pillar
       0.95, 0.9, -0.85,  0.95, 1.48, -0.85
    ], 0.45);
    // wheels
    car.wheels = [];
    [[-1.0, 1.45], [1.0, 1.45], [-1.0, -1.45], [1.0, -1.45]].forEach(function (w) {
      var wg = new THREE.Group();
      wg.position.set(w[0], 0.42, w[1]);
      car.group.add(wg);
      car.part(new THREE.CylinderGeometry(0.42, 0.42, 0.26, 14), [0, 0, 0], [0, 0, Math.PI / 2], 0.7, wg);
      car.lines([0, 0.42, 0, 0, -0.42, 0, 0, 0, 0.42, 0, 0, -0.42, 0, 0.3, 0.3, 0, -0.3, -0.3, 0, 0.3, -0.3, 0, -0.3, 0.3], 0.35, wg);
      car.wheels.push(wg);
    });
    // headlights + tail lights
    car.dots([-0.7, 0.62, 2.22, 0.7, 0.62, 2.22], 0.34, 1);
    car.dots([-0.75, 0.6, -2.22, 0.75, 0.6, -2.22], 0.22, 0.7);
    car.group.scale.setScalar(1.3);
    car.radius = 3;
  })();

  // Neural network -------------------------------------------------------
  var nn = new Model([-10.5, 4, -70], [0.15, 0.55, 0]);
  (function () {
    var layers = [3, 5, 6, 5, 2], gapX = 2.4, gapY = 1.25, nodes = [], coords = [];
    layers.forEach(function (n, li) {
      var col = [];
      for (var k = 0; k < n; k++) {
        var p = [li * gapX - (layers.length - 1) * gapX / 2, (k - (n - 1) / 2) * gapY, 0];
        col.push(p); nodes.push(p[0], p[1], p[2]);
      }
      coords.push(col);
    });
    var links = [];
    for (var li = 0; li < coords.length - 1; li++) coords[li].forEach(function (a) { coords[li + 1].forEach(function (b) { links.push(a[0], a[1], a[2], b[0], b[1], b[2]); }); });
    nn.lines(links, 0.16);
    nn.dots(nodes, 0.5, 0.95);
    nn.radius = 5;
  })();

  // Robot — stands on the road -------------------------------------------
  var robot = new Model([-8.5, GRID_Y, -104], [0, 0.7, 0]);
  (function () {
    var S = 1.45;
    function box(w, h, d, x, y, z, op) { return robot.part(new THREE.BoxGeometry(w * S, h * S, d * S), [x * S, y * S, z * S], null, op == null ? 0.55 : op); }
    box(0.85, 0.75, 0.75, 0, 3.05, 0);          // head
    box(1.3, 1.5, 0.7, 0, 1.9, 0);              // torso
    box(1.0, 0.3, 0.6, 0, 1.0, 0);              // pelvis
    box(0.3, 1.3, 0.3, -0.95, 1.85, 0);         // arms
    box(0.3, 1.3, 0.3, 0.95, 1.85, 0);
    box(0.38, 1.3, 0.4, -0.35, 0.65, 0);        // legs
    box(0.38, 1.3, 0.4, 0.35, 0.65, 0);
    box(0.5, 0.12, 0.6, -0.35, 0.02, 0.1);      // feet
    box(0.5, 0.12, 0.6, 0.35, 0.02, 0.1);
    robot.lines([0, 3.43 * S, 0, 0, 3.95 * S, 0], 0.5);            // antenna
    robot.dots([0, 3.95 * S, 0], 0.3, 1);
    robot.dots([-0.2 * S, 3.12 * S, 0.38 * S, 0.2 * S, 3.12 * S, 0.38 * S], 0.3, 1); // eyes
    robot.lines([-0.45 * S, 2.35 * S, 0.36 * S, 0.45 * S, 2.35 * S, 0.36 * S, -0.45 * S, 2.35 * S, 0.36 * S, -0.45 * S, 1.45 * S, 0.36 * S], 0.3); // chest panel
    robot.radius = 4;
  })();

  // CubeSat --------------------------------------------------------------
  var cubesat = new Model([-7.5, 2.8, -130], [0.35, 0.6, 0.15]);
  (function () {
    cubesat.part(new THREE.BoxGeometry(1, 1, 2.2), null, null, 0.6);
    cubesat.part(new THREE.BoxGeometry(3.2, 1.05, 0.04), [2.2, 0, 0], null, 0.55);
    cubesat.part(new THREE.BoxGeometry(3.2, 1.05, 0.04), [-2.2, 0, 0], null, 0.55);
    var cells = [];
    for (var px = -3.7; px <= 3.7; px += 0.5) if (Math.abs(px) > 0.6) cells.push(px, -0.52, 0, px, 0.52, 0);
    cubesat.lines(cells, 0.25);
    cubesat.part(new THREE.ConeGeometry(0.55, 0.35, 12, 1, true), [0, 0.85, -0.4], null, 0.45);
    cubesat.radius = 4;
  })();

  // Dish satellite --------------------------------------------------------
  var dishsat = new Model([-12, 5, -172], [0.2, 0.9, -0.1]);
  (function () {
    dishsat.part(new THREE.CylinderGeometry(0.9, 0.9, 2.6, 8), null, [Math.PI / 2, 0, 0], 0.6);            // bus, axis along z
    dishsat.part(new THREE.SphereGeometry(2.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), [0, 0, 2.6], [-Math.PI / 2, 0, 0], 0.5); // dish
    dishsat.lines([0, 0, 1.3, 0, 0, 3.9], 0.5);                                                                   // feed boom
    dishsat.part(new THREE.ConeGeometry(0.3, 0.5, 8), [0, 0, 3.9], [-Math.PI / 2, 0, 0], 0.5);                    // feed horn
    dishsat.lines([0, 0.9, 0, 0, 3.0, 0, 0, -0.9, 0, 0, -3.0, 0], 0.5);                                           // panel booms
    dishsat.part(new THREE.BoxGeometry(2.2, 5.2, 0.04), [0, 5.6, 0], null, 0.55);                                 // panels
    dishsat.part(new THREE.BoxGeometry(2.2, 5.2, 0.04), [0, -5.6, 0], null, 0.55);
    var cells = [];
    for (var py = 3.2; py <= 8.0; py += 0.6) cells.push(-1.1, py, 0, 1.1, py, 0, -1.1, -py, 0, 1.1, -py, 0);
    dishsat.lines(cells, 0.22);
    dishsat.part(new THREE.TorusGeometry(1.25, 0.03, 4, 28), [0, 0, -1.4], null, 0.45);                            // aft ring
    dishsat.radius = 7;
  })();

  // Theme ---------------------------------------------------------------
  function applyTheme() {
    var cs = getComputedStyle(document.documentElement);
    ink.set(cs.getPropertyValue('--ink').trim() || '#f2f2f0');
    bg.set(cs.getPropertyValue('--bg').trim() || '#0b0b0c');
    scene.fog.color.copy(bg);
    materials.forEach(function (m) { m.color.copy(ink); });
    requestRender();
  }
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  // Scroll & pointer ----------------------------------------------------
  var target = 0, progress = 0, mx = 0, my = 0, smx = 0, smy = 0;
  function onScroll() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    target = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
    requestRender();
  }
  function onPointer(e) {
    mx = (e.clientX / window.innerWidth - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
    requestRender();
  }
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    onScroll();
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', resize);
  if (!small) window.addEventListener('pointermove', onPointer, { passive: true });

  // Render loop ---------------------------------------------------------
  var needsRender = true, running = false, lastZ = 0, clock = 0;
  function requestRender() { needsRender = true; if (!running) loop(); }

  function frame() {
    progress += (target - progress) * (reduceMotion ? 1 : 0.07);
    smx += (mx - smx) * 0.05;
    smy += (my - smy) * 0.05;
    clock += 1 / 60;

    var z = -progress * PATH;
    var camX = Math.sin(progress * Math.PI * 2) * 2.2 + smx * 0.8;
    camera.position.set(camX, 1.4 + Math.sin(progress * Math.PI * 3) * 0.6 - smy * 0.5, z);
    camera.lookAt(camX * 0.6 + smx * 1.5, camera.position.y - 0.3 - smy * 0.8, z - 30);

    // Car keeps pace ahead on the road, wheels turn with distance travelled
    var dz = z - lastZ; lastZ = z;
    car.group.position.set(camX * 0.5 + (small ? 3.4 : 6.2), GRID_Y + 0.02, z - 16);
    car.group.rotation.y = -(camX * 0.5) * 0.02;
    car.wheels.forEach(function (w) { w.rotation.x -= dz / 0.42; });

    // Models resolve from point cloud to wireframe as the camera approaches
    for (var i = 0; i < models.length; i++) {
      var m = models[i];
      if (!m.resolve) continue;
      var d = m.group.position.z - z;                 // negative when ahead
      var t = 1 - Math.min(Math.max((-d - m.radius * 2) / 45, 0), 1);
      var tt = t * t;
      for (var k = 0; k < m.edges.length; k++) m.edges[k].mat.opacity = m.edges[k].base * (0.12 + 0.88 * tt);
      for (var q = 0; q < m.points.length; q++) { m.points[q].mat.opacity = m.points[q].base * (1 - 0.55 * tt); m.points[q].mat.size = m.points[q].size * (1 - 0.35 * tt); }
    }

    if (!reduceMotion) {
      nn.group.rotation.y += 0.0025;
      robot.group.rotation.y = 0.7 + Math.sin(clock * 0.6) * 0.35;
      cubesat.group.rotation.y += 0.0012; cubesat.group.rotation.z += 0.0004;
      dishsat.group.rotation.y += 0.0008; dishsat.group.rotation.x += 0.0003;
    }

    renderer.render(scene, camera);
  }

  function loop() {
    running = true;
    var settled = Math.abs(target - progress) < 0.0005 && Math.abs(mx - smx) < 0.002 && Math.abs(my - smy) < 0.002;
    if (reduceMotion && settled && !needsRender) { running = false; return; }
    needsRender = false;
    frame();
    requestAnimationFrame(loop);
  }

  applyTheme();
  resize();
  loop();
})();
