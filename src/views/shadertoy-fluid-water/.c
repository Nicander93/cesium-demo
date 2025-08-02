// Stockholms Ström (斯德哥尔摩水流)
// 作者: Peder Norrby / Trapcode in 2016
// 许可证: Creative Commons Attribution-NonCommercial-ShareAlike 3.0

// 创建绕指定轴旋转的3x3旋转矩阵
mat3 rotationMatrix(vec3 axis, float angle)
{
    axis = normalize(axis);  // 归一化旋转轴
    float s = sin(angle);    // 正弦值
    float c = cos(angle);    // 余弦值
    float oc = 1.0 - c;     // 1-cos(angle)
    
    // 返回3x3旋转矩阵 (罗德里格斯旋转公式)
    return mat3(oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  
                oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  
                oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c          );
                                          
}


//
// 描述: 无数组和纹理的GLSL 2D/3D/4D simplex噪声函数
// 作者: Ian McEwan, Ashima Arts
// 维护者: ijm
// 最后修改: 20110822 (ijm)
// 许可证: Copyright (C) 2011 Ashima Arts. All rights reserved.
//         基于MIT许可证分发。见LICENSE文件。
//         https://github.com/ashima/webgl-noise
// 

// 对289取模的辅助函数
vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

// 排列函数，用于噪声生成
vec4 permute(vec4 x) {
     return mod289(((x*34.0)+1.0)*x);
}

// 泰勒级数逆平方根近似
vec4 taylorInvSqrt(vec4 r)
{
  return 1.79284291400159 - 0.85373472095314 * r;
}

// 3D simplex噪声函数
float noise(vec3 v) { 
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;  // 常数
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0); // 常数

// 第一个角点
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 =   v - i + dot(i, C.xxx) ;

// 其他角点
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  //   x0 = x0 - 0.0 + 0.0 * C.xxx;
  //   x1 = x0 - i1  + 1.0 * C.xxx;
  //   x2 = x0 - i2  + 2.0 * C.xxx;
  //   x3 = x0 - 1.0 + 3.0 * C.xxx;
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

// 排列
  i = mod289(i); 
  vec4 p = permute( permute( permute( 
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

// 梯度: 7x7点覆盖正方形，映射到八面体
// 环大小17*17 = 289接近49的倍数 (49*6 = 294)
  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;
  //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

// 归一化梯度
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

// 混合最终噪声值
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                dot(p2,x2), dot(p3,x3) ) );
  }



/*
// 4x4旋转矩阵版本 (注释掉)
mat4 rotationMatrix(vec3 axis, float angle)
{
    axis = normalize(axis);
    float s = sin(angle);
    float c = cos(angle);
    float oc = 1.0 - c;
    
    return mat4(oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  0.0,
                oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  0.0,
                oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c,           0.0,
                0.0,                                0.0,                                0.0,                                1.0);
}*/



// 分形噪声函数 - 创建多层噪声叠加效果
float fnoise( vec3 p)
{
    // 创建两个不同速度的旋转矩阵
    mat3 rot = rotationMatrix( normalize(vec3(0.0,0.0, 1.0)), 0.5*iTime);
    mat3 rot2 = rotationMatrix( normalize(vec3(0.0,0.0, 1.0)), 0.3*iTime);
    float sum = 0.0;
    
    vec3 r = rot*p;
    
    // 第一层噪声
    float add = noise(r);
    float msc = add+0.7;  // 调制因子
   	msc = clamp(msc, 0.0, 1.0);
    sum += 0.6*add;
    
    // 第二层噪声 (频率翻倍)
    p = p*2.0;
    r = rot*p;
    add = noise(r);
 
    add *= msc;  // 应用调制
    sum += 0.5*add;
    msc *= add+0.7;
   	msc = clamp(msc, 0.0, 1.0);
    
    // 第三层噪声 (xy频率翻倍)
    p.xy = p.xy*2.0;
    p = rot2 *p;
    add = noise(p);
    add *= msc;
    sum += 0.25*abs(add);
    msc *= add+0.7;
   	msc = clamp(msc, 0.0, 1.0);
 
    // 第四层噪声 (频率翻倍)
    p = p*2.0;
  //  p = p*rot;
    add = noise(p);// + vec3(iTime*5.0, 0.0, 0.0));
    add *= msc;
    sum += 0.125*abs(add);
    msc *= add+0.2;
   	msc = clamp(msc, 0.0, 1.0);

    // 第五层噪声 (频率翻倍)
    p = p*2.0;
  //  p = p*rot;
    add = noise(p);
    add *= msc;
    sum += 0.0625*abs(add);
    //msc *= add+0.7;
   	//msc = clamp(msc, 0.0, 1.0);

    
    return sum*0.516129; // 返回归一化后的噪声值
}

