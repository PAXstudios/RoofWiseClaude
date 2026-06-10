import * as THREE from 'three';
import { BLOCK, BLOCK_DEFS } from './blocks.js';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 256;

/**
 * The six cube faces. Corner winding is counter-clockwise as seen from
 * outside the cube, so two CCW triangles per quad: (0,1,2) and (2,1,3).
 * `shade` bakes Minecraft-style directional shading into vertex colors.
 */
const FACES = [
  { dir: [-1, 0, 0], shade: 0.78, corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]] },
  { dir: [1, 0, 0], shade: 0.78, corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]] },
  { dir: [0, -1, 0], shade: 0.55, corners: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]] },
  { dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { dir: [0, 0, -1], shade: 0.88, corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, 0, 1], shade: 0.88, corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] },
];

// Shared materials — chunks must never own materials, only geometries.
const opaqueMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
const waterMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.7,
  side: THREE.DoubleSide, // visible while submerged
  depthWrite: false,      // avoids self-occlusion artifacts between water faces
});

/**
 * A 16x16x256 column of blocks stored in a flat Uint8Array, plus the meshes
 * built from it. Index layout is x + z*16 + y*256 (x fastest) so the mesher
 * walks memory linearly.
 */
export class Chunk {
  constructor(world, cx, cz) {
    this.world = world;
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    this.mesh = null;
    this.waterMesh = null;
    this.hasMesh = false;
    this.dirty = false;
  }

  static index(x, y, z) {
    return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
  }

  /** Local-coordinate accessors; bounds are the caller's responsibility. */
  getBlock(x, y, z) {
    return this.blocks[Chunk.index(x, y, z)];
  }

  setBlock(x, y, z, id) {
    this.blocks[Chunk.index(x, y, z)] = id;
    this.dirty = true;
  }

  /**
   * Rebuild render geometry with simple face culling: a face is emitted only
   * when the neighboring cell does not visually occlude it. Neighbor lookups
   * that fall outside this chunk go through the world (which falls back to
   * the terrain generator for unloaded chunks, so chunk borders never seam).
   */
  buildMesh() {
    const blocks = this.blocks;
    const world = this.world;
    const wx0 = this.cx * CHUNK_SIZE;
    const wz0 = this.cz * CHUNK_SIZE;

    const opaque = { positions: [], normals: [], colors: [], indices: [] };
    const water = { positions: [], normals: [], colors: [], indices: [] };

    const blockAt = (x, y, z) => {
      if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK.AIR;
      if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) {
        return blocks[Chunk.index(x, y, z)];
      }
      return world.getBlock(wx0 + x, y, wz0 + z);
    };

    let idx = 0;
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++, idx++) {
          const id = blocks[idx];
          if (id === BLOCK.AIR) continue;

          const def = BLOCK_DEFS[id];
          const isWater = id === BLOCK.WATER;
          const target = isWater ? water : opaque;

          for (const face of FACES) {
            const neighbor = blockAt(x + face.dir[0], y + face.dir[1], z + face.dir[2]);
            if (isWater) {
              // Water only shows surfaces against air, never water-on-water
              // internals or faces pressed against solid blocks.
              if (neighbor !== BLOCK.AIR) continue;
            } else if (BLOCK_DEFS[neighbor].opaque) {
              continue;
            }

            const tint = face.dir[1] === 1 ? def.rgb.top : face.dir[1] === -1 ? def.rgb.bottom : def.rgb.side;
            const r = tint[0] * face.shade;
            const g = tint[1] * face.shade;
            const b = tint[2] * face.shade;

            const base = target.positions.length / 3;
            for (const c of face.corners) {
              target.positions.push(x + c[0], y + c[1], z + c[2]);
              target.normals.push(face.dir[0], face.dir[1], face.dir[2]);
              target.colors.push(r, g, b);
            }
            target.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          }
        }
      }
    }

    this.disposeMeshes();
    this.mesh = this.createMesh(opaque, opaqueMaterial);
    this.waterMesh = this.createMesh(water, waterMaterial);
    this.hasMesh = true;
    this.dirty = false;
  }

  createMesh(data, material) {
    if (data.positions.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(data.normals), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.colors), 3));
    geometry.setIndex(data.indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(this.cx * CHUNK_SIZE, 0, this.cz * CHUNK_SIZE);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.world.scene.add(mesh);
    return mesh;
  }

  disposeMeshes() {
    for (const mesh of [this.mesh, this.waterMesh]) {
      if (mesh) {
        this.world.scene.remove(mesh);
        mesh.geometry.dispose();
      }
    }
    this.mesh = null;
    this.waterMesh = null;
    this.hasMesh = false;
  }
}
