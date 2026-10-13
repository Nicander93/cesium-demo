# Upstream

Source: https://github.com/yuwoniu03/cesium-clouds-atmosphere
Source tree SHA: b3e6d33ff05b9abaa1b0ebe45ff79789c7784a7b
License: MIT; adapted upstream from takram-design-engineering/three-geospatial.

Local changes: import Cesium as an ES module, remove dat.gui imports and automatic GUI creation, keep assets local. The Vue city page owns all controls. Runtime shader and private WebGL compatibility must be checked against Cesium 1.132.

City integration changes: render clouds at 0.75 scale, reconstruct cloud rays and geometry hits from normalized UVs, remove the globe depth-plane heuristic for this globe-free model scene. Tone mapping is moved to the final city pass by a scoped instance adapter with restoration tests.

Original archive verified against all 41 Git blob hashes in that source tree. Archive SHA256: f555f606e2848ce98fd5d48d662eee08a2c355998586a41913d40fb2a24834e2.

Additional city integration: omit duplicate gamma decoding for linear HDR input, expose layer altitude and thickness, enable temporal accumulation only for high quality, and release TAA framebuffer/program/vertex buffer on destruction.

Latest corrections: upload atmospheric LUTs with flipY=false to preserve Three DataTexture row order; apply the previously unused atmosphere exposure only to sky radiance; preserve all GL state touched by raw BSM/TAA copies using an isolated VAO. The city currently disables temporal cloud accumulation and uses a fixed STBN slice without history. Local cloud shadow contribution is reduced because the nearby sun march already integrates the same extinction.


2026-10-12 city stability follow-up: raw CloudShadowPass and ShadowResolvePass now share gl-state.js isolation with blits; texture units, sampler objects and Cesium VAO/program state are restored in finally. Cloud jitterStrength is applied; secondary sun march keeps metre step sizes rather than dividing them by the sample count. Main step sizes are capped. Cloud self-lighting uses its own sun march rather than adding camera-centred BSM cascade extinction. City BSM resolve uses current-frame input, avoiding stale shadow history while moving.

2026-10-13: camera-ray.js shares main-camera projection/view ray uniforms across sky, clouds and aerial perspective. Read raw depth R with the log-depth reconstruction overload; sky selection uses depth. Initialize all cloud-shell intersection cases and march the complete interval with a bounded sample count. Pipeline-owned shadow passes run after parameter sync in one callback; standalone passes retain automatic rendering by default. City uses a 512 shadow atlas and continuous globe ground. GPU visual acceptance remains pending because browser policy rejected automated page access.


2026-10-13 orbital follow-up: optional separateCloudComposite emits cloud-only premultiplied radiance/opacity at reduced resolution, then composites the original scene at full resolution. Existing standalone usage retains combined output. Cloud sampling budgets apply after shell entry; orbital entry fading excludes the radial vacuum segment. Detail LOD is blended and cloud distance is weighted by extinction contribution. Aerial surface-shadow strength is configurable, with the city disabling whole-scene attenuation by default because it dims indirect and emissive lighting as well as direct light. GPU visual and continuous-motion acceptance remain unverified.


2026-10-13 fair-cloud refinement: add an optional approximation of the upstream ground-bounce lighting path (MIT, packages/clouds/src/shaders/clouds.frag). It marches extinction downward and evaluates ground sun/sky irradiance, then feeds bounced radiance into cloud scattering. The standalone default is zero; the city enables it except on low quality. Apply the previously unused cloudExposure to cloud radiance only, preserving opacity and the underlying scene. City fair and rainy presets use different layer density/thickness and sky-light weighting. References: https://github.com/takram-design-engineering/three-geospatial/blob/main/packages/clouds/src/shaders/clouds.frag .
