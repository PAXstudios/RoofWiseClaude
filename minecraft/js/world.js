import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './chunk.js';
import { WorldGenerator } from './worldgen.js';
import { BLOCK } from './blocks.js';

/**
 * Owns all chunks. Streams them in around the player sorted by distance,
 * spreads generation + meshing across frames with a time budget, and routes
 * world-coordinate block reads/writes to the right chunk.
 */
export class World {
  constructor(scene, seed = 1337, renderDistance = 5) {
    this.scene = scene;
    this.generator = new WorldGenerator(seed);
    this.renderDistance = renderDistance;
    this.chunks = new Map(); // "cx,cz" -> Chunk
    this.meshQueue = [];     // pending chunk coords, nearest first
    this.lastCx = null;
    this.lastCz = null;
  }

  key(cx, cz) {
    return cx + ',' + cz;
  }

  getChunk(cx, cz) {
    return this.chunks.get(this.key(cx, cz));
  }

  getOrCreateChunk(cx, cz) {
    const key = this.key(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(this, cx, cz);
      this.generator.fillChunk(chunk);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  /**
   * Block lookup at world coordinates. Unloaded chunks fall back to the
   * deterministic generator, so collision, raycasts and border meshing all
   * see consistent terrain regardless of streaming state.
   */
  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK.AIR;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return this.generator.blockAt(x, y, z);
    return chunk.getBlock(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
  }

  /**
   * Write a block and rebuild affected meshes immediately so edits feel
   * instant. Edits on a chunk border also remesh the adjacent chunk(s),
   * since their face culling depends on this block.
   */
  setBlock(x, y, z, id) {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return false;

    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    chunk.setBlock(lx, y, lz, id);
    chunk.buildMesh();

    if (lx === 0) this.rebuildIfMeshed(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.rebuildIfMeshed(cx + 1, cz);
    if (lz === 0) this.rebuildIfMeshed(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.rebuildIfMeshed(cx, cz + 1);
    return true;
  }

  rebuildIfMeshed(cx, cz) {
    const chunk = this.getChunk(cx, cz);
    if (chunk && chunk.hasMesh) chunk.buildMesh();
  }

  /** Synchronously generate and mesh the chunks around a position (spawn). */
  primeAround(pos, radius = 1) {
    const pcx = Math.floor(pos.x / CHUNK_SIZE);
    const pcz = Math.floor(pos.z / CHUNK_SIZE);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const chunk = this.getOrCreateChunk(pcx + dx, pcz + dz);
        if (!chunk.hasMesh) chunk.buildMesh();
      }
    }
  }

  /** Called once per frame: stream chunks in/out around the player. */
  update(playerPos) {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);

    if (pcx !== this.lastCx || pcz !== this.lastCz) {
      this.lastCx = pcx;
      this.lastCz = pcz;
      this.refreshQueue(pcx, pcz);
    }

    // Generate/mesh pending chunks until the frame budget runs out. ~6ms
    // keeps streaming brisk while leaving headroom for 60fps rendering.
    const deadline = performance.now() + 6;
    while (this.meshQueue.length > 0 && performance.now() < deadline) {
      const { cx, cz } = this.meshQueue.shift();
      const chunk = this.getOrCreateChunk(cx, cz);
      if (!chunk.hasMesh || chunk.dirty) chunk.buildMesh();
    }
  }

  /** Recompute the work queue and drop chunks that are now out of range. */
  refreshQueue(pcx, pcz) {
    for (const [key, chunk] of this.chunks) {
      const d = Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz));
      if (d > this.renderDistance + 1) {
        chunk.disposeMeshes();
        this.chunks.delete(key);
      }
    }

    const queue = [];
    const r = this.renderDistance;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const chunk = this.getChunk(pcx + dx, pcz + dz);
        if (!chunk || !chunk.hasMesh || chunk.dirty) {
          queue.push({ cx: pcx + dx, cz: pcz + dz, d: dx * dx + dz * dz });
        }
      }
    }
    queue.sort((a, b) => a.d - b.d);
    this.meshQueue = queue;
  }
}
