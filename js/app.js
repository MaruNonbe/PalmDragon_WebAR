import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import {
  HandLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

import { HandDragonController } from "./handDragonController.js";

/**
 * ==========================================================
 * 龍モデル調整定数
 * ==========================================================
 * GLBモデルによって大きさ・向きが違うため、まずここを調整してください。
 */
let DRAGON_SCALE = 1.6;
let DRAGON_ROTATION_X = 0.0;
let DRAGON_ROTATION_Y = 0.0;
let DRAGON_ROTATION_Z = 0.0;
let DRAGON_OFFSET_X = 0.0;
let DRAGON_OFFSET_Y = 0.35;
let DRAGON_OFFSET_Z = 0.0;

/**
 * 手の大きさに対する龍サイズ倍率。
 * 龍が大きすぎる場合は下げてください。
 */
const PALM_SIZE_TO_DRAGON_SCALE = 4.2;

/**
 * 手検出の間隔。
 * iPhoneで重い場合は 80〜120 に上げると安定しやすいです。
 */
const HAND_DETECTION_INTERVAL_MS = 60;

/**
 * カメラ解像度。
 * 重い場合は 640 x 480 程度へ下げてください。
 */
const CAMERA_WIDTH = 960;
const CAMERA_HEIGHT = 1280;

/**
 * MediaPipeモデル。
 */
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/**
 * 龍モデル相対パス。
 * GitHub Pagesでも動くように、Cドライブ直指定はしません。
 */
const DRAGON_MODEL_PATH = "./assets/models/dragon.glb";

/**
 * DOM
 */
const video = document.getElementById("cameraVideo");
const threeCanvas = document.getElementById("threeCanvas");
const debugCanvas = document.getElementById("debugCanvas");

const startPanel = document.getElementById("startPanel");
const startButton = document.getElementById("startButton");

const statusBar = document.getElementById("statusBar");
const errorBox = document.getElementById("errorBox");

const debugToggleButton = document.getElementById("debugToggleButton");
const landmarkToggleButton = document.getElementById("landmarkToggleButton");
const tuneToggleButton = document.getElementById("tuneToggleButton");
const tunePanel = document.getElementById("tunePanel");

const scaleRange = document.getElementById("scaleRange");
const offsetYRange = document.getElementById("offsetYRange");
const rotationYRange = document.getElementById("rotationYRange");

const scaleValue = document.getElementById("scaleValue");
const offsetYValue = document.getElementById("offsetYValue");
const rotationYValue = document.getElementById("rotationYValue");

/**
 * Three.js
 */
let scene;
let camera;
let renderer;

let dragonRoot;
let dragonModel;
let dragonMixer;

let palmRing;
let particleGroup;
let particleMaterial;

/**
 * MediaPipe
 */
let handLandmarker;
let handController;

/**
 * 状態管理
 */
let started = false;
let debugEnabled = false;
let landmarksEnabled = true;

let lastDetectionTime = 0;
let lastVideoTime = -1;

let targetPosition = new THREE.Vector3();
let smoothedPosition = new THREE.Vector3();

let targetScale = 1;
let smoothedScale = 1;

let dragonOpacity = 0;
let targetOpacity = 0;

let lastHandY = null;
let verticalBoost = 0;

let currentHandedness = "Unknown";

/**
 * 起動
 */
startButton.addEventListener("click", async () => {
  if (started) return;

  started = true;
  hideError();
  setStatus("カメラ準備中");

  try {
    checkHttpsWarning();

    initThree();
    initHandController();
    setupUI();
    handleResize();

    await initCamera();
    await initMediaPipe();
    await loadDragonModel();

    startPanel.classList.add("hidden");

    setStatus("手のひらをカメラに向けてください");

    requestAnimationFrame(animate);
  } catch (error) {
    console.error(error);
    showError(
      "起動に失敗しました。\n\n" +
      getReadableErrorMessage(error)
    );
    setStatus("エラーが発生しました");
    started = false;
  }
});

/**
 * HTTPS注意。
 */
function checkHttpsWarning() {
  const isLocalhost =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  if (location.protocol !== "https:" && !isLocalhost) {
    showError(
      "注意: スマホ実機でカメラを使う場合はHTTPSが必要です。\n" +
      "GitHub PagesなどHTTPS環境で確認してください。"
    );
  }
}

/**
 * カメラ初期化。
 * スマホでは背面カメラを優先し、失敗したら前面カメラへフォールバック。
 */
async function initCamera() {
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.muted = true;
  video.autoplay = true;

  const environmentConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: CAMERA_WIDTH },
      height: { ideal: CAMERA_HEIGHT }
    }
  };

  const userConstraints = {
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 }
    }
  };

  let stream;

  try {
    stream = await navigator.mediaDevices.getUserMedia(environmentConstraints);
  } catch (error) {
    console.warn("背面カメラ起動に失敗。前面カメラへフォールバックします。", error);
    stream = await navigator.mediaDevices.getUserMedia(userConstraints);
  }

  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });

  setStatus("手のひらをカメラに向けてください");
}

