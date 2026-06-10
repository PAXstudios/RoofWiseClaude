import * as THREE from 'three';
import { BLOCK, BLOCK_DEFS, isSolid } from './blocks.js';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './player.js';

/**
 * Voxel raycast using Amanatides & Woo grid traversal (DDA). Walks the exact
 * sequence of cells the ray pierces — no mesh intersection tests needed —
 * and returns the first targetable block plus the face normal it was hit
 * through (used for placement).
 */
export function raycastVoxel(getBlock, origin, dir, maxDist) {
  let ix = Math.floor(origin.x);
  let iy = Math.floor(origin.y);
  let iz = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;

  const tDeltaX = Math.abs(1 / dir.x); // Infinity when the component is 0
  const tDeltaY = Math.abs(1 / dir.y);
  const tDeltaZ = Math.abs(1 / dir.z);

  let tMaxX = dir.x !== 0 ? (stepX > 0 ? ix + 1 - origin.x : origin.x - ix) * tDeltaX : Infinity;
  let tMaxY = dir.y !== 0 ? (stepY > 0 ? iy + 1 - origin.y : origin.y - iy) * tDeltaY : Infinity;
  let tMaxZ = dir.z !== 0 ? (stepZ > 0 ? iz + 1 - origin.z : origin.z - iz) * tDeltaZ : Infinity;

  let t = 0;
  const normal = [0, 0, 0];

  while (t <= maxDist) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      ix += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal[0] = -stepX; normal[1] = 0; normal[2] = 0;
    } else if (tMaxY < tMaxZ) {
      iy += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal[0] = 0; normal[1] = -stepY; normal[2] = 0;
    } else {
      iz += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal[0] = 0; normal[1] = 0; normal[2] = stepZ * -1;
    }
    if (t > maxDist) break;

    const id = getBlock(ix, iy, iz);
    if (isSolid(id)) {
      // Water and air are not targetable, matching Minecraft behavior.
      return { x: ix, y: iy, z: iz, id, normal: [...normal], distance: t };
    }
  }
  return null;
}

/** Targets blocks under the crosshair; breaks and places on click. */
export class BlockInteraction {
  constructor(world, player, camera, scene, reach = 5) {
    this.world = world;
    this.player = player;
    this.camera = camera;
    this.reach = reach;
    this.target = null;

    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x111111 })
    );
    box.dispose();
    this.highlight.visible = false;
    scene.add(this.highlight);

    this._dir = new THREE.Vector3();
  }

  /** Re-run the crosshair raycast and move the highlight box. */
  update() {
    this.camera.getWorldDirection(this._dir);
    this.target = raycastVoxel(
      (x, y, z) => this.world.getBlock(x, y, z),
      this.camera.position,
      this._dir,
      this.reach
    );

    if (this.target) {
      this.highlight.visible = true;
      this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    } else {
      this.highlight.visible = false;
    }
  }

  breakBlock() {
    if (!this.target) return;
    const { x, y, z } = this.target;
    if (BLOCK_DEFS[this.world.getBlock(x, y, z)].unbreakable) return;
    this.world.setBlock(x, y, z, BLOCK.AIR);
  }

  placeBlock(id) {
    if (!this.target) return;
    const t = this.target;
    const x = t.x + t.normal[0];
    const y = t.y + t.normal[1];
    const z = t.z + t.normal[2];

    const existing = this.world.getBlock(x, y, z);
    if (existing !== BLOCK.AIR && existing !== BLOCK.WATER) return;

    // Refuse placements that would trap the player inside a solid block.
    if (isSolid(id)) {
      const p = this.player.position;
      const overlapsPlayer =
        x + 1 > p.x - PLAYER_HALF_WIDTH && x < p.x + PLAYER_HALF_WIDTH &&
        y + 1 > p.y && y < p.y + PLAYER_HEIGHT &&
        z + 1 > p.z - PLAYER_HALF_WIDTH && z < p.z + PLAYER_HALF_WIDTH;
      if (overlapsPlayer) return;
    }

    this.world.setBlock(x, y, z, id);
  }
}
