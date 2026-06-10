import * as THREE from 'three';
import { BLOCK, isSolid } from './blocks.js';

export const PLAYER_HALF_WIDTH = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;

const GRAVITY = 28;
const JUMP_SPEED = 8.6;
const WALK_SPEED = 5.6;
const TERMINAL_VELOCITY = 55;
const EPS = 0.001;

function approach(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/**
 * First-person controller with acceleration-based movement, gravity, jumping,
 * basic swimming, and swept axis-by-axis AABB collision against the voxel
 * grid. `position` is the center of the player's feet; the camera rides at
 * eye height above it.
 */
export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ'; // yaw, then pitch — no roll
    this.world = world;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.spawnPoint = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = 0.0023;

    this.onGround = false;
    this.inWater = false;
    this.enabled = false; // true only while pointer is locked

    this.keys = Object.create(null);
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => {
      this.keys = Object.create(null);
    });
  }

  spawn(x, y, z) {
    this.spawnPoint.set(x, y, z);
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
  }

  look(dx, dy) {
    this.yaw -= dx * this.sensitivity;
    this.pitch -= dy * this.sensitivity;
    const limit = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  update(dt) {
    const p = this.position;
    const v = this.velocity;

    // Fell out of the world (shouldn't happen — bedrock — but be safe).
    if (p.y < -16) this.spawn(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z);

    this.inWater =
      this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z)) === BLOCK.WATER;

    // --- Horizontal movement: accelerate toward the desired velocity. ---
    let forward = 0;
    let strafe = 0;
    if (this.enabled) {
      forward = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0);
      strafe = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    }

    let targetX = 0;
    let targetZ = 0;
    if (forward !== 0 || strafe !== 0) {
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // Camera looks along (-sin(yaw), 0, -cos(yaw)); right is (cos, 0, -sin).
      let dx = -sin * forward + cos * strafe;
      let dz = -cos * forward - sin * strafe;
      const len = Math.hypot(dx, dz);
      const speed = WALK_SPEED * (this.inWater ? 0.65 : 1);
      targetX = (dx / len) * speed;
      targetZ = (dz / len) * speed;
    }

    const accel = this.inWater ? 25 : this.onGround ? 70 : 18;
    v.x = approach(v.x, targetX, accel * dt);
    v.z = approach(v.z, targetZ, accel * dt);

    // --- Vertical: gravity, jumping, swimming. ---
    if (this.inWater) {
      v.y -= GRAVITY * 0.3 * dt;
      v.y *= Math.max(0, 1 - 2.5 * dt); // water drag
      if (this.enabled && this.keys.Space) v.y = approach(v.y, 4.5, 30 * dt);
      if (v.y < -4) v.y = -4;
    } else {
      if (this.enabled && this.keys.Space && this.onGround) v.y = JUMP_SPEED;
      v.y -= GRAVITY * dt;
      if (v.y < -TERMINAL_VELOCITY) v.y = -TERMINAL_VELOCITY;
    }

    // --- Integrate with substeps so fast falls can't tunnel through blocks. ---
    this.onGround = false;
    const maxComponent = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    const steps = Math.max(1, Math.ceil((maxComponent * dt) / 0.4));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      p.x += v.x * sdt;
      this.resolveCollisions(0);
      p.y += v.y * sdt;
      this.resolveCollisions(1);
      p.z += v.z * sdt;
      this.resolveCollisions(2);
    }

    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.position.set(p.x, p.y + EYE_HEIGHT, p.z);
  }

  /**
   * After moving along one axis, push the player's AABB out of any solid
   * block it now overlaps and kill velocity on that axis. Resolving one axis
   * at a time is what lets the player slide along walls.
   */
  resolveCollisions(axis) {
    const p = this.position;
    const v = this.velocity;

    const x0 = Math.floor(p.x - PLAYER_HALF_WIDTH);
    const x1 = Math.floor(p.x + PLAYER_HALF_WIDTH);
    const y0 = Math.floor(p.y);
    const y1 = Math.floor(p.y + PLAYER_HEIGHT);
    const z0 = Math.floor(p.z - PLAYER_HALF_WIDTH);
    const z1 = Math.floor(p.z + PLAYER_HALF_WIDTH);

    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (let bx = x0; bx <= x1; bx++) {
          if (!isSolid(this.world.getBlock(bx, by, bz))) continue;
          // Re-test precisely: an earlier clamp this call may have already
          // moved the AABB off this block.
          if (
            p.x - PLAYER_HALF_WIDTH >= bx + 1 || p.x + PLAYER_HALF_WIDTH <= bx ||
            p.y >= by + 1 || p.y + PLAYER_HEIGHT <= by ||
            p.z - PLAYER_HALF_WIDTH >= bz + 1 || p.z + PLAYER_HALF_WIDTH <= bz
          ) {
            continue;
          }

          if (axis === 0) {
            p.x = v.x > 0 ? bx - PLAYER_HALF_WIDTH - EPS : bx + 1 + PLAYER_HALF_WIDTH + EPS;
            v.x = 0;
          } else if (axis === 1) {
            if (v.y > 0) {
              p.y = by - PLAYER_HEIGHT - EPS;
            } else {
              p.y = by + 1 + EPS;
              this.onGround = true;
            }
            v.y = 0;
          } else {
            p.z = v.z > 0 ? bz - PLAYER_HALF_WIDTH - EPS : bz + 1 + PLAYER_HALF_WIDTH + EPS;
            v.z = 0;
          }
        }
      }
    }
  }
}
