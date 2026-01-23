import * as Cesium from 'cesium';

let positions = [120,30,120.5,30,120.5,30.5,120,30.5];
 const cartesianPositions =Cesium.Cartesian3.fromDegreesArray(
   [].concat.apply([], positions),
  );
 //建立局部坐标系 将所有点转到该坐标系下
 let m =Cesium.Transforms.eastNorthUpToFixedFrame(cartesianPositions[0]);
 let inverse =Cesium.Matrix4.inverse(m,new Cesium.Matrix4());
 let localPositions:Cesium.Cartesian3[] = [];
  cartesianPositions.forEach((position) =>{
   localPositions.push(
   Cesium.Matrix4.multiplyByPoint(
     inverse,
     position,
    new Cesium.Cartesian3(),
    ),
   );
  });
 //计算矩形范围
 let rect =Cesium.BoundingRectangle.fromPoints(
   localPositions,
  new Cesium.BoundingRectangle(),
  );
 const cartesianRect =new Cesium.Cartesian4(
   rect.x,
   rect.y,
   rect.x+ rect.width,
   rect.y+ rect.height,
  );
 const fragmentShaderSource =`
  uniform sampler2D colorTexture;
  uniform sampler2D depthTexture;
  in vec2 v_textureCoordinates;
  uniform vec4 rect;
  uniform mat4 inverse;
  void main(void)
  {        
     out_FragColor = texture(colorTexture, v_textureCoordinates);
     float depth =czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
     if(depth>=1.)return;
     vec4 eyeCoordinate4 = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
     vec3 eyeCoordinate3 = eyeCoordinate4.xyz/eyeCoordinate4.w;
     vec4 worldCoordinate4 = czm_inverseView * vec4(eyeCoordinate3,1.) ; 
     vec3 worldCoordinate = worldCoordinate4.xyz / worldCoordinate4.w;
     vec4 local=inverse * vec4(worldCoordinate,1.);
     local.z=0.;
     //判断是否在rect中
     if(local.x>rect.x&&local.x<rect.z&&local.y<rect.w&&local.y>rect.y){ 
     
     }  else {
       out_FragColor.r =1.;}
  }
  `;
 const postProcessStage =new Cesium.PostProcessStage({
  fragmentShader: fragmentShaderSource,
  uniforms: {
   inverse: inverse,
   rect: cartesianRect,
   },
  });
//   map.scene.postProcessStages.add(postProcessStage);