import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { BlockInteraction } from './interaction.js';
import { BLOCK, BLOCK_DEFS, PLACEABLE_BLOCKS, cssColor } from './blocks.js';
import { CHUNK_SIZE } from './chunk.js';

// ---------- Config (overridable via URL: ?seed=42&rd=7) ----------

const params = new URLSearchParams(location.search);
const SEED = Number.parseInt(params.get('seed'), 10) || 1337;
const RENDER_DISTANCE = Math.min(Math.max(Number.parseInt(params.get('rd'), 10) || 5, 2), 10);
const SKY_COLOR = 0x87ceeb;

// ---------- Renderer / scene / camera ----------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_COLOR);
const viewDist = RENDER_DISTANCE * CHUNK_SIZE;
scene.fog = new THREE.Fog(SKY_COLOR, viewDist * 0.55, viewDist * 0.95);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);

// ---------- World, player, interaction ----------

const world = new World(scene, SEED, RENDER_DISTANCE);
const player = new Player(camera, world);
const interaction = new BlockInteraction(world, player, camera, scene);

const spawn = world.generator.findSpawn();
player.spawn(spawn.x, spawn.y, spawn.z);
world.primeAround(player.position); // ground under our feet before frame one

// ---------- Pointer lock + menu overlay ----------

const overlay = document.getElementById('overlay');
const playButton = document.getElementById('play-button');

playButton.addEventListener('click', () => {
  renderer.domElement.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  overlay.classList.toggle('hidden', locked);
  player.enabled = locked;
});

document.addEventListener('mousemove', (e) => {
  if (player.enabled) player.look(e.movementX, e.movementY);
});

document.addEventListener('mousedown', (e) => {
  if (!player.enabled) return;
  if (e.button === 0) interaction.breakBlock();
  else if (e.button === 2) interaction.placeBlock(PLACEABLE_BLOCKS[selectedSlot]);
});

document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Hotbar (placeholder until Phase 3's inventory) ----------

let selectedSlot = 0;
const hotbarEl = document.getElementById('hotbar');
const hotbarLabelEl = document.getElementById('hotbar-label');

const slotEls = PLACEABLE_BLOCKS.map((id, i) => {
  const slot = document.createElement('div');
  slot.className = 'slot';
  slot.style.background = cssColor(BLOCK_DEFS[id].icon);
  const key = document.createElement('span');
  key.className = 'key';
  key.textContent = String(i + 1);
  slot.appendChild(key);
  hotbarEl.appendChild(slot);
  return slot;
});

function selectSlot(i) {
  selectedSlot = (i + PLACEABLE_BLOCKS.length) % PLACEABLE_BLOCKS.length;
  slotEls.forEach((el, j) => el.classList.toggle('selected', j === selectedSlot));
  hotbarLabelEl.textContent = BLOCK_DEFS[PLACEABLE_BLOCKS[selectedSlot]].name;
}
selectSlot(0);

document.addEventListener('keydown', (e) => {
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= PLACEABLE_BLOCKS.length) selectSlot(n - 1);
  }
});

document.addEventListener('wheel', (e) => {
  if (player.enabled) selectSlot(selectedSlot + Math.sign(e.deltaY));
}, { passive: true });

// ---------- Debug HUD + underwater tint ----------

const debugEl = document.getElementById('debug-info');
const waterTintEl = document.getElementById('water-tint');
let fpsAccum = 0;
let fpsFrames = 0;
let fps = 0;

function updateHUD(dt) {
  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.5) {
    fps = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
  }

  const p = player.position;
  const t = interaction.target;
  debugEl.textContent =
    `FPS     ${fps}\n` +
    `XYZ     ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\n` +
    `Chunks  ${world.chunks.size} loaded, ${world.meshQueue.length} queued\n` +
    `Target  ${t ? `${BLOCK_DEFS[t.id].name} (${t.x}, ${t.y}, ${t.z})` : '—'}`;

  const camBlock = world.getBlock(
    Math.floor(camera.position.x),
    Math.floor(camera.position.y),
    Math.floor(camera.position.z)
  );
  waterTintEl.classList.toggle('active', camBlock === BLOCK.WATER);
}

// ---------- Resize ----------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Game loop ----------

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05); // clamp tab-switch spikes
  player.update(dt);
  world.update(player.position);
  interaction.update();
  updateHUD(dt);
  renderer.render(scene, camera);
}

animate();
