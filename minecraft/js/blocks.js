/**
 * Central block registry. Every block type is described once here; the rest
 * of the engine only ever consults this table.
 *
 * Phase 1 renders blocks with flat per-face colors (top / side / bottom).
 * Phase 2 will replace `rgb` with texture-atlas UVs without touching the
 * mesher's culling logic.
 */

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  BEDROCK: 4,
  WATER: 5,
  SAND: 6,
  WOOD: 7,
  LEAVES: 8,
};

function rgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function block(name, { solid = true, opaque = true, unbreakable = false, top, side, bottom, icon } = {}) {
  const topHex = top ?? side;
  const bottomHex = bottom ?? side;
  return {
    name,
    solid,        // blocks player movement
    opaque,       // hides the faces of adjacent blocks
    unbreakable,
    icon: icon ?? topHex ?? 0x000000,
    rgb: side === undefined ? null : { top: rgb(topHex), side: rgb(side), bottom: rgb(bottomHex) },
  };
}

export const BLOCK_DEFS = [];
BLOCK_DEFS[BLOCK.AIR] = block('Air', { solid: false, opaque: false });
BLOCK_DEFS[BLOCK.GRASS] = block('Grass', { top: 0x5fa83d, side: 0x817142, bottom: 0x7a5b3a });
BLOCK_DEFS[BLOCK.DIRT] = block('Dirt', { side: 0x7a5b3a });
BLOCK_DEFS[BLOCK.STONE] = block('Stone', { side: 0x8d8d8d });
BLOCK_DEFS[BLOCK.BEDROCK] = block('Bedrock', { side: 0x383838, unbreakable: true });
BLOCK_DEFS[BLOCK.WATER] = block('Water', { solid: false, opaque: false, side: 0x3f76e4 });
BLOCK_DEFS[BLOCK.SAND] = block('Sand', { side: 0xdbd3a0 });
BLOCK_DEFS[BLOCK.WOOD] = block('Wood', { top: 0x9c7f4e, side: 0x6e5530 });
BLOCK_DEFS[BLOCK.LEAVES] = block('Leaves', { side: 0x3e7a2a });

/** Blocks offered in the Phase 1 hotbar (full inventory arrives in Phase 3). */
export const PLACEABLE_BLOCKS = [
  BLOCK.GRASS,
  BLOCK.DIRT,
  BLOCK.STONE,
  BLOCK.SAND,
  BLOCK.WOOD,
  BLOCK.LEAVES,
];

export function isSolid(id) {
  return BLOCK_DEFS[id].solid;
}

export function isOpaque(id) {
  return BLOCK_DEFS[id].opaque;
}

export function cssColor(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}
