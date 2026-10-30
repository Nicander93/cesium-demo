# cesium-geospatial upstream record

2026-10-26 startup follow-up: immutable lab cloud options can be baked into shader constants; an opt-in vertex stage restores camera-constant irradiance evaluation to the fullscreen quad. The lab opts into BSM-only sun occlusion, a local moon occlusion estimate and height-exponential cloud aerial perspective; the full lighting path remains available for raw diagnostics, and the sky/ground atmosphere remains LUT based. A cancellable, bounded Worker warms compiled programs and their first submission in an isolated 1x1 context; a Cesium 1.132 source adapter and runtime source-fingerprint checks guard the cache hint. Unsupported/failed preparation falls back to ordinary rendering. See PERFORMANCE.md for numerical checks, measured startup and remaining initialization pauses. This is a visual approximation, not pixel equivalence with the full model.

2026-10-26 local performance changes: the lab opts into `BOUNDED_MARCH`, spreading a fixed iteration budget over the remaining segment and omitting nested density refinement on that path. The existing non-bounded shader path remains available. Cloud PCF follows the selected 4/8/16 sample budget; an inactive resolve despeckle kernel is omitted at compile time. LUT uploads use native half-float input when supported, and volumetric primitive disposal releases its ShaderCache reference. The lab owns and reuses LUT/weather resources per Viewer. See `src/views/cloud-atmosphere-lab/PERFORMANCE.md` for measurements, reference-code comparisons and unresolved startup stalls. No shader or asset was copied from cesium-extract.

## Local rendering extensions, 2026-10-24

- `emptyStepScale` is optional (fallback 1). A larger clear-medium search stride resamples candidate hits using the fine optical cell before lighting. Layer gaps use sphere intersections to skip known empty space. Coarse search is not a guarantee of preserving arbitrarily thin features.
- Moving weather invalidates cached BSM contents even with stationary matrices. `CloudsStageOptions.shadowUpdateIntervalMs` bounds weather-only refresh latency (fallback 0); camera/grid changes, explicit refresh and temporal accumulation still refresh immediately. The lab selects 100ms.

- `maxOpticalDepthPerStep` is optional (fallback 0). Primary rays can refine dense cells before lighting/integration, at most twice with a 1m floor and a clipped final segment. Texture footprints include the cell length. This is bounded-work refinement, not an exact heterogeneous-medium integral.

- Optional `CloudsDefaultParameters` fields: `sampleFootprintScale` (fallback 0), `cumulusDensity` (0), `groundDiffuseTransport` (0), `ambientMultipleScattering` (0), `ambientSkySaturation` (1). Library consumers retain the previous density/lighting/sampling model unless they opt in. Lab-only defaults and art direction are in `provider-settings.ts`.
- Footprint filtering uses explicit volume mip levels, continuous detail weights, and matched integration/advancement lengths. Shape/detail assets are unchanged; the loader can create mip chains from the existing R8 volumes.
- Low-cumulus density uses the first two packed layers. Main and shadow passes share the same uniforms/density functions. Existing layer height bounds and world-space weather/wind coordinates are preserved.
- Indirect sky/ground terms are bounded approximations with no emitted-light floor; sky saturation is an art control preserving photometric luminance. They are not a full spatial multiple-scattering solver.
- Camera classification now uses actual geodetic `cameraHeight`; clipped ray entry positions must not trigger in-cloud fog processing for exterior views.

- Source repository: https://github.com/Zhliyun/cesium-geospatial
- Pinned commit: `577d5a2ad6731e97a91318ed20bcd14dd9cb2036`
- Source package directories: `packages/cesium-core/src` and `packages/cesium-clouds/src`
- Imported files: runtime `.ts`, `.glsl`, `.frag`, and `.vert` files from those source directories, except tests and shader-validation-only helpers.
- Excluded: tests, docs, examples, scripts, package/build output, shader validator helpers (`clouds/glslangUtil.ts`, `core/cesium/glslangUtil.ts`), and `.claude`/`.codegraph` agent configuration.
- Local entry: `core/experimental.ts` exports only symbols consumed by the cloud package and the lab; upstream source modules remain unchanged unless a compatibility patch is recorded here.
- Cesium target: project Cesium `1.132.0`; upstream package development dependencies declare `^1.143.0`. Local runtime verification is required.
- Runtime dependency: `@petamoriken/float16` is required by the upstream core LUT loader. Shader validator and other upstream development tools are excluded.

