import * as Cesium from 'cesium'
export const useTileLocalFlat = (positions: Cesium.Cartesian3[], center: Cesium.Cartesian3) => {
  // 使用Texture方式实现
  let transform = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  let inverse = Cesium.Matrix4.inverse(transform, new Cesium.Matrix4);
  const localPositions = [] as any;
  positions.forEach(p => {
    localPositions.push(Cesium.Matrix4.multiplyByPoint(inverse, p, new Cesium.Cartesian3()));
  })
  let rect1 = Cesium.BoundingRectangle.fromPoints(localPositions, new Cesium.BoundingRectangle());
  //长和宽
  let w = rect1.width;
  let h = rect1.height;
  let rect = new Cesium.Cartesian4(rect1.x, rect1.y, rect1.x + rect1.width, rect1.y + rect1.height);
  //定义用于画布的宽高
  let canvasWidth = w * 5;
  let canvasHeight = h * 5;
  //将经纬度数据坐标转换到画布的坐标系上 
  const canvasPoints = [] as any;
  localPositions.forEach(point => {
    canvasPoints.push({
      x: (point.x - rect.x) / w * canvasWidth,
      y: -(point.y - rect.w) / h * canvasHeight
    })
  })
  // 创建canvas进行图形绘制
  let canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;left:0px;top:0px;z-index:1000;transform: translateY(0px);"
  canvas.height = canvasHeight;
  canvas.width = canvasWidth;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  //第一个点开始
  let point = canvasPoints[0];
  ctx.moveTo(point.x, point.y);
  for (let i = 1; i < canvasPoints.length; i++) {
    point = canvasPoints[i];
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  ctx.fillStyle = "#000";
  ctx.fill();
  document.body.appendChild(canvas);

  return new Cesium.CustomShader({
    vertexShaderText: ` 
      void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) { 
          vec2 p= vsOutput.positionMC.xy;   
          if (p.x >= rect.x && p.x <= rect.z && p.y >= rect.y && p.y <= rect.w) {
            float w = rect.z - rect.x;
            float h = rect.w - rect.y;
            float s = (p.x - rect.x) / w;
            float t = (p.y - rect.y) / h; 
            vec4 color = texture(image, vec2(s,t));
            if(color.r<0.5){
                vsOutput.positionMC.z=405.;  
            }
          }
      }`,
    uniforms: {
      rect: {
        type: Cesium.UniformType.VEC4,
        value: rect,
      },
      image: {
        type: Cesium.UniformType.SAMPLER_2D,
        value: new Cesium.TextureUniform({
          url: canvas.toDataURL(),
        }),
        minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
        magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
      },
    },
  });
}