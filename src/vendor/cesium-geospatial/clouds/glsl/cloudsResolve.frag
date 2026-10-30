precision highp float;
precision highp sampler2DArray;

// 【Cesium 适配扩展（涂抹修复 T1，2026-09-02）】upscale 分母缺省 1（2026-09-02 用户定稿
// 全分 TAA 档为默认；1=全分走 TAA 分支，2/4=低分 upscale）——运行时由
// buildCloudsResolveFragmentShader defines 恒注入；此缺省保 raw source 独立编译
// 可过（GLSL ES：未定义宏参与 #if 表达式是编译错）。
#ifndef UPSCALE_DIVISOR
#define UPSCALE_DIVISOR 1
#endif // UPSCALE_DIVISOR

#include "core/turbo"
#include "catmullRomSampling"
#include "varianceClipping"

uniform sampler2D colorBuffer;
uniform sampler2D depthVelocityBuffer;
uniform sampler2D colorHistoryBuffer;

#ifdef SHADOW_LENGTH
uniform sampler2D shadowLengthBuffer;
uniform sampler2D shadowLengthHistoryBuffer;
#endif // SHADOW_LENGTH

uniform vec2 texelSize;
uniform int frame;
uniform float varianceGamma;
uniform float temporalAlpha;
uniform int u_staticSampleCount;
uniform bool u_cameraMoving;
uniform float temporalDisocclusion;
uniform bool u_accumulateUpscaleHistory;
uniform vec2 jitterOffset;
// 【2026-10-08 白点治理】输出端孤点中值滤波强度（0=关缺省零回归；1=全替换）。
// 白点=march 能量积分采样方差的 1px 亮度尖峰（伴生暗斑族对称），时序平均
// （frameUnfreeze）消掉 ~95% 后的残余为每帧随机注入的稳态——邻域中值直接替换。
uniform float u_spatialDespeckle;

in vec2 vUv;

layout(location = 0) out vec4 outputColor;
#ifdef SHADOW_LENGTH
layout(location = 1) out float outputShadowLength;
#endif // SHADOW_LENGTH

const ivec2 neighborOffsets[9] = ivec2[9](
  ivec2(-1, -1),
  ivec2(-1, 0),
  ivec2(-1, 1),
  ivec2(0, -1),
  ivec2(0, 0),
  ivec2(0, 1),
  ivec2(1, -1),
  ivec2(1, 0),
  ivec2(1, 1)
);

const ivec4[4] bayerIndices = ivec4[4](
  ivec4(0, 12, 3, 15),
  ivec4(8, 4, 11, 7),
  ivec4(2, 14, 1, 13),
  ivec4(10, 6, 9, 5)
);

// 【Cesium 适配扩展（涂抹修复 T1，2026-09-02）】UPSCALE_DIVISOR=2：半分 march（RT 面积 ×4，
// 细节上限 4px→2px 像素周期）下直通块从 4×4 变 2×2——16 相位 4×4 表不适用，改 2×2 Bayer
// 4 相位表 + frame%4 直通（每像素每 4 帧直通一次，逐轮消费 march 端 16 相位 jitter 的不同
// 真值）。N=4 路径（#else）保持 three 原文逐字，便于上游 diff。
#if UPSCALE_DIVISOR == 2
const int bayerIndices2[4] = int[4](0, 2, 3, 1);
#endif // UPSCALE_DIVISOR == 2

// 【2026-09-04 coverage=1 云甲内运动全黑修复：getHistoryNanGuard】history 采样含 NaN 时
// 以 current 替换。GLSL mix 为 IEEE 融合乘加——NaN·(1-α) 任意 α 均传播，NaN 一旦写入
// history 即 ping-pong 永久自持（δa rejection 的比较恒 false 拦不住、α=1 直混也无法
// 消除、刷新才清）。运动中大视差（近云深度 texel 数米位移→百 texel 级重投影）易采到
// 坏值区，故在采样后立即消毒。
vec4 sanitizeHistory(const vec4 sampled, const vec4 current) {
  if (any(isnan(sampled)) || any(isinf(sampled))) {
    return current;
  }
  return sampled;
}