## Height-based suspension (2026-10-23)

Optional `pauseWhenHidden` reuses height fade to skip cloud march/resolve command submission and BSM updates at zero visibility, retaining resources. Re-entry invalidates cloud/BSM temporal history and refreshes BSM even if its world grid has not moved. Read-only `visibility` / `renderingActive` report presentation separately from stage readiness. Library defaults retain the original 50–300km fade and do not pause unless requested. The city-oriented 4–12km default is selected only by the lab adapter. Debug views bypass the fade. `VolumetricPrimitive.show` gates submission rather than destroying GPU objects.

## Assets

The lab reuses `public/city-rendering/atmosphere/lut` and `public/city-rendering/atmosphere/clouds-assets`. The cloud package consumes the 3D `shape.bin`, `shape_detail.bin`, and `stbn.bin` noise assets plus `local_weather.png`; the core consumes the four Bruneton half-float LUTs. The binary sizes and declared dimensions were checked against the upstream loaders.

## License notices

The pinned repository root `package.json` declares MIT and its README says MIT, but the pinned tree has no standalone LICENSE file. These declarations do not override third-party terms. Full source notices are preserved in `licenses/`:

- `LICENSE.three-geospatial.txt`: MIT, copyright Shota Matsuda; upstream atmosphere/cloud implementation is derived from Takram three-geospatial.
- `LICENSE.bruneton.txt`: BSD 3-Clause, copyright 2017 Eric Bruneton; required for Bruneton-derived scattering shader portions and LUT data.
- `LICENSE.nvidia-stbn.txt`: complete NVIDIA STBN License.txt, including its Non-Commercial Use License and separate NVIDIA RTX SDKs License section. The STBN asset is used only for this research/evaluation experiment. This record does not determine future distribution eligibility.

## Local compatibility patches and support code

- `clouds/glsl/clouds.frag` initializes the `out rayDistance` before the zero-secondary-sample return; GLSL out arguments do not preserve the caller's initialization. It computes cloud depth from segment extinction weights and the conditional mean extinction distance, using a thin-cell series for numerical stability. Opaque first segments retain finite cloud depth. Cloud-hit temporal velocity now uses camera-space reprojection instead of subtracting large ECEF coordinates on the GPU. These correctness changes do not alter cloud density or shape controls and do not establish a complete visual-quality pass.
- `clouds/glsl/cloudsResolve.frag` corrects the closest-neighbor depth guard to the documented 0.5–2 depth ratio and clamps neighbor coordinates at viewport edges. `scripts/test-cloud-resolve-gpu.mjs` executes the actual assembled GLSL neighborhood function and depth helper on WebGL2; the neighbor regression fails against the former guard.
- `createCloudsStage.ts`, `temporalMath.ts` and `CloudsResolvePass.ts` add opt-in `staticAccumulation`. Callers must guarantee fixed weather, lighting and opaque geometry. An unchanged camera averages128 samples, then retains the preview instead of cycling an EMA over the same64 STBN layers. Motion resets the accumulation; the ordinary temporal path remains active during motion. The camera comparison tolerates the observed nanometre-scale ECEF matrix recomputation noise. The lab enables this only for frozen-weather full-resolution previews; it is not a general animated-cloud denoiser.
- `fixedViewJitter`, `fixedLightJitter` and `opticalStep` are explicit shader diagnostics. They isolate view/light phase variance and optically bounded camera-medium steps. The optical-step experiment did not materially improve the tested views and remains disabled. `cloudDebug=raw` in the lab selects unaccumulated output; regular full-resolution preview now uses temporal rendering and the opt-in fixed-scene accumulation above.

