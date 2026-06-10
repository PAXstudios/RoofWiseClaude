# VoxelCraft — Phase 1

A 3D Minecraft-style voxel engine built from scratch with HTML5, JavaScript (ES modules), and Three.js (loaded from CDN). No build step, no dependencies to install.

## Run it

ES modules require an HTTP server (opening `index.html` directly via `file://` will not work):

```bash
cd minecraft
python3 -m http.server 8000
# open http://localhost:8000
```

Any static server works (`npx serve`, VS Code Live Server, etc.). An internet connection is needed for the Three.js CDN.

URL options: `?seed=42` (world seed), `?rd=7` (render distance in chunks, 2–10, default 5).

## Controls

| Action | Input |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Jump / swim up | `Space` |
| Look | Mouse (pointer lock) |
| Break block | Left click |
| Place block | Right click |
| Select block | `1`–`6` or scroll wheel |
| Release mouse | `Esc` |

## Architecture

```
index.html          Entry point; import map pins Three.js from CDN
css/style.css       Crosshair, hotbar, menu overlay, debug HUD
js/
  main.js           Bootstrap: scene, lights, pointer lock, HUD, game loop
  blocks.js         Block registry — IDs, colors, solidity, opacity flags
  noise.js          Seeded 2D/3D simplex noise + fBm, written from scratch
  worldgen.js       Heightmap terrain, strata, caves, sea level, spawn search
  chunk.js          16×16×256 chunk: flat Uint8Array storage + face-culled mesher
  world.js          Chunk streaming, frame-budgeted meshing, block get/set routing
  player.js         FPS controller: mouse-look, WASD, gravity, AABB collision
  interaction.js    DDA voxel raycast, block highlight, break/place
```

### Technical highlights

- **Chunked voxel storage** — each 16×16×256 chunk is one flat `Uint8Array` (64 KB), indexed `x + z·16 + y·256` so the mesher walks memory linearly.
- **Face culling** — only faces adjacent to non-opaque cells are emitted, with per-face directional shading baked into vertex colors. Opaque and water geometry are split into separate meshes sharing two global materials.
- **Seamless borders** — block lookups in unloaded chunks fall back to the deterministic generator, so chunk-edge meshing, collision, and raycasts never see inconsistent terrain.
- **Frame-budgeted streaming** — chunks generate/mesh nearest-first under a ~6 ms per-frame budget; far chunks are disposed (geometry freed) as the player moves.
- **Terrain** — seeded simplex fBm heightmap (plains, mountains, oceans), bedrock floor at y=0–2, stone body carved by 3D-noise caves, dirt + grass cap, sand beaches, water up to sea level y=64.
- **Physics** — acceleration-based movement, gravity, jumping, basic swimming; swept axis-by-axis AABB collision with substepping so high fall speeds cannot tunnel through blocks.
- **Interaction** — Amanatides–Woo grid traversal from the crosshair (reach 5), wireframe highlight on the targeted block, left-click break (bedrock is unbreakable), right-click place with player-overlap rejection.

### Known Phase 1 limitations

- Water is static (no flow simulation); breaking a block next to water leaves an air pocket.
- Caves are fully underground (no surface entrances) to avoid flooding edge cases.
- Edits are not persisted when a chunk unloads or the page reloads.

## Roadmap

- **Phase 2** — texture atlas + per-face UVs (the mesher's color path swaps for UVs), biomes, trees, ambient occlusion.
- **Phase 3** — inventory, hotbar item counts, block drops.
