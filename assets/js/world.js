/* Local offline Three.js world. Textures stay in assets/textures as classic scripts. */
(function () {
  'use strict';
  const lib = window.WORLD_LIB;
  if (!lib) return;
  const { THREE: T, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoomEnvironment } = lib;
  const TAU = Math.PI * 2;
  const mobile = matchMedia('(max-width: 700px)').matches || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const items = window.SITE_DATA.items;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => { script.remove(); reject(new Error(src)); };
      document.head.appendChild(script);
    });
  }

  function textureFromImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const map = new T.Texture(image);
        map.colorSpace = T.SRGBColorSpace;
        map.needsUpdate = true;
        resolve(map);
      };
      image.onerror = reject;
      image.src = url;
    });
  }

  class World {
    constructor(container, callbacks) {
      this.callbacks = callbacks;
      this.container = container;
      this.lowQuality = Boolean(mobile);
      this.motion = !reducedMotion.matches;
      this.time = 0;
      this.frames = [];
      this.labels = [];
      this.pickables = [];
      this.texturePromises = new Map();
      this.view = 'home';
      this.flight = null;
      this.running = true;
      this.ready = false;
      this.gyro = false;
      this.visibleSeconds = 0;
      this.categoryHighlight = null;
      this.selectedFrame = null;
      this.focusedItem = null;
      this.scratch = { world: new T.Vector3(), pos: new T.Vector3(), point: new T.Vector3(), offset: new T.Vector3() };

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
      this.scene.fog = new T.FogExp2(0x27163c, 0.007);
      this.camera = new T.PerspectiveCamera(innerWidth < 700 ? 53 : 44, innerWidth / innerHeight, 0.1, 300);
      const home = this.getView('home');
      this.camera.position.fromArray(home.position);
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.fromArray(home.target);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.07;
      this.controls.enablePan = false;
      this.controls.minDistance = 6;
      this.controls.maxDistance = 100;
      this.controls.maxPolarAngle = Math.PI * 0.49;
      this.controls.minPolarAngle = 0.15;
      this.controls.rotateSpeed = 0.5;
      this.controls.zoomSpeed = 0.65;
      this.controls.addEventListener('start', () => {
        this.flight = null;
        this.gyroBase = null;
        this.manualGesture = true;
        this.lastInteraction = performance.now();
      });
      this.controls.addEventListener('end', () => {
        this.manualGesture = false;
        this.gyroBase = null;
      });
      this.controls.update();

      const envScene = new RoomEnvironment();
      const pmrem = new T.PMREMGenerator(this.renderer);
      this.environment = pmrem.fromScene(envScene, 0.04);
      this.scene.environment = this.environment.texture;
      envScene.dispose();
      pmrem.dispose();

      this.ambient = new T.HemisphereLight(0xf4d1ff, 0x3a2067, 1.4);
      this.scene.add(this.ambient);
      this.key = new T.DirectionalLight(0xffb8df, 2.2);
      this.key.position.set(-15, 25, 20);
      this.scene.add(this.key);
      this.fill = new T.PointLight(0x8bcaff, 65, 90, 1.4);
      this.fill.position.set(20, 13, 10);
      this.scene.add(this.fill);
      this.pinkLight = new T.PointLight(0xff5bad, 55, 70, 1.4);
      this.pinkLight.position.set(-12, 6, 16);
      this.scene.add(this.pinkLight);

      this.raycaster = new T.Raycaster();
      this.pointer = new T.Vector2();
      this.frustum = new T.Frustum();
      this.matrix = new T.Matrix4();
      this.createCore();
      this.createIslands();
      this.createEnvironment();
      this.createEvents();

      this.composer = null;
      if (!this.lowQuality) {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new T.Vector2(innerWidth * 0.65, innerHeight * 0.65), 0.42, 0.65, 1.18);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
      }
      this.clock = new T.Clock();
      this.performanceWindow = { duration: 0, frames: 0, windows: 0 };
      this.setTheme(document.documentElement.dataset.theme || 'night');
      this.animate = this.animate.bind(this);
      this.raf = requestAnimationFrame(this.animate);
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

    metal(color, extra = {}) {
      return new T.MeshStandardMaterial({ color, metalness: 0.64, roughness: 0.29, ...extra });
    }

    glow(color, intensity = 2) {
      return this.metal(color, { emissive: color, emissiveIntensity: intensity, metalness: 0.3 });
    }

    mesh(geo, mat, position, parent = this.scene) {
      const object = new T.Mesh(geo, mat);
      if (position) object.position.fromArray(position);
      parent.add(object);
      return object;
    }

    ring(radius, tube, color, position, parent = this.scene, intensity = 2) {
      const ring = this.mesh(new T.TorusGeometry(radius, tube, 8, mobile ? 80 : 144), this.glow(color, intensity), position, parent);
      ring.rotation.x = Math.PI / 2;
      return ring;
    }

    createCore() {
      this.core = new T.Group();
      this.core.position.set(0, 9.5, 0);
      this.scene.add(this.core);
      const sphereMat = this.metal(0xc7b4ce, { roughness: 0.55, metalness: 0.15, envMapIntensity: 0.4, emissive: 0xffffff, emissiveIntensity: 0.3 });
      this.sphereUniforms = { time: { value: 0 }, night: { value: 1 } };
      sphereMat.onBeforeCompile = (shader) => {
        shader.uniforms.uWorldTime = this.sphereUniforms.time;
        shader.uniforms.uNight = this.sphereUniforms.night;
        shader.fragmentShader = `uniform float uWorldTime; uniform float uNight;\n${shader.fragmentShader}`;
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
      this.sphere.userData.sphere = true;
      this.pickables.push(this.sphere);
      this.shell = this.mesh(new T.SphereGeometry(8.27, 40, 28), new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        uniforms: { color: { value: new T.Color(0xdc64ff) } },
        vertexShader: 'varying vec3 vNormal; varying vec3 vView; void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
        fragmentShader: 'uniform vec3 color;varying vec3 vNormal;varying vec3 vView;void main(){float rim=pow(1.0-max(0.0,dot(normalize(vNormal),normalize(vView))),3.5);gl_FragColor=vec4(color*1.7,rim*.7);}'
      }), [0, 0, 0], this.core);
      this.ring(8.22, 0.025, 0xff85c9, [0, 0, 0], this.core, 1.8);
      this.ring(8.3, 0.05, 0xb187ff, [0, 0.45, 0]);
      this.mesh(new T.CylinderGeometry(8.2, 9.3, 0.65, 80), this.metal(0x302040), [0, 0, 0]);
      this.ring(9.3, 0.055, 0xffa6d4, [0, -0.2, 0]);
      this.ring(10.7, 0.027, 0xb899ff, [0, -0.55, 0], this.scene, 1);
      this.orbit = new T.Group();
      this.orbit.position.set(0, 9.5, 0);
      this.orbit.rotation.z = -0.17;
      this.orbit.rotation.x = 0.1;
      this.scene.add(this.orbit);
      this.ring(10.8, 0.022, 0xe8b0e6, [0, 0, 0], this.orbit, 0.6);
      ['娃娃开箱', '测评分享', 'GBC', 'chiikawa'].forEach((label, index) => {
        const angle = index * Math.PI / 2 + 0.5;
        const anchor = new T.Object3D();
        anchor.position.set(Math.cos(angle) * 10.8, 0.1, Math.sin(angle) * 10.8);
        this.orbit.add(anchor);
        this.label(label, anchor, () => this.callbacks.category(label), 'category-label');
      });
      const caption = new T.Object3D();
      caption.position.set(0, 19, 0);
      this.scene.add(caption);
      this.label('每一份喜欢 · 正在发光', caption, null, 'sphere-caption');
    }

    async loadAtlas() {
      try {
        await loadScript('assets/textures/sphere.js');
        const texture = await textureFromImage(window.SPHERE_ATLAS.image);
        texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
        this.sphere.material.map = texture;
        this.sphere.material.emissiveMap = texture;
        this.sphere.material.needsUpdate = true;
        this.atlasReady = true;
        window.SPHERE_ATLAS.image = null;
      } catch {
        this.callbacks.notice('球面封面暂未载入，可以继续浏览作品岛。');
      }
    }

    label(text, anchor, action, className = '', small = '') {
      const element = document.createElement(action ? 'button' : 'div');
      element.className = `world-label ${className}`.trim();
      if (action) element.type = 'button';
      const dot = document.createElement('span');
      dot.className = 'dot';
      const title = document.createElement('span');
      title.textContent = text;
      element.append(dot, title);
      if (small) {
        const count = document.createElement('small');
        count.textContent = small;
        element.append(count);
      }
      if (action) element.addEventListener('click', action);
      document.getElementById('world-labels').append(element);
      this.labels.push({ element, anchor, className });
    }

    createIslands() {
      this.islands = {};
      this.panelGeometry = new T.PlaneGeometry(2.48, 1.86);
      this.borderGeometry = new T.BoxGeometry(2.68, 2.06, 0.14);
      this.standGeometry = new T.CylinderGeometry(0.025, 0.025, 0.85, 5);
      this.frameMat = this.glow(0xcba5e5, 0.32);
      const catalog = window.CATALOG;
      const definitions = [
        { key: 'works', name: '小红书岛', position: [-20, 0, -20], color: 0xff92c7, radius: 12.5, scale: 0.86, list: items.filter((item) => item.platform === 'xhs'), cols: 8, small: `${catalog.counts.xhs} 件作品` },
        { key: 'videos', name: 'B 站岛', position: [20, -0.4, -22], color: 0x7bccff, radius: 12.5, scale: 0.86, list: items.filter((item) => item.platform === 'bili'), cols: 7, small: `${catalog.counts.bili} 条视频` },
        { key: 'featured', name: '精选岛', position: [0, -0.3, 21], color: 0xeaa1e1, radius: 7.5, scale: 0.85, list: catalog.featured, cols: 3, small: '小白的心头好' }
      ];
      for (const def of definitions) {
        const group = new T.Group();
        group.position.fromArray(def.position);
        group.scale.setScalar(def.scale);
        this.scene.add(group);
        this.islands[def.key] = group;
        const deck = this.mesh(new T.CylinderGeometry(def.radius, def.radius * 0.82, 0.8, 64), this.metal(0x453254, { metalness: 0.75 }), [0, -0.3, 0], group);
        deck.scale.z = 0.62;
        const under = this.mesh(new T.ConeGeometry(def.radius * 0.86, 3.2, 8), this.metal(0x322542, { flatShading: true }), [0, -2.15, 0], group);
        under.rotation.z = Math.PI;
        under.scale.z = 0.62;
        const rim = this.ring(def.radius, 0.045, def.color, [0, 0.14, 0], group, 1.8);
        rim.scale.y = 0.62;
        const lower = this.ring(def.radius * 0.88, 0.018, def.color, [0, -0.85, 0], group, 0.9);
        lower.scale.y = 0.62;
        const inner = this.ring(def.radius * 0.72, 0.015, def.color, [0, 0.13, 0], group, 0.5);
        inner.scale.y = 0.62;
        const anchor = new T.Object3D();
        anchor.position.set(0, 1, def.radius * 0.65 + 1.2);
        group.add(anchor);
        this.label(def.name, anchor, () => this.callbacks.portal(def.key), '', def.small);
        const rows = Math.ceil(def.list.length / def.cols);
        def.list.forEach((item, index) => {
          const col = index % def.cols;
          const row = Math.floor(index / def.cols);
          const x = (col - (def.cols - 1) / 2) * 2.95;
          const y = 2 + (rows - 1 - row) * 2.5;
          const z = -1.8 + Math.abs(x) * 0.17 + (def.key === 'featured' ? 0 : row * 0.5);
          const groupFrame = new T.Group();
          groupFrame.position.set(x, y, z);
          groupFrame.rotation.y = -x * 0.009;
          group.add(groupFrame);
          const borderMat = this.frameMat.clone();
          borderMat.color.set(def.color);
          borderMat.emissive.set(def.color);
          borderMat.envMapIntensity = 0.2;
          const border = this.mesh(this.borderGeometry, borderMat, [0, 0, -0.09], groupFrame);
          const picture = this.mesh(this.panelGeometry, new T.MeshBasicMaterial({ color: 0x5d426f }), [0, 0, 0.01], groupFrame);
          picture.userData.item = item;
          picture.userData.island = def.key;
          this.pickables.push(picture);
          this.frames.push({ item, group: groupFrame, picture, border, island: def.key, loaded: false, requested: false });
          this.mesh(this.standGeometry, this.metal(0x967fa8), [0, -1.4, 0], groupFrame);
        });
      }
      for (const [key, x, label] of [['about', -32, '关于小白'], ['follow', 32, '关注小白']]) {
        const group = new T.Group();
        group.position.set(x, 0, 18);
        this.scene.add(group);
        this.mesh(new T.CylinderGeometry(4, 3.3, 0.7, 48), this.metal(0x493153), [0, 0, 0], group);
        this.ring(4, 0.05, key === 'about' ? 0xffb1d8 : 0x97d6ff, [0, 0.4, 0], group);
        const portal = this.ring(2.5, 0.09, 0xc798ff, [0, 3, 0], group);
        portal.rotation.x = 0;
        const inner = this.mesh(new T.CircleGeometry(2.35, 48), new T.MeshBasicMaterial({ color: 0xc397ff, transparent: true, opacity: 0.08, side: T.DoubleSide, depthWrite: false }), [0, 3, 0], group);
        inner.userData.portal = key;
        this.pickables.push(inner);
        const anchor = new T.Object3D();
        anchor.position.set(0, 6.5, 0);
        group.add(anchor);
        this.label(label, anchor, () => this.callbacks.portal(key));
      }
    }

    createEnvironment() {
      this.sky = this.mesh(new T.SphereGeometry(145, 24, 16), new T.ShaderMaterial({
        side: T.BackSide,
        depthWrite: false,
        uniforms: { day: { value: 0 } },
        vertexShader: 'varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader: `uniform float day;varying vec3 vPos;void main(){
          vec3 p=normalize(vPos);float nebula=exp(-pow((p.y-.12)*3.2,2.0))*pow(.5+.5*sin(p.x*3.0+p.z*2.0+.6),2.0);
          float cloud=.6+.4*sin(p.x*9.0+sin(p.z*7.0)+p.y*11.0);
          vec3 night=mix(vec3(.028,.018,.064),vec3(.18,.065,.20),nebula*.7*cloud);
          vec3 morning=mix(vec3(.53,.64,.85),vec3(.97,.74,.88),.55+.35*nebula);
          gl_FragColor=vec4(mix(night,morning,day),1.0);
        }`
      }), [0, 0, 0]);
      this.sky.renderOrder = -100;
      const count = mobile ? 450 : 1400;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      let seed = 731;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      for (let index = 0; index < count; index += 1) {
        positions.set([(random() - 0.5) * 180, random() * 95 - 18, (random() - 0.5) * 150 - 20], index * 3);
        const color = new T.Color().setHSL(0.7 + random() * 0.2, 0.38, 0.72 + random() * 0.28);
        colors.set(color.toArray(), index * 3);
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
      this.stars = new T.Points(geometry, new T.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending }));
      this.scene.add(this.stars);
      const haloGeo = new T.BufferGeometry();
      const haloPos = [];
      for (let index = 0; index < (mobile ? 140 : 420); index += 1) {
        const angle = random() * TAU;
        const radius = 11 + random() * 9;
        haloPos.push(Math.cos(angle) * radius, (random() - 0.5) * 7 + 4, Math.sin(angle) * radius);
      }
      haloGeo.setAttribute('position', new T.Float32BufferAttribute(haloPos, 3));
      this.halo = new T.Points(haloGeo, new T.PointsMaterial({ color: 0xffb4e6, size: 0.065, transparent: true, opacity: 0.75, depthWrite: false, blending: T.AdditiveBlending }));
      this.scene.add(this.halo);
      this.bubbles = new T.Group();
      this.scene.add(this.bubbles);
      const bubbleGeo = new T.SphereGeometry(1, 18, 12);
      const bubbleMat = new T.MeshPhysicalMaterial({ color: 0xe6b3ec, metalness: 0.1, roughness: 0.12, clearcoat: 1, transparent: true, opacity: 0.16, envMapIntensity: 2, depthWrite: false });
      for (let index = 0; index < (mobile ? 12 : 28); index += 1) {
        const bubble = this.mesh(bubbleGeo, bubbleMat, [(random() - 0.5) * 95, random() * 35 + 1, (random() - 0.5) * 55], this.bubbles);
        bubble.scale.setScalar(0.12 + random() * 0.8);
        bubble.userData.baseY = bubble.position.y;
        bubble.userData.phase = random() * TAU;
      }
      this.beams = new T.Group();
      this.scene.add(this.beams);
      for (let index = 0; index < 8; index += 1) {
        const angle = index / 8 * TAU;
        const beamMat = new T.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: T.DoubleSide,
          blending: T.AdditiveBlending,
          uniforms: { color: { value: new T.Color(index % 2 ? 0xa078ff : 0xff7bbc) }, strength: { value: 0.08 } },
          vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader: 'uniform vec3 color;uniform float strength;varying vec2 vUv;void main(){float falloff=pow(1.0-vUv.y,1.9);gl_FragColor=vec4(color,falloff*strength);}'
        });
        const beam = this.mesh(new T.CylinderGeometry(2.2, 0.04, 32, 24, 1, true), beamMat, [Math.cos(angle) * 13, 13, Math.sin(angle) * 13], this.beams);
        beam.rotation.z = Math.cos(angle) * 0.24;
        beam.rotation.x = Math.sin(angle) * 0.24;
      }
      const pathPoints = [];
      for (let index = 0; index < 500; index += 1) {
        const angle = index / 500 * TAU;
        pathPoints.push(Math.cos(angle) * 28, -1.3, Math.sin(angle) * 24);
      }
      const pathGeo = new T.BufferGeometry();
      pathGeo.setAttribute('position', new T.Float32BufferAttribute(pathPoints, 3));
      this.path = new T.Points(pathGeo, new T.PointsMaterial({ color: 0xeaa6ff, size: 0.07, transparent: true, opacity: 0.75 }));
      this.scene.add(this.path);
    }

    createEvents() {
      const canvas = this.renderer.domElement;
      let down = null;
      canvas.addEventListener('pointerdown', (event) => {
        down = { x: event.clientX, y: event.clientY, time: performance.now() };
      });
      canvas.addEventListener('pointerup', (event) => {
        if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7 || performance.now() - down.time > 600) {
          down = null;
          return;
        }
        down = null;
        const hit = this.hit(event.clientX, event.clientY);
        if (!hit) return;
        if (hit.object.userData.portal) this.callbacks.portal(hit.object.userData.portal);
        else {
          const item = this.itemForHit(hit);
          if (item) this.callbacks.select(item, { island: hit.object.userData.island || 'sphere' });
        }
      });
      canvas.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch' || down) return;
        const hit = this.hit(event.clientX, event.clientY);
        const item = hit && this.itemForHit(hit);
        canvas.style.cursor = hit ? 'pointer' : 'grab';
        this.callbacks.hover(item, event.clientX, event.clientY);
      });
      canvas.addEventListener('pointerleave', () => {
        down = null;
        this.callbacks.hover(null);
      });
      canvas.addEventListener('pointercancel', () => { down = null; });
      canvas.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && this.focusedItem) {
          const frame = this.frames.find((entry) => entry.item.id === this.focusedItem.id);
          this.callbacks.select(this.focusedItem, { island: frame ? frame.island : 'sphere' });
          event.preventDefault();
          return;
        }
        if (event.key === '+' || event.key === '=') { this.zoom(0.85); event.preventDefault(); }
        if (event.key === '-') { this.zoom(1.18); event.preventDefault(); }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          this.flight = null;
          this.gyroBase = null;
          this.lastInteraction = performance.now();
          const offset = this.camera.position.clone().sub(this.controls.target);
          const spherical = new T.Spherical().setFromVector3(offset);
          spherical.theta += event.key === 'ArrowLeft' ? -0.12 : event.key === 'ArrowRight' ? 0.12 : 0;
          spherical.phi = T.MathUtils.clamp(spherical.phi + (event.key === 'ArrowUp' ? -0.08 : event.key === 'ArrowDown' ? 0.08 : 0), 0.15, Math.PI * 0.49);
          this.camera.position.copy(this.controls.target).add(new T.Vector3().setFromSpherical(spherical));
          event.preventDefault();
        }
      });
      this.onResize = () => {
        this.camera.aspect = innerWidth / innerHeight;
        this.camera.fov = innerWidth < 700 ? 53 : 44;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(innerWidth, innerHeight);
        if (this.composer) this.composer.setSize(innerWidth, innerHeight);
        if (this.view === 'home' && !this.lastInteraction && !this.flight) {
          const nextHome = this.getView('home');
          this.camera.position.fromArray(nextHome.position);
          this.controls.target.fromArray(nextHome.target);
        }
      };
      addEventListener('resize', this.onResize);
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        this.stop();
        this.callbacks.fallback('3D 画面已暂停，先在轻量展馆里继续逛逛。');
      });
      this.onReducedMotion = (event) => {
        this.motion = !event.matches;
        this.callbacks.motion(this.motion);
      };
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
        const uv = hit.uv;
        const atlas = window.SPHERE_ATLAS;
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
        if (!this.texturePromises.has(frame.item.id)) {
          this.texturePromises.set(frame.item.id, (async () => {
            await loadScript(frame.item.texture);
            const texture = await textureFromImage(window.SITE_TEXTURES[frame.item.id]);
            texture.anisotropy = this.lowQuality ? 1 : 4;
            delete window.SITE_TEXTURES[frame.item.id];
            return texture;
          })());
        }
        const texture = await this.texturePromises.get(frame.item.id);
        frame.picture.material.map = texture;
        frame.picture.material.color.set(0xffffff);
        frame.picture.material.needsUpdate = true;
        frame.loaded = true;
        if (!frame.caption) {
          const labelCanvas = document.createElement('canvas');
          labelCanvas.width = 768;
          labelCanvas.height = 90;
          const ctx = labelCanvas.getContext('2d');
          ctx.fillStyle = 'rgba(24,14,38,.90)';
          ctx.fillRect(0, 0, 768, 90);
          ctx.font = '32px "Microsoft YaHei",system-ui,sans-serif';
          ctx.fillStyle = '#fff0fd';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          let title = frame.item.title;
          while (title.length > 1 && ctx.measureText(title).width > 715) title = `${title.slice(0, -2)}…`;
          ctx.fillText(title, 384, 45);
          const labelTexture = new T.CanvasTexture(labelCanvas);
          labelTexture.colorSpace = T.SRGBColorSpace;
          frame.caption = this.mesh(new T.PlaneGeometry(2.48, 0.29), new T.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false }), [0, -1.12, 0.02], frame.group);
        }
      } catch {
        this.texturePromises.delete(frame.item.id);
        frame.requested = frame.attempts >= 2;
        if (frame.attempts >= 2) {
          this.failedTextures = (this.failedTextures || 0) + 1;
          if (this.failedTextures === 3) {
            this.stop();
            this.callbacks.fallback('部分3D封面未载入，已为你打开完整作品列表。');
          }
        }
      }
    }

    updateVisible() {
      this.matrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.matrix);
      const point = this.scratch.point;
      let loads = 0;
      for (const frame of this.frames) {
        if (frame.requested) continue;
        frame.picture.getWorldPosition(point);
        if (this.frustum.containsPoint(point) && point.distanceTo(this.camera.position) < 105 && loads < (mobile ? 3 : 6)) {
          this.loadFrame(frame);
          loads += 1;
        }
      }
    }

    updateLabels() {
      const world = this.scratch.world;
      const pos = this.scratch.pos;
      for (const label of this.labels) {
        label.anchor.getWorldPosition(world);
        const distance = this.camera.position.distanceTo(world);
        pos.copy(world).project(this.camera);
        const occluded = label.className === 'category-label' && (this.view !== 'home' || world.z < -3);
        const behindIntro = this.view === 'home' && innerWidth > 700 && pos.x < -0.34 && pos.y < 0.5;
        const behindMobileIntro = this.view === 'home' && innerWidth <= 700 && (-pos.y * 0.5 + 0.5) * innerHeight < 290;
        const captionAway = label.className === 'sphere-caption' && this.view !== 'home';
        const inView = pos.z > -1 && pos.z < 1 && Math.abs(pos.x) < 1.15 && Math.abs(pos.y) < 1.05 && distance < 115 && !occluded && !behindIntro && !behindMobileIntro && !captionAway;
        label.element.hidden = !inView;
        if (inView) label.element.style.transform = `translate(${(pos.x * 0.5 + 0.5) * innerWidth}px,${(-pos.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%)`;
      }
    }

    flyTo(name, onDone) {
      const view = this.getView(name);
      this.view = name;
      this.focusedItem = null;
      this.startFlight(new T.Vector3(...view.position), new T.Vector3(...view.target), onDone);
    }

    startFlight(position, target, onDone) {
      this.gyroBase = null;
      this.flight = {
        fromPosition: this.camera.position.clone(),
        fromTarget: this.controls.target.clone(),
        position,
        target,
        start: performance.now(),
        duration: this.motion ? 1500 : 0,
        onDone
      };
    }

    focusItem(item) {
      const frame = this.frames.find((entry) => entry.item.id === item.id && entry.island !== 'featured') || this.frames.find((entry) => entry.item.id === item.id);
      if (!frame) return;
      this.view = frame.island;
      const target = frame.group.getWorldPosition(new T.Vector3());
      const forward = new T.Vector3(0, 0.6, 7.5).applyQuaternion(frame.group.getWorldQuaternion(new T.Quaternion()));
      this.focusedItem = item;
      this.startFlight(target.clone().add(forward), target, () => this.renderer.domElement.focus({ preventScroll: true }));
      if (this.selectedFrame) this.selectedFrame.border.material.emissiveIntensity = 0.32;
      this.selectedFrame = frame;
      this.highlightUntil = performance.now() + 12000;
      if (!frame.requested) this.loadFrame(frame);
    }

    highlightCategory(category) {
      this.categoryHighlight = { category, until: performance.now() + 10000 };
    }

    zoom(factor) {
      this.flight = null;
      this.gyroBase = null;
      this.lastInteraction = performance.now();
      const direction = this.camera.position.clone().sub(this.controls.target);
      direction.setLength(T.MathUtils.clamp(direction.length() * factor, this.controls.minDistance, this.controls.maxDistance));
      this.camera.position.copy(this.controls.target).add(direction);
      this.controls.update();
    }

    setTheme(theme) {
      const day = theme === 'day';
      this.theme = theme;
      this.scene.fog.color.set(day ? 0xe3bbde : 0x27163c);
      this.scene.fog.density = day ? 0.008 : 0.007;
      this.ambient.color.set(day ? 0xffffff : 0xf4d1ff);
      this.ambient.groundColor.set(day ? 0xd4abcf : 0x3a2067);
      this.ambient.intensity = day ? 2.2 : 1.4;
      this.key.intensity = day ? 2.6 : 2.2;
      this.key.color.set(day ? 0xffe0ed : 0xffb8df);
      this.renderer.toneMappingExposure = day ? 1.06 : 0.94;
      this.sphere.material.emissiveIntensity = day ? 0.12 : 0.3;
      this.sphereUniforms.night.value = day ? 0 : 1;
      this.sky.material.uniforms.day.value = day ? 1 : 0;
      this.stars.material.opacity = day ? 0.3 : 0.9;
      this.halo.material.color.set(day ? 0xe17cbe : 0xffb4e6);
      this.shell.material.uniforms.color.value.set(day ? 0xffa4d6 : 0xdc64ff);
      this.beams.children.forEach((beam) => { beam.material.uniforms.strength.value = day ? 0.025 : 0.08; });
      if (this.bloom) this.bloom.strength = day ? 0.18 : 0.42;
      this.scene.traverse((object) => {
        if (object.isMesh && object.material.isMeshStandardMaterial && !object.material.emissiveMap && object.material.emissiveIntensity === 1 && object.material.emissive.getHex() === 0) {
          object.material.envMapIntensity = day ? 1.5 : 1;
        }
      });
    }

    setMotion(enabled) { this.motion = enabled; }

    setGyro(enabled) {
      this.gyro = enabled;
      this.gyroBase = null;
      if (!this.onOrientation) {
        this.onOrientation = (event) => {
          if (!this.gyro || this.flight || this.manualGesture || event.beta == null || event.gamma == null || document.querySelector('dialog[open]')) return;
          if (!this.gyroReceived) {
            this.gyroReceived = true;
            this.callbacks.gyro(true);
          }
          if (!this.gyroBase) this.gyroBase = { beta: event.beta, gamma: event.gamma, offset: this.camera.position.clone().sub(this.controls.target) };
          const spherical = new T.Spherical().setFromVector3(this.gyroBase.offset);
          spherical.theta -= T.MathUtils.degToRad(T.MathUtils.clamp(event.gamma - this.gyroBase.gamma, -30, 30)) * 0.45;
          spherical.phi = T.MathUtils.clamp(spherical.phi + T.MathUtils.degToRad(T.MathUtils.clamp(event.beta - this.gyroBase.beta, -30, 30)) * 0.3, 0.2, Math.PI * 0.48);
          this.camera.position.lerp(this.controls.target.clone().add(new T.Vector3().setFromSpherical(spherical)), 0.1);
        };
      }
      clearTimeout(this.gyroTimeout);
      this.gyroReceived = false;
      if (enabled) {
        addEventListener('deviceorientation', this.onOrientation);
        this.gyroTimeout = setTimeout(() => {
          if (!this.gyroReceived) {
            this.setGyro(false);
            this.callbacks.gyro(false);
            this.callbacks.notice('未检测到感应数据，请继续用手指拖动。');
          }
        }, 5000);
      } else removeEventListener('deviceorientation', this.onOrientation);
    }

    downgrade() {
      if (this.lowQuality) return;
      this.lowQuality = true;
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
      this.renderer.setSize(innerWidth, innerHeight);
      if (this.composer) {
        this.composer.passes.forEach((pass) => pass.dispose?.());
        this.composer.dispose();
        this.composer = null;
      }
      this.stars.geometry.setDrawRange(0, 450);
      this.callbacks.notice('已自动调低光效，继续轻松逛。');
    }

    pulseCategory() {
      const mark = this.categoryHighlight;
      if (!mark) return;
      const active = performance.now() < mark.until;
      for (const frame of this.frames) {
        if (frame === this.selectedFrame) continue;
        const match = active && frame.item.category === mark.category && frame.island !== 'featured';
        frame.border.material.emissiveIntensity = match ? 1.55 : 0.32;
      }
      if (!active) this.categoryHighlight = null;
    }

    animate() {
      if (!this.running) return;
      this.raf = requestAnimationFrame(this.animate);
      const rawDelta = this.clock.getDelta();
      const delta = Math.min(rawDelta, 0.1);
      if (document.hidden) return;
      this.visibleSeconds += Math.min(rawDelta, 0.5);
      const now = performance.now();
      if (this.motion && !document.querySelector('dialog[open]')) {
        this.time += delta;
        this.sphere.rotation.y = this.time * 0.028;
        this.orbit.rotation.y = this.time * 0.045;
        this.sphereUniforms.time.value = this.time;
        this.halo.rotation.y = this.time * 0.018;
        this.stars.rotation.y = this.time * 0.0015;
        this.bubbles.children.forEach((bubble) => {
          bubble.position.y = bubble.userData.baseY + Math.sin(this.time * 0.3 + bubble.userData.phase) * 0.45;
        });
        this.beams.rotation.y = Math.sin(this.time * 0.08) * 0.18;
      }
      if (this.flight) {
        const flight = this.flight;
        const t = flight.duration ? Math.min(1, (now - flight.start) / flight.duration) : 1;
        const ease = t * t * (3 - 2 * t);
        this.camera.position.lerpVectors(flight.fromPosition, flight.position, ease);
        this.controls.target.lerpVectors(flight.fromTarget, flight.target, ease);
        if (t === 1) {
          this.flight = null;
          flight.onDone?.();
        }
      }
      this.controls.update();
      this.pulseCategory();
      if (this.selectedFrame) {
        this.selectedFrame.border.material.emissiveIntensity = now < this.highlightUntil ? 1.8 + (this.motion ? Math.sin(now * 0.005) * 0.45 : 0) : 0.32;
        if (now >= this.highlightUntil) this.selectedFrame = null;
      }
      if (!this.lastVisibility || now - this.lastVisibility > 160) {
        this.updateVisible();
        this.lastVisibility = now;
      }
      this.updateLabels();
      try {
        if (this.composer) this.composer.render(delta);
        else this.renderer.render(this.scene, this.camera);
      } catch {
        this.stop();
        this.callbacks.fallback('当前设备已切换到轻量展馆，全部作品仍可查看。');
        return;
      }
      const stats = this.performanceWindow;
      if (this.visibleSeconds > 5 && !document.querySelector('dialog[open]')) {
        stats.duration += Math.min(rawDelta, 0.5);
        stats.frames += 1;
        if (stats.duration > 5) {
          const fps = stats.frames / stats.duration;
          stats.duration = 0;
          stats.frames = 0;
          stats.windows += 1;
          if (fps < 25 && !this.lowQuality) this.downgrade();
          else if (fps < 16 && this.lowQuality && stats.windows >= 3) {
            this.stop();
            this.callbacks.fallback('这个设备更适合轻量展馆，作品已经为你铺开。');
          }
        }
      }
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  window.XiaobaiWorld = World;
}());
