import { SimplexNoise } from './noise.js';
import { BLOCK } from './blocks.js';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './chunk.js';

export const SEA_LEVEL = 64;

/**
 * Procedural terrain generator. Deterministic for a given seed: any block can
 * be computed analytically via blockAt(), which lets the world answer block
 * queries for chunks that are not loaded yet (used by the mesher at chunk
 * borders and by player collision before meshes stream in).
 *
 * Terrain recipe, bottom to top:
 *   y = 0..2            bedrock (solid floor, ragged upper layers)
 *   y < height - 3      stone, carved by 3D-noise caves
 *   height-3 .. height  dirt with a grass cap (sand near/below sea level)
 *   height+1 .. 64      water wherever the surface dips under sea level
 */
export class WorldGenerator {
  constructor(seed = 1337) {
    this.seed = seed;
    this.seedSalt = Math.imul(seed, 0x9e3779b1) | 0;
    this.continentNoise = new SimplexNoise(seed);
    this.detailNoise = new SimplexNoise(seed + 101);
    this.caveNoise = new SimplexNoise(seed + 202);
    this.heightCache = new Map();
  }

  /** Terrain surface height (y of the topmost solid block) for a column. */
  height(x, z) {
    const key = x + ',' + z;
    const cached = this.heightCache.get(key);
    if (cached !== undefined) return cached;

    // Raising the fBm to a power (sign-preserving) flattens plains and
    // ocean floors while keeping mountain peaks and deep seas dramatic.
    let e = this.continentNoise.fbm2D(x * 0.004, z * 0.004, 4);
    e = Math.sign(e) * Math.pow(Math.abs(e), 1.5);
    let h = 66 + e * 42 + this.detailNoise.noise2D(x * 0.02, z * 0.02) * 3;
    h = Math.round(Math.min(Math.max(h, 4), CHUNK_HEIGHT - 40));

    if (this.heightCache.size > 100000) this.heightCache.clear();
    this.heightCache.set(key, h);
    return h;
  }

  /** Deterministic per-block hash in [0, 1), used for the ragged bedrock cap. */
  hash3(x, y, z) {
    let h = (x * 374761393 + y * 668265263 + z * 1274126177 + this.seedSalt) | 0;
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  /** Underground cave carving via 3D simplex noise (squashed vertically). */
  isCave(x, y, z, h) {
    if (y < 6 || y > h - 6) return false;
    return this.caveNoise.noise3D(x * 0.055, y * 0.085, z * 0.055) > 0.6;
  }

  /** The block at any world coordinate, independent of chunk state. */
  blockAt(x, y, z, h = this.height(x, z)) {
    if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK.AIR;
    if (y === 0) return BLOCK.BEDROCK;
    if (y <= 2 && this.hash3(x, y, z) > y / 3) return BLOCK.BEDROCK;
    if (y > h) return y <= SEA_LEVEL ? BLOCK.WATER : BLOCK.AIR;
    if (this.isCave(x, y, z, h)) return BLOCK.AIR;

    const sandy = h <= SEA_LEVEL + 1; // beaches and ocean floor
    if (y === h) return sandy ? BLOCK.SAND : BLOCK.GRASS;
    if (y >= h - 3) return sandy ? BLOCK.SAND : BLOCK.DIRT;
    return BLOCK.STONE;
  }

  /** Populate a freshly created chunk's block array. */
  fillChunk(chunk) {
    const x0 = chunk.cx * CHUNK_SIZE;
    const z0 = chunk.cz * CHUNK_SIZE;
    const blocks = chunk.blocks;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const h = this.height(wx, wz);
        const top = Math.max(h, SEA_LEVEL);
        for (let y = 0; y <= top; y++) {
          const id = this.blockAt(wx, y, wz, h);
          if (id !== BLOCK.AIR) blocks[Chunk.index(lx, y, lz)] = id;
        }
      }
    }
  }

  /** Ring-search outward from the origin for a dry column to spawn on. */
  findSpawn() {
    for (let radius = 0; radius <= 32; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const x = dx * 4;
          const z = dz * 4;
          const h = this.height(x, z);
          if (h > SEA_LEVEL + 1) return { x: x + 0.5, y: h + 1.01, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: this.height(0, 0) + 1.01, z: 0.5 };
  }
}