/**
 * MediaPipe初期化。
 */
async function initMediaPipe() {
  setStatus("MediaPipe準備中");

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: HAND_MODEL_URL,
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1
  });
}

/**
 * Three.js初期化。
 */
function initThree() {
  scene = new THREE.Scene();

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({
    canvas: threeCanvas,
    alpha: true,
    antialias: true
  });

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const ambient = new THREE.AmbientLight(0xffffff, 1.8);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(3, 4, 5);
  scene.add(keyLight);

  const warmLight = new THREE.PointLight(0xff8866, 1.2, 8);
  warmLight.position.set(0, 1.2, 2);
  scene.add(warmLight);

  dragonRoot = new THREE.Group();
  dragonRoot.visible = false;
  scene.add(dragonRoot);

  createPalmRing();
  createParticles();
}

/**
 * 手コントローラー初期化。
 */
function initHandController() {
  handController = new HandDragonController({
    video,
    debugCanvas
  });
}

/**
 * 龍モデル読み込み。
 */
async function loadDragonModel() {
  setStatus("龍モデル読み込み中");

  const loader = new GLTFLoader();

  const gltf = await loader.loadAsync(DRAGON_MODEL_PATH);

  dragonModel = gltf.scene;
  dragonModel.name = "DragonModel";

  dragonModel.traverse((child) => {
    if (child.isMesh) {
      child.frustumCulled = false;

      if (child.material) {
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity = 0;
        child.material.depthWrite = true;
      }
    }
  });

  dragonRoot.add(dragonModel);

  if (gltf.animations && gltf.animations.length > 0) {
    dragonMixer = new THREE.AnimationMixer(dragonModel);

    for (const clip of gltf.animations) {
      const action = dragonMixer.clipAction(clip);
      action.play();
    }
  }

  applyDragonTransform();
}

/**
 * 手のひらリング。
 */
function createPalmRing() {
  const geometry = new THREE.TorusGeometry(0.35, 0.012, 12, 80);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffd36b,
    transparent: true,
    opacity: 0
  });

  palmRing = new THREE.Mesh(geometry, material);

  // 画面正面から円形に見えるようにする
  palmRing.rotation.x = 0;

  palmRing.visible = false;

  dragonRoot.add(palmRing);
}

/**
 * 粒子エフェクト。
 */
function createParticles() {
  const count = 90;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const r = 0.35 + Math.random() * 0.9;
    const a = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 0.6;

    positions[i * 3 + 0] = Math.cos(a) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(a) * r;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3)
  );

  particleMaterial = new THREE.PointsMaterial({
    color: 0xffd36b,
    size: 0.035,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });

  particleGroup = new THREE.Points(geometry, particleMaterial);
  dragonRoot.add(particleGroup);
}

/**
 * UI設定。
 */