// 获取高度函数 - 基于噪声生成水面高度
float getHeight(vec3 p) // 参数: x,z,time
{
    
 	return 0.3-0.5*fnoise( vec3(0.5*(p.x + 0.0*iTime), 0.5*p.z,  0.4*iTime) );   
}

// 场景常量定义
#define box_y 1.0    // 盒子高度
#define box_x 2.0    // 盒子宽度
#define box_z 2.0    // 盒子深度
#define bg vec4(0.0, 0.0, 0.0, 1.0)  // 背景色
#define step 0.3     // 光线步进距离
#define red vec4(1.0, 0.0, 0.0, 1.0) // 红色 (调试用)
#define PI_HALF 1.5707963267949       // π/2

// 获取天空颜色函数
vec4 getSky(vec3 rd)
{
    if (rd.y > 0.3) return vec4(0.5, 0.8, 1.5, 1.0); // 明亮天空
    if (rd.y < 0.0) return vec4(0.0, 0.2, 0.4, 1.0); // 下方无反射
    
    if (rd.z > 0.9 && rd.x > 0.3) {
    	if (rd.y > 0.2) return 1.5*vec4(2.0, 1.0, 1.0, 1.0); // 红色房屋
    	return 1.5*vec4(2.0, 1.0, 0.5, 1.0); // 橙色房屋
    } else return vec4(0.5, 0.8, 1.5, 1.0 ); // 明亮天空
}


// 盒子着色函数
vec4 shadeBox(vec3 normal, vec3 pos, vec3 rd)
{
    float deep = 1.0+0.5*pos.y;  // 深度因子
    
    vec4 col = deep*0.4*vec4(0.0, 0.3, 0.4, 1.0);  // 深蓝色
    
    return col;
 
}

// 水面着色函数 - 包含菲涅尔反射效果
vec4 shade(vec3 normal, vec3 pos, vec3 rd)
{
    float ReflectionFresnel = 0.99;  // 反射菲涅尔系数
   	float fresnel = ReflectionFresnel*pow( 1.0-clamp(dot(-rd, normal), 0.0, 1.0), 5.0) + (1.0-ReflectionFresnel);
    vec3 refVec = reflect(rd, normal);  // 计算反射方向
    vec4 reflection = getSky(refVec);   // 获取反射的天空颜色
    
    //vec3 sunDir = normalize(vec3(-1.0, -1.0, 0.5));
    //float intens = 0.5 + 0.5*clamp( dot(normal, sunDir), 0.0, 1.0);
    
    float deep = 1.0+0.5*pos.y;  // 深度因子
    
    vec4 col = fresnel*reflection;  // 菲涅尔反射
    col += deep*0.4*vec4(0.0, 0.3, 0.4, 1.0);  // 添加深蓝色
    
    return clamp(col, 0.0, 1.0);  // 限制颜色范围
}

// 盒子相交检测函数 - 只检测侧面，不包括顶面和底面
vec4 intersect_box(vec3 ro, vec3 rd) 
{
    //vec3 normal;
    float t_min = 1000.0;  // 最小相交距离
    vec3 t_normal;         // 相交点法线

    // 检测 x = -box_x 平面
    float t = (-box_x -ro.x) / rd.x;
    vec3 p = ro + t*rd;

    if (p.y > -box_y && p.z < box_z && p.z > -box_z) {
        t_normal = vec3(-1.0, 0.0, 0.0);
        t_min = t;
        //if (dot(normal, rd) > PI_HALF ) return red;//shadeBox(normal, p, rd);
    }

    
    // 检测 x = +box_x 平面
    //box_x = ro.x + t*rd.x
    //t*rd.x = box_x - ro.x
   // t = (box_x - ro.x)/rd.x
    
    t = (box_x -ro.x) / rd.x;
    p = ro + t*rd;

    if (p.y > -box_y && p.z < box_z && p.z > -box_z) {
        if (t < t_min) {
        	t_normal = vec3(1.0, 0.0, 0.0);
			t_min = t;
        }
    }

    // 检测 z = -box_z 平面
	t = (-box_z -ro.z) / rd.z;
    p = ro + t*rd;
    
    if (p.y > -box_y && p.x < box_x && p.x > -box_x) {
        
        if (t < t_min) {
        	t_normal = vec3(0.0, 0.0, -1.0);
            t_min = t;
        }
    }
    
    // 检测 z = +box_z 平面
	t = (box_z -ro.z) / rd.z;
    p = ro + t*rd;
    
    if (p.y > -box_y && p.x < box_x && p.x > -box_x) {
        
        if (t < t_min) {
        	t_normal = vec3(0.0, 0.0, 1.0);
            t_min = t;
        }
    }
    
    
    if (t_min < 1000.0) return shadeBox(t_normal, ro + t_min*rd, rd);  // 返回盒子颜色
    
    
    return bg;  // 返回背景色
}