- `clouds/CloudsMaterial.ts` and `clouds/glsl/clouds.frag` add an opt-in `fixedJitter` diagnostic. It passes a constant 0.5 phase only into the main cloud integral, keeping the density field, iteration budget, shadow pass and default rendering unchanged. The lab exposes it only through `cloudDebug=fixedJitter`. Real IAB comparisons at the 2400m sunset view reduced visible grain, but retained flat grey fog; the ground view also exposed structured streaks. This is a source-isolation experiment, not a production denoising fix or a visual pass.

- `core/normalizeShaderSource.ts`, `core/glslIndex.ts`, and `clouds/glslIndex.ts` normalize imported raw shader line endings before the upstream include assembler performs LF-based source surgery. On Windows, Vite `?raw` preserves CRLF and the assembler otherwise misses anchors; this prevents malformed runtime shaders.
- `clouds/CloudsPass.ts` owns every MRT attachment through `mrtTextures`; `shadowLenTex` is already included when light shafts are enabled. Its duplicate destroy call threw Cesium `DeveloperError` on every provider teardown and left the overlay stage mounted. The redundant second destroy was removed. On 2026-10-21, a real sunny-to-sunset community rebuild completed from `loading` to `ready` (rebuild count 1 to 2) without stage-name or cleanup errors on the NVIDIA GeForce RTX 5070 test path.
- `clouds/glsl/clouds.frag` raises the dense-layer in-cloud march cap from 32 to 128 samples. The pinned cap produced severe alternating opaque/transparent pixels at the lab's 2400 m inside-cloud view. A 96-sample trial reduced the checker pattern; 128 further reduced visible high-contrast speckle versus 96 in the same 2400 m capture, but substantial residual noise remains; this is not a visual pass. The continuous-motion smoke passed on the lab GPU at median 17.5 ms, p95 18.5 ms, and max 87.2 ms for the full scene; these are whole-frame timings, not isolated cloud-march costs. This is a local visual/performance tradeoff verified on the lab GPU.
- `clouds/CloudsResolvePass.ts`, `clouds/createCloudsStage.ts`, and `clouds/glsl/cloudsResolve.frag` keep temporal-upscale history accumulation enabled when `frameUnfreeze` changes march STBN every frame. The upstream direct-current Bayer branch overwrote each full-resolution history pixel every four phases, limiting accumulation to the three intervening frames; a fixed-camera Cesium 1.132 GPU A/B at 1440×900 reduced the inside-cloud ROI's 60→120-frame mean absolute pixel change from 5.46 to 2.00 (pixels >8 levels: 19.13% to 2.55%). Residual high-contrast spots remain, so this is a convergence improvement, not a visual pass. The option is false by default and preserves the upstream direct-current behavior when march noise is frozen. It removes the early return for about one quarter of upscale output pixels per frame (up to one third more active resolve shading); the test records full-frame timing only, not isolated pass cost.
- `core/experimental.ts` is a narrow local entry point to keep cloud imports from traversing unrelated package exports. It does not change the upstream algorithms.
- `core/cesium/cesium-augment.d.ts` adds the Cesium 1.132 internal class declarations used by this vendor copy, including `Texture3D` and `isDestroyed()` signatures required for cleanup.
- `core/cesium/lutLoader.ts` adds `AbortSignal` forwarding, non-2xx rejection, and exact LUT byte-size validation. Texture creation is transactional: if a later LUT allocation fails, earlier textures are destroyed before the loader rejects.
- `clouds/weatherTextures.ts` adds `AbortSignal` forwarding, non-2xx rejection, exact raw noise size validation, and strict PNG decode errors. It does not create the former 1×1 white fallback. Decoded `ImageBitmap` instances are closed in `finally`, and any shape/detail/STBN/weather textures already allocated are destroyed if a later step fails.
- `clouds/createCloudsStage.ts` adds `weatherTimeSource` for cloud advection/evolution only; celestial sun and shadow lighting continue to use Cesium clock time. This lets the experiment animate wind while keeping the selected sun phase frozen.
- `core/cesium/AtmosphereStage.ts` tracks and releases its lazily created dummy textures when the stage is destroyed.
- `core/resourceScope.ts` is a local helper (not copied from upstream) shared by the LUT and weather loaders for rollback on partial allocation failure.
- The lab passes `moon: false`, `lensFlare: false`, and `depthTemporal: false` to avoid unprovided moon/stars/lens flare assets and extra temporal history stages. Community assets use only the existing local `public/city-rendering/atmosphere` files.
- Mode switches reconstruct and serialize the full candidate pipeline rather than calling upstream `AtmosphereStage.setMode`, whose own comments leave overlay/depth-temporal ordering undefined after rebuild.

- `core/cesium/aerialPerspective.frag.ts` uses the Cesium 1.132 two-argument eye-coordinate reconstruction for depth (the engine does inject `LOG_DEPTH` into post-process stages). Local range is measured in eye space. The stable far-sphere fallback is retained: extending arbitrary opaque endpoints across the whole globe exposed grid artifacts and was rejected. Foreground and sun-disc masks now use ascending `smoothstep` edges. `core/cesium/tonemap.frag.ts` restricts the HDR `/5` diagnostic to mode 7, so transport diagnostics above mode 7 retain their declared scale.
- `clouds/glsl/clouds.frag`, `CloudsPass.ts`, and `cloudsDefaultParameters.ts` add optional `groundAmbientAlbedo` (default 0, lab profile 0.2). `getGroundAmbientRadiance` approximates a Lambertian ground hemisphere with a homogeneous local vertical Beer path, reusing the existing physical sun/sky samples before artistic night fill. It requires no extra texture fetches, secondary rays, or targets. This is an indirect-light approximation rather than full ground occlusion, material response or cloud multiple scattering. The numeric GPU tests execute the actual GLSL and cover zero albedo, Lambert normalization, attenuation, overcast and darkness.

## Imported runtime source manifest


- `core/normalizeShaderSource.ts` (local Windows raw-shader compatibility helper)
- `clouds/CascadedShadowMaps.ts`
- `clouds/cloudLayersPacking.ts`
- `clouds/cloudsConstants.ts`
- `clouds/cloudsDefaultParameters.ts`
- `clouds/CloudsMaterial.ts`
- `clouds/CloudsPass.ts`
- `clouds/CloudsResolveMaterial.ts`
- `clouds/CloudsResolvePass.ts`
- `clouds/cloudsShaderAssembler.ts`
- `clouds/createCloudsStage.ts`
- `clouds/glsl/catmullRomSampling.glsl`
- `clouds/glsl/clouds.glsl`
- `clouds/glsl/compatCommon.glsl`
- `clouds/glsl/compatPacking.glsl`
- `clouds/glsl/parameters.glsl`
- `clouds/glsl/perlin.glsl`
- `clouds/glsl/structuredSampling.glsl`
- `clouds/glsl/tileableNoise.glsl`
- `clouds/glsl/types.glsl`
- `clouds/glsl/varianceClipping.glsl`
- `clouds/glsl/clouds.frag`
- `clouds/glsl/clouds.vert`
- `clouds/glsl/cloudsEffect.frag`
- `clouds/glsl/cloudShape.frag`
- `clouds/glsl/cloudShapeDetail.frag`
- `clouds/glsl/cloudsResolve.frag`
- `clouds/glsl/cloudsResolve.vert`
- `clouds/glsl/localWeather.frag`
- `clouds/glsl/shadow.frag`
- `clouds/glsl/shadow.vert`
- `clouds/glsl/shadowResolve.frag`
- `clouds/glsl/shadowResolve.vert`
- `clouds/glsl/turbulence.frag`
- `clouds/glsl/weatherBake.frag`
- `clouds/glslIndex.ts`
- `clouds/index.ts`
- `clouds/qualityPresets.ts`
- `clouds/raw.d.ts`
- `clouds/resolveCloudsIncludes.ts`
- `clouds/shadowBudgetAdaptation.ts`
- `clouds/ShadowMaterial.ts`
- `clouds/ShadowPass.ts`
- `clouds/ShadowResolveMaterial.ts`
- `clouds/sunQuantization.ts`
- `clouds/temporalMath.ts`
- `clouds/WeatherAtlas.ts`
- `clouds/weatherBakeAssembler.ts`
- `clouds/weatherTextures.ts`
- `clouds/weatherTime.ts`
- `core/celestial/celestialDirections.ts`
- `core/cesium/aerialPerspective.frag.ts`
- `core/cesium/AtmosphereStage.ts`
- `core/cesium/cesium-augment.d.ts`
- `core/cesium/cesiumCore.ts`
- `core/cesium/cesiumTextures.ts`
- `core/cesium/depthReconstruction.ts`
- `core/cesium/depthTemporal/depthTemporal.frag.ts`
- `core/cesium/depthTemporal/depthTemporalConstants.ts`
- `core/cesium/depthTemporal/historyBlit.ts`
- `core/cesium/depthTemporal/temporalAlpha.ts`
- `core/cesium/lensFlare/bloomDownsample.frag.ts`
- `core/cesium/lensFlare/bloomUpsample.frag.ts`
- `core/cesium/lensFlare/composite.frag.ts`
- `core/cesium/lensFlare/createLensFlareStage.ts`
- `core/cesium/lensFlare/features.frag.ts`
- `core/cesium/lensFlare/lensFlareConstants.ts`
- `core/cesium/lensFlare/occlusion.frag.ts`
- `core/cesium/lensFlare/occlusion.ts`
- `core/cesium/lensFlare/preBlur.frag.ts`
- `core/cesium/lensFlare/threshold.frag.ts`
- `core/cesium/logDepth.ts`
- `core/cesium/lutLoader.ts`
- `core/cesium/platform/FramebufferManager.ts`
- `core/cesium/platform/FullscreenPass.ts`
- `core/cesium/platform/index.ts`
- `core/cesium/platform/VolumetricPrimitive.ts`
- `core/cesium/profile/stageGpuTimer.ts`
- `core/cesium/tonemap.frag.ts`
- `core/experimental.ts`
- `core/glsl/bruneton/common.glsl`
- `core/glsl/bruneton/definitions.glsl`
- `core/glsl/bruneton/precompute.glsl`
- `core/glsl/bruneton/runtime.glsl`
- `core/glsl/cascadedShadowMaps.glsl`
- `core/glsl/depth.glsl`
- `core/glsl/generators.glsl`
- `core/glsl/interleavedGradientNoise.glsl`
- `core/glsl/math.glsl`
- `core/glsl/packing.glsl`
- `core/glsl/raySphereIntersection.glsl`
- `core/glsl/transform.glsl`
- `core/glsl/turbo.glsl`
- `core/glsl/vogelDisk.glsl`
- `core/glslIndex.ts`
- `core/index.ts`
- `core/math/altitudeCorrection.ts`
- `core/math/atmosphereParameters.ts`
- `core/raw.d.ts`
- `core/resolveIncludes.ts`
- `core/unrollLoops.ts`

