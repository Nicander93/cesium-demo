import * as Cesium from 'cesium';

/**
 * 后处理遮罩实现 - 使用PostProcessStage实现反选遮罩效果
 * 
 * 原理：在每一帧渲染完成后，对屏幕上的每个像素进行处理
 * 1. 读取该像素的世界坐标
 * 2. 将世界坐标转换到局部坐标系
 * 3. 判断是否在指定矩形区域内
 * 4. 如果不在区域内，则应用遮罩效果（这里是将红色通道设为1）
 */

// 定义遮罩区域的四个顶点（经纬度坐标：[经度, 纬度]）
// 这里定义了一个矩形区域：从(120, 30)到(120.5, 30.5)
let positions = [120,30,120.5,30,120.5,30.5,120,30.5];

// 将经纬度坐标转换为Cesium的世界坐标（Cartesian3，即3D笛卡尔坐标）
// fromDegreesArray需要传入一维数组：[lon1, lat1, lon2, lat2, ...]
const cartesianPositions =Cesium.Cartesian3.fromDegreesArray(
   [].concat.apply([], positions),
  );

// ========== 建立局部坐标系 ==========
// 为了简化判断，我们需要将世界坐标转换到一个局部坐标系
// 这个局部坐标系以第一个顶点为原点，X轴指向东，Y轴指向北，Z轴指向上

// eastNorthUpToFixedFrame: 创建一个从"东-北-上"局部坐标系到世界坐标系的变换矩阵
// 这个矩阵可以将局部坐标转换为世界坐标
let m =Cesium.Transforms.eastNorthUpToFixedFrame(cartesianPositions[0]);

// 计算逆矩阵：从世界坐标系转换到局部坐标系
// 这样我们就可以将世界坐标转换为局部坐标，方便进行矩形判断
let inverse =Cesium.Matrix4.inverse(m,new Cesium.Matrix4());

// 将所有顶点从世界坐标转换到局部坐标
let localPositions:Cesium.Cartesian3[] = [];
 cartesianPositions.forEach((position) =>{
   localPositions.push(
   Cesium.Matrix4.multiplyByPoint(
     inverse,  // 变换矩阵（逆矩阵）
     position, // 世界坐标
    new Cesium.Cartesian3(), // 结果存储位置
    ),
   );
  });

// ========== 计算矩形范围 ==========
// 在局部坐标系中，计算这些点形成的矩形边界
let rect =Cesium.BoundingRectangle.fromPoints(
   localPositions,
  new Cesium.BoundingRectangle(),
  );

// 将矩形边界信息打包成vec4格式，方便传入shader
// rect.x: 最小X值（左边界）
// rect.y: 最小Y值（下边界）
// rect.z: 最大X值（右边界）= rect.x + rect.width
// rect.w: 最大Y值（上边界）= rect.y + rect.height
const cartesianRect =new Cesium.Cartesian4(
   rect.x,
   rect.y,
   rect.x+ rect.width,
   rect.y+ rect.height,
  );
 /**
  * Fragment Shader（片段着色器）
  * 
  * 这个shader会在屏幕上的每个像素上执行，用于后处理效果
  * 
  * 坐标转换流程：
  * 屏幕坐标 → 眼坐标（Eye Coordinate） → 世界坐标（World Coordinate） → 局部坐标（Local Coordinate）
  * 
  * 注意：由于深度缓冲区的精度限制和多次坐标转换的累积误差，
  * 在远距离或视角变化时，可能会出现边界抖动的问题
  */
 const fragmentShaderSource =`
  // 输入纹理：场景渲染后的颜色纹理
  uniform sampler2D colorTexture;
  
  // 输入纹理：深度纹理，存储每个像素的深度值
  uniform sampler2D depthTexture;
  
  // 当前像素的纹理坐标（0.0到1.0之间）
  in vec2 v_textureCoordinates;
  
  // 矩形边界：[最小X, 最小Y, 最大X, 最大Y]
  uniform vec4 rect;
  
  // 从世界坐标系到局部坐标系的变换矩阵（逆矩阵）
  uniform mat4 inverse;
  
  void main(void)
  {        
     // 1. 获取当前像素的颜色（场景渲染的结果）
     out_FragColor = texture(colorTexture, v_textureCoordinates);
     
     // 2. 读取深度值并解包
     // czm_unpackDepth是Cesium提供的函数，将压缩的深度值还原为0-1之间的浮点数
     // depth = 1.0 表示该像素在远裁剪面（通常是天空或背景）
     float depth =czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
     
     // 如果深度值为1.0，说明是背景像素，直接返回（不处理）
     if(depth>=1.)return;
     
     // 3. 将屏幕坐标转换为眼坐标（Eye Coordinate，也叫视图坐标）
     // gl_FragCoord.xy: 当前像素在屏幕上的坐标（像素位置）
     // depth: 该像素的深度值
     // 返回的是齐次坐标（x, y, z, w），需要除以w得到实际坐标
     vec4 eyeCoordinate4 = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
     
     // 将齐次坐标转换为3D坐标（透视除法）
     vec3 eyeCoordinate3 = eyeCoordinate4.xyz/eyeCoordinate4.w;
     
     // 4. 将眼坐标转换为世界坐标
     // czm_inverseView: Cesium内置的uniform，是视图矩阵的逆矩阵
     // 视图矩阵可以将世界坐标转换为眼坐标，逆矩阵则相反
     vec4 worldCoordinate4 = czm_inverseView * vec4(eyeCoordinate3,1.) ; 
     
     // 再次进行透视除法，得到世界坐标
     vec3 worldCoordinate = worldCoordinate4.xyz / worldCoordinate4.w;
     
     // 5. 将世界坐标转换为局部坐标
     // 使用之前计算的逆矩阵，将世界坐标转换到以第一个顶点为原点的局部坐标系
     vec4 local=inverse * vec4(worldCoordinate,1.);
     
     // 忽略Z轴（高度），因为我们只关心XY平面上的矩形判断
     local.z=0.;
     
     // 6. 判断当前像素对应的世界坐标点是否在矩形区域内
     // rect.x: 最小X值（左边界）
     // rect.z: 最大X值（右边界）
     // rect.y: 最小Y值（下边界）
     // rect.w: 最大Y值（上边界）
     if(local.x>rect.x&&local.x<rect.z&&local.y<rect.w&&local.y>rect.y){ 
       // 在矩形内：保持原样，不做处理
     
     }  else {
       // 不在矩形内：应用遮罩效果（将红色通道设为1.0，显示为红色）
       // 这是"反选遮罩"：遮罩矩形外的区域
       out_FragColor.r =1.;
     }
  }
  `;
 /**
  * 创建后处理阶段（PostProcessStage）
  * 
  * PostProcessStage会在每一帧渲染完成后执行，
  * 对已经渲染到纹理的场景进行二次处理
  */
 const postProcessStage =new Cesium.PostProcessStage({
  fragmentShader: fragmentShaderSource,  // 使用的片段着色器代码
  uniforms: {
   // 将计算好的变换矩阵和矩形边界传入shader
   inverse: inverse,           // 世界坐标到局部坐标的变换矩阵
   rect: cartesianRect,        // 矩形边界信息
   },
  });

  export default postProcessStage;