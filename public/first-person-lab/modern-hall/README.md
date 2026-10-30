# Modern Hall

Author: NewSee2l035. License: CC BY 3.0, see LICENSE.txt.
Original: https://blendswap.com/blend/6304
Collection: https://benedikt-bitterli.me/resources/
Pinned glTF conversion: https://github.com/ErfanMo77/gltf-research-scenes/tree/1f47d4c63bcad7582150d68300308b0c913bda6c/scenes/modern-hall

Upstream modern_hall.bin SHA256: 854cc7a67bb12d8b4c5350241844f0015cb2c2e136b3163031060adec1207ad6 (6,231,516 bytes).
Normalized glTF Y-up, meter scale. Collision uses identical triangles mapped to ENU [x,-z,y], including glass surfaces. Cesium must use upAxis=Y, forwardAxis=X. The original offline area lights are emissive geometry; no real-time GI is baked by this conversion.

Rebuild with scripts/analyze-interior.mjs, using scripts/asset-source/modern-hall/config.json. The model is a connected architectural hall, not a floor-semantic BIM asset.