vec4 getClosestFragment(const ivec2 coord) {
  // 【2026-09-03 夜间云内移动黑块修复：getClosestFragmentNoCloudGuard】云甲内视角下
  // depthVelocity.r 在「有云 texel（云距）/无云 texel（cameraFar≈1e10）」间逐像素跳变。
  // 3×3 全局最近深度会让无云 texel 借到别处云的 velocity → history 重投影错位 → 云的
  // a/rgb 拖尾成层叠鬼影（暗色块；移动时持续供错、刷新才清；夜晚 761m 复现组实证）。
  // 修=中心 texel 自身 depth 为远平面级（无样本=无云）时直接退回自身 velocity——
  // 自身即 no-hit 分支的 view-space 自洽重投影，语义最准。有云 texel 保持上游
  // closest-neighbor 行为（边缘稳定性）不变。
  vec4 centerDepthVelocity = texelFetch(depthVelocityBuffer, coord, 0);
  if (centerDepthVelocity.r >= 1e8) {
    return centerDepthVelocity;
  }
  // 【2026-09-03 coverage=1 云甲内盐粒修复：getClosestFragmentDepthHomogeneityGuard】
  // 甲内水平视角下 depthVelocity.r 在「近云数米 ↔ 甲顶球远端数百 km」间逐像素跳变
  // （合法几何值，非远平面哨兵——上述 1e8 守卫不覆盖）。全局最近深度让远端 texel 借到
  // 近云 velocity（反向错借同样存在）→ history 大距离错位；coverage=1 全屏 a≈1 →
  // |Δa| rejection 永不触发 → 满屏盐粒（temporal=0 直通同一 march buffer 平滑、
  // upscale=4 分支低分聚合深度平滑——层锁定全分 TAA 借用）。修=邻居与中心深度比
  // 超 2×（更深或更浅）视为跨层 texel 不参与 min 竞争；无同质邻居退回自身 velocity。
  // closest 边缘语义保留（同质域内仍取最近）。
  float centerDepth = centerDepthVelocity.r;
  ivec2 maxCoord = textureSize(depthVelocityBuffer, 0) - ivec2(1);
  vec4 result = centerDepthVelocity; // 缺省=自身（无同质邻居时退自身自洽重投影）
  vec4 neighbor;
  #pragma unroll_loop_start
  for (int i = 0; i < 9; ++i) {
    neighbor = texelFetch(depthVelocityBuffer, clamp(coord + neighborOffsets[i], ivec2(0), maxCoord), 0);
    // 深度悬殊（>2× 或 <0.5×）= 跨层 texel，velocity 不可借。同质条件并入 min 竞争
    //（unroll 展开后无循环上下文，不能用 continue——glslang 'continue statement
    // only allowed in loops'）。
    if (neighbor.r >= centerDepth * 0.5 && neighbor.r <= centerDepth * 2.0 && neighbor.r < result.r) {
      result = neighbor;
    }
  }
  #pragma unroll_loop_end
  return result;
}

vec4 reconstructCloudColor(const sampler2D buffer, const vec2 uv) {
  ivec2 size = textureSize(buffer, 0);
  vec2 position = uv * vec2(size) - 0.5;
  ivec2 base = ivec2(floor(position));
  vec2 weight = fract(position);
  ivec2 maximum = size - 1;
  vec4 a = texelFetch(buffer, clamp(base, ivec2(0), maximum), 0);
  vec4 b = texelFetch(buffer, clamp(base + ivec2(1, 0), ivec2(0), maximum), 0);
  vec4 c = texelFetch(buffer, clamp(base + ivec2(0, 1), ivec2(0), maximum), 0);
  vec4 d = texelFetch(buffer, clamp(base + ivec2(1), ivec2(0), maximum), 0);
  return mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y);
}

