let THREE;
let PointerLockControls;

const THREE_CDN_URL = "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";
const POINTER_LOCK_CDN_URL =
  "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/controls/PointerLockControls.js";
const FIREBASE_APP_CDN_URL = "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
const FIREBASE_DATABASE_CDN_URL = "https://www.gstatic.com/firebasejs/12.13.0/firebase-database.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyACkd1QzPgDnmRz3b206e4IiePiS55keio",
  authDomain: "mbc-ingest.firebaseapp.com",
  databaseURL: "https://mbc-ingest-default-rtdb.firebaseio.com",
  projectId: "mbc-ingest",
  storageBucket: "mbc-ingest.firebasestorage.app",
  messagingSenderId: "700019516",
  appId: "1:700019516:web:09f8b929973059316ea439",
};

const FIREBASE_PATHS = {
  ads: "adverse/ads",
};

const STORAGE_KEYS = {
  ads: "adverse_3d_ads",
  adminSession: "adverse_admin_session",
  chatUser: "adverse_chat_user",
  chatMessages: "adverse_chat_messages",
  settings: "adverse_world_settings",
};

const DEFAULT_SETTINGS = {
  starCount: 1200,
  auroraStrength: 0.68,
  brightness: 1.05,
  moveSpeed: 10,
  mouseSensitivity: 1,
  zoomFov: 74,
  detectionMultiplier: 1,
  flyerMaxCount: 80,
};

const AD_TYPES = ["booth", "lcd", "pillar", "flyer", "blimp"];
const PROXIMITY_BY_TYPE = {
  booth: 8,
  lcd: 12,
  pillar: 8,
  flyer: 4,
  blimp: 20,
};

const TYPE_LABEL = {
  booth: "Booth",
  lcd: "LCD",
  pillar: "Pillar",
  flyer: "Flyer",
  blimp: "Blimp",
};

const BANNED_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "damn",
  "씨발",
  "시발",
  "병신",
  "개새끼",
  "좆",
  "꺼져",
];

const LINK_PATTERN = /(https?:\/\/|www\.|\b\S+\.(com|net|kr|org|io|co|shop|xyz|app|dev|info)\b)/i;
const IS_MOBILE =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  window.matchMedia("(pointer: coarse)").matches;
const WORLD_LIMIT = 58;
const CAMERA_HEIGHT = 2.25;

const app = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  clock: null,
  textureLoader: null,
  settings: { ...DEFAULT_SETTINGS },
  ads: [],
  adRecords: [],
  animatedItems: [],
  blimps: [],
  flyerItems: [],
  keys: {
    forward: false,
    backward: false,
    left: false,
    right: false,
    run: false,
  },
  verticalVelocity: 0,
  isGrounded: true,
  hasStarted: false,
  elapsed: 0,
  lastNearbyCheck: 0,
  currentNearbyAdId: null,
  manuallyHiddenAds: new Set(),
  admin: false,
  adminTab: "list",
  editingAdId: null,
  chatCooldownUntil: 0,
  chatTimer: null,
  chatUser: "",
  skyDome: null,
  stars: null,
  auroras: [],
  ambientLight: null,
  directionalLight: null,
  placeholderCache: new Map(),
  toastTimer: null,
  firebase: {
    enabled: false,
    status: "local",
    client: null,
    database: null,
    api: null,
    adsRef: null,
    unsubscribeAds: null,
    saveTimer: null,
    isApplyingRemote: false,
    lastError: "",
    lastRemoteSignature: "",
  },
  placement: {
    active: false,
    preview: null,
    grid: null,
    raycaster: null,
    pointer: null,
    plane: null,
    rotationY: 0,
    form: null,
  },
  mobileLook: {
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  },
  dom: {},
};

window.addEventListener("DOMContentLoaded", bootstrapApp);

async function bootstrapApp() {
  cacheDom();
  try {
    const [threeModule, controlsModule] = await Promise.all([
      import(THREE_CDN_URL),
      import(POINTER_LOCK_CDN_URL),
    ]);
    THREE = threeModule;
    PointerLockControls = controlsModule.PointerLockControls;
    await initFirebaseClient();
    initApp();
  } catch (error) {
    console.error("Failed to load Three.js modules", error);
    showStartupError(
      "Three.js CDN 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하거나 http://localhost 정적 서버로 실행해 주세요.",
    );
  }
}

async function initFirebaseClient() {
  try {
    const [firebaseAppModule, firebaseDatabaseModule] = await Promise.all([
      import(FIREBASE_APP_CDN_URL),
      import(FIREBASE_DATABASE_CDN_URL),
    ]);
    const client = firebaseAppModule.initializeApp(FIREBASE_CONFIG);
    const database = firebaseDatabaseModule.getDatabase(client);
    app.firebase = {
      ...app.firebase,
      enabled: true,
      status: "connecting",
      client,
      database,
      api: {
        ref: firebaseDatabaseModule.ref,
        onValue: firebaseDatabaseModule.onValue,
        set: firebaseDatabaseModule.set,
        get: firebaseDatabaseModule.get,
      },
      adsRef: firebaseDatabaseModule.ref(database, FIREBASE_PATHS.ads),
      lastError: "",
    };
  } catch (error) {
    app.firebase.enabled = false;
    app.firebase.status = "local";
    app.firebase.lastError = error.message || "Firebase module load failed";
    console.warn("Firebase is unavailable. Falling back to localStorage.", error);
  }
}

function initApp() {
  cacheDom();

  if (!isWebGLAvailable()) {
    app.dom.webglUnsupported.classList.remove("hidden");
    app.dom.loadingScreen.classList.add("hidden");
    return;
  }

  app.settings = loadSettingsFromStorage();
  app.ads = loadAdsFromStorage();

  initScene();
  initCamera();
  initRenderer();
  initControls();
  initLights();
  initWorld();
  initUI();
  buildAds();
  applyAdminSession();
  initFirebaseSync();
  animate();

  window.setTimeout(() => {
    app.dom.loadingScreen.classList.add("hidden");
  }, 450);
}

function showStartupError(message) {
  if (app.dom.loadingScreen) app.dom.loadingScreen.classList.add("hidden");
  if (app.dom.startOverlay) app.dom.startOverlay.classList.add("hidden");
  if (!app.dom.webglUnsupported) return;
  app.dom.webglUnsupported.classList.remove("hidden");
  app.dom.webglUnsupported.innerHTML = `
    <strong>ADVERSE를 시작하지 못했습니다.</strong>
    <span>${escapeHTML(message)}</span>
  `;
}

function cacheDom() {
  app.dom = {
    canvas: document.getElementById("worldCanvas"),
    webglUnsupported: document.getElementById("webglUnsupported"),
    loadingScreen: document.getElementById("loadingScreen"),
    startOverlay: document.getElementById("startOverlay"),
    startExploreButton: document.getElementById("startExploreButton"),
    controlHint: document.getElementById("controlHint"),
    mouseModeButton: document.getElementById("mouseModeButton"),
    loginButton: document.getElementById("loginButton"),
    loginModal: document.getElementById("loginModal"),
    loginForm: document.getElementById("loginForm"),
    adminId: document.getElementById("adminId"),
    adminPassword: document.getElementById("adminPassword"),
    loginError: document.getElementById("loginError"),
    adminPanel: document.getElementById("adminPanel"),
    placementHud: document.getElementById("placementHud"),
    adPopup: document.getElementById("adPopup"),
    adPopupClose: document.getElementById("adPopupClose"),
    adPopupThumb: document.getElementById("adPopupThumb"),
    adPopupTitle: document.getElementById("adPopupTitle"),
    adPopupDescription: document.getElementById("adPopupDescription"),
    adPopupLink: document.getElementById("adPopupLink"),
    chatWidget: document.getElementById("chatWidget"),
    chatUserLabel: document.getElementById("chatUserLabel"),
    chatMessages: document.getElementById("chatMessages"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    chatSendButton: document.getElementById("chatSendButton"),
    chatStatus: document.getElementById("chatStatus"),
    mobileControls: document.getElementById("mobileControls"),
    mobileLookArea: document.getElementById("mobileLookArea"),
    toast: document.getElementById("toast"),
  };
}

function isWebGLAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl")),
    );
  } catch (error) {
    return false;
  }
}

function initScene() {
  app.scene = new THREE.Scene();
  app.scene.background = new THREE.Color(0x071127);
  app.scene.fog = new THREE.FogExp2(0x101b43, 0.009);
  app.clock = new THREE.Clock();
  app.textureLoader = new THREE.TextureLoader();
  app.textureLoader.setCrossOrigin("anonymous");
}

function initCamera() {
  app.camera = new THREE.PerspectiveCamera(
    clampNumber(app.settings.zoomFov, 54, 86, DEFAULT_SETTINGS.zoomFov),
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );
  app.camera.position.set(0, CAMERA_HEIGHT, 13);
}

function initRenderer() {
  app.renderer = new THREE.WebGLRenderer({
    canvas: app.dom.canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  app.renderer.setSize(window.innerWidth, window.innerHeight);
  app.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.35 : 2));
  app.renderer.outputColorSpace = THREE.SRGBColorSpace;
  app.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  app.renderer.toneMappingExposure = app.settings.brightness;
  app.renderer.shadowMap.enabled = true;
  app.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  window.addEventListener("resize", handleResize);
}

function initControls() {
  app.controls = new PointerLockControls(app.camera, document.body);
  app.controls.pointerSpeed = app.settings.mouseSensitivity;
  app.scene.add(app.controls.getObject());
  app.controls.getObject().position.set(0, CAMERA_HEIGHT, 13);

  app.controls.addEventListener("lock", () => {
    app.dom.startOverlay.classList.add("hidden");
    updateMouseModeButton();
  });

  app.controls.addEventListener("unlock", () => {
    updateMouseModeButton();
    if (!app.dom.loginModal.classList.contains("hidden")) return;
    if (!app.hasStarted) {
      app.dom.startOverlay.classList.remove("hidden");
      app.dom.startExploreButton.textContent = "Click to Explore";
      return;
    }
    app.dom.startOverlay.classList.add("hidden");
  });

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);
  window.addEventListener("wheel", handleWheelZoom, { passive: false });
}

function initLights() {
  app.ambientLight = new THREE.AmbientLight(0xb7c7ff, 1.28);
  app.scene.add(app.ambientLight);

  const hemisphere = new THREE.HemisphereLight(0xaee9ff, 0x2b205e, 0.92);
  app.scene.add(hemisphere);

  app.directionalLight = new THREE.DirectionalLight(0xffffff, 1.62);
  app.directionalLight.position.set(20, 28, 10);
  app.directionalLight.castShadow = true;
  app.directionalLight.shadow.mapSize.set(1024, 1024);
  app.directionalLight.shadow.camera.near = 5;
  app.directionalLight.shadow.camera.far = 90;
  app.directionalLight.shadow.camera.left = -44;
  app.directionalLight.shadow.camera.right = 44;
  app.directionalLight.shadow.camera.top = 44;
  app.directionalLight.shadow.camera.bottom = -44;
  app.scene.add(app.directionalLight);
}

function initWorld() {
  createSkyDome();
  createStars();
  createAuroraSheets();
  createPlatform();
  createExpoAisles();
  createStationAccents();
}

function createSkyDome() {
  const texture = createSpaceTexture();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(260, 48, 32),
    new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  sphere.name = "Space Sky Dome";
  app.scene.add(sphere);
  app.skyDome = sphere;
}

function createSpaceTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#10245b");
  gradient.addColorStop(0.34, "#182a68");
  gradient.addColorStop(0.68, "#1a1648");
  gradient.addColorStop(1, "#071127");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawNebula(ctx, canvas.width * 0.2, canvas.height * 0.34, 650, "rgba(124, 92, 255, 0.30)");
  drawNebula(ctx, canvas.width * 0.68, canvas.height * 0.38, 680, "rgba(0, 212, 255, 0.23)");
  drawNebula(ctx, canvas.width * 0.52, canvas.height * 0.72, 540, "rgba(255, 204, 112, 0.16)");
  drawNebula(ctx, canvas.width * 0.86, canvas.height * 0.68, 360, "rgba(255, 120, 170, 0.13)");

  for (let i = 0; i < 1250; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const radius = Math.random() * 1.35 + 0.25;
    const alpha = Math.random() * 0.76 + 0.24;
    ctx.fillStyle = `rgba(245, 247, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 7; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height * 0.82;
    const r = 18 + Math.random() * 26;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 5.2);
    halo.addColorStop(0, "rgba(255,255,255,0.38)");
    halo.addColorStop(0.14, "rgba(0,212,255,0.16)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 5.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function drawNebula(ctx, x, y, radius, color) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.42, color.replace(/0\.\d+\)/, "0.08)"));
  gradient.addColorStop(1, "rgba(5, 8, 20, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function createStars() {
  if (app.stars) {
    app.scene.remove(app.stars);
    disposeObject(app.stars);
    app.stars = null;
  }

  const count = clampNumber(app.settings.starCount, 150, IS_MOBILE ? 900 : 2200, DEFAULT_SETTINGS.starCount);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    const radius = 85 + Math.random() * 150;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = 10 + Math.abs(radius * Math.cos(phi)) * 0.88;
    const z = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    color.setHSL(0.58 + Math.random() * 0.1, 0.55, 0.75 + Math.random() * 0.25);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  app.stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: IS_MOBILE ? 0.42 : 0.34,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    }),
  );
  app.stars.name = "Star Field";
  app.scene.add(app.stars);
}

function createAuroraSheets() {
  app.auroras.forEach((aurora) => {
    app.scene.remove(aurora);
    disposeObject(aurora);
  });
  app.auroras = [];

  const texture = createAuroraTexture();
  const specs = [
    { position: [0, 24, -78], rotation: [0, 0, 0], scale: [100, 26, 1], opacity: 0.55 },
    { position: [-64, 28, -30], rotation: [0, Math.PI / 2.8, 0], scale: [76, 22, 1], opacity: 0.34 },
    { position: [68, 30, 18], rotation: [0, -Math.PI / 2.6, 0], scale: [82, 24, 1], opacity: 0.3 },
  ];

  specs.forEach((spec) => {
    const material = new THREE.MeshBasicMaterial({
      map: texture.clone(),
      transparent: true,
      opacity: spec.opacity * app.settings.auroraStrength,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    material.map.needsUpdate = true;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.position.set(...spec.position);
    mesh.rotation.set(...spec.rotation);
    mesh.scale.set(...spec.scale);
    mesh.name = "Aurora Sheet";
    app.scene.add(mesh);
    app.auroras.push(mesh);
  });
}

function createAuroraTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 7; i += 1) {
    const y = 36 + i * 24 + Math.random() * 8;
    const gradient = ctx.createLinearGradient(0, y, canvas.width, y + 70);
    gradient.addColorStop(0, "rgba(0, 212, 255, 0)");
    gradient.addColorStop(0.18, "rgba(0, 212, 255, 0.18)");
    gradient.addColorStop(0.5, "rgba(124, 92, 255, 0.28)");
    gradient.addColorStop(0.78, "rgba(255, 204, 112, 0.10)");
    gradient.addColorStop(1, "rgba(0, 212, 255, 0)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 18 + Math.random() * 14;
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += 24) {
      const wave = Math.sin(x * 0.009 + i) * 30 + Math.sin(x * 0.018 + i * 2) * 10;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function createPlatform() {
  const texture = createPlatformTexture();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);

  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(124, 0.55, 124),
    new THREE.MeshStandardMaterial({
      color: 0x263474,
      map: texture,
      roughness: 0.54,
      metalness: 0.2,
      emissive: 0x10265a,
      emissiveIntensity: 0.36,
    }),
  );
  platform.position.y = -0.28;
  platform.receiveShadow = true;
  platform.name = "Main Space Plaza";
  app.scene.add(platform);

  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x53dfff,
    transparent: true,
    opacity: 0.34,
  });
  const linePositions = [];
  for (let i = -60; i <= 60; i += 10) {
    linePositions.push(-60, 0.035, i, 60, 0.035, i);
    linePositions.push(i, 0.035, -60, i, 0.035, 60);
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  const grid = new THREE.LineSegments(lineGeometry, lineMaterial);
  grid.name = "Glow Grid";
  app.scene.add(grid);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd98f,
    transparent: true,
    opacity: 0.54,
  });
  [16, 31, 48].forEach((radius, index) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 8, 160), ringMaterial.clone());
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06 + index * 0.006;
    ring.name = "Plaza Orbit Ring";
    app.scene.add(ring);
  });

  const boundaryMaterial = new THREE.MeshBasicMaterial({
    color: 0x7c5cff,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
  });
  const boundary = new THREE.Mesh(new THREE.RingGeometry(60, 61.2, 160), boundaryMaterial);
  boundary.rotation.x = Math.PI / 2;
  boundary.position.y = 0.09;
  boundary.name = "Soft World Boundary";
  app.scene.add(boundary);
}

function createPlatformTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#263474");
  gradient.addColorStop(0.52, "#2a3b82");
  gradient.addColorStop(1, "#1a285c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(83, 223, 255, 0.24)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= canvas.width; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, canvas.height);
    ctx.moveTo(0, i);
    ctx.lineTo(canvas.width, i);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255, 204, 112, 0.18)";
  ctx.lineWidth = 6;
  ctx.strokeRect(96, 96, canvas.width - 192, canvas.height - 192);
  ctx.strokeStyle = "rgba(124, 92, 255, 0.26)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, 280, 0, Math.PI * 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createStationAccents() {
  const material = new THREE.MeshStandardMaterial({
    color: 0x253064,
    roughness: 0.55,
    metalness: 0.25,
    emissive: 0x0b1230,
    emissiveIntensity: 0.25,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x00d4ff,
    transparent: true,
    opacity: 0.48,
  });

  const positions = [
    [-42, 0, -42],
    [42, 0, -42],
    [-42, 0, 42],
    [42, 0, 42],
  ];
  positions.forEach(([x, y, z], index) => {
    const pylon = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.56, 5.2, 8), material);
    body.position.y = 2.6;
    body.castShadow = true;
    pylon.add(body);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.8, 18, 12), glowMaterial.clone());
    cap.position.y = 5.48;
    pylon.add(cap);

    const light = new THREE.PointLight(index % 2 ? 0x7c5cff : 0x00d4ff, 1.3, 24, 2);
    light.position.y = 5.3;
    pylon.add(light);

    pylon.position.set(x, y, z);
    app.scene.add(pylon);
  });
}

function createExpoAisles() {
  const bannerMaterial = new THREE.MeshStandardMaterial({
    color: 0x172c69,
    roughness: 0.48,
    metalness: 0.24,
    emissive: 0x10265a,
    emissiveIntensity: 0.42,
  });

  const bannerSpecs = [
    { label: "A ROW", sub: "BOOTH ZONE", x: -16, z: -9 },
    { label: "B ROW", sub: "BOOTH ZONE", x: 16, z: -9 },
    { label: "LCD GATE", sub: "MAIN SPONSORS", x: 0, z: -31 },
    { label: "FLYER WALK", sub: "COUPON LANE", x: 0, z: 11 },
  ];

  bannerSpecs.forEach((spec) => {
    const group = new THREE.Group();
    const poleLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 10), bannerMaterial);
    poleLeft.position.set(-2.4, 1.6, 0);
    const poleRight = poleLeft.clone();
    poleRight.position.x = 2.4;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.82, 0.14), bannerMaterial.clone());
    panel.position.y = 3.12;
    const text = new THREE.Mesh(
      new THREE.PlaneGeometry(4.72, 0.62),
      new THREE.MeshBasicMaterial({
        map: createTextTexture(spec.label, spec.sub, 1024, 256, ["#10245b", "#00d4ff"]),
      }),
    );
    text.position.set(0, 3.12, 0.09);
    group.add(poleLeft, poleRight, panel, text);
    group.position.set(spec.x, 0, spec.z);
    app.scene.add(group);
  });

  const laneMaterial = new THREE.MeshBasicMaterial({
    color: 0x53dfff,
    transparent: true,
    opacity: 0.26,
  });
  [-12, 0, 12].forEach((x) => {
    const lane = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 68), laneMaterial.clone());
    lane.position.set(x, 0.13, -5);
    app.scene.add(lane);
  });
  [-28, -12, 4, 20].forEach((z) => {
    const lane = new THREE.Mesh(new THREE.BoxGeometry(64, 0.03, 0.12), laneMaterial.clone());
    lane.position.set(0, 0.135, z);
    app.scene.add(lane);
  });
}

function initUI() {
  app.dom.startOverlay.addEventListener("click", beginExplore);
  app.dom.startOverlay.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") beginExplore();
  });
  app.dom.startExploreButton.addEventListener("click", beginExplore);
  app.dom.mouseModeButton.addEventListener("click", togglePointerLock);

  app.dom.loginButton.addEventListener("click", () => {
    if (app.admin) {
      app.dom.adminPanel.classList.toggle("hidden");
      return;
    }
    openLoginModal();
  });

  app.dom.loginModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-modal]")) closeLoginModal();
  });
  app.dom.loginForm.addEventListener("submit", handleLogin);

  app.dom.adPopupClose.addEventListener("click", () => {
    if (app.currentNearbyAdId) app.manuallyHiddenAds.add(app.currentNearbyAdId);
    hideAdPopup();
  });
  app.dom.adPopupLink.addEventListener("click", () => {
    const ad = app.ads.find((item) => item.id === app.currentNearbyAdId);
    if (ad) openAdLink(ad);
  });

  app.dom.adminPanel.addEventListener("click", handleAdminClick);
  app.dom.adminPanel.addEventListener("submit", handleAdminSubmit);
  app.dom.adminPanel.addEventListener("change", (event) => {
    if (event.target.id === "adType") {
      updateVisibleTypeFields(event.target.value);
      if (app.placement.active) startPlacementMode(document.getElementById("adForm"), true);
    }
  });

  initChat();
  initMobileControls();
  updateMouseModeButton();
}

function beginExplore() {
  app.hasStarted = true;
  stopPlacementMode(false);
  app.dom.startOverlay.classList.add("hidden");
  if (!IS_MOBILE) {
    try {
      app.controls.lock();
    } catch (error) {
      showToast("화면을 한 번 더 클릭하면 마우스 잠금이 시작됩니다.");
    }
  }
}

function togglePointerLock() {
  if (IS_MOBILE) return;
  if (app.placement.active) {
    stopPlacementMode(true);
    return;
  }
  if (app.controls?.isLocked) {
    app.controls.unlock();
    showToast("커서 모드입니다. 로그인, 채팅, 관리자 패널을 사용할 수 있습니다.");
    return;
  }
  app.hasStarted = true;
  app.dom.startOverlay.classList.add("hidden");
  try {
    app.controls.lock();
  } catch (error) {
    showToast("화면을 한 번 클릭한 뒤 다시 ~ 키를 눌러 주세요.");
  }
}

function updateMouseModeButton() {
  if (!app.dom.mouseModeButton || !app.controls) return;
  const locked = app.controls.isLocked;
  app.dom.mouseModeButton.classList.toggle("locked", locked);
  app.dom.mouseModeButton.textContent = locked ? "~ Explore" : "~ Cursor";
  app.dom.mouseModeButton.title = locked
    ? "마우스 잠금 중입니다. ~ 키로 커서를 켭니다."
    : "커서 모드입니다. ~ 키로 탐험 모드로 돌아갑니다.";
}

function handleWheelZoom(event) {
  if (!app.camera || isTypingTarget(event.target) || isUIInteractionTarget(event.target)) return;
  event.preventDefault();
  const nextFov = THREE.MathUtils.clamp(app.camera.fov + Math.sign(event.deltaY) * 3, 54, 86);
  app.camera.fov = nextFov;
  app.settings.zoomFov = nextFov;
  app.camera.updateProjectionMatrix();
}

function isUIInteractionTarget(target) {
  return Boolean(
    target?.closest?.(
      ".admin-panel, .chat-widget, .modal, .top-bar, .ad-popup, .placement-hud, button, input, textarea, select",
    ),
  );
}

function handleKeyDown(event) {
  if (app.placement.active && event.code === "Escape") {
    event.preventDefault();
    stopPlacementMode(true);
    return;
  }
  if (isTypingTarget(event.target)) return;

  if (app.placement.active && (event.code === "KeyQ" || event.code === "KeyE" || event.code === "KeyR")) {
    event.preventDefault();
    rotatePlacementPreview(event.code === "KeyQ" ? -15 : event.code === "KeyE" ? 15 : 0, event.code === "KeyR");
    return;
  }

  switch (event.code) {
    case "Backquote":
      event.preventDefault();
      togglePointerLock();
      break;
    case "KeyF": {
      if (!app.dom.adPopup.classList.contains("hidden") && app.currentNearbyAdId) {
        event.preventDefault();
        const ad = app.ads.find((item) => item.id === app.currentNearbyAdId);
        if (ad) openAdLink(ad);
      }
      break;
    }
    case "KeyW":
      app.keys.forward = true;
      break;
    case "KeyS":
      app.keys.backward = true;
      break;
    case "KeyA":
      app.keys.left = true;
      break;
    case "KeyD":
      app.keys.right = true;
      break;
    case "ShiftLeft":
    case "ShiftRight":
      app.keys.run = true;
      break;
    case "Space":
      event.preventDefault();
      if (app.isGrounded) {
        app.verticalVelocity = 6.2;
        app.isGrounded = false;
      }
      break;
    case "KeyM":
      app.dom.controlHint.classList.toggle("hidden");
      break;
    default:
      break;
  }
}

function handleKeyUp(event) {
  switch (event.code) {
    case "KeyW":
      app.keys.forward = false;
      break;
    case "KeyS":
      app.keys.backward = false;
      break;
    case "KeyA":
      app.keys.left = false;
      break;
    case "KeyD":
      app.keys.right = false;
      break;
    case "ShiftLeft":
    case "ShiftRight":
      app.keys.run = false;
      break;
    default:
      break;
  }
}

function isTypingTarget(target) {
  if (!target) return false;
  const tagName = target.tagName ? target.tagName.toLowerCase() : "";
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function initMobileControls() {
  if (!IS_MOBILE) {
    app.dom.mobileControls.classList.add("hidden");
    return;
  }

  document.querySelectorAll("[data-mobile-key]").forEach((button) => {
    const key = button.dataset.mobileKey;
    const mapped = {
      forward: "forward",
      backward: "backward",
      left: "left",
      right: "right",
    }[key];
    if (!mapped) return;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      app.keys[mapped] = true;
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener("pointerup", () => {
      app.keys[mapped] = false;
    });
    button.addEventListener("pointercancel", () => {
      app.keys[mapped] = false;
    });
    button.addEventListener("pointerleave", () => {
      app.keys[mapped] = false;
    });
  });

  app.dom.mobileLookArea.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    app.mobileLook.active = true;
    app.mobileLook.pointerId = event.pointerId;
    app.mobileLook.lastX = event.clientX;
    app.mobileLook.lastY = event.clientY;
    app.dom.mobileLookArea.setPointerCapture(event.pointerId);
  });

  app.dom.mobileLookArea.addEventListener("pointermove", (event) => {
    if (!app.mobileLook.active || event.pointerId !== app.mobileLook.pointerId) return;
    const dx = event.clientX - app.mobileLook.lastX;
    const dy = event.clientY - app.mobileLook.lastY;
    app.mobileLook.lastX = event.clientX;
    app.mobileLook.lastY = event.clientY;
    const sensitivity = 0.004 * app.settings.mouseSensitivity;
    app.camera.rotation.y -= dx * sensitivity;
    app.camera.rotation.x -= dy * sensitivity;
    app.camera.rotation.x = THREE.MathUtils.clamp(app.camera.rotation.x, -Math.PI / 2.2, Math.PI / 2.4);
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
    app.dom.mobileLookArea.addEventListener(type, () => {
      app.mobileLook.active = false;
      app.mobileLook.pointerId = null;
    });
  });
}

function handleResize() {
  if (!app.camera || !app.renderer) return;
  app.camera.aspect = window.innerWidth / window.innerHeight;
  app.camera.updateProjectionMatrix();
  app.renderer.setSize(window.innerWidth, window.innerHeight);
  app.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.35 : 2));
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(app.clock.getDelta(), 0.05);
  app.elapsed += delta;

  updatePlayer(delta);
  updateWorldMotion(delta, app.elapsed);
  updateAnimatedAds(delta, app.elapsed);

  const now = performance.now();
  if (now - app.lastNearbyCheck > 180) {
    app.lastNearbyCheck = now;
    checkNearbyAds();
  }

  app.renderer.render(app.scene, app.camera);
}

function updatePlayer(delta) {
  const canMove = app.controls?.isLocked || IS_MOBILE;
  const moveX = Number(app.keys.right) - Number(app.keys.left);
  const moveZ = Number(app.keys.forward) - Number(app.keys.backward);

  if (canMove && (moveX !== 0 || moveZ !== 0)) {
    const length = Math.hypot(moveX, moveZ) || 1;
    const speed = app.settings.moveSpeed * (app.keys.run ? 1.72 : 1);
    app.controls.moveRight((moveX / length) * speed * delta);
    app.controls.moveForward((moveZ / length) * speed * delta);
  }

  const object = app.controls.getObject();
  if (!app.isGrounded || app.verticalVelocity > 0) {
    object.position.y += app.verticalVelocity * delta;
    app.verticalVelocity -= 14.5 * delta;
    if (object.position.y <= CAMERA_HEIGHT) {
      object.position.y = CAMERA_HEIGHT;
      app.verticalVelocity = 0;
      app.isGrounded = true;
    }
  }

  object.position.x = THREE.MathUtils.clamp(object.position.x, -WORLD_LIMIT, WORLD_LIMIT);
  object.position.z = THREE.MathUtils.clamp(object.position.z, -WORLD_LIMIT, WORLD_LIMIT);
}

function updateWorldMotion(delta, elapsed) {
  if (app.skyDome) app.skyDome.rotation.y += delta * 0.006;
  if (app.stars) app.stars.rotation.y -= delta * 0.004;
  app.auroras.forEach((aurora, index) => {
    aurora.material.opacity =
      (0.26 + Math.sin(elapsed * 0.5 + index) * 0.04 + index * 0.08) * app.settings.auroraStrength;
    aurora.position.y += Math.sin(elapsed * 0.35 + index) * 0.002;
    if (aurora.material.map) {
      aurora.material.map.offset.x += delta * (0.01 + index * 0.004);
    }
  });
}

function updateAnimatedAds(delta, elapsed) {
  app.animatedItems.forEach((item) => {
    if (item.kind === "spin") {
      item.object.rotation.y += item.speed * delta * 60;
    }
  });

  app.flyerItems.forEach((item) => {
    if (!item.animate) return;
    item.mesh.position.y = item.baseY + Math.sin(elapsed * 1.8 + item.phase) * 0.025;
    item.mesh.rotation.z = item.baseRotation + Math.sin(elapsed * 0.9 + item.phase) * 0.025;
  });

  app.blimps.forEach((item) => {
    const ad = item.ad;
    item.angle += item.speed * delta * 60;
    const centerX = safeNumber(ad.position?.x, 0);
    const centerZ = safeNumber(ad.position?.z, 0);
    const x = centerX + Math.cos(item.angle) * item.radius;
    const z = centerZ + Math.sin(item.angle) * item.radius;
    const y = item.altitude + Math.sin(elapsed * 0.8 + item.angle) * 0.75;
    item.group.position.set(x, y, z);
    item.group.rotation.y = -item.angle + Math.PI / 2;
  });
}

function loadAdData() {
  app.ads = loadAdsFromStorage();
  buildAds();
}

function getDefaultAds() {
  return [
    {
      ...getBlankAd("booth"),
      id: "sample_booth_space_coffee",
      title: "Space Coffee Booth",
      description: "우주 정거장에서 만나는 프리미엄 커피 광고 부스",
      linkUrl: "https://example.com",
      position: { x: -24, y: 0, z: -20 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: 1,
      boothShape: "square",
    },
    {
      ...getBlankAd("booth"),
      id: "sample_booth_round_moon",
      title: "Moon Hiring Kiosk",
      description: "채용 박람회 스타일의 원형 브랜드 키오스크",
      linkUrl: "https://example.com",
      position: { x: -8, y: 0, z: -20 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: 1,
      boothShape: "round",
    },
    {
      ...getBlankAd("booth"),
      id: "sample_booth_orbit_design",
      title: "Orbit Design Lab",
      description: "신제품 런칭을 위한 사각형 전시 부스",
      linkUrl: "https://example.com",
      position: { x: 8, y: 0, z: -20 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: 1,
      boothShape: "square",
    },
    {
      ...getBlankAd("booth"),
      id: "sample_booth_star_finance",
      title: "Star Finance Booth",
      description: "우주 테마파크 안의 금융 브랜드 체험 부스",
      linkUrl: "https://example.com",
      position: { x: 24, y: 0, z: -20 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: 1,
      boothShape: "square",
    },
    {
      ...getBlankAd("lcd"),
      id: "sample_lcd_neon_travel",
      title: "Neon Travel LCD",
      description: "여행 브랜드용 대형 LCD 전광판",
      linkUrl: "https://example.com",
      position: { x: -18, y: 0, z: -34 },
      rotation: { x: 0, y: THREE.MathUtils.degToRad(8), z: 0 },
      width: 9,
      height: 4.6,
      brightness: 1.35,
    },
    {
      ...getBlankAd("lcd"),
      id: "sample_lcd_future_jobs",
      title: "Future Jobs LCD",
      description: "취업박람회 메인 스폰서 대형 전광판",
      linkUrl: "https://example.com",
      position: { x: 18, y: 0, z: -34 },
      rotation: { x: 0, y: THREE.MathUtils.degToRad(-8), z: 0 },
      width: 9,
      height: 4.6,
      brightness: 1.4,
    },
    {
      ...getBlankAd("pillar"),
      id: "sample_pillar_galaxy_brand",
      title: "Galaxy Brand Pillar",
      description: "원통형 브랜드 광고 기둥",
      linkUrl: "https://example.com",
      position: { x: -28, y: 0, z: 4 },
      rotationSpeed: 0.003,
      radius: 1.35,
      pillarHeight: 6.8,
    },
    {
      ...getBlankAd("pillar"),
      id: "sample_pillar_launch_week",
      title: "Launch Week Pillar",
      description: "입구 동선을 잡아주는 회전형 기둥 광고",
      linkUrl: "https://example.com",
      position: { x: 28, y: 0, z: 4 },
      rotationSpeed: -0.0025,
      radius: 1.2,
      pillarHeight: 6.2,
    },
    {
      ...getBlankAd("flyer"),
      id: "sample_flyer_coupon",
      title: "Coupon Flyers",
      description: "바닥에 흩뿌려진 쿠폰형 전단지",
      linkUrl: "https://example.com",
      flyerCount: 36,
      spreadRadius: 11,
      center: { x: -12, z: 12 },
      animateFlyers: true,
    },
    {
      ...getBlankAd("flyer"),
      id: "sample_flyer_event_pass",
      title: "Event Pass Flyers",
      description: "전시장 중앙 통로에 놓인 이벤트 패스 전단지",
      linkUrl: "https://example.com",
      flyerCount: 28,
      spreadRadius: 10,
      center: { x: 12, z: 12 },
      animateFlyers: true,
    },
    {
      ...getBlankAd("blimp"),
      id: "sample_blimp_floating_logo",
      title: "Floating Logo Blimp",
      description: "하늘을 둥둥 떠다니는 로고 비행선",
      linkUrl: "https://example.com",
      position: { x: 0, y: 0, z: 0 },
      altitude: 19,
      orbitRadius: 33,
      speed: 0.0012,
      startAngle: THREE.MathUtils.degToRad(35),
    },
  ];
}

function getBlankAd(type = "booth") {
  const base = {
    id: generateId(),
    type,
    title: "New Ad",
    description: "새 광고 설명",
    imageUrl: "",
    linkUrl: "",
    active: true,
    position: { x: 0, y: 0, z: -10 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1,
    boothShape: "square",
    width: 8,
    height: 4,
    brightness: 1.2,
    radius: 1,
    pillarHeight: 6,
    rotationSpeed: 0.003,
    flyerCount: 30,
    spreadRadius: 12,
    center: { x: 0, z: 0 },
    animateFlyers: true,
    altitude: 18,
    orbitRadius: 30,
    speed: 0.001,
    startAngle: 0,
  };

  if (type === "lcd") {
    base.position = { x: 0, y: 0, z: -20 };
    base.width = 8;
    base.height = 4;
  }
  if (type === "pillar") {
    base.position = { x: 0, y: 0, z: 0 };
  }
  if (type === "flyer") {
    base.position = { x: 0, y: 0, z: 0 };
    base.center = { x: 0, z: 0 };
  }
  if (type === "blimp") {
    base.position = { x: 0, y: 0, z: 0 };
    base.altitude = 18;
  }
  return base;
}

function loadAdsFromStorage() {
  let shouldSaveDefaults = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ads);
    if (!raw) {
      shouldSaveDefaults = true;
      const defaults = getDefaultAds();
      localStorage.setItem(STORAGE_KEYS.ads, JSON.stringify(defaults));
      return defaults;
    }
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : parsed?.ads;
    if (!Array.isArray(source) || source.length === 0) {
      shouldSaveDefaults = true;
      return getDefaultAds();
    }
    if (isLegacyDefaultAds(source)) {
      shouldSaveDefaults = true;
      return getDefaultAds();
    }
    return source.map((item) => normalizeAd(item)).filter(Boolean);
  } catch (error) {
    console.warn("Failed to load ads from localStorage", error);
    shouldSaveDefaults = true;
    return getDefaultAds();
  } finally {
    if (shouldSaveDefaults) {
      window.setTimeout(() => saveAdsToStorage(app.ads.length ? app.ads : getDefaultAds()), 0);
    }
  }
}

function isLegacyDefaultAds(source) {
  if (!Array.isArray(source) || source.length > 5) return false;
  const legacyIds = new Set([
    "sample_booth_space_coffee",
    "sample_lcd_neon_travel",
    "sample_pillar_galaxy_brand",
    "sample_flyer_coupon",
    "sample_blimp_floating_logo",
  ]);
  return source.length > 0 && source.every((item) => legacyIds.has(item?.id));
}

function normalizeAd(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = AD_TYPES.includes(raw.type) ? raw.type : "booth";
  const defaults = getBlankAd(type);
  return {
    ...defaults,
    ...raw,
    id: String(raw.id || generateId()),
    type,
    title: String(raw.title || defaults.title).slice(0, 80),
    description: String(raw.description || "").slice(0, 220),
    imageUrl: sanitizeUrl(raw.imageUrl || "", true),
    linkUrl: sanitizeUrl(raw.linkUrl || "", false),
    active: raw.active !== false,
    position: {
      x: safeNumber(raw.position?.x, defaults.position.x),
      y: safeNumber(raw.position?.y, defaults.position.y),
      z: safeNumber(raw.position?.z, defaults.position.z),
    },
    rotation: {
      x: safeNumber(raw.rotation?.x, defaults.rotation.x),
      y: safeNumber(raw.rotation?.y, defaults.rotation.y),
      z: safeNumber(raw.rotation?.z, defaults.rotation.z),
    },
    scale: clampNumber(raw.scale, 0.2, 6, defaults.scale),
    boothShape: raw.boothShape === "round" ? "round" : "square",
    width: clampNumber(raw.width, 1, 24, defaults.width),
    height: clampNumber(raw.height, 1, 14, defaults.height),
    brightness: clampNumber(raw.brightness, 0.2, 4, defaults.brightness),
    radius: clampNumber(raw.radius, 0.25, 5, defaults.radius),
    pillarHeight: clampNumber(raw.pillarHeight ?? raw.height, 1, 18, defaults.pillarHeight),
    rotationSpeed: clampNumber(raw.rotationSpeed, -0.06, 0.06, defaults.rotationSpeed),
    flyerCount: Math.round(clampNumber(raw.flyerCount ?? raw.count, 1, 80, defaults.flyerCount)),
    spreadRadius: clampNumber(raw.spreadRadius, 1, 42, defaults.spreadRadius),
    center: {
      x: safeNumber(raw.center?.x ?? raw.centerX, defaults.center.x),
      z: safeNumber(raw.center?.z ?? raw.centerZ, defaults.center.z),
    },
    animateFlyers: raw.animateFlyers !== false,
    altitude: clampNumber(raw.altitude, 6, 54, defaults.altitude),
    orbitRadius: clampNumber(raw.orbitRadius, 6, 58, defaults.orbitRadius),
    speed: clampNumber(raw.speed, -0.02, 0.02, defaults.speed),
    startAngle: safeNumber(raw.startAngle, defaults.startAngle),
  };
}

function saveAdsToStorage(ads = app.ads) {
  try {
    localStorage.setItem(STORAGE_KEYS.ads, JSON.stringify(ads, null, 2));
  } catch (error) {
    showToast("광고 데이터를 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.");
    console.warn("Failed to save ads", error);
  }
  if (!app.firebase.isApplyingRemote) {
    queueSaveAdsToFirebase(ads);
  }
}

function initFirebaseSync() {
  if (!app.firebase.enabled || !app.firebase.adsRef || !app.firebase.api) {
    app.firebase.status = "local";
    renderAdminPanel(app.adminTab);
    return;
  }

  app.firebase.status = "connecting";
  renderAdminPanel(app.adminTab);

  app.firebase.unsubscribeAds = app.firebase.api.onValue(
    app.firebase.adsRef,
    (snapshot) => {
      app.firebase.status = "online";
      app.firebase.lastError = "";
      const value = snapshot.val();

      if (!value) {
        saveAdsToFirebase(app.ads, { silent: true });
        renderAdminPanel(app.adminTab);
        return;
      }

      const source = Array.isArray(value) ? value : value.ads;
      if (!Array.isArray(source)) {
        app.firebase.lastError = "Firebase ads payload is not an array.";
        renderAdminPanel(app.adminTab);
        return;
      }

      const normalized = source.map((item) => normalizeAd(item)).filter(Boolean);
      if (!normalized.length) {
        renderAdminPanel(app.adminTab);
        return;
      }

      const signature = getAdsSignature(normalized);
      if (signature === app.firebase.lastRemoteSignature && signature === getAdsSignature(app.ads)) {
        renderAdminPanel(app.adminTab);
        return;
      }

      app.firebase.lastRemoteSignature = signature;
      app.firebase.isApplyingRemote = true;
      app.ads = normalized;
      saveAdsToStorage(app.ads);
      app.firebase.isApplyingRemote = false;
      rebuildAds();
      renderAdminPanel(app.adminTab);
    },
    (error) => {
      app.firebase.status = "error";
      app.firebase.lastError = error.message || "Firebase read failed";
      console.warn("Firebase ads sync failed", error);
      renderAdminPanel(app.adminTab);
    },
  );
}

function queueSaveAdsToFirebase(ads = app.ads) {
  if (!app.firebase.enabled || !app.firebase.adsRef || !app.firebase.api) return;
  window.clearTimeout(app.firebase.saveTimer);
  app.firebase.saveTimer = window.setTimeout(() => {
    saveAdsToFirebase(ads);
  }, 250);
}

async function saveAdsToFirebase(ads = app.ads, options = {}) {
  if (!app.firebase.enabled || !app.firebase.adsRef || !app.firebase.api) return false;
  const normalized = ads.map((item) => normalizeAd(item)).filter(Boolean);
  const signature = getAdsSignature(normalized);
  try {
    app.firebase.status = "syncing";
    renderAdminPanel(app.adminTab);
    await app.firebase.api.set(app.firebase.adsRef, {
      ads: normalized,
      updatedAt: Date.now(),
      version: 1,
    });
    app.firebase.status = "online";
    app.firebase.lastError = "";
    app.firebase.lastRemoteSignature = signature;
    renderAdminPanel(app.adminTab);
    return true;
  } catch (error) {
    app.firebase.status = "error";
    app.firebase.lastError = error.message || "Firebase write failed";
    console.warn("Failed to save ads to Firebase", error);
    if (!options.silent) showToast("Firebase에 광고 데이터를 저장하지 못했습니다. Database rules를 확인해 주세요.");
    renderAdminPanel(app.adminTab);
    return false;
  }
}

async function fetchAdsFromFirebase() {
  if (!app.firebase.enabled || !app.firebase.adsRef || !app.firebase.api) {
    showToast("Firebase가 연결되지 않아 localStorage 데이터만 사용 중입니다.");
    return false;
  }
  try {
    const snapshot = await app.firebase.api.get(app.firebase.adsRef);
    const value = snapshot.val();
    const source = Array.isArray(value) ? value : value?.ads;
    if (!Array.isArray(source) || !source.length) {
      showToast("Firebase에 저장된 광고 데이터가 없습니다.");
      return false;
    }
    const normalized = source.map((item) => normalizeAd(item)).filter(Boolean);
    app.firebase.isApplyingRemote = true;
    app.ads = normalized;
    saveAdsToStorage(app.ads);
    app.firebase.isApplyingRemote = false;
    rebuildAds();
    renderAdminPanel(app.adminTab);
    showToast("Firebase 광고 데이터를 다시 불러왔습니다.");
    return true;
  } catch (error) {
    app.firebase.status = "error";
    app.firebase.lastError = error.message || "Firebase fetch failed";
    renderAdminPanel(app.adminTab);
    showToast("Firebase 데이터를 불러오지 못했습니다.");
    return false;
  }
}

function getAdsSignature(ads) {
  return JSON.stringify(
    ads.map((ad) => ({
      id: ad.id,
      type: ad.type,
      title: ad.title,
      description: ad.description,
      active: ad.active,
      position: ad.position,
      rotation: ad.rotation,
      scale: ad.scale,
      imageUrl: ad.imageUrl,
      linkUrl: ad.linkUrl,
      boothShape: ad.boothShape,
      width: ad.width,
      height: ad.height,
      radius: ad.radius,
      pillarHeight: ad.pillarHeight,
      flyerCount: ad.flyerCount,
      spreadRadius: ad.spreadRadius,
      center: ad.center,
      altitude: ad.altitude,
      orbitRadius: ad.orbitRadius,
      speed: ad.speed,
    })),
  );
}

function loadSettingsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      starCount: Math.round(clampNumber(parsed.starCount, 150, 2400, DEFAULT_SETTINGS.starCount)),
      auroraStrength: clampNumber(parsed.auroraStrength, 0, 1.4, DEFAULT_SETTINGS.auroraStrength),
      brightness: clampNumber(parsed.brightness, 0.45, 1.9, DEFAULT_SETTINGS.brightness),
      moveSpeed: clampNumber(parsed.moveSpeed, 3, 22, DEFAULT_SETTINGS.moveSpeed),
      mouseSensitivity: clampNumber(parsed.mouseSensitivity, 0.35, 2.5, DEFAULT_SETTINGS.mouseSensitivity),
      zoomFov: clampNumber(parsed.zoomFov, 54, 86, DEFAULT_SETTINGS.zoomFov),
      detectionMultiplier: clampNumber(parsed.detectionMultiplier, 0.4, 3, DEFAULT_SETTINGS.detectionMultiplier),
      flyerMaxCount: Math.round(clampNumber(parsed.flyerMaxCount, 5, 80, DEFAULT_SETTINGS.flyerMaxCount)),
    };
  } catch (error) {
    console.warn("Failed to load settings", error);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettingsToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(app.settings, null, 2));
  } catch (error) {
    showToast("월드 설정을 저장하지 못했습니다.");
  }
}

function exportAdsJSON() {
  const payload = JSON.stringify(app.ads, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `adverse-ads-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importAdsJSON(text) {
  try {
    const parsed = JSON.parse(text);
    const source = Array.isArray(parsed) ? parsed : parsed?.ads;
    if (!Array.isArray(source)) {
      throw new Error("JSON must be an array or an object with ads array.");
    }
    const normalized = source.map((item) => normalizeAd(item)).filter(Boolean);
    if (!normalized.length) {
      throw new Error("No valid ad objects found.");
    }
    app.ads = normalized;
    saveAdsToStorage();
    rebuildAds();
    renderAdminPanel("list");
    showToast("JSON 데이터를 적용했습니다.");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || "JSON을 읽을 수 없습니다." };
  }
}

function buildAds() {
  clearAdObjects();
  app.ads.forEach((ad) => {
    if (!ad.active) return;
    const record = createAdObject(ad);
    if (!record) return;
    app.scene.add(record.group);
    app.adRecords.push(record);
  });
}

function clearAdObjects() {
  app.adRecords.forEach((record) => {
    app.scene.remove(record.group);
    disposeObject(record.group);
  });
  app.adRecords = [];
  app.animatedItems = [];
  app.blimps = [];
  app.flyerItems = [];
  app.currentNearbyAdId = null;
  hideAdPopup();
}

function rebuildAds() {
  buildAds();
}

function createAdObject(ad) {
  switch (ad.type) {
    case "booth":
      return createBoothAd(ad);
    case "lcd":
      return createLCDAd(ad);
    case "pillar":
      return createPillarAd(ad);
    case "flyer":
      return createFlyerAd(ad);
    case "blimp":
      return createBlimpAd(ad);
    default:
      return createBoothAd(ad);
  }
}

function createBoothAd(ad) {
  if (ad.boothShape === "round") return createRoundBoothAd(ad);

  const group = new THREE.Group();
  group.name = `Booth Ad - ${ad.title}`;
  applyTransform(group, ad);

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x253064,
    roughness: 0.48,
    metalness: 0.22,
    emissive: 0x0f1c46,
    emissiveIntensity: 0.32,
  });
  const trimMaterial = new THREE.MeshBasicMaterial({
    color: 0x00d4ff,
    transparent: true,
    opacity: 0.82,
  });

  const base = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.35, 3.4), baseMaterial);
  base.position.set(0, 0.18, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.35, 3.1), baseMaterial.clone());
  leftWall.position.set(-2.9, 1.4, -0.05);
  leftWall.castShadow = true;
  group.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.35, 3.1), baseMaterial.clone());
  rightWall.position.set(2.9, 1.4, -0.05);
  rightWall.castShadow = true;
  group.add(rightWall);

  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(5.4, 3.3, 0.22), baseMaterial.clone());
  backPanel.position.set(0, 2.08, -1.56);
  backPanel.castShadow = true;
  group.add(backPanel);

  const adPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(4.65, 2.45),
    createAdPlaneMaterial(ad, { aspect: 4.65 / 2.45, emissive: false }),
  );
  adPlane.position.set(0, 2.12, -1.685);
  adPlane.castShadow = false;
  group.add(adPlane);

  const sign = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.74, 0.34), baseMaterial.clone());
  sign.position.set(0, 4.05, -1.55);
  group.add(sign);

  const signPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(5.15, 0.48),
    new THREE.MeshBasicMaterial({
      map: createTextTexture(ad.title, "AD BOOTH", 1024, 256, ["#7c5cff", "#00d4ff"]),
    }),
  );
  signPlane.position.set(0, 4.05, -1.73);
  group.add(signPlane);

  [-2.92, 2.92].forEach((x) => {
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.7, 10), trimMaterial.clone());
    column.position.set(x, 2.05, -1.72);
    group.add(column);
  });

  const glowLine = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.04, 0.04), trimMaterial.clone());
  glowLine.position.set(0, 0.54, 1.74);
  group.add(glowLine);

  const light = new THREE.PointLight(0x00d4ff, 1.2, 13, 2.2);
  light.position.set(0, 3.6, 0.3);
  group.add(light);

  return {
    ad,
    group,
    getFocusPosition: () => group.localToWorld(new THREE.Vector3(0, 2.1, 0)),
  };
}

function createRoundBoothAd(ad) {
  const group = new THREE.Group();
  group.name = `Round Booth Ad - ${ad.title}`;
  applyTransform(group, ad);

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x273a7f,
    roughness: 0.44,
    metalness: 0.25,
    emissive: 0x10275c,
    emissiveIntensity: 0.34,
  });
  const trimMaterial = new THREE.MeshBasicMaterial({
    color: 0xffcc70,
    transparent: true,
    opacity: 0.82,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 3.05, 0.45, 56), baseMaterial);
  base.position.y = 0.23;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const kiosk = new THREE.Mesh(new THREE.CylinderGeometry(1.78, 1.98, 2.85, 56, 1, true), baseMaterial.clone());
  kiosk.position.y = 1.92;
  kiosk.castShadow = true;
  group.add(kiosk);

  const screenMaterial = createAdPlaneMaterial(ad, { aspect: 1.35, emissive: false });
  [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((angle) => {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.82, 1.34), screenMaterial.clone());
    screen.position.set(Math.sin(angle) * 2.02, 2.05, Math.cos(angle) * 2.02);
    screen.rotation.y = angle;
    group.add(screen);
  });

  const halo = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.045, 8, 96), trimMaterial.clone());
  halo.position.y = 3.5;
  halo.rotation.x = Math.PI / 2;
  group.add(halo);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 0.72),
    new THREE.MeshBasicMaterial({
      map: createTextTexture(ad.title, "ROUND BOOTH", 1024, 256, ["#4a90e2", "#7c5cff"]),
      transparent: false,
    }),
  );
  sign.position.set(0, 3.55, 2.1);
  group.add(sign);

  const light = new THREE.PointLight(0xffcc70, 1.25, 13, 2.2);
  light.position.set(0, 3.6, 0);
  group.add(light);

  return {
    ad,
    group,
    getFocusPosition: () => group.localToWorld(new THREE.Vector3(0, 2.1, 0)),
  };
}

function createLCDAd(ad) {
  const group = new THREE.Group();
  group.name = `LCD Ad - ${ad.title}`;
  applyTransform(group, ad);

  const width = clampNumber(ad.width, 1, 24, 8);
  const height = clampNumber(ad.height, 1, 14, 4);
  const screenY = height / 2 + 2.15;

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x070a17,
    roughness: 0.42,
    metalness: 0.42,
    emissive: 0x0c1028,
    emissiveIntensity: 0.28,
  });

  const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.55, height + 0.55, 0.34), frameMaterial);
  frame.position.set(0, screenY, -0.05);
  frame.castShadow = true;
  group.add(frame);

  const screenMaterial = createAdPlaneMaterial(ad, {
    aspect: width / height,
    emissive: true,
    brightness: ad.brightness,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), screenMaterial);
  screen.position.set(0, screenY, 0.15);
  group.add(screen);

  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c2759,
    roughness: 0.5,
    metalness: 0.32,
  });
  [-width * 0.36, width * 0.36].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.2, 0.18), legMaterial);
    leg.position.set(x, 1.1, -0.08);
    leg.castShadow = true;
    group.add(leg);
  });
  const foot = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, 0.2, 1.15), legMaterial);
  foot.position.set(0, 0.1, -0.06);
  foot.castShadow = true;
  group.add(foot);

  const light = new THREE.PointLight(0xffffff, clampNumber(ad.brightness, 0.2, 4, 1.2), 18, 2);
  light.position.set(0, screenY, 1.4);
  group.add(light);

  return {
    ad,
    group,
    getFocusPosition: () => group.localToWorld(new THREE.Vector3(0, screenY, 0.6)),
  };
}

function createPillarAd(ad) {
  const group = new THREE.Group();
  group.name = `Pillar Ad - ${ad.title}`;
  applyTransform(group, ad);

  const radius = clampNumber(ad.radius, 0.25, 5, 1);
  const height = clampNumber(ad.pillarHeight, 1, 18, 6);
  const pillarMaterial = createAdPlaneMaterial(ad, {
    aspect: 1,
    emissive: false,
  });
  pillarMaterial.side = THREE.DoubleSide;

  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 48, 1, false), pillarMaterial);
  cylinder.position.y = height / 2 + 0.45;
  cylinder.castShadow = true;
  group.add(cylinder);

  const capMaterial = new THREE.MeshStandardMaterial({
    color: 0x27306b,
    roughness: 0.42,
    metalness: 0.32,
    emissive: 0x101c46,
    emissiveIntensity: 0.25,
  });
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.25, radius * 1.35, 0.45, 48), capMaterial);
  bottom.position.y = 0.22;
  bottom.castShadow = true;
  group.add(bottom);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.18, radius * 1.18, 0.28, 48), capMaterial);
  top.position.y = height + 0.7;
  group.add(top);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffcc70,
    transparent: true,
    opacity: 0.7,
  });
  [0.7, height + 0.35].forEach((y) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.04, 0.035, 8, 80), ringMaterial.clone());
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  });

  const light = new THREE.PointLight(0xffcc70, 1.2, 14, 2.1);
  light.position.set(0, height * 0.66, 0);
  group.add(light);

  app.animatedItems.push({
    kind: "spin",
    object: cylinder,
    speed: clampNumber(ad.rotationSpeed, -0.06, 0.06, 0.003),
  });

  return {
    ad,
    group,
    getFocusPosition: () => group.localToWorld(new THREE.Vector3(0, height / 2 + 0.5, 0)),
  };
}

function createFlyerAd(ad) {
  const group = new THREE.Group();
  group.name = `Flyer Ad - ${ad.title}`;

  const maxCount = Math.min(80, Math.max(1, app.settings.flyerMaxCount));
  const count = Math.round(clampNumber(ad.flyerCount, 1, maxCount, 24));
  const spread = clampNumber(ad.spreadRadius, 1, 42, 12);
  const centerX = safeNumber(ad.center?.x, 0);
  const centerZ = safeNumber(ad.center?.z, 0);
  const material = createAdPlaneMaterial(ad, { aspect: 1.45, emissive: false });
  material.side = THREE.DoubleSide;

  const locations = [];
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * spread;
    const x = centerX + Math.cos(angle) * radius;
    const z = centerZ + Math.sin(angle) * radius;
    const scale = THREE.MathUtils.randFloat(0.75, 1.18);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.45 * scale, 1 * scale), material.clone());
    const y = 0.065 + i * 0.0008;
    mesh.position.set(x, y, z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.receiveShadow = true;
    group.add(mesh);
    locations.push(mesh.position);
    app.flyerItems.push({
      mesh,
      baseY: y,
      baseRotation: mesh.rotation.z,
      phase: Math.random() * Math.PI * 2,
      animate: ad.animateFlyers,
    });
  }

  const marker = new THREE.PointLight(0x7c5cff, 0.45, Math.max(8, spread * 0.8), 2.1);
  marker.position.set(centerX, 1.6, centerZ);
  group.add(marker);

  return {
    ad,
    group,
    locations,
    getFocusPosition: () => getClosestFlyerPosition({ locations }),
  };
}

function createBlimpAd(ad) {
  const group = new THREE.Group();
  group.name = `Blimp Ad - ${ad.title}`;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xdde6ff,
    roughness: 0.46,
    metalness: 0.08,
    emissive: 0x162052,
    emissiveIntensity: 0.2,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0x7c5cff,
    roughness: 0.52,
    metalness: 0.12,
    emissive: 0x211066,
    emissiveIntensity: 0.28,
  });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 18), bodyMaterial);
  body.scale.set(3.35, 1.08, 1.08);
  body.castShadow = true;
  group.add(body);

  const logoMaterial = createAdPlaneMaterial(ad, { aspect: 2.8, emissive: true, brightness: 1.1 });
  const leftLogo = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.1), logoMaterial);
  leftLogo.position.set(0.15, 0.05, 1.1);
  group.add(leftLogo);
  const rightLogo = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.1), logoMaterial.clone());
  rightLogo.position.set(0.15, 0.05, -1.1);
  rightLogo.rotation.y = Math.PI;
  group.add(rightLogo);

  const gondola = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.45, 0.62), accentMaterial);
  gondola.position.set(0.2, -1.05, 0);
  gondola.castShadow = true;
  group.add(gondola);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.1, 4), accentMaterial.clone());
  tail.position.set(-3.35, 0.02, 0);
  tail.rotation.z = Math.PI / 2;
  group.add(tail);

  const finTop = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.78, 0.9), accentMaterial.clone());
  finTop.position.set(-2.75, 0.88, 0);
  group.add(finTop);
  const finSide = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 1.18), accentMaterial.clone());
  finSide.position.set(-2.75, -0.02, 0);
  finSide.rotation.x = Math.PI / 2;
  group.add(finSide);

  const light = new THREE.PointLight(0xffffff, 1.05, 18, 2);
  light.position.set(0.5, 0.2, 0);
  group.add(light);

  const item = {
    ad,
    group,
    angle: safeNumber(ad.startAngle, 0),
    speed: clampNumber(ad.speed, -0.02, 0.02, 0.001),
    radius: clampNumber(ad.orbitRadius, 6, 58, 30),
    altitude: clampNumber(ad.altitude, 6, 54, 18),
  };
  app.blimps.push(item);
  updateBlimpInitialPosition(item);

  return {
    ad,
    group,
    getFocusPosition: () => group.getWorldPosition(new THREE.Vector3()),
  };
}

function updateBlimpInitialPosition(item) {
  const ad = item.ad;
  const centerX = safeNumber(ad.position?.x, 0);
  const centerZ = safeNumber(ad.position?.z, 0);
  item.group.position.set(
    centerX + Math.cos(item.angle) * item.radius,
    item.altitude,
    centerZ + Math.sin(item.angle) * item.radius,
  );
  item.group.rotation.y = -item.angle + Math.PI / 2;
}

function applyTransform(group, ad) {
  group.position.set(
    safeNumber(ad.position?.x, 0),
    safeNumber(ad.position?.y, 0),
    safeNumber(ad.position?.z, 0),
  );
  group.rotation.set(
    safeNumber(ad.rotation?.x, 0),
    safeNumber(ad.rotation?.y, 0),
    safeNumber(ad.rotation?.z, 0),
  );
  const scale = clampNumber(ad.scale, 0.2, 6, 1);
  group.scale.setScalar(scale);
}

function createAdPlaneMaterial(ad, options = {}) {
  const aspect = safeNumber(options.aspect, 2);
  const placeholder = createPlaceholderTexture(ad.title, ad.type, aspect);
  const baseOptions = {
    map: placeholder,
    transparent: false,
  };
  const material = options.emissive
    ? new THREE.MeshBasicMaterial({
        ...baseOptions,
        color: new THREE.Color(options.brightness || 1, options.brightness || 1, options.brightness || 1),
      })
    : new THREE.MeshStandardMaterial({
        ...baseOptions,
        roughness: 0.58,
        metalness: 0.08,
        emissive: 0x141f45,
        emissiveIntensity: 0.22,
      });

  const imageUrl = sanitizeUrl(ad.imageUrl, true);
  if (imageUrl) {
    app.textureLoader.load(
      imageUrl,
      (texture) => {
        configureTexture(texture, aspect);
        material.map = texture;
        material.needsUpdate = true;
      },
      undefined,
      () => {
        console.warn(
          `Image texture failed for "${ad.title}". JPG/PNG/WebP are supported, but WebGL textures require CORS-enabled image URLs.`,
          imageUrl,
        );
        material.map = placeholder;
        material.needsUpdate = true;
      },
    );
  }
  return material;
}

function configureTexture(texture, targetAspect) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = app.renderer ? Math.min(app.renderer.capabilities.getMaxAnisotropy(), 8) : 4;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  const image = texture.image;
  if (image?.width && image?.height && targetAspect) {
    const imageAspect = image.width / image.height;
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    if (imageAspect > targetAspect) {
      texture.repeat.x = targetAspect / imageAspect;
      texture.offset.x = (1 - texture.repeat.x) / 2;
    } else {
      texture.repeat.y = imageAspect / targetAspect;
      texture.offset.y = (1 - texture.repeat.y) / 2;
    }
  }
  texture.needsUpdate = true;
}

function createPlaceholderTexture(title, type = "ad", aspect = 2) {
  const key = `${title}|${type}|${Math.round(aspect * 100)}`;
  if (app.placeholderCache.has(key)) return app.placeholderCache.get(key).clone();

  const wide = aspect >= 1;
  const canvas = document.createElement("canvas");
  canvas.width = wide ? 1024 : 640;
  canvas.height = wide ? Math.max(384, Math.round(1024 / aspect)) : 1024;
  if (canvas.height > 1024) canvas.height = 1024;

  const ctx = canvas.getContext("2d");
  const palette = getTypePalette(type);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, palette[0]);
  gradient.addColorStop(0.55, palette[1]);
  gradient.addColorStop(1, palette[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let i = 0; i < 36; i += 1) {
    const x = seededRandom(`${key}-${i}`) * canvas.width;
    const y = seededRandom(`${key}-y-${i}`) * canvas.height;
    const size = 2 + seededRandom(`${key}-s-${i}`) * 5;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 6;
  ctx.strokeRect(34, 34, canvas.width - 68, canvas.height - 68);

  ctx.fillStyle = "rgba(5,8,20,0.26)";
  ctx.fillRect(64, canvas.height * 0.18, canvas.width - 128, canvas.height * 0.64);

  ctx.fillStyle = "#F5F7FF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${wide ? 76 : 64}px Pretendard, system-ui, sans-serif`;
  drawWrappedText(ctx, title || "AD SPACE", canvas.width / 2, canvas.height * 0.46, canvas.width - 160, wide ? 84 : 72, 2);

  ctx.font = `900 ${wide ? 34 : 28}px Pretendard, system-ui, sans-serif`;
  ctx.fillStyle = "#FFCC70";
  ctx.fillText("AD SPACE", canvas.width / 2, canvas.height * 0.72);

  ctx.font = `800 ${wide ? 22 : 20}px Pretendard, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(245,247,255,0.76)";
  ctx.fillText(TYPE_LABEL[type]?.toUpperCase() || "VIRTUAL AD", canvas.width / 2, canvas.height * 0.82);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  app.placeholderCache.set(key, texture);
  return texture.clone();
}

function createTextTexture(title, subtitle, width = 1024, height = 256, colors = ["#111936", "#4a90e2"]) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, width - 28, height - 28);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#F5F7FF";
  ctx.font = "900 58px Pretendard, system-ui, sans-serif";
  drawWrappedText(ctx, title, width / 2, height * 0.46, width - 90, 62, 1);
  ctx.fillStyle = "#FFCC70";
  ctx.font = "800 24px Pretendard, system-ui, sans-serif";
  ctx.fillText(subtitle, width / 2, height * 0.75);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getTypePalette(type) {
  const palettes = {
    booth: ["#1b2a68", "#7c5cff", "#00d4ff"],
    lcd: ["#071233", "#4a90e2", "#ffcc70"],
    pillar: ["#24124f", "#7c5cff", "#ffcc70"],
    flyer: ["#22345d", "#00d4ff", "#ffcc70"],
    blimp: ["#0b1026", "#4a90e2", "#f5f7ff"],
  };
  return palettes[type] || palettes.booth;
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const source = String(text || "").trim() || "AD SPACE";
  const words = source.includes(" ") ? source.split(/\s+/) : Array.from(source);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const next = source.includes(" ") ? `${line}${line ? " " : ""}${word}` : `${line}${word}`;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);

  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) visible[visible.length - 1] = `${visible[visible.length - 1].slice(0, -1)}…`;
  const startY = y - ((visible.length - 1) * lineHeight) / 2;
  visible.forEach((lineText, index) => {
    ctx.fillText(lineText, x, startY + index * lineHeight);
  });
}

function checkNearbyAds() {
  if (!app.adRecords.length) {
    hideAdPopup();
    return;
  }

  const playerPosition = app.controls.getObject().position;
  let best = null;

  app.adRecords.forEach((record) => {
    const ad = record.ad;
    const focus = record.ad.type === "flyer" ? getClosestFlyerPosition(record) : record.getFocusPosition();
    const distance = playerPosition.distanceTo(focus);
    const threshold = PROXIMITY_BY_TYPE[ad.type] * app.settings.detectionMultiplier;

    if (app.manuallyHiddenAds.has(ad.id) && distance > threshold * 1.35) {
      app.manuallyHiddenAds.delete(ad.id);
    }
    if (app.manuallyHiddenAds.has(ad.id)) return;

    if (distance <= threshold) {
      const score = distance / threshold;
      if (!best || score < best.score) best = { ad, distance, score };
    }
  });

  if (best) {
    showAdPopup(best.ad);
  } else {
    hideAdPopup();
  }
}

function getClosestFlyerPosition(record) {
  const playerPosition = app.controls.getObject().position;
  let closest = null;
  let closestDistance = Infinity;
  record.locations.forEach((localPosition) => {
    const worldPosition = localPosition.clone();
    const distance = playerPosition.distanceTo(worldPosition);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = worldPosition;
    }
  });
  return closest || new THREE.Vector3();
}

function showAdPopup(ad) {
  if (app.currentNearbyAdId !== ad.id) {
    app.currentNearbyAdId = ad.id;
    app.dom.adPopupTitle.textContent = ad.title;
    app.dom.adPopupDescription.textContent = ad.description || "광고 설명이 없습니다.";
    app.dom.adPopupThumb.style.backgroundImage = getAdThumbBackground(ad);
    const canOpen = Boolean(sanitizeUrl(ad.linkUrl, false));
    app.dom.adPopupLink.disabled = !canOpen;
    app.dom.adPopupLink.textContent = canOpen ? "F · 광고 페이지 열기" : "링크 없음";
  }
  app.dom.adPopup.classList.remove("hidden");
}

function hideAdPopup() {
  app.currentNearbyAdId = null;
  if (app.dom.adPopup) app.dom.adPopup.classList.add("hidden");
}

function openAdLink(ad) {
  const url = sanitizeUrl(ad.linkUrl, false);
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function getAdThumbUrl(ad) {
  const imageUrl = sanitizeUrl(ad.imageUrl, true);
  if (imageUrl) return imageUrl.replace(/"/g, "%22");
  const key = `thumb|${ad.id}|${ad.title}`;
  if (app.placeholderCache.has(key)) {
    return app.placeholderCache.get(key);
  }
  const texture = createPlaceholderTexture(ad.title, ad.type, 1.45);
  const dataUrl = texture.image.toDataURL("image/png");
  app.placeholderCache.set(key, dataUrl);
  return dataUrl;
}

function getAdThumbBackground(ad) {
  const placeholder = getAdThumbUrl({ ...ad, imageUrl: "" });
  const imageUrl = sanitizeUrl(ad.imageUrl, true);
  if (!imageUrl) return `url("${placeholder}")`;
  return `url("${imageUrl.replace(/"/g, "%22")}"), url("${placeholder}")`;
}

function openLoginModal() {
  stopPlacementMode(false);
  try {
    app.controls.unlock();
  } catch (error) {
    // Pointer lock may already be released.
  }
  app.dom.loginModal.classList.remove("hidden");
  app.dom.loginModal.setAttribute("aria-hidden", "false");
  app.dom.loginError.textContent = "";
  app.dom.adminId.value = "";
  app.dom.adminPassword.value = "";
  window.setTimeout(() => app.dom.adminId.focus(), 20);
}

function closeLoginModal() {
  app.dom.loginModal.classList.add("hidden");
  app.dom.loginModal.setAttribute("aria-hidden", "true");
}

function handleLogin(event) {
  event.preventDefault();
  const id = app.dom.adminId.value.trim();
  const password = app.dom.adminPassword.value;
  if (id === "admin" && password === "1234") {
    app.admin = true;
    localStorage.setItem(STORAGE_KEYS.adminSession, "true");
    closeLoginModal();
    renderAdminPanel("list");
    app.dom.adminPanel.classList.remove("hidden");
    app.dom.loginButton.textContent = "Admin";
    showToast("관리자로 로그인했습니다.");
    return;
  }
  app.dom.loginError.textContent = "아이디 또는 비밀번호가 올바르지 않습니다.";
}

function logoutAdmin() {
  app.admin = false;
  localStorage.removeItem(STORAGE_KEYS.adminSession);
  app.dom.adminPanel.classList.add("hidden");
  app.dom.loginButton.textContent = "Login";
  showToast("로그아웃했습니다.");
}

function applyAdminSession() {
  app.admin = localStorage.getItem(STORAGE_KEYS.adminSession) === "true";
  if (app.admin) {
    app.dom.loginButton.textContent = "Admin";
    renderAdminPanel("list");
    app.dom.adminPanel.classList.remove("hidden");
  }
}

function renderAdminPanel(tab = app.adminTab) {
  if (!app.admin) return;
  app.adminTab = tab;
  const collapsed = app.dom.adminPanel.classList.contains("collapsed");
  app.dom.adminPanel.className = `admin-panel${collapsed ? " collapsed" : ""}`;
  app.dom.adminPanel.innerHTML = `
    <header class="admin-head">
      <div class="admin-title">
        <strong>Admin Panel</strong>
        <small>${app.ads.length} ads · ${getFirebaseStatusLabel()}</small>
      </div>
      <div class="admin-actions">
        <button type="button" class="icon-button" data-action="toggle-panel" title="접기/펼치기">↔</button>
        <button type="button" class="ghost-button" data-action="logout">Logout</button>
      </div>
    </header>
    <nav class="admin-tabs" aria-label="관리자 메뉴">
      ${adminTabButton("list", "광고 목록")}
      ${adminTabButton("form", "광고 추가")}
      ${adminTabButton("settings", "월드 설정")}
      ${adminTabButton("data", "데이터 관리")}
    </nav>
    <div class="admin-content">${renderAdminContent(tab)}</div>
  `;
  if (tab === "form") {
    const type = document.getElementById("adType")?.value || "booth";
    updateVisibleTypeFields(type);
  }
}

function getFirebaseStatusLabel() {
  const labels = {
    connecting: "Firebase connecting",
    online: "Firebase online",
    syncing: "Firebase syncing",
    error: "Firebase error",
    local: "local cache",
  };
  return labels[app.firebase.status] || "local cache";
}

function adminTabButton(tab, label) {
  return `<button type="button" data-action="tab" data-tab="${tab}" class="${app.adminTab === tab ? "active" : ""}">${label}</button>`;
}

function renderAdminContent(tab) {
  if (tab === "form") return renderAdForm();
  if (tab === "settings") return renderSettingsFormV2();
  if (tab === "data") return renderDataPanelV2();
  return renderAdList();
}

function renderAdList() {
  if (!app.ads.length) {
    return `
      <div class="ad-list">
        <button type="button" class="primary-button" data-action="add-ad">광고 추가</button>
        <p class="admin-message">광고 데이터가 없습니다.</p>
      </div>
    `;
  }

  return `
    <div class="ad-list">
      <button type="button" class="primary-button" data-action="add-ad">광고 추가</button>
      ${app.ads
        .map((ad) => {
          const pos = ad.type === "flyer" ? `center ${formatNumber(ad.center.x)}, ${formatNumber(ad.center.z)}` : `${formatNumber(ad.position.x)}, ${formatNumber(ad.position.y)}, ${formatNumber(ad.position.z)}`;
          return `
            <article class="ad-card">
              <div class="ad-card-head">
                <div>
                  <span class="badge ${ad.active ? "" : "off"}">${escapeHTML(TYPE_LABEL[ad.type] || ad.type)}</span>
                  <strong>${escapeHTML(ad.title)}</strong>
                </div>
                <span class="badge ${ad.active ? "" : "off"}">${ad.active ? "ON" : "OFF"}</span>
              </div>
              <p>${escapeHTML(ad.description || "설명 없음")}</p>
              <p>위치: ${escapeHTML(pos)}</p>
              <div class="ad-card-actions">
                <button type="button" class="small-button" data-action="edit-ad" data-id="${ad.id}">수정</button>
                <button type="button" class="small-button" data-action="focus-ad" data-id="${ad.id}">위치로 이동</button>
                <button type="button" class="danger-button" data-action="delete-ad" data-id="${ad.id}">삭제</button>
              </div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderAdForm() {
  const ad = app.editingAdId
    ? app.ads.find((item) => item.id === app.editingAdId) || getBlankAd("booth")
    : getBlankAd("booth");
  const title = app.editingAdId ? "광고 수정" : "광고 추가";
  const rotationY = THREE.MathUtils.radToDeg(safeNumber(ad.rotation?.y, 0));
  const startAngle = THREE.MathUtils.radToDeg(safeNumber(ad.startAngle, 0));

  return `
    <form id="adForm" class="admin-form">
      <h3>${title}</h3>
      <div class="form-grid">
        <label>광고 타입
          <select id="adType" name="type">
            ${AD_TYPES.map((type) => `<option value="${type}" ${ad.type === type ? "selected" : ""}>${TYPE_LABEL[type]}</option>`).join("")}
          </select>
        </label>
        <label class="check-row">
          <input type="checkbox" name="active" ${ad.active ? "checked" : ""} />
          활성화
        </label>
      </div>
      <div class="form-grid single">
        <label>광고명
          <input name="title" value="${escapeAttr(ad.title)}" maxlength="80" />
        </label>
        <label>설명
          <textarea name="description" maxlength="220">${escapeHTML(ad.description || "")}</textarea>
        </label>
        <label>이미지 URL
          <input name="imageUrl" value="${escapeAttr(ad.imageUrl || "")}" placeholder="https://..." />
          <small class="form-help">JPG/PNG/WebP/AVIF 모두 가능하지만 WebGL 광고판에는 이미지 서버의 CORS 허용이 필요합니다.</small>
        </label>
        <label>광고 링크 URL
          <input name="linkUrl" value="${escapeAttr(ad.linkUrl || "")}" placeholder="https://example.com" />
        </label>
      </div>
      <div class="form-grid">
        ${numberField("positionX", "Position X", ad.position?.x, 0.1)}
        ${numberField("positionY", "Position Y", ad.position?.y, 0.1)}
        ${numberField("positionZ", "Position Z", ad.position?.z, 0.1)}
        ${numberField("rotationY", "Rotation Y (deg)", rotationY, 1)}
        ${numberField("scale", "Scale", ad.scale, 0.1)}
      </div>

      <div class="type-fields" data-type-fields="booth">
        <div class="form-grid">
          <label>Booth Shape
            <select name="boothShape">
              <option value="square" ${ad.boothShape !== "round" ? "selected" : ""}>Square Expo Booth</option>
              <option value="round" ${ad.boothShape === "round" ? "selected" : ""}>Round Kiosk Booth</option>
            </select>
          </label>
        </div>
      </div>

      <div class="type-fields" data-type-fields="lcd">
        <div class="form-grid">
          ${numberField("width", "LCD Width", ad.width, 0.1)}
          ${numberField("height", "LCD Height", ad.height, 0.1)}
          ${numberField("brightness", "Brightness", ad.brightness, 0.1)}
        </div>
      </div>

      <div class="type-fields" data-type-fields="pillar">
        <div class="form-grid">
          ${numberField("radius", "Radius", ad.radius, 0.1)}
          ${numberField("pillarHeight", "Pillar Height", ad.pillarHeight, 0.1)}
          ${numberField("rotationSpeed", "Rotation Speed", ad.rotationSpeed, 0.001)}
        </div>
      </div>

      <div class="type-fields" data-type-fields="flyer">
        <div class="form-grid">
          ${numberField("flyerCount", "Flyer Count", ad.flyerCount, 1)}
          ${numberField("spreadRadius", "Spread Radius", ad.spreadRadius, 0.5)}
          ${numberField("centerX", "Center X", ad.center?.x, 0.1)}
          ${numberField("centerZ", "Center Z", ad.center?.z, 0.1)}
          <label class="check-row">
            <input type="checkbox" name="animateFlyers" ${ad.animateFlyers ? "checked" : ""} />
            전단지 움직임
          </label>
        </div>
      </div>

      <div class="type-fields" data-type-fields="blimp">
        <div class="form-grid">
          ${numberField("altitude", "Altitude", ad.altitude, 0.5)}
          ${numberField("orbitRadius", "Orbit Radius", ad.orbitRadius, 0.5)}
          ${numberField("speed", "Speed", ad.speed, 0.001)}
          ${numberField("startAngle", "Start Angle (deg)", startAngle, 1)}
        </div>
      </div>

      <p id="adFormMessage" class="admin-message"></p>
      <div class="form-row-actions">
        <button type="submit" class="primary-button">저장</button>
        <button type="button" class="small-button" data-action="test-image-url">이미지 테스트</button>
        <button type="button" class="small-button" data-action="placement-start">3D 격자로 배치</button>
        <button type="button" class="ghost-button hidden" data-action="placement-stop">배치 종료</button>
        <button type="button" class="ghost-button" data-action="cancel-form">취소</button>
      </div>
    </form>
  `;
}

function numberField(name, label, value, step = 1) {
  return `
    <label>${label}
      <input type="number" name="${name}" value="${escapeAttr(formatNumber(value ?? 0))}" step="${step}" />
    </label>
  `;
}

function renderSettingsForm() {
  const settings = app.settings;
  return `
    <form id="settingsForm" class="admin-form">
      <h3>월드 설정</h3>
      <div class="form-grid">
        ${numberField("starCount", "별 파티클 개수", settings.starCount, 1)}
        ${numberField("auroraStrength", "오로라 강도", settings.auroraStrength, 0.05)}
        ${numberField("brightness", "전체 밝기", settings.brightness, 0.05)}
        ${numberField("moveSpeed", "이동 속도", settings.moveSpeed, 0.5)}
        ${numberField("mouseSensitivity", "마우스 민감도", settings.mouseSensitivity, 0.05)}
        ${numberField("zoomFov", "기본 줌 FOV", settings.zoomFov, 1)}
        ${numberField("detectionMultiplier", "광고 감지 거리 배율", settings.detectionMultiplier, 0.1)}
        ${numberField("flyerMaxCount", "전단지 최대 개수", settings.flyerMaxCount, 1)}
      </div>
      <p class="admin-message ok">설정 저장 시 월드와 광고가 즉시 갱신됩니다.</p>
      <button type="submit" class="primary-button">설정 저장</button>
    </form>
  `;
}

function renderDataPanel() {
  return `
    <div class="admin-form">
      <h3>데이터 관리</h3>
      <div class="form-row-actions">
        <button type="button" class="small-button" data-action="export-json">JSON Export</button>
        <button type="button" class="danger-button" data-action="reset-samples">샘플로 초기화</button>
      </div>
      <form id="importForm" class="admin-form">
        <label>JSON Import
          <textarea id="importJson" class="json-area" placeholder='[{"type":"lcd","title":"New LCD"}]'></textarea>
        </label>
        <p id="importMessage" class="admin-message"></p>
        <button type="submit" class="primary-button">적용</button>
      </form>
    </div>
  `;
}

function renderSettingsFormV2() {
  const settings = app.settings;
  return `
    <form id="settingsForm" class="admin-form">
      <h3>World Settings</h3>
      <div class="form-grid">
        ${numberField("starCount", "Star particle count", settings.starCount, 1)}
        ${numberField("auroraStrength", "Aurora strength", settings.auroraStrength, 0.05)}
        ${numberField("brightness", "World brightness", settings.brightness, 0.05)}
        ${numberField("moveSpeed", "Move speed", settings.moveSpeed, 0.5)}
        ${numberField("mouseSensitivity", "Mouse sensitivity", settings.mouseSensitivity, 0.05)}
        ${numberField("zoomFov", "Default zoom FOV", settings.zoomFov, 1)}
        ${numberField("detectionMultiplier", "Ad detection multiplier", settings.detectionMultiplier, 0.1)}
        ${numberField("flyerMaxCount", "Max flyer count", settings.flyerMaxCount, 1)}
      </div>
      <p class="admin-message ok">Settings apply immediately to this browser.</p>
      <button type="submit" class="primary-button">Save Settings</button>
    </form>
  `;
}

function renderDataPanelV2() {
  const firebaseClass = app.firebase.status === "error" ? "" : "ok";
  const firebaseDetail = app.firebase.lastError ? ` · ${escapeHTML(app.firebase.lastError)}` : "";
  return `
    <div class="admin-form">
      <h3>Data Management</h3>
      <p class="admin-message ${firebaseClass}">
        ${escapeHTML(getFirebaseStatusLabel())}${firebaseDetail}
      </p>
      <div class="form-row-actions">
        <button type="button" class="small-button" data-action="export-json">JSON Export</button>
        <button type="button" class="small-button" data-action="firebase-pull">Pull Firebase</button>
        <button type="button" class="small-button" data-action="firebase-push">Push Firebase</button>
        <button type="button" class="danger-button" data-action="reset-samples">Reset Samples</button>
      </div>
      <form id="importForm" class="admin-form">
        <label>JSON Import
          <textarea id="importJson" class="json-area" placeholder='[{"type":"lcd","title":"New LCD"}]'></textarea>
        </label>
        <p id="importMessage" class="admin-message"></p>
        <button type="submit" class="primary-button">Apply Import</button>
      </form>
    </div>
  `;
}

function handleAdminClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === "toggle-panel") {
    app.dom.adminPanel.classList.toggle("collapsed");
    return;
  }
  if (action === "logout") {
    logoutAdmin();
    return;
  }
  if (action === "tab") {
    stopPlacementMode(false);
    if (button.dataset.tab === "form") app.editingAdId = null;
    renderAdminPanel(button.dataset.tab);
    return;
  }
  if (action === "add-ad") {
    app.editingAdId = null;
    renderAdminPanel("form");
    return;
  }
  if (action === "edit-ad") {
    app.editingAdId = id;
    renderAdminPanel("form");
    return;
  }
  if (action === "cancel-form") {
    stopPlacementMode(false);
    app.editingAdId = null;
    renderAdminPanel("list");
    return;
  }
  if (action === "placement-start") {
    const form = document.getElementById("adForm");
    if (form) startPlacementMode(form);
    return;
  }
  if (action === "test-image-url") {
    const form = document.getElementById("adForm");
    if (form) testImageUrlFromForm(form);
    return;
  }
  if (action === "placement-stop") {
    stopPlacementMode(true);
    return;
  }
  if (action === "delete-ad") {
    deleteAd(id);
    return;
  }
  if (action === "focus-ad") {
    focusAd(id);
    return;
  }
  if (action === "export-json") {
    exportAdsJSON();
    return;
  }
  if (action === "firebase-pull") {
    fetchAdsFromFirebase();
    return;
  }
  if (action === "firebase-push") {
    saveAdsToFirebase(app.ads).then((ok) => {
      if (ok) showToast("현재 광고 데이터를 Firebase에 업로드했습니다.");
    });
    return;
  }
  if (action === "reset-samples") {
    if (!window.confirm("현재 광고 데이터를 샘플 광고로 초기화할까요?")) return;
    app.ads = getDefaultAds();
    saveAdsToStorage();
    rebuildAds();
    renderAdminPanel("list");
    showToast("샘플 광고로 초기화했습니다.");
  }
}

function handleAdminSubmit(event) {
  if (event.target.id === "adForm") {
    event.preventDefault();
    saveAdFromForm(event.target);
  }
  if (event.target.id === "settingsForm") {
    event.preventDefault();
    saveSettingsFromForm(event.target);
  }
  if (event.target.id === "importForm") {
    event.preventDefault();
    const result = importAdsJSON(document.getElementById("importJson").value);
    if (!result.ok) {
      const message = document.getElementById("importMessage");
      if (message) message.textContent = result.message;
    }
  }
}

function updateVisibleTypeFields(type) {
  document.querySelectorAll("[data-type-fields]").forEach((element) => {
    element.classList.toggle("hidden", element.dataset.typeFields !== type);
  });
}

function testImageUrlFromForm(form) {
  const message = document.getElementById("adFormMessage");
  const rawUrl = form.elements.imageUrl?.value || "";
  const url = sanitizeUrl(rawUrl, true);
  if (!url) {
    if (message) {
      message.classList.remove("ok");
      message.textContent = "이미지 URL이 비어 있거나 http/https/data:image 형식이 아닙니다.";
    }
    return;
  }

  if (message) {
    message.classList.remove("ok");
    message.textContent = "이미지 CORS 로딩을 테스트하는 중입니다...";
  }

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
    if (message) {
      message.classList.add("ok");
      message.textContent = "이미지 테스트 성공: 광고판 텍스처로 사용할 수 있습니다.";
    }
  };
  image.onerror = () => {
    if (message) {
      message.classList.remove("ok");
      message.textContent =
        "이미지 테스트 실패: JPG 문제가 아니라 이미지 서버가 CORS를 허용하지 않거나 AVIF/리다이렉트 응답이 막혔을 가능성이 큽니다. Firebase Storage, GitHub Pages, Imgur처럼 CORS 가능한 URL을 사용해 주세요.";
    }
  };
  image.src = url;
}

function saveAdFromForm(form) {
  stopPlacementMode(false);
  const formData = new FormData(form);
  const type = AD_TYPES.includes(formData.get("type")) ? formData.get("type") : "booth";
  const existing = app.editingAdId ? app.ads.find((item) => item.id === app.editingAdId) : null;
  const ad = normalizeAd({
    ...(existing || getBlankAd(type)),
    type,
    title: String(formData.get("title") || "").trim() || "Untitled Ad",
    description: String(formData.get("description") || "").trim(),
    imageUrl: sanitizeUrl(String(formData.get("imageUrl") || ""), true),
    linkUrl: sanitizeUrl(String(formData.get("linkUrl") || ""), false),
    active: form.elements.active.checked,
    position: {
      x: safeNumber(formData.get("positionX"), 0),
      y: safeNumber(formData.get("positionY"), 0),
      z: safeNumber(formData.get("positionZ"), -10),
    },
    rotation: {
      x: 0,
      y: THREE.MathUtils.degToRad(safeNumber(formData.get("rotationY"), 0)),
      z: 0,
    },
    scale: safeNumber(formData.get("scale"), 1),
    boothShape: formData.get("boothShape") === "round" ? "round" : "square",
    width: safeNumber(formData.get("width"), 8),
    height: safeNumber(formData.get("height"), 4),
    brightness: safeNumber(formData.get("brightness"), 1.2),
    radius: safeNumber(formData.get("radius"), 1),
    pillarHeight: safeNumber(formData.get("pillarHeight"), 6),
    rotationSpeed: safeNumber(formData.get("rotationSpeed"), 0.003),
    flyerCount: safeNumber(formData.get("flyerCount"), 30),
    spreadRadius: safeNumber(formData.get("spreadRadius"), 12),
    center: {
      x: safeNumber(formData.get("centerX"), 0),
      z: safeNumber(formData.get("centerZ"), 0),
    },
    animateFlyers: form.elements.animateFlyers ? form.elements.animateFlyers.checked : true,
    altitude: safeNumber(formData.get("altitude"), 18),
    orbitRadius: safeNumber(formData.get("orbitRadius"), 30),
    speed: safeNumber(formData.get("speed"), 0.001),
    startAngle: THREE.MathUtils.degToRad(safeNumber(formData.get("startAngle"), 0)),
  });

  if (app.editingAdId) {
    app.ads = app.ads.map((item) => (item.id === app.editingAdId ? ad : item));
  } else {
    app.ads.push(ad);
  }
  saveAdsToStorage();
  rebuildAds();
  app.editingAdId = null;
  renderAdminPanel("list");
  showToast("광고를 저장했습니다.");
}

function startPlacementMode(form, refreshOnly = false) {
  if (!form) return;
  const draft = readAdDraftFromForm(form);

  if (!refreshOnly) {
    try {
      app.controls.unlock();
    } catch (error) {
      // Pointer lock may already be released.
    }
    app.hasStarted = true;
    app.dom.startOverlay.classList.add("hidden");
  }

  stopPlacementMode(false, true);

  app.placement.active = true;
  app.placement.form = form;
  app.placement.rotationY = safeNumber(draft.rotation?.y, 0);
  app.placement.raycaster = new THREE.Raycaster();
  app.placement.pointer = new THREE.Vector2();
  app.placement.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  const grid = new THREE.GridHelper(120, 120, 0x53dfff, 0x334b9b);
  grid.position.y = 0.11;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  grid.name = "Admin Placement Grid";
  app.scene.add(grid);
  app.placement.grid = grid;

  const preview = createPlacementPreview(draft);
  app.scene.add(preview);
  app.placement.preview = preview;
  applyPlacementPositionToPreview(getDraftPlacementPosition(draft));

  app.dom.placementHud.classList.remove("hidden");
  form.querySelector('[data-action="placement-stop"]')?.classList.remove("hidden");
  form.querySelector('[data-action="placement-start"]')?.classList.add("hidden");
  app.dom.canvas.addEventListener("pointermove", handlePlacementPointerMove);
  app.dom.canvas.addEventListener("click", handlePlacementClick);
  showToast("3D 배치 모드입니다. 격자를 클릭하면 위치가 폼에 들어갑니다.");
}

function stopPlacementMode(showMessage = false, internalRefresh = false) {
  if (!app.placement.active && !app.placement.preview && !app.placement.grid) return;
  app.dom.canvas.removeEventListener("pointermove", handlePlacementPointerMove);
  app.dom.canvas.removeEventListener("click", handlePlacementClick);

  if (app.placement.preview) {
    app.scene.remove(app.placement.preview);
    disposeObject(app.placement.preview);
  }
  if (app.placement.grid) {
    app.scene.remove(app.placement.grid);
    disposeObject(app.placement.grid);
  }

  if (app.placement.form && !internalRefresh) {
    app.placement.form.querySelector('[data-action="placement-stop"]')?.classList.add("hidden");
    app.placement.form.querySelector('[data-action="placement-start"]')?.classList.remove("hidden");
  }

  app.placement = {
    active: false,
    preview: null,
    grid: null,
    raycaster: null,
    pointer: null,
    plane: null,
    rotationY: 0,
    form: internalRefresh ? app.placement.form : null,
  };
  if (!internalRefresh) app.dom.placementHud.classList.add("hidden");
  if (showMessage) showToast("3D 배치 모드를 종료했습니다.");
}

function readAdDraftFromForm(form) {
  const formData = new FormData(form);
  const type = AD_TYPES.includes(formData.get("type")) ? formData.get("type") : "booth";
  return normalizeAd({
    ...getBlankAd(type),
    type,
    title: String(formData.get("title") || "Placement Preview"),
    description: String(formData.get("description") || ""),
    imageUrl: String(formData.get("imageUrl") || ""),
    linkUrl: String(formData.get("linkUrl") || ""),
    active: true,
    position: {
      x: safeNumber(formData.get("positionX"), 0),
      y: safeNumber(formData.get("positionY"), 0),
      z: safeNumber(formData.get("positionZ"), -10),
    },
    rotation: {
      x: 0,
      y: THREE.MathUtils.degToRad(safeNumber(formData.get("rotationY"), 0)),
      z: 0,
    },
    scale: safeNumber(formData.get("scale"), 1),
    boothShape: formData.get("boothShape") === "round" ? "round" : "square",
    width: safeNumber(formData.get("width"), 8),
    height: safeNumber(formData.get("height"), 4),
    radius: safeNumber(formData.get("radius"), 1),
    pillarHeight: safeNumber(formData.get("pillarHeight"), 6),
    spreadRadius: safeNumber(formData.get("spreadRadius"), 12),
    center: {
      x: safeNumber(formData.get("centerX"), 0),
      z: safeNumber(formData.get("centerZ"), 0),
    },
    altitude: safeNumber(formData.get("altitude"), 18),
    orbitRadius: safeNumber(formData.get("orbitRadius"), 30),
  });
}

function getDraftPlacementPosition(ad) {
  if (ad.type === "flyer") {
    return new THREE.Vector3(safeNumber(ad.center?.x, 0), 0, safeNumber(ad.center?.z, 0));
  }
  return new THREE.Vector3(safeNumber(ad.position?.x, 0), 0, safeNumber(ad.position?.z, -10));
}

function handlePlacementPointerMove(event) {
  const point = getPlacementPointFromEvent(event);
  if (!point) return;
  applyPlacementPositionToPreview(point);
}

function handlePlacementClick(event) {
  if (!app.placement.active || event.target !== app.dom.canvas) return;
  const point = getPlacementPointFromEvent(event);
  if (!point) return;
  event.preventDefault();
  applyPlacementPositionToPreview(point);
  writePlacementToForm(point);
  showToast(`배치 좌표 적용: X ${formatNumber(point.x)}, Z ${formatNumber(point.z)}`);
}

function getPlacementPointFromEvent(event) {
  if (!app.placement.raycaster || !app.placement.plane) return null;
  const rect = app.dom.canvas.getBoundingClientRect();
  app.placement.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  app.placement.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  app.placement.raycaster.setFromCamera(app.placement.pointer, app.camera);
  const point = new THREE.Vector3();
  if (!app.placement.raycaster.ray.intersectPlane(app.placement.plane, point)) return null;
  point.x = THREE.MathUtils.clamp(Math.round(point.x), -WORLD_LIMIT, WORLD_LIMIT);
  point.y = 0;
  point.z = THREE.MathUtils.clamp(Math.round(point.z), -WORLD_LIMIT, WORLD_LIMIT);
  return point;
}

function applyPlacementPositionToPreview(point) {
  if (!app.placement.preview || !point) return;
  app.placement.preview.position.set(point.x, 0, point.z);
  app.placement.preview.rotation.y = app.placement.rotationY;
}

function writePlacementToForm(point) {
  const form = app.placement.form;
  if (!form || !point) return;
  const type = form.elements.type?.value || "booth";
  if (type === "flyer") {
    if (form.elements.centerX) form.elements.centerX.value = formatNumber(point.x);
    if (form.elements.centerZ) form.elements.centerZ.value = formatNumber(point.z);
  }
  if (form.elements.positionX) form.elements.positionX.value = formatNumber(point.x);
  if (form.elements.positionZ) form.elements.positionZ.value = formatNumber(point.z);
  if (form.elements.rotationY) {
    form.elements.rotationY.value = formatNumber(THREE.MathUtils.radToDeg(app.placement.rotationY));
  }
}

function rotatePlacementPreview(degrees, reset = false) {
  if (!app.placement.active) return;
  app.placement.rotationY = reset
    ? 0
    : app.placement.rotationY + THREE.MathUtils.degToRad(degrees);
  if (app.placement.preview) app.placement.preview.rotation.y = app.placement.rotationY;
  writePlacementToForm(app.placement.preview?.position || null);
}

function createPlacementPreview(ad) {
  const group = new THREE.Group();
  group.name = "Placement Preview";
  const fill = new THREE.MeshBasicMaterial({
    color: 0x53dfff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const edge = new THREE.MeshBasicMaterial({
    color: 0xffcc70,
    transparent: true,
    opacity: 0.9,
  });
  const scale = clampNumber(ad.scale, 0.2, 6, 1);

  if (ad.type === "lcd") {
    const w = clampNumber(ad.width, 1, 24, 8) * scale;
    const h = clampNumber(ad.height, 1, 14, 4) * scale;
    const screen = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.25), fill);
    screen.position.y = h / 2 + 2.1;
    group.add(screen);
    const footprint = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 0.04, 1.2), edge);
    footprint.position.y = 0.08;
    group.add(footprint);
  } else if (ad.type === "pillar") {
    const r = clampNumber(ad.radius, 0.25, 5, 1) * scale;
    const h = clampNumber(ad.pillarHeight, 1, 18, 6) * scale;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32), fill);
    body.position.y = h / 2 + 0.35;
    group.add(body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.2, 0.04, 8, 48), edge);
    ring.position.y = 0.12;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  } else if (ad.type === "flyer") {
    const r = clampNumber(ad.spreadRadius, 1, 42, 12);
    const area = new THREE.Mesh(new THREE.CircleGeometry(r, 64), fill);
    area.position.y = 0.09;
    area.rotation.x = -Math.PI / 2;
    group.add(area);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r, 64), edge);
    ring.position.y = 0.1;
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
  } else if (ad.type === "blimp") {
    const altitude = clampNumber(ad.altitude, 6, 54, 18);
    const radius = clampNumber(ad.orbitRadius, 6, 58, 30);
    const orbit = new THREE.Mesh(new THREE.RingGeometry(radius - 0.08, radius, 96), edge);
    orbit.position.y = 0.1;
    orbit.rotation.x = -Math.PI / 2;
    group.add(orbit);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, altitude, 8), edge);
    mast.position.y = altitude / 2;
    group.add(mast);
    const blimp = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 12), fill);
    blimp.position.y = altitude;
    blimp.scale.set(3.2, 0.9, 0.9);
    group.add(blimp);
  } else {
    const w = (ad.boothShape === "round" ? 6.2 : 6) * scale;
    const d = (ad.boothShape === "round" ? 6.2 : 3.8) * scale;
    const h = 4.3 * scale;
    const booth = ad.boothShape === "round"
      ? new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 36), fill)
      : new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fill);
    booth.position.y = h / 2;
    group.add(booth);
    const footprint = ad.boothShape === "round"
      ? new THREE.Mesh(new THREE.TorusGeometry(w / 2, 0.04, 8, 64), edge)
      : new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), edge);
    footprint.position.y = 0.09;
    if (ad.boothShape === "round") footprint.rotation.x = Math.PI / 2;
    group.add(footprint);
  }

  group.traverse((child) => {
    if (child.isMesh) child.renderOrder = 4;
  });
  return group;
}

function deleteAd(id) {
  const ad = app.ads.find((item) => item.id === id);
  if (!ad) return;
  if (!window.confirm(`"${ad.title}" 광고를 삭제할까요?`)) return;
  app.ads = app.ads.filter((item) => item.id !== id);
  saveAdsToStorage();
  rebuildAds();
  renderAdminPanel("list");
  showToast("광고를 삭제했습니다.");
}

function focusAd(id) {
  const record = app.adRecords.find((item) => item.ad.id === id);
  const ad = app.ads.find((item) => item.id === id);
  if (!record || !ad) {
    showToast("비활성화된 광고는 월드 위치로 이동할 수 없습니다.");
    return;
  }
  try {
    app.controls.unlock();
  } catch (error) {
    // Ignore if pointer lock is already released.
  }

  const focus = record.getFocusPosition();
  const angle = safeNumber(ad.rotation?.y, 0);
  const offsetDistance = ad.type === "blimp" ? 10 : 8;
  const offset = new THREE.Vector3(Math.sin(angle) * offsetDistance, ad.type === "blimp" ? -1.5 : 1.1, Math.cos(angle) * offsetDistance);
  const target = focus.clone().add(offset);
  target.x = THREE.MathUtils.clamp(target.x, -WORLD_LIMIT, WORLD_LIMIT);
  target.z = THREE.MathUtils.clamp(target.z, -WORLD_LIMIT, WORLD_LIMIT);
  app.controls.getObject().position.set(target.x, Math.max(CAMERA_HEIGHT, target.y), target.z);
  app.camera.lookAt(focus);
  showToast(`"${ad.title}" 근처로 이동했습니다.`);
}

function saveSettingsFromForm(form) {
  const formData = new FormData(form);
  app.settings = {
    starCount: Math.round(clampNumber(formData.get("starCount"), 150, 2400, DEFAULT_SETTINGS.starCount)),
    auroraStrength: clampNumber(formData.get("auroraStrength"), 0, 1.4, DEFAULT_SETTINGS.auroraStrength),
    brightness: clampNumber(formData.get("brightness"), 0.45, 1.9, DEFAULT_SETTINGS.brightness),
    moveSpeed: clampNumber(formData.get("moveSpeed"), 3, 22, DEFAULT_SETTINGS.moveSpeed),
    mouseSensitivity: clampNumber(formData.get("mouseSensitivity"), 0.35, 2.5, DEFAULT_SETTINGS.mouseSensitivity),
    zoomFov: clampNumber(formData.get("zoomFov"), 54, 86, DEFAULT_SETTINGS.zoomFov),
    detectionMultiplier: clampNumber(formData.get("detectionMultiplier"), 0.4, 3, DEFAULT_SETTINGS.detectionMultiplier),
    flyerMaxCount: Math.round(clampNumber(formData.get("flyerMaxCount"), 5, 80, DEFAULT_SETTINGS.flyerMaxCount)),
  };
  saveSettingsToStorage();
  applyWorldSettings();
  showToast("월드 설정을 저장했습니다.");
  renderAdminPanel("settings");
}

function applyWorldSettings() {
  app.renderer.toneMappingExposure = app.settings.brightness;
  app.camera.fov = app.settings.zoomFov;
  app.camera.updateProjectionMatrix();
  if (app.controls) app.controls.pointerSpeed = app.settings.mouseSensitivity;
  if (app.ambientLight) app.ambientLight.intensity = 0.92 + app.settings.brightness * 0.18;
  if (app.directionalLight) app.directionalLight.intensity = 1 + app.settings.brightness * 0.35;
  createStars();
  createAuroraSheets();
  rebuildAds();
}

function initChat() {
  app.chatUser = loadChatUser();
  app.dom.chatUserLabel.textContent = app.chatUser;
  let messages = loadChatMessages();
  if (!messages.length) {
    messages = [
      {
        type: "system",
        text: `${app.chatUser}님이 입장했습니다.`,
        time: Date.now(),
      },
    ];
    saveChatMessages(messages);
  }
  renderChatMessages(messages);
  app.dom.chatForm.addEventListener("submit", sendChatMessage);
  app.chatTimer = window.setInterval(updateChatCooldown, 250);
}

function loadChatUser() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.chatUser);
    if (saved) return saved;
    const name = `익명${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(STORAGE_KEYS.chatUser, name);
    return name;
  } catch (error) {
    return `익명${Math.floor(1000 + Math.random() * 9000)}`;
  }
}

function loadChatMessages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.chatMessages);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-80).map((message) => ({
      type: message.type === "system" ? "system" : "user",
      user: String(message.user || ""),
      text: String(message.text || "").slice(0, 120),
      time: safeNumber(message.time, Date.now()),
    }));
  } catch (error) {
    return [];
  }
}

function saveChatMessages(messages) {
  try {
    localStorage.setItem(STORAGE_KEYS.chatMessages, JSON.stringify(messages.slice(-80)));
  } catch (error) {
    console.warn("Failed to save chat messages", error);
  }
}

function sendChatMessage(event) {
  event.preventDefault();
  const now = Date.now();
  if (now < app.chatCooldownUntil) {
    updateChatCooldown();
    return;
  }

  const text = app.dom.chatInput.value.trim();
  const validation = validateChatMessage(text);
  if (!validation.ok) {
    app.dom.chatStatus.textContent = validation.message;
    return;
  }

  const messages = loadChatMessages();
  messages.push({
    type: "user",
    user: app.chatUser,
    text,
    time: now,
  });
  saveChatMessages(messages);
  renderChatMessages(messages);
  app.dom.chatInput.value = "";
  startChatCooldown();
}

function validateChatMessage(text) {
  if (!text) return { ok: false, message: "메시지를 입력해 주세요." };
  if (text.length > 120) return { ok: false, message: "메시지는 최대 120자까지 가능합니다." };
  if (LINK_PATTERN.test(text)) return { ok: false, message: "채팅에는 링크나 광고 문구를 올릴 수 없습니다." };
  const lowered = text.toLowerCase();
  if (BANNED_WORDS.some((word) => lowered.includes(word.toLowerCase()))) {
    return { ok: false, message: "금지어가 포함되어 메시지를 보낼 수 없습니다." };
  }
  return { ok: true };
}

function startChatCooldown() {
  app.chatCooldownUntil = Date.now() + 30_000;
  updateChatCooldown();
}

function updateChatCooldown() {
  const remain = Math.max(0, Math.ceil((app.chatCooldownUntil - Date.now()) / 1000));
  if (remain > 0) {
    app.dom.chatInput.disabled = true;
    app.dom.chatSendButton.disabled = true;
    app.dom.chatStatus.textContent = `${remain}초 후 다시 채팅할 수 있습니다.`;
  } else {
    app.dom.chatInput.disabled = false;
    app.dom.chatSendButton.disabled = false;
    if (app.dom.chatStatus.textContent.includes("초 후")) app.dom.chatStatus.textContent = "";
  }
}

function renderChatMessages(messages = loadChatMessages()) {
  app.dom.chatMessages.innerHTML = messages
    .map((message) => {
      if (message.type === "system") {
        return `<div class="chat-message system">${escapeHTML(message.text)}</div>`;
      }
      return `
        <div class="chat-message">
          <span class="meta">${escapeHTML(message.user || "익명")} · ${formatTime(message.time)}</span>
          <span>${escapeHTML(message.text)}</span>
        </div>
      `;
    })
    .join("");
  app.dom.chatMessages.scrollTop = app.dom.chatMessages.scrollHeight;
}

function sanitizeUrl(value, allowImages = false) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    if (allowImages && url.protocol === "data:" && raw.startsWith("data:image/")) return raw;
    return "";
  } catch (error) {
    return "";
  }
}

function generateId() {
  if (globalThis.crypto?.randomUUID) {
    return `ad_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `ad_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, min, max, fallback = min) {
  const number = safeNumber(value, fallback);
  return THREE.MathUtils.clamp(number, min, max);
}

function formatNumber(value) {
  const number = safeNumber(value, 0);
  if (Math.abs(number) < 0.0001) return "0";
  return Number(number.toFixed(3)).toString();
}

function seededRandom(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHTML(value).replace(/`/g, "&#096;");
}

function showToast(message) {
  if (!app.dom.toast) return;
  app.dom.toast.textContent = message;
  app.dom.toast.classList.remove("hidden");
  window.clearTimeout(app.toastTimer);
  app.toastTimer = window.setTimeout(() => {
    app.dom.toast.classList.add("hidden");
  }, 2600);
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        Object.keys(material).forEach((key) => {
          const value = material[key];
          if (value && typeof value.dispose === "function" && value.isTexture) value.dispose();
        });
        material.dispose();
      });
    }
  });
}
