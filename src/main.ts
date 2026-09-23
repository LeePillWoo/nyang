import * as THREE from 'three';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { buildField } from './field.ts';
import { makeCat } from './cat.ts';
import { resolveCircle } from './collide.ts';

// GDD 3장 카메라 · 5장 스탯
const PITCH = THREE.MathUtils.degToRad(50);
const CAM_DISTS = [16, 24, 40]; // 근접 · 중간 · 전체. C 키로 순환 (M0 테스트용)
const SPEED = 5; // m/s
const RADIUS = 0.45;
const DASH_DIST = 3;
const DASH_TIME = 0.2;
const DASH_CD = 0.5;
const SKY = '#dff1ff';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
const fog = new THREE.Fog(SKY, 34, 72);
scene.fog = fog;

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 160);
const camDir = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));

scene.add(new THREE.HemisphereLight('#e8f4ff', '#ffd9ab', 1.2));
const sun = new THREE.DirectionalLight('#fff3d2', 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.far = 60;
sun.shadow.normalBias = 0.03;
const sunOffset = new THREE.Vector3(9, 18, 7);
scene.add(sun, sun.target);

// 카메라 거리에 맞춰 그림자 프러스텀과 안개 범위를 같이 늘린다
let camDist = 0;
function setCamDist(d: number) {
  camDist = d;
  const s = d * 0.62;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -s;
  sun.shadow.camera.right = sun.shadow.camera.top = s;
  sun.shadow.camera.updateProjectionMatrix();
  fog.near = d * 1.4;
  fog.far = d * 3;
}
setCamDist(CAM_DISTS[2]);

const field = buildField();
scene.add(field.group);

const cat = makeCat(PITCH);
cat.group.position.set(field.spawn.x, 0, field.spawn.y);
scene.add(cat.group);

camera.position.copy(cat.group.position).addScaledVector(camDir, camDist);

const stats = new Stats();
document.body.appendChild(stats.dom);

const keys = new Set<string>();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyC') setCamDist(CAM_DISTS[(CAM_DISTS.indexOf(camDist) + 1) % CAM_DISTS.length]);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const held = (...codes: string[]) => codes.some((c) => keys.has(c));

const move = new THREE.Vector2();
const face = new THREE.Vector2(0, 1);
const dash = new THREE.Vector2();
let dashT = 0;
let dashCd = 0;
let flip = 1;
let clockT = 0;

const camTarget = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  clockT += dt;
  dashCd = Math.max(0, dashCd - dt);

  move.set(
    (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0),
    (held('KeyS', 'ArrowDown') ? 1 : 0) - (held('KeyW', 'ArrowUp') ? 1 : 0),
  );
  if (move.lengthSq() > 0) {
    move.normalize();
    face.copy(move);
    if (move.x !== 0) flip = Math.sign(move.x);
  }

  if (keys.has('Space') && dashT <= 0 && dashCd <= 0) {
    dash.copy(face);
    dashT = DASH_TIME;
    dashCd = DASH_TIME + DASH_CD;
  }

  let vx = move.x * SPEED;
  let vz = move.y * SPEED;
  if (dashT > 0) {
    dashT -= dt;
    vx = dash.x * (DASH_DIST / DASH_TIME);
    vz = dash.y * (DASH_DIST / DASH_TIME);
  }

  const p = resolveCircle(
    field.grid,
    cat.group.position.x + vx * dt,
    cat.group.position.z + vz * dt,
    RADIUS,
  );
  cat.group.position.set(p.x, 0, p.z);

  // 구르기는 화면 안에서 한 바퀴, 평소엔 말랑한 바운스
  if (dashT > 0) {
    cat.sprite.rotation.z = -flip * (1 - dashT / DASH_TIME) * Math.PI * 2;
    cat.sprite.scale.set(flip, 1, 1);
  } else {
    cat.sprite.rotation.z = 0;
    const bob = Math.sin(clockT * (move.lengthSq() > 0 ? 14 : 4)) * (move.lengthSq() > 0 ? 0.06 : 0.025);
    cat.sprite.scale.set(flip * (1 - bob * 0.6), 1 + bob, 1);
  }

  camTarget.copy(cat.group.position).addScaledVector(camDir, camDist);
  camera.position.lerp(camTarget, 1 - Math.exp(-7 * dt));
  lookAt.copy(cat.group.position).setY(0.7);
  camera.lookAt(lookAt);

  sun.position.copy(cat.group.position).add(sunOffset);
  sun.target.position.copy(cat.group.position);

  renderer.render(scene, camera);
  stats.update();
});