void temporalUpscale(
  const ivec2 coord,
  const ivec2 lowResCoord,
  const bool currentFrame,
  out vec4 outputColor,
  out float outputShadowLength
) {
  // Each low-res texel observes one Bayer position, not all 4x4 output pixels.
  // Reconstruct unobserved pixels only when history is unavailable or moving fast.
  vec2 currentUv = vUv - jitterOffset;
  vec4 reconstructed = reconstructCloudColor(colorBuffer, currentUv);
  vec4 currentSample = texelFetch(colorBuffer, lowResCoord, 0);
  outputColor = reconstructed;
  outputShadowLength = 0.0;
  #ifdef SHADOW_LENGTH
  float reconstructedShadow = reconstructCloudColor(shadowLengthBuffer, currentUv).r;
  outputShadowLength = reconstructedShadow;
  #endif

  vec4 depthVelocity = getClosestFragment(lowResCoord);
  vec2 previousUv = vUv - depthVelocity.gb;
  if (any(lessThan(previousUv, vec2(0.0))) || any(greaterThan(previousUv, vec2(1.0)))) return;
  vec4 history = sanitizeHistory(texture(colorHistoryBuffer, previousUv), reconstructed);
  #ifdef SHADOW_LENGTH
  float historyShadow = texture(shadowLengthHistoryBuffer, previousUv).r;
  #endif

  // An orbit anchor can have zero screen velocity while its old cloud becomes
  // visible ground. Camera motion still requires disocclusion checks there.
  if (u_cameraMoving && abs(reconstructed.a - history.a) > temporalDisocclusion) return;

  if (!currentFrame) {
    // Testing alpha against a different subpixel rejects valid cloud-edge history.
    // Keep its observation until this pixel's own phase is sampled again.
    float motionBlend = smoothstep(2.0, 8.0, length(depthVelocity.gb / texelSize));
    outputColor = mix(history, reconstructed, motionBlend);
    #ifdef SHADOW_LENGTH
    outputShadowLength = mix(historyShadow, reconstructedShadow, motionBlend);
    #endif
    return;
  }

  outputColor = currentSample;
  #ifdef SHADOW_LENGTH
  outputShadowLength = texelFetch(shadowLengthBuffer, lowResCoord, 0).r;
  #endif
  float motionPixels = length(depthVelocity.gb / texelSize);
  if ((u_cameraMoving || motionPixels > 0.5) && abs(currentSample.a - history.a) > temporalDisocclusion) return;
  // At a fixed camera, alpha fluctuations are stochastic samples of the same
  // medium. Rejecting or clipping them would keep injecting binary edge noise.
  vec4 clipped = (u_cameraMoving || motionPixels > 0.5)
    ? varianceClipping(colorBuffer, currentUv, currentSample, history, varianceGamma) : history;
  float alpha = u_accumulateUpscaleHistory
    ? (u_cameraMoving ? clamp(temporalAlpha * 1.5, 0.15, 0.85)
      : mix(0.04, clamp(temporalAlpha * 1.5, 0.1, 0.85), smoothstep(0.25, 2.0, motionPixels))) : 1.0;
  outputColor = mix(clipped, currentSample, alpha);
  #ifdef SHADOW_LENGTH
  outputShadowLength = mix(historyShadow, outputShadowLength, alpha);
  #endif
}

void temporalAntialiasing(const ivec2 coord, out vec4 outputColor, out float outputShadowLength) {
  vec4 currentColor = texelFetch(colorBuffer, coord, 0);
  #ifdef SHADOW_LENGTH
  vec4 currentShadowLength = vec4(texelFetch(shadowLengthBuffer, coord, 0).rgb, 1.0);
  #endif // SHADOW_LENGTH

  vec4 depthVelocity = getClosestFragment(coord);
  vec2 velocity = depthVelocity.gb;

  vec2 prevUv = vUv - velocity;
  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {
    outputColor = currentColor;
    #ifdef SHADOW_LENGTH
    outputShadowLength = currentShadowLength.r;
    #endif // SHADOW_LENGTH
    return; // Rejection
  }

  vec4 historyColor = sanitizeHistory(texture(colorHistoryBuffer, prevUv), currentColor); // getHistoryNanGuard
  // 【2026-09-03 穿云黑块修复】disocclusion rejection——312573d 只加在 temporalUpscale 分支
  // （N=4 时代默认档），1ce0d93 默认档切 N=1 走本分支后补丁丢失：穿云 velocity 跨层错位 →
  // history 采到无效 texel（黑）→ γ=2 宽 AABB 剪不住 → mix 90% 黑 history 固化扩散（傍晚
  // 穿云黑块 A/B 复现实证）。|Δa|>阈 = 云/非云遮挡关系翻转，不信任 history 直出 current。
  if (abs(currentColor.a - historyColor.a) > temporalDisocclusion) {
    outputColor = currentColor;
    #ifdef SHADOW_LENGTH
    outputShadowLength = currentShadowLength.r;
    #endif // SHADOW_LENGTH
    return; // Disocclusion rejection
  }
  vec4 clippedColor = varianceClipping(colorBuffer, coord, currentColor, historyColor);
  // 【2026-10-09 远云平均自适应】α 按云前距离衰减：远云视差小（屏幕近乎静止，可狠平均）
  // 且欠采样噪声幅度大（需要狠平均）——双契合。50km→α/2 起步（2e-5/米）。
  float aEff = temporalAlpha / (1.0 + max(0.0, depthVelocity.r) * 2e-5);
  outputColor = mix(clippedColor, currentColor, aEff);
  // 【outputColorSanityGuard】NaN 兜底：任何上游残留 NaN（含 mix 的 IEEE 传播）直出 current。
  if (any(isnan(outputColor.rgb))) {
    outputColor = currentColor;
  }

  #ifdef SHADOW_LENGTH
  vec4 historyShadowLength = vec4(texture(shadowLengthHistoryBuffer, prevUv).rgb, 1.0);
  vec4 clippedShadowLength = varianceClipping(
    shadowLengthBuffer,
    coord,
    currentShadowLength,
    historyShadowLength
  );
  outputShadowLength = mix(clippedShadowLength.r, currentShadowLength.r, temporalAlpha);
  #endif // SHADOW_LENGTH
}

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);

  #if !defined(SHADOW_LENGTH)
  float outputShadowLength;
  #endif // !defined(SHADOW_LENGTH)

  #ifdef TEMPORAL_UPSCALE
  #if UPSCALE_DIVISOR == 2
  ivec2 lowResCoord = coord / 2;
  int bayerValue = bayerIndices2[(coord.y % 2) * 2 + (coord.x % 2)];
  bool currentFrame = bayerValue == frame % 4;
  #else // UPSCALE_DIVISOR == 2
  ivec2 lowResCoord = coord / 4;
  int bayerValue = bayerIndices[coord.x % 4][coord.y % 4];
  bool currentFrame = bayerValue == frame % 16;
  #endif // UPSCALE_DIVISOR == 2
  #else
  ivec2 lowResCoord = coord;
  #endif

  // A fixed camera, medium and light need no reprojection or disocclusion test.
  // Rejection of stochastic alpha fluctuations otherwise keeps reintroducing
  // noisy current samples, even though the underlying scene has not changed.
  if (u_staticSampleCount >= 0) {
    vec4 currentColor = texelFetch(colorBuffer, lowResCoord, 0);
    #ifdef TEMPORAL_UPSCALE
    if (u_staticSampleCount == 0) currentColor = reconstructCloudColor(colorBuffer, vUv - jitterOffset);
    #endif
    outputColor = currentColor;
    if (u_staticSampleCount > 0) {
      vec4 historyColor = sanitizeHistory(texelFetch(colorHistoryBuffer, coord, 0), currentColor);
      // STBN has 64 layers. After two complete cycles, the fixed preview has
      // consumed the full sequence; continuing an exponential average would
      // reintroduce a periodic shimmer without adding independent samples.
      outputColor = u_staticSampleCount >= 128 ? historyColor
        : mix(historyColor, currentColor, 1.0 / float(u_staticSampleCount + 1));
    }
    #ifdef SHADOW_LENGTH
    outputShadowLength = texelFetch(shadowLengthBuffer, lowResCoord, 0).r;
    if (u_staticSampleCount > 0) {
      float historyShadowLength = texelFetch(shadowLengthHistoryBuffer, coord, 0).r;
      outputShadowLength = u_staticSampleCount >= 128 ? historyShadowLength
        : mix(historyShadowLength, outputShadowLength, 1.0 / float(u_staticSampleCount + 1));
    }
    #endif
    return;
  }

  #ifdef TEMPORAL_UPSCALE
  temporalUpscale(coord, lowResCoord, currentFrame, outputColor, outputShadowLength);
  #else // TEMPORAL_UPSCALE
  temporalAntialiasing(coord, outputColor, outputShadowLength);
  #endif // TEMPORAL_UPSCALE

  // 【2026-10-08 白点治理】孤点中值替换（u_spatialDespeckle>0 才走，全屏一致分支）：
  // 当前像素 luma 与邻域中值差超阈（0.1 线性域）= 孤立亮/暗点 → 中值替换。
  // 【5×5 窗】云缘颗粒带密度高（>44%），3×3 中值（抗 44%）失效——5×5 中值抗 ~52%
  // 且窗更大覆盖 2px 簇；25 texelFetch+插入排序成本 ~1ms/1080p（resolve 全屏 pass）。
  #ifdef SPATIAL_DESPECKLE
  if (u_spatialDespeckle > 0.0) {
    float lumas[25];
    float alphas[25];
    vec3 colors[25];
    int k = 0;
    for (int dy = -2; dy <= 2; ++dy) {
      for (int dx = -2; dx <= 2; ++dx) {
        vec4 cn = texelFetch(colorBuffer, coord + ivec2(dx, dy), 0);
        colors[k] = cn.rgb;
        alphas[k] = cn.a;
        lumas[k] = dot(colors[k], vec3(0.299, 0.587, 0.114));
        ++k;
      }
    }
    vec3 meanColor = vec3(0.0);
    float meanA = 0.0;
    for (int i = 0; i < 25; ++i) { meanColor += colors[i]; meanA += alphas[i]; }
    meanColor /= 25.0;
    meanA /= 25.0;
    float lumaOut = dot(outputColor.rgb, vec3(0.299, 0.587, 0.114));
    float lumaMean = dot(meanColor, vec3(0.299, 0.587, 0.114));
    // 【2026-10-09 分通道方向性滤波】rgb=对称（亮喷溅+黑点都治——黑点=暗离群，
    // 单侧版实测 5950m 黑点回潮 28.0）；α=单侧只填透明洞——对称 α 替换会在云边界
    // 内侧把高 α 拉向跨边界低均值=云啃成半透明透出暗地形（3021m 层内实测黑方块）。
    // 替换量∝离群幅度（连续化防色带）。
    float lumDiff = lumaOut - lumaMean;
    if (abs(lumDiff) > 0.02) {
      outputColor.rgb = mix(outputColor.rgb, meanColor,
        min(1.0, abs(lumDiff) * 4.0) * u_spatialDespeckle);
    }
    float aDeficit = meanA - outputColor.a;
    if (aDeficit > 0.05) {
      outputColor.a = mix(outputColor.a, meanA,
        min(1.0, aDeficit * 4.0) * u_spatialDespeckle);
    }
  }

  #endif // SPATIAL_DESPECKLE

  #if defined(SHADOW_LENGTH) && defined(DEBUG_SHOW_SHADOW_LENGTH)
  outputColor = vec4(turbo(outputShadowLength * 0.05), 1.0);
  #endif // defined(SHADOW_LENGTH) && defined(DEBUG_SHOW_SHADOW_LENGTH)

  #ifdef DEBUG_SHOW_VELOCITY
  outputColor.rgb = outputColor.rgb + vec3(abs(texture(depthVelocityBuffer, vUv).gb) * 10.0, 0.0);
  #endif // DEBUG_SHOW_VELOCITY
}