function setupUI() {
  debugToggleButton.addEventListener("click", () => {
    debugEnabled = !debugEnabled;
    debugToggleButton.textContent = debugEnabled
      ? "デバッグ ON"
      : "デバッグ OFF";

    handController.setDebugEnabled(debugEnabled);
  });

  landmarkToggleButton.addEventListener("click", () => {
    landmarksEnabled = !landmarksEnabled;
    landmarkToggleButton.textContent = landmarksEnabled
      ? "ランドマーク ON"
      : "ランドマーク OFF";

    handController.setLandmarksEnabled(landmarksEnabled);
  });

  tuneToggleButton.addEventListener("click", () => {
    tunePanel.classList.toggle("hidden");
  });

  scaleRange.addEventListener("input", () => {
    DRAGON_SCALE = Number(scaleRange.value);
    scaleValue.textContent = DRAGON_SCALE.toFixed(1);
    applyDragonTransform();
  });

  offsetYRange.addEventListener("input", () => {
    DRAGON_OFFSET_Y = Number(offsetYRange.value);
    offsetYValue.textContent = DRAGON_OFFSET_Y.toFixed(2);
    applyDragonTransform();
  });

  rotationYRange.addEventListener("input", () => {
    DRAGON_ROTATION_Y = Number(rotationYRange.value);
    rotationYValue.textContent = DRAGON_ROTATION_Y.toFixed(2);
    applyDragonTransform();
  });

  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", () => {
    setTimeout(handleResize, 300);
  });
}

/**
 * リサイズ対応。
 */
function handleResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (renderer) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
  }

  if (camera) {
    const aspect = width / height;

    camera.left = -aspect;
    camera.right = aspect;
    camera.top = 1;
    camera.bottom = -1;
    camera.updateProjectionMatrix();
  }

  if (handController) {
    handController.resizeDebugCanvas(width, height, dpr);
  }
}

/**
 * メインループ。
 */
function animate(now) {
  requestAnimationFrame(animate);

  const delta = 0.016;

  detectHandsIfNeeded(now);
  updateDragon(now * 0.001, delta);

  renderer.render(scene, camera);
}

/**
 * 手検出。
 */
function detectHandsIfNeeded(now) {
  if (!handLandmarker || !video.videoWidth) return;

  if (now - lastDetectionTime < HAND_DETECTION_INTERVAL_MS) {
    return;
  }

  if (video.currentTime === lastVideoTime) {
    return;
  }

  lastDetectionTime = now;
  lastVideoTime = video.currentTime;

  let results;

  try {
    results = handLandmarker.detectForVideo(video, now);
  } catch (error) {
    console.warn("手検出エラー", error);
    return;
  }

  const handInfo = handController.extractHandInfo(results);

  if (!handInfo) {
    targetOpacity = 0;
    setStatus("手のひらをカメラに向けてください");
    updateStatusColor("Unknown");
    return;
  }

  currentHandedness = handInfo.handedness;

  const world = screenToWorld(handInfo.screenCenter.x, handInfo.screenCenter.y);

  const handY = world.y;
  if (lastHandY !== null) {
    const dy = handY - lastHandY;

    if (dy > 0.015) {
      verticalBoost = Math.min(0.35, verticalBoost + dy * 2.0);
    }
  }
  lastHandY = handY;

  const openScale = handInfo.isOpen ? 1.18 : 0.82;

  targetPosition.set(
    world.x + DRAGON_OFFSET_X,
    world.y + DRAGON_OFFSET_Y + verticalBoost,
    DRAGON_OFFSET_Z
  );

  targetScale =
    DRAGON_SCALE *
    PALM_SIZE_TO_DRAGON_SCALE *
    handInfo.palmSize *
    openScale;

  targetScale = THREE.MathUtils.clamp(targetScale, 0.25, 4.5);

  targetOpacity = 1;

  if (handInfo.isOpen) {
    setStatus(`龍を表示中 / ${currentHandedness === "Right" ? "右手" : currentHandedness === "Left" ? "左手" : "手"} / 手のひら開`);
  } else {
    setStatus(`手のひら検知中 / ${currentHandedness === "Right" ? "右手" : currentHandedness === "Left" ? "左手" : "手"}`);
  }

  updateStatusColor(currentHandedness);
}

/**
 * 画面ピクセル座標をThree.jsのOrthographic座標へ変換。
 */
function screenToWorld(screenX, screenY) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;

  const x = (screenX / width) * 2 * aspect - aspect;
  const y = -(screenY / height) * 2 + 1;

  return { x, y };
}

/**
 * 龍更新。
 */
function updateDragon(time, delta) {
  if (!dragonRoot) return;

  verticalBoost = THREE.MathUtils.lerp(verticalBoost, 0, 0.04);

  dragonOpacity = THREE.MathUtils.lerp(dragonOpacity, targetOpacity, 0.08);

  if (dragonOpacity < 0.01) {
    dragonRoot.visible = false;
  } else {
    dragonRoot.visible = true;
  }

  smoothedPosition.lerp(targetPosition, 0.12);
  smoothedScale = THREE.MathUtils.lerp(smoothedScale, targetScale, 0.12);

  const floatY = Math.sin(time * 2.0) * 0.06;

  dragonRoot.position.set(
    smoothedPosition.x,
    smoothedPosition.y + floatY,
    smoothedPosition.z
  );

  dragonRoot.scale.setScalar(smoothedScale);

  dragonRoot.rotation.z = Math.sin(time * 0.9) * 0.08;

  if (dragonModel) {
    dragonModel.rotation.y =
      DRAGON_ROTATION_Y + Math.sin(time * 0.45) * 0.18;
  }

  setObjectOpacity(dragonRoot, dragonOpacity);

  if (palmRing) {
    palmRing.visible = dragonOpacity > 0.05;
    palmRing.material.opacity = dragonOpacity * 0.8;
    palmRing.rotation.z += 0.018;
    palmRing.scale.setScalar(0.75 + Math.sin(time * 3.2) * 0.06);
  }

  if (particleGroup) {
    particleGroup.rotation.y += 0.006;
    particleGroup.rotation.z += 0.002;
  }

  if (particleMaterial) {
    particleMaterial.opacity = dragonOpacity * 0.65;
  }

  if (dragonMixer) {
    dragonMixer.update(delta);
  }
}

/**
 * 龍モデルの基本向き。
 */
function applyDragonTransform() {
  if (!dragonModel) return;

  dragonModel.rotation.set(
    DRAGON_ROTATION_X,
    DRAGON_ROTATION_Y,
    DRAGON_ROTATION_Z
  );

  dragonModel.position.set(0, 0, 0);
}

/**
 * 透明度をまとめて変更。
 */
function setObjectOpacity(root, opacity) {
  root.traverse((child) => {
    if (child.isMesh && child.material) {
      child.material.opacity = opacity;
      child.material.transparent = true;
    }
  });
}

/**
 * ステータス。
 */
function setStatus(message) {
  statusBar.textContent = message;
}

function updateStatusColor(handedness) {
  statusBar.classList.remove("status-right", "status-left");

  if (handedness === "Right") {
    statusBar.classList.add("status-right");
  } else if (handedness === "Left") {
    statusBar.classList.add("status-left");
  }
}

/**
 * エラー表示。
 */
function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function hideError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function getReadableErrorMessage(error) {
  const message = error && error.message ? error.message : String(error);

  if (message.includes("Permission denied")) {
    return "カメラ使用が拒否されました。ブラウザのカメラ許可を確認してください。";
  }

  if (message.includes("Requested device not found")) {
    return "カメラが見つかりません。PCの場合はWebカメラ接続を確認してください。";
  }

  if (message.includes("dragon.glb")) {
    return "龍モデル assets/models/dragon.glb が読み込めませんでした。配置場所とファイル名を確認してください。";
  }

  return message;
}