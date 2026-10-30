# Living Room interior model

This is the real, textured “The Grey & White Room” interior by Wig42, converted from the PBRT v4 scene into glTF Core 2.0 by the gltf-research-scenes project. It contains the room shell, floor, sofa, tables, and other furnishings. The source coordinate system is Y-up and the source dimensions are already meter scale (about 5.64 × 4.23 × 2.88 m).

## Provenance and license

- Original author: Wig42
- Original model: [The Grey & White Room](https://blendswap.com/blend/13552), also distributed via [Benedikt Bitterli Rendering Resources](https://benedikt-bitterli.me/resources/)
- glTF conversion: [ErfanMo77/gltf-research-scenes, living-room](https://github.com/ErfanMo77/gltf-research-scenes/tree/1f47d4c63bcad7582150d68300308b0c913bda6c/scenes/living-room)
- Model license: [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/), as stated in the original scene's `source/LICENSE.txt`.
- Attribution: “The Grey & White Room” by Wig42, converted to glTF by Erfan Moazeni. The room source and glTF conversion are distributed under their respective CC BY 3.0 terms.

`LICENSE` contains the source package's license notice. The conversion repository's commit and source hashes are recorded below for provenance.

## Files and runtime format

- `model.glb`: original PBR materials and embedded images retained; a root transform only rebases the room center and floor while preserving the source Y-up convention. Cesium applies its standard glTF-to-ENU axis conversion. Apply the scene's Cesium `modelMatrix`/ENU frame once; do not rotate the GLB again.
- `collision.bin`: little-endian `Float32` triangle soup in ENU meters. Each triangle is 9 floats (`a.xyz`, `b.xyz`, `c.xyz`). This is extracted from static glTF mesh primitives after node transforms using `[x-centerX, -(z-centerZ), y-floorY]`. `Glass` and `Windowpane` materials are excluded; all other static triangles are retained. It already includes the model normalization and ENU conversion; apply the Cesium geographic ENU frame only once.
- `manifest.json`: bounds, scene inventory, source camera and candidate floor locations, spawn hints, and collision format.

The model contains 65 source meshes, 19 PBR materials, 5 embedded image textures, and 131,989 collision triangles. The static collider contains actual source triangles, not hand-authored house AABBs. Spawn entries are geometric hints; resolve the final player start against the rendered model and capsule collision.

## Reproduce the normalized GLB and collision

From the staging root, fetch the two source files at the pinned commit and run the Node.js analyzer/converter:

```powershell
$source = 'scripts/asset-source/living-room'
New-Item -ItemType Directory -Force $source | Out-Null
Invoke-WebRequest 'https://raw.githubusercontent.com/ErfanMo77/gltf-research-scenes/1f47d4c63bcad7582150d68300308b0c913bda6c/scenes/living-room/gltf/living_room_core.gltf' -OutFile "$source/living_room_core.gltf"
Invoke-WebRequest 'https://media.githubusercontent.com/media/ErfanMo77/gltf-research-scenes/1f47d4c63bcad7582150d68300308b0c913bda6c/scenes/living-room/gltf/living_room.bin' -OutFile "$source/living_room.bin"
node scripts/analyze-interior.mjs "$source/living_room_core.gltf" public/first-person-lab/interior
```

The converter uses Node built-ins only. It rejects sparse accessors and non-triangle modes rather than silently producing incomplete collision data.

## SHA-256

Pinned source revision: `1f47d4c63bcad7582150d68300308b0c913bda6c`.

| File | SHA-256 |
| --- | --- |
| `model.glb` | `5cdfba85f6505403552c0980a6d1738443be295d60b3cd40bf7f154b3e3d2656` |
| `collision.bin` | `895d44f43a66f6d7b8d91a5d847c57510d2ba028fb70307ee30db7bc54a6ef3b` |
| source `living_room_core.gltf` | `75210889556a32f5e19d7086b722fb153e584b1d82444b5d43947bc5f78bb55b` |
| source LFS `living_room.bin` | `13365708f56b59b2e255070ae392af43df7d15c032da6ffd04bde7750c6e0c7c` |