- The lab passes `moon: false`, `lensFlare: false`, and `depthTemporal: false` to avoid unprovided moon/stars/lens flare assets and extra temporal history stages. Community assets use only the existing local `public/city-rendering/atmosphere` files.
- Mode switches reconstruct and serialize the full candidate pipeline rather than calling upstream `AtmosphereStage.setMode`, whose own comments leave overlay/depth-temporal ordering undefined after rebuild.

- 2026-10-25: Cumulus detail erosion varies with normalized local cloud height and protects dense cores; it adds no volume samples. AtmosphereStage has an opt-in groundShadowOnly mode: the existing BSM attenuates only the LUT-estimated direct-light fraction of already lit Cesium colors, retaining diffuse sky light. Both are independently written integration experiments informed by the cesium-extract pipeline; no extracted shaders or assets are copied. See the lab README and scripts/test-atmosphere-gpu.mjs for validation and approximation limits.

- 2026-10-26: Independently written phase-aware intermediate reconstruction, normalized viewport/depth alignment, STBN phase decorrelation, cumulus cap shaping, and bounded single-shape near-light approximation. Inspired by cesium-extract's two-stage cloud reconstruction; no extracted source/assets copied. See the lab VISUAL-RECONSTRUCTION.md and test-cloud-reconstruction-gpu.mjs.
