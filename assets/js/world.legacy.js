/* A local, offline-capable Three.js world. No network imports or JSON fetching. */
(function () {
  'use strict';
  const lib = window.WORLD_LIB;
  if (!lib) return;
  const { THREE: T, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoomEnvironment } = lib;
  const TAU = Math.PI * 2;
  const mobile = matchMedia('(max-width: 700px)').matches || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const items = window.SITE_DATA.items;
  const loadScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
  });
  function textureFromImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => { const map = new T.Texture(image); map.colorSpace = T.SRGBColorSpace; map.needsUpdate = true; resolve(map); };
      image.onerror = reject; image.src = url;
    });
  }
  class World {
    constructor(container, callbacks) {
      this.callbacks = callbacks;
      this.container = container;
      this.lowQuality = Boolean(mobile);
      this.motion = !reducedMotion.matches;
      this.time = 0; this.frames = []; this.labels = []; this.pickables = []; this.texturePromises = new Map(); this.accentMaterials = [];
      this.view = 'home'; this.flight = null; this.running = true; this.ready = false; this.gyro = false; this.visibleSeconds = 0;
      this.renderer = new T.WebGLRenderer({ antialias: !mobile, alpha: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1 : 1.6));
      this.renderer.setSize(innerWidth, innerHeight);
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.08;
      this.renderer.setClearColor(0x10091f, 0);
      this.renderer.domElement.setAttribute('aria-label', '小白的3D星球：拖动旋转，滚轮缩放，点击发光画框查看作品');
      this.renderer.domElement.setAttribute('tabindex', '0');
      container.appendChild(this.renderer.domElement);
      this.scene = new T.Scene();
      this.scene.fog = new T.FogExp2(0x27163c, .007);
      this.camera = new T.PerspectiveCamera(innerWidth < 700 ? 53 : 44, innerWidth / innerHeight, .1, 300);
      const home = this.getView('home'); this.camera.position.fromArray(home.position);
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.fromArray(home.target);
      this.controls.enableDamping = true; this.controls.dampingFactor = .07; this.controls.enablePan = false;
      this.controls.minDistance = 6; this.controls.maxDistance = 100; this.controls.maxPolarAngle = Math.PI * .49; this.controls.minPolarAngle = .15;
      this.controls.rotateSpeed = .5; this.controls.zoomSpeed = .65;
      this.controls.addEventListener('start', () => { this.flight = null; this.gyroBase = null; this.manualGesture = true; this.lastInteraction = performance.now(); });
      this.controls.addEventListener('end', () => { this.manualGesture = false; this.gyroBase = null; });
      this.controls.update();
      const envScene = new RoomEnvironment();
      const pmrem = new T.PMREMGenerator(this.renderer);
      this.environment = pmrem.fromScene(envScene, .04); this.scene.environment = this.environment.texture;
      envScene.dispose(); pmrem.dispose();
      this.ambient = new T.HemisphereLight(0xf4d1ff, 0x3a2067, 1.4); this.scene.add(this.ambient);
      this.key = new T.DirectionalLight(0xffb8df, 2.2); this.key.position.set(-15, 25, 20); this.scene.add(this.key);
      this.fill = new T.PointLight(0x8bcaff, 65, 90, 1.4); this.fill.position.set(20, 13, 10); this.scene.add(this.fill);
      this.pinkLight = new T.PointLight(0xff5bad, 55, 70, 1.4); this.pinkLight.position.set(-12, 6, 16); this.scene.add(this.pinkLight);
      this.raycaster = new T.Raycaster(); this.pointer = new T.Vector2(); this.frustum = new T.Frustum(); this.matrix = new T.Matrix4();
      this.createCore(); this.createIslands(); this.createEnvironment(); this.createEvents();
      this.composer = null;
      if (!this.lowQuality) {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new T.Vector2(innerWidth * .65, innerHeight * .65), .42, .65, 1.18);
        this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
      }
      this.clock = new T.Clock();
      this.performanceWindow = { duration: 0, frames: 0, windows: 0 };
      this.setTheme(document.documentElement.dataset.theme || 'night');
      this.animate = this.animate.bind(this); this.raf = requestAnimationFrame(this.animate);
      this.ready = true;
      this.loadAtlas();
      setTimeout(() => this.callbacks.ready(), 120);
    }
    getView(name) {
      const narrow = innerWidth < 700;
      const views = {
        home: { position: narrow ? [0, 23, 67] : [-4, 20, 53], target: narrow ? [0, 8, 0] : [-8, 7, 0] },
        featured: { position: [0, 11, 42], target: [0, 4, 22] },
        works: { position: [-20, 10, narrow ? 24 : 11], target: [-20, 5, -20] },
        videos: { position: [20, 11, narrow ? 26 : 11], target: [20, 6, -22] },
        about: { position: [-32, 10, 35], target: [-32, 4, 18] },
        follow: { position: [32, 10, 35], target: [32, 4, 18] }
      };
      return views[name] || views.home;
    }
    metal(color, extra = {}) { return new T.MeshStandardMaterial({ color, metalness: .64, roughness: .29, ...extra }); }
    glow(color, intensity = 2) { const mat = this.metal(color, { emissive: color, emissiveIntensity: intensity, metalness: .3 }); this.accentMaterials.push(mat); return mat; }
    mesh(geo, mat, position, parent = this.scene) { const m = new T.Mesh(geo, mat); if (position) m.position.fromArray(position); parent.add(m); return m; }
    ring(radius, tube, color, position, parent = this.scene, intensity = 2) {
      const ring = this.mesh(new T.TorusGeometry(radius, tube, 8, mobile ? 80 : 144), this.glow(color, intensity), position, parent);
      ring.rotation.x = Math.PI / 2; return ring;
    }
    createCore() {
      this.core = new T.Group(); this.core.position.set(0, 9.5, 0); this.scene.add(this.core);
      const sphereMat = this.metal(0xc7b4ce, { roughness: .55, metalness: .15, envMapIntensity: .4, emissive: 0xffffff, emissiveIntensity: .3 });
      // The LED grid is applied to the actual spherical cover surface, not a flat overlay.
      this.sphereUniforms = { time: { value: 0 }, night: { value: 1 } };
      sphereMat.onBeforeCompile = (shader) => {
        shader.uniforms.uWorldTime = this.sphereUniforms.time;
        shader.uniforms.uNight = this.sphereUniforms.night;
        shader.fragmentShader = 'uniform float uWorldTime; uniform float uNight;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          #ifdef USE_MAP
            vec2 led = fract(vMapUv * vec2(680.0, 310.0));
            float dots = smoothstep(0.49, 0.30, length(led - 0.5));
            vec2 tile = fract(vMapUv * vec2(12.0, 7.0));
            float seam = smoothstep(0.0, 0.026, min(min(tile.x, 1.0-tile.x),min(tile.y,1.0-tile.y)));
            diffuseColor.rgb *= mix(0.57, 1.0, dots) * mix(0.3, 1.0, seam);
            float scan = pow(0.5 + 0.5 * sin(vMapUv.y * 28.0 - uWorldTime * 1.3), 20.0);
            diffuseColor.rgb += vec3(0.05,0.02,0.055) * scan * uNight;
          #endif`);
      };
      this.sphere = this.mesh(new T.SphereGeometry(8.15, mobile ? 48 : 96, mobile ? 32 : 64), sphereMat, [0, 0, 0], this.core);
      this.sphere.userData.sphere = true; this.pickables.push(this.sphere);
      const shell = this.mesh(new T.SphereGeometry(8.27, 40, 28), new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending,
        uniforms: { color: { value: new T.Color(0xdc64ff) } },
        vertexShader: 'varying vec3 vNormal; varying vec3 vView; void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
        fragmentShader: 'uniform vec3 color;varying vec3 vNormal;varying vec3 vView;void main(){float rim=pow(1.0-max(0.0,dot(normalize(vNormal),normalize(vView))),3.5);gl_FragColor=vec4(color*1.7,rim*.7);}'
      }), [0, 0, 0], this.core); this.shell = shell;
      this.ring(8.22, .025, 0xff85c9, [0, 0, 0], this.core, 1.8);
      this.ring(8.3, .05, 0xb187ff, [0, .45, 0]);
      this.mesh(new T.CylinderGeometry(8.2, 9.3, .65, 80), this.metal(0x302040), [0, 0, 0]);
      this.ring(9.3, .055, 0xffa6d4, [0, -.2, 0]);
      this.ring(10.7, .027, 0xb899ff, [0, -.55, 0], this.scene, 1);
      this.orbit = new T.Group(); this.orbit.position.set(0, 9.5, 0); this.orbit.rotation.z = -.17; this.orbit.rotation.x = .1; this.scene.add(this.orbit);
      this.ring(10.8, .022, 0xe8b0e6, [0, 0, 0], this.orbit, .6);
      ['娃娃开箱', '测评分享', 'GBC', 'chiikawa'].forEach((label, i) => {
        const angle = i * Math.PI / 2 + .5;
        const anchor = new T.Object3D(); anchor.position.set(Math.cos(angle) * 10.8, .1, Math.sin(angle) * 10.8); this.orbit.add(anchor);
        this.label(label, anchor, () => this.callbacks.category(label), 'category-label');
      });
      const caption = new T.Object3D(); caption.position.set(0, 19, 0); this.scene.add(caption); this.label('每一份喜欢 · 正在发光', caption, null, 'sphere-caption');
    }
    async loadAtlas() {
      try {
        await loadScript('assets/textures/sphere.js');
        const texture = await textureFromImage(window.SPHERE_ATLAS.image);
        texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
        this.sphere.material.map = texture; this.sphere.material.emissiveMap = texture; this.sphere.material.needsUpdate = true;
        this.atlasReady = true;
        window.SPHERE_ATLAS.image = null;
      } catch { this.callbacks.notice('球面封面暂未载入，可以继续浏览作品岛。'); }
    }
    label(text, anchor, action, className = '', small = '') {
      const element = document.createElement(action ? 'button' : 'div'); element.className = `world-label ${className}`;
      const dot = document.createElement('span'); dot.className = 'dot'; element.append(dot);
      const title = document.createElement('span'); title.textContent = text; element.append(title);
      if (small) { const count = document.createElement('small'); count.textContent = small; element.append(count); }
      if (action) element.addEventListener('click', action);
      document.getElementById('world-labels').append(element);
      this.labels.push({ element, anchor, className });
    }
    createIslands() {
      this.islands = {};
      this.panelGeometry = new T.PlaneGeometry(2.48, 1.86);
      this.borderGeometry = new T.BoxGeometry(2.68, 2.06, .14);
      this.standGeometry = new T.CylinderGeometry(.025, .025, .85, 5);
      this.frameMat = this.glow(0xcba5e5, .32);
      const definitions = [
        { key: 'works', name: '小红书岛', position: [-20, 0, -20], color: 0xff92c7, radius: 12.5, scale: .86, list: items.filter(x => x.platform === 'xhs'), cols: 8, small: '32 件作品' },
        { key: 'videos', name: 'B 站岛', position: [20, -.4, -22], color: 0x7bccff, radius: 12.5, scale: .86, list: items.filter(x => x.platform === 'bili'), cols: 7, small: '42 条视频' },
        { key: 'featured', name: '精选岛', position: [0, -.3, 21], color: 0xeaa1e1, radius: 7.5, scale: .85, list: window.SITE_DATA.featuredIds.map(id => items.find(x => x.id === id)), cols: 3, small: '小白的心头好' }
      ];
      for (const def of definitions) {
        const group = new T.Group(); group.position.fromArray(def.position); group.scale.setScalar(def.scale); this.scene.add(group); this.islands[def.key] = group;
        const deck = this.mesh(new T.CylinderGeometry(def.radius, def.radius * .82, .8, 64), this.metal(0x453254, { metalness: .75 }), [0, -.3, 0], group); deck.scale.z = .62;
        const under = this.mesh(new T.ConeGeometry(def.radius * .86, 3.2, 8), this.metal(0x322542, { flatShading: true }), [0, -2.15, 0], group); under.rotation.z = Math.PI; under.scale.z = .62;
        const rim = this.ring(def.radius, .045, def.color, [0, .14, 0], group, 1.8); rim.scale.y = .62;
        const lower = this.ring(def.radius * .88, .018, def.color, [0, -.85, 0], group, .9); lower.scale.y = .62;
        const inner = this.ring(def.radius * .72, .015, def.color, [0, .13, 0], group, .5); inner.scale.y = .62;
        const anchor = new T.Object3D(); anchor.position.set(0, 1, def.radius * .65 + 1.2); group.add(anchor);
        this.label(def.name, anchor, () => this.callbacks.portal(def.key), '', def.small);
        const rows = Math.ceil(def.list.length / def.cols);
        def.list.forEach((item, i) => {
          const col = i % def.cols, row = Math.floor(i / def.cols);
          const x = (col - (def.cols - 1) / 2) * 2.95;
          const y = 2 + (rows - 1 - row) * 2.5;
          const z = -1.8 + Math.abs(x) * .17 + (def.key === 'featured' ? 0 : row * .5);
          const groupFrame = new T.Group(); groupFrame.position.set(x, y, z); groupFrame.rotation.y = -x * .009; group.add(groupFrame);
          const borderMat = this.frameMat.clone(); borderMat.color.set(def.color); borderMat.emissive.set(def.color); borderMat.envMapIntensity = .2;
          const border = this.mesh(this.borderGeometry, borderMat, [0, 0, -.09], groupFrame);
          const mat = new T.MeshBasicMaterial({ color: 0x5d426f });
          const picture = this.mesh(this.panelGeometry, mat, [0, 0, .01], groupFrame);
          picture.userData.item = item; this.pickables.push(picture);
          const frame = { item, group: groupFrame, picture, border, island: def.key, loaded: false, requested: false, initialY: y };
          this.frames.push(frame);
          this.mesh(this.standGeometry, this.metal(0x967fa8), [0, -1.4, 0], groupFrame);
        });
      }
      for (const [key, x, label] of [['about', -32, '关于小白'], ['follow', 32, '关注小白']]) {
        const group = new T.Group(); group.position.set(x, 0, 18); this.scene.add(group);
        this.mesh(new T.CylinderGeometry(4, 3.3, .7, 48), this.metal(0x493153), [0, 0, 0], group);
        this.ring(4, .05, key === 'about' ? 0xffb1d8 : 0x97d6ff, [0, .4, 0], group);
        const portal = this.ring(2.5, .09, 0xc798ff, [0, 3, 0], group); portal.rotation.x = 0;
        const inner = this.mesh(new T.CircleGeometry(2.35, 48), new T.MeshBasicMaterial({ color: 0xc397ff, transparent: true, opacity: .08, side: T.DoubleSide, depthWrite: false }), [0, 3, 0], group);
        inner.userData.portal = key; this.pickables.push(inner);
        const anchor = new T.Object3D(); anchor.position.set(0, 6.5, 0); group.add(anchor); this.label(label, anchor, () => this.callbacks.portal(key));
      }
    }
    createEnvironment() {
      this.sky = this.mesh(new T.SphereGeometry(145, 24, 16), new T.ShaderMaterial({
        side: T.BackSide, depthWrite: false,
        uniforms: { day: { value: 0 } },
        vertexShader: 'varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform float day;varying vec3 vPos;void main(){
          vec3 p=normalize(vPos);float nebula=exp(-pow((p.y-.12)*3.2,2.0))*pow(.5+.5*sin(p.x*3.0+p.z*2.0+.6),2.0);
          float cloud=.6+.4*sin(p.x*9.0+sin(p.z*7.0)+p.y*11.0);
          vec3 night=mix(vec3(.028,.018,.064),vec3(.18,.065,.20),nebula*.7*cloud);
          vec3 morning=mix(vec3(.53,.64,.85),vec3(.97,.74,.88),.55+.35*nebula);
          gl_FragColor=vec4(mix(night,morning,day),1.0);
        }`
      }), [0, 0, 0]); this.sky.renderOrder = -100;
      const count = mobile ? 450 : 1400;
      const positions = new Float32Array(count * 3); const colors = new Float32Array(count * 3);
      let seed = 731;
      const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      for (let i = 0; i < count; i++) {
        positions.set([(random() - .5) * 180, random() * 95 - 18, (random() - .5) * 150 - 20], i * 3);
        const color = new T.Color().setHSL(.7 + random() * .2, .38, .72 + random() * .28); colors.set(color.toArray(), i * 3);
      }
      const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(positions, 3)); geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
      this.stars = new T.Points(geometry, new T.PointsMaterial({ size: .14, vertexColors: true, transparent: true, opacity: .9, depthWrite: false, blending: T.AdditiveBlending })); this.scene.add(this.stars);
      const haloGeo = new T.BufferGeometry(); const haloPos = [];
      for (let i = 0; i < (mobile ? 140 : 420); i++) { const a = random() * TAU, r = 11 + random() * 9; haloPos.push(Math.cos(a) * r, (random() - .5) * 7 + 4, Math.sin(a) * r); }
      haloGeo.setAttribute('position', new T.Float32BufferAttribute(haloPos, 3));
      this.halo = new T.Points(haloGeo, new T.PointsMaterial({ color: 0xffb4e6, size: .065, transparent: true, opacity: .75, depthWrite: false, blending: T.AdditiveBlending })); this.scene.add(this.halo);
      this.bubbles = new T.Group(); this.scene.add(this.bubbles);
      const bubbleGeo = new T.SphereGeometry(1, 18, 12);
      const bubbleMat = new T.MeshPhysicalMaterial({ color: 0xe6b3ec, metalness: .1, roughness: .12, clearcoat: 1, transparent: true, opacity: .16, envMapIntensity: 2, depthWrite: false });
      for (let i = 0; i < (mobile ? 12 : 28); i++) {
        const bubble = this.mesh(bubbleGeo, bubbleMat, [(random() - .5) * 95, random() * 35 + 1, (random() - .5) * 55], this.bubbles);
        bubble.scale.setScalar(.12 + random() * .8); bubble.userData.baseY = bubble.position.y; bubble.userData.phase = random() * TAU;
      }
      this.beams = new T.Group(); this.scene.add(this.beams);
      for (let i = 0; i < 8; i++) {
        const angle = i / 8 * TAU; const beamMat = new T.ShaderMaterial({
          transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
          uniforms: { color: { value: new T.Color(i % 2 ? 0xa078ff : 0xff7bbc) }, strength: { value: .08 } },
          vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader: 'uniform vec3 color;uniform float strength;varying vec2 vUv;void main(){float falloff=pow(1.0-vUv.y,1.9);gl_FragColor=vec4(color,falloff*strength);}'
        });
        const beam = this.mesh(new T.CylinderGeometry(2.2, .04, 32, 24, 1, true), beamMat, [Math.cos(angle) * 13, 13, Math.sin(angle) * 13], this.beams);
        beam.rotation.z = Math.cos(angle) * .24; beam.rotation.x = Math.sin(angle) * .24;
      }
      const pathPoints = [];
      for (let i = 0; i < 500; i++) { const a = i / 500 * TAU; pathPoints.push(Math.cos(a) * 28, -1.3, Math.sin(a) * 24); }
      const pathGeo = new T.BufferGeometry(); pathGeo.setAttribute('position', new T.Float32BufferAttribute(pathPoints, 3));
      this.path = new T.Points(pathGeo, new T.PointsMaterial({ color: 0xeaa6ff, size: .07, transparent: true, opacity: .75 })); this.scene.add(this.path);
    }
    createEvents() {
      const canvas = this.renderer.domElement;
      let down = null;
      canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, time: performance.now() }; });
      canvas.addEventListener('pointerup', (e) => {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7 || performance.now() - down.time > 600) { down = null; return; }
        down = null; const hit = this.hit(e.clientX, e.clientY);
        if (!hit) return;
        if (hit.object.userData.portal) this.callbacks.portal(hit.object.userData.portal);
        else { const item = this.itemForHit(hit); if (item) this.callbacks.select(item); }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch' || down) return;
        const hit = this.hit(e.clientX, e.clientY); const item = hit && this.itemForHit(hit);
        canvas.style.cursor = hit ? 'pointer' : 'grab'; this.callbacks.hover(item, e.clientX, e.clientY);
      });
      canvas.addEventListener('pointerleave', () => { down = null; this.callbacks.hover(null); });
      canvas.addEventListener('pointercancel', () => { down = null; });
      canvas.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && this.focusedItem) { this.callbacks.select(this.focusedItem); e.preventDefault(); return; }
        if (e.key === '+' || e.key === '=') { this.zoom(.85); e.preventDefault(); }
        if (e.key === '-') { this.zoom(1.18); e.preventDefault(); }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          this.flight = null; this.gyroBase = null; this.lastInteraction = performance.now(); const offset = this.camera.position.clone().sub(this.controls.target); const spherical = new T.Spherical().setFromVector3(offset);
          spherical.theta += e.key === 'ArrowLeft' ? -.12 : e.key === 'ArrowRight' ? .12 : 0;
          spherical.phi = T.MathUtils.clamp(spherical.phi + (e.key === 'ArrowUp' ? -.08 : e.key === 'ArrowDown' ? .08 : 0), .15, Math.PI * .49);
          this.camera.position.copy(this.controls.target).add(new T.Vector3().setFromSpherical(spherical)); e.preventDefault();
        }
      });
      this.onResize = () => {
        this.camera.aspect = innerWidth / innerHeight; this.camera.fov = innerWidth < 700 ? 53 : 44; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); if (this.composer) this.composer.setSize(innerWidth, innerHeight);
        if (this.view === 'home' && !this.lastInteraction && !this.flight) { const home = this.getView('home'); this.camera.position.fromArray(home.position); this.controls.target.fromArray(home.target); }
      };
      addEventListener('resize', this.onResize);
      canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); this.stop(); this.callbacks.fallback('3D 画面已暂停，先在轻量展馆里继续逛逛。'); });
      this.onReducedMotion = (event) => { this.motion = !event.matches; this.callbacks.motion(this.motion); };
      reducedMotion.addEventListener('change', this.onReducedMotion);
    }
    hit(x, y) {
      this.pointer.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      return this.raycaster.intersectObjects(this.pickables, false)[0];
    }
    itemForHit(hit) {
      if (hit.object.userData.item) return hit.object.userData.item;
      if (hit.object.userData.sphere && this.atlasReady) {
        const uv = hit.uv; const atlas = window.SPHERE_ATLAS;
        const col = Math.min(atlas.columns - 1, Math.floor(uv.x * atlas.columns));
        const row = Math.min(atlas.rows - 1, Math.floor((1 - uv.y) * atlas.rows));
        return items[(row * atlas.columns + col) % items.length];
      }
      return null;
    }
    async loadFrame(frame) {
      frame.requested = true;
      frame.attempts = (frame.attempts || 0) + 1;
      try {
        if (!this.texturePromises.has(frame.item.id)) this.texturePromises.set(frame.item.id, (async () => {
          await loadScript(frame.item.texture);
          const texture = await textureFromImage(window.SITE_TEXTURES[frame.item.id]);
          texture.anisotropy = this.lowQuality ? 1 : 4;
          delete window.SITE_TEXTURES[frame.item.id];
          return texture;
        })());
        const texture = await this.texturePromises.get(frame.item.id);
        frame.picture.material.map = texture; frame.picture.material.color.set(0xffffff); frame.picture.material.needsUpdate = true; frame.loaded = true;
        const labelCanvas = document.createElement('canvas'); labelCanvas.width = 768; labelCanvas.height = 90;
        const ctx = labelCanvas.getContext('2d');
        ctx.fillStyle = 'rgba(24,14,38,.90)'; ctx.fillRect(0, 0, 768, 90);
        ctx.font = '32px "Microsoft YaHei",system-ui,sans-serif'; ctx.fillStyle = '#fff0fd'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        let title = frame.item.title;
        while (title.length > 1 && ctx.measureText(title).width > 715) title = title.slice(0, -2) + '…';
        ctx.fillText(title, 384, 45);
        const labelTexture = new T.CanvasTexture(labelCanvas); labelTexture.colorSpace = T.SRGBColorSpace;
        this.mesh(new T.PlaneGeometry(2.48, .29), new T.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false }), [0, -1.12, .02], frame.group);
      } catch {
        this.texturePromises.delete(frame.item.id);
        frame.requested = frame.attempts >= 2;
        if (frame.attempts >= 2) { this.failedTextures = (this.failedTextures || 0) + 1; if (this.failedTextures === 3) { this.stop(); this.callbacks.fallback('部分3D封面未载入，已为你打开完整作品列表。'); } }
      }
    }
    updateVisible() {
      this.matrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.matrix);
      let loads = 0;
      for (const frame of this.frames) {
        if (frame.requested) continue;
        const point = frame.picture.getWorldPosition(new T.Vector3());
        if (this.frustum.containsPoint(point) && point.distanceTo(this.camera.position) < 105 && loads < (mobile ? 3 : 6)) { this.loadFrame(frame); loads++; }
      }
    }
    updateLabels() {
      const world = new T.Vector3();
      for (const label of this.labels) {
        label.anchor.getWorldPosition(world);
        const distance = this.camera.position.distanceTo(world);
        const pos = world.clone().project(this.camera);
        const occluded = label.className === 'category-label' && world.z < -3 && this.view === 'home';
        const behindIntro = this.view === 'home' && innerWidth > 700 && pos.x < -.34 && pos.y < .5;
        const behindMobileIntro = this.view === 'home' && innerWidth <= 700 && (-pos.y * .5 + .5) * innerHeight < 290;
        const inView = pos.z > -1 && pos.z < 1 && Math.abs(pos.x) < 1.15 && Math.abs(pos.y) < 1.05 && distance < 115 && !occluded && !behindIntro && !behindMobileIntro;
        label.element.hidden = !inView;
        if (inView) label.element.style.transform = `translate(${(pos.x * .5 + .5) * innerWidth}px,${(-pos.y * .5 + .5) * innerHeight}px) translate(-50%,-50%)`;
      }
    }
    flyTo(name, onDone) {
      const view = this.getView(name); this.view = name; this.focusedItem = null;
      this.startFlight(new T.Vector3(...view.position), new T.Vector3(...view.target), onDone);
    }
    startFlight(position, target, onDone) {
      this.gyroBase = null;
      this.flight = { fromPosition: this.camera.position.clone(), fromTarget: this.controls.target.clone(), position, target, start: performance.now(), duration: this.motion ? 1500 : 0, onDone };
    }
    focusItem(item) {
      const frame = this.frames.find(f => f.item.id === item.id && f.island !== 'featured') || this.frames.find(f => f.item.id === item.id);
      if (!frame) return;
      this.view = frame.island;
      const target = frame.group.getWorldPosition(new T.Vector3());
      const forward = new T.Vector3(0, .6, 7.5).applyQuaternion(frame.group.getWorldQuaternion(new T.Quaternion()));
      this.focusedItem = item;
      this.startFlight(target.clone().add(forward), target, () => this.renderer.domElement.focus({ preventScroll: true }));
      if (this.selectedFrame) this.selectedFrame.border.material.emissiveIntensity = .32;
      this.selectedFrame = frame; this.highlightUntil = performance.now() + 12000;
      if (!frame.requested) this.loadFrame(frame);
    }
    zoom(factor) {
      this.flight = null; this.gyroBase = null; this.lastInteraction = performance.now();
      const direction = this.camera.position.clone().sub(this.controls.target);
      direction.setLength(T.MathUtils.clamp(direction.length() * factor, this.controls.minDistance, this.controls.maxDistance));
      this.camera.position.copy(this.controls.target).add(direction); this.controls.update();
    }
    setTheme(theme) {
      const day = theme === 'day'; this.theme = theme;
      this.scene.fog.color.set(day ? 0xe3bbde : 0x27163c);
      this.scene.fog.density = day ? .008 : .007;
      this.ambient.color.set(day ? 0xffffff : 0xf4d1ff); this.ambient.groundColor.set(day ? 0xd4abcf : 0x3a2067); this.ambient.intensity = day ? 2.2 : 1.4;
      this.key.intensity = day ? 2.6 : 2.2; this.key.color.set(day ? 0xffe0ed : 0xffb8df);
      this.renderer.toneMappingExposure = day ? 1.06 : .94;
      this.sphere.material.emissiveIntensity = day ? .12 : .3; this.sphereUniforms.night.value = day ? 0 : 1;
      this.sky.material.uniforms.day.value = day ? 1 : 0;
      this.stars.material.opacity = day ? .3 : .9; this.halo.material.color.set(day ? 0xe17cbe : 0xffb4e6);
      this.shell.material.uniforms.color.value.set(day ? 0xffa4d6 : 0xdc64ff);
      this.beams.children.forEach(beam => { beam.material.uniforms.strength.value = day ? .025 : .08; });
      if (this.bloom) this.bloom.strength = day ? .18 : .42;
      this.scene.traverse(object => { if (object.isMesh && object.material.isMeshStandardMaterial && !object.material.emissiveMap && object.material.emissiveIntensity === 1 && object.material.emissive.getHex() === 0) object.material.envMapIntensity = day ? 1.5 : 1; });
    }
    setMotion(enabled) { this.motion = enabled; }
    setGyro(enabled) {
      this.gyro = enabled; this.gyroBase = null;
      if (!this.onOrientation) this.onOrientation = (event) => {
        if (!this.gyro || this.flight || this.manualGesture || event.beta == null || event.gamma == null || document.querySelector('dialog[open]')) return;
        if (!this.gyroReceived) { this.gyroReceived = true; this.callbacks.gyro(true); }
        if (!this.gyroBase) this.gyroBase = { beta: event.beta, gamma: event.gamma, offset: this.camera.position.clone().sub(this.controls.target) };
        const offset = this.gyroBase.offset.clone(); const spherical = new T.Spherical().setFromVector3(offset);
        spherical.theta -= T.MathUtils.degToRad(T.MathUtils.clamp(event.gamma - this.gyroBase.gamma, -30, 30)) * .45;
        spherical.phi = T.MathUtils.clamp(spherical.phi + T.MathUtils.degToRad(T.MathUtils.clamp(event.beta - this.gyroBase.beta, -30, 30)) * .3, .2, Math.PI * .48);
        this.camera.position.lerp(this.controls.target.clone().add(new T.Vector3().setFromSpherical(spherical)), .1);
      };
      clearTimeout(this.gyroTimeout); this.gyroReceived = false;
      if (enabled) {
        addEventListener('deviceorientation', this.onOrientation);
        this.gyroTimeout = setTimeout(() => { if (!this.gyroReceived) { this.setGyro(false); this.callbacks.gyro(false); this.callbacks.notice('未检测到感应数据，请继续用手指拖动。'); } }, 5000);
      } else removeEventListener('deviceorientation', this.onOrientation);
    }
    downgrade() {
      if (this.lowQuality) return;
      this.lowQuality = true; this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1)); this.renderer.setSize(innerWidth, innerHeight);
      if (this.composer) { this.composer.passes.forEach(pass => pass.dispose?.()); this.composer.dispose(); this.composer = null; }
      this.stars.geometry.setDrawRange(0, 450); this.callbacks.notice('已自动调低光效，继续轻松逛。');
    }
    animate() {
      if (!this.running) return;
      this.raf = requestAnimationFrame(this.animate);
      const rawDelta = this.clock.getDelta(); const delta = Math.min(rawDelta, .1);
      if (document.hidden) return;
      this.visibleSeconds += Math.min(rawDelta, .5);
      const now = performance.now();
      if (this.motion && !document.querySelector('dialog[open]')) {
        this.time += delta; this.sphere.rotation.y = this.time * .028; this.orbit.rotation.y = this.time * .045;
        this.sphereUniforms.time.value = this.time; this.halo.rotation.y = this.time * .018; this.stars.rotation.y = this.time * .0015;
        this.bubbles.children.forEach(b => { b.position.y = b.userData.baseY + Math.sin(this.time * .3 + b.userData.phase) * .45; });
        this.beams.rotation.y = Math.sin(this.time * .08) * .18;
      }
      if (this.flight) {
        const f = this.flight; const t = f.duration ? Math.min(1, (now - f.start) / f.duration) : 1; const ease = t * t * (3 - 2 * t);
        this.camera.position.lerpVectors(f.fromPosition, f.position, ease); this.controls.target.lerpVectors(f.fromTarget, f.target, ease);
        if (t === 1) { this.flight = null; f.onDone?.(); }
      }
      this.controls.update();
      if (this.selectedFrame) {
        this.selectedFrame.border.material.emissiveIntensity = now < this.highlightUntil ? 1.8 + (this.motion ? Math.sin(now * .005) * .45 : 0) : .32;
        if (now >= this.highlightUntil) this.selectedFrame = null;
      }
      if (!this.lastVisibility || now - this.lastVisibility > 160) { this.updateVisible(); this.lastVisibility = now; }
      this.updateLabels();
      try { if (this.composer) this.composer.render(delta); else this.renderer.render(this.scene, this.camera); }
      catch { this.stop(); this.callbacks.fallback('当前设备已切换到轻量展馆，全部作品仍可查看。'); return; }
      const stats = this.performanceWindow;
      if (this.visibleSeconds > 5 && !document.querySelector('dialog[open]')) {
        stats.duration += Math.min(rawDelta, .5); stats.frames++;
        if (stats.duration > 5) {
          const fps = stats.frames / stats.duration; stats.duration = 0; stats.frames = 0; stats.windows++;
          if (fps < 25 && !this.lowQuality) this.downgrade();
          else if (fps < 16 && this.lowQuality && stats.windows >= 3) { this.stop(); this.callbacks.fallback('这个设备更适合轻量展馆，作品已经为你铺开。'); }
        }
      }
    }
    stop() { this.running = false; cancelAnimationFrame(this.raf); }
  }
  window.XiaobaiWorld = World;
}());
