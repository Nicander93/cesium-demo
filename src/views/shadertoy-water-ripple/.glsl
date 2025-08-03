/*
A quick experiment with rain drop ripples.

This effect was written for and used in the launch scene of the
64kB PC intro "H - Immersion", by Ctrl-Alt-Test.

> http://www.ctrl-alt-test.fr/productions/h-immersion/
> https://www.youtube.com/watch?v=27PN1SsXbjM

-- 
Zavie / Ctrl-Alt-Test
*/

// 最大的波纹半径，单位是网格单元
// 这个值决定了波纹效果的范围，值越大波纹覆盖范围越广
#define MAX_RADIUS 2

// 设置为1以进行双重哈希，速度较慢，但图案更少
// 双重哈希可以减少重复的波纹图案，但会降低性能
#define DOUBLE_HASH 0

// 哈希函数的缩放因子，用于生成伪随机数
// 这些值经过精心选择，可以产生良好的随机分布
#define HASHSCALE1 .1031
#define HASHSCALE3 vec3(.1031, .1030, .0973)

// 单一哈希函数，输入二维坐标，返回一个浮点数
// 这个函数用于生成伪随机数，确保每个位置都有不同的波纹效果
float hash12(vec2 p)
{
    // 将二维坐标转换为三维，并乘以缩放因子
    // fract 函数将浮点数的小数部分返回
    vec3 p3  = fract(vec3(p.xyx) * HASHSCALE1);
    // 使用点积运算增加随机性
    // dot 函数计算两个向量的点积
    p3 += dot(p3, p3.yzx + 19.19);
    // 返回0-1之间的随机浮点数
    return fract((p3.x + p3.y) * p3.z);
}

// 双重哈希函数，输入二维坐标，返回一个二维向量
// 这个函数用于生成更复杂的随机模式
vec2 hash22(vec2 p)
{
    // 将二维坐标转换为三维，并乘以缩放因子
    vec3 p3 = fract(vec3(p.xyx) * HASHSCALE3);
    // 使用点积运算增加随机性
    p3 += dot(p3, p3.yzx+19.19);
    // 返回二维随机向量
    return fract((p3.xx+p3.yz)*p3.zy);
}

// 主函数，计算每个像素的颜色
// fragColor: 输出颜色
// fragCoord: 当前像素的坐标
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // 根据鼠标位置调整分辨率
    // iMouse.x/iResolution.x 表示鼠标在窗口中的水平位置，范围是0到1
    // 鼠标位置越靠右，分辨率越高，波纹越密集
    float resolution = 10. * exp2(-3.*iMouse.x/iResolution.x);
    // 将像素坐标转换为归一化后的UV坐标，并应用分辨率缩放
    // 归一化后的UV坐标：X 坐标范围是 [0, width/height]，Y 坐标范围是 [0, 1]
    vec2 uv = fragCoord.xy / iResolution.y * resolution;
    // 计算当前像素所在的网格单元
    vec2 p0 = floor(uv);

    // 初始化波纹向量
    vec2 circles = vec2(0.);
    
    // 遍历每个可能的波纹中心
    // 检查以当前像素为中心的(2*MAX_RADIUS+1)*(2*MAX_RADIUS+1)个网格单元
    for (int j = -MAX_RADIUS; j <= MAX_RADIUS; ++j)
    {
        for (int i = -MAX_RADIUS; i <= MAX_RADIUS; ++i)
        {
            // 计算当前检查的网格单元坐标
            vec2 pi = p0 + vec2(i, j);
            
            // 根据是否启用双重哈希选择不同的哈希方式
            #if DOUBLE_HASH
            vec2 hsh = hash22(pi);
            #else
            vec2 hsh = pi;
            #endif
            
            // 使用哈希值生成波纹中心位置
            vec2 p = pi + hash22(hsh);

            // 计算时间因子，使波纹随时间扩散
            // hash12(hsh)确保每个波纹有不同的时间偏移
            float t = fract(0.3*iTime + hash12(hsh));
            
            // 计算当前像素到波纹中心的向量
            vec2 v = p - uv;
            // 计算波纹的半径，波纹随时间向外扩散
            float d = length(v) - (float(MAX_RADIUS) + 1.)*t;

            // 使用数值微分计算波纹的法向量
            // h是微分步长
            float h = 1e-3;
            float d1 = d - h;
            float d2 = d + h;
            
            // 计算波纹的强度
            // sin(31.*d)创建波纹的波动效果
            // smoothstep函数创建平滑的波纹边缘
            float p1 = sin(31.*d1) * smoothstep(-0.6, -0.3, d1) * smoothstep(0., -0.3, d1);
            float p2 = sin(31.*d2) * smoothstep(-0.6, -0.3, d2) * smoothstep(0., -0.3, d2);
            
            // 计算波纹对当前像素的贡献
            // normalize(v)是波纹的法向量方向
            // (1.-t)*(1.-t)使波纹强度随时间衰减
            circles += 0.5 * normalize(v) * ((p2 - p1) / (2. * h) * (1. - t) * (1. - t));
        }
    }
    
    // 归一化波纹强度，避免波纹过于强烈
    circles /= float((MAX_RADIUS*2+1)*(MAX_RADIUS*2+1));

    // 计算光照强度，随时间变化
    // 使用smoothstep创建平滑的光照变化
    float intensity = mix(0.01, 0.15, smoothstep(0.1, 0.6, abs(fract(0.05*iTime + 0.5)*2.-1.)));
    
    // 计算法向量，用于光照计算
    // n.xy是波纹的法向量，n.z是垂直分量
    vec3 n = vec3(circles, sqrt(1. - dot(circles, circles)));
    
    // 计算最终颜色
    // 第一部分：使用法向量偏移纹理坐标，模拟水面折射
    // 第二部分：添加高光效果，模拟水面反射
    vec3 color = texture(iChannel0, uv/resolution - intensity*n.xy).rgb + 
                 5.*pow(clamp(dot(n, normalize(vec3(1., 0.7, 0.5))), 0., 1.), 6.);
    
    // 输出最终颜色
    fragColor = vec4(color, 1.0);
}