// 高度场光线追踪函数 - 核心渲染函数
vec4 trace_heightfield( vec3 ro, vec3 rd)
{
    
    // 与最大高度平面相交，y=1
    
    //ro.y + t*rd.y = 1.0;
    //t*rd.y = 1.0 - ro.y;
    float t = (1.0 - ro.y) / rd.y;  // 计算与y=1平面的相交时间
    
    if (t<0.0) return red;  // 如果t<0，返回红色(调试)
    
    vec3 p = ro + t*rd;  // 计算相交点
    
    // 检查是否超出边界
    if (p.x < -2.0 && rd.x <= 0.0) return bg;
    if (p.x >  2.0 && rd.x >= 0.0) return bg;
    if (p.z < -2.0 && rd.z <= 0.0) return bg;
    if (p.z >  2.0 && rd.z >= 0.0) return bg;
   
    
    //float h = getHeight(p);
    float h, last_h;
    bool not_found = true;
    vec3 last_p = p;
    
    // 光线步进，寻找与地形的相交点
    for (int i=0; i<20; i++) {
        
        p += step*rd;  // 沿光线方向步进
    
    	h = getHeight(p);  // 获取当前点的高度
        
        if (p.y < h) {not_found = false; break;} // 找到相交点
        last_h = h;
        last_p = p;
    }
    
    if (not_found) return bg;  // 未找到相交点，返回背景
 
 	// 精确相交点计算
    float dh2 = h - p.y;
    float dh1 = last_p.y - last_h;
 	p = last_p + rd*step/(dh2/dh1+1.0);
   
    // 边界处理 - 检查是否与盒子相交
    if (p.x < -2.0) {
        if (rd.x <= 0.0) return bg; 
        return intersect_box(ro, rd);
    }
    if (p.x >  2.0) {
        if (rd.x >= 0.0) return bg;
        return intersect_box(ro, rd);
    }
    if (p.z < -2.0) {
        if (rd.z <= 0.0) return bg; 
        return intersect_box(ro, rd);
    }
    if (p.z >  2.0) {
        if (rd.z >= 0.0) return bg;
        return intersect_box(ro, rd);
    }
    
    // 计算法线 - 通过有限差分
    vec3 pdx = p + vec3( 0.01, 0.0,  0.00);
    vec3 pdz = p + vec3( 0.00, 0.0,  0.01);
    
    float hdx = getHeight( pdx );
    float hdz = getHeight( pdz );
   	h = getHeight( p );
    
    p.y = h;
    pdx.y = hdx;
    pdz.y = hdz;
    
    vec3 normal = normalize(cross( p-pdz, p-pdx)) ;  // 计算法线
    
 	return shade(normal, p, rd);  // 返回着色结果
}


// Shadertoy相机代码 (作者: iq)

// 设置相机矩阵函数
mat3 setCamera( in vec3 ro, in vec3 ta, float cr ) 
{
	vec3 cw = normalize(ta-ro);  // 相机前方向
	vec3 cp = vec3(sin(cr), cos(cr),0.0);  // 相机上方向
	vec3 cu = normalize( cross(cw,cp) );    // 相机右方向
	vec3 cv = normalize( cross(cu,cw) );    // 相机上方向
    return mat3( cu, cv, cw );  // 返回相机矩阵
}


// 主图像函数 - Shadertoy入口点
void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 p = (-iResolution.xy + 2.0*fragCoord.xy)/ iResolution.y;  // 归一化像素坐标
    vec2 m = iMouse.xy/iResolution.xy;  // 鼠标位置
    
    m.y += 0.3;  // 调整鼠标y位置
    m.x += 0.72; // 调整鼠标x位置
    
    //m.y = clamp(m.y, 0.2, 2.0);
    //m.x = clamp(m.x, 1.15, 1.6);
    
    // 相机设置
    vec3 ro = 9.0*normalize(vec3(sin(5.0*m.x), 1.0*m.y, cos(5.0*m.x))); // 相机位置
	vec3 ta = vec3(0.0, -1.0, 0.0); // 相机目标点
    mat3 ca = setCamera( ro, ta, 0.0 );  // 计算相机矩阵
    // 光线方向
    vec3 rd = ca * normalize( vec3(p.xy,4.0));  // 计算光线方向
    
    
    fragColor = trace_heightfield( ro, rd );  // 执行光线追踪
}

// VR钩子函数 (未测试)
void mainVR( out vec4 fragColor, in vec2 fragCoord, in vec3 fragRayOri, in vec3 fragRayDir )
{
    fragColor = trace_heightfield( fragRayOri, fragRayDir );
}
