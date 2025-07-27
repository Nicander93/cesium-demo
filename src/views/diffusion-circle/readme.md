# 扩散圆

- 核心是设置一个随时间变化的扩散半径（0~1）

``` javascript
`czm_material czm_getMaterial(czm_materialInput materialInput)
                       {
                           // 获取默认材质
                           czm_material material = czm_getDefaultMaterial(materialInput);
                           // 设置漫反射颜色，增强亮度
                           material.diffuse = 1.5 * color.rgb;
                           // 获取纹理坐标 (0-1范围)
                           vec2 st = materialInput.st;
                           /*
                            * 计算当前像素到扩散中心的距离
                            * vec2(0.5, 0.5) 表示纹理中心点
                            */
                           float distanceFromCenter = distance(st, vec2(0.5, 0.5));
                           
                           /*
                            * 计算扩散半径, 扩散半径会随着时间从 0 到 1 变化
                            * czm_frameNumber 是当前帧数; fract是取小数部分，确保值在0-1之间
                            * time控制扩散速度，数值越大扩散越快
                            */
                           float diffusionRadius = fract(czm_frameNumber * time / 1000.0);
                           // 如果距离大于当前扩散半径，则丢弃
                           if(distanceFromCenter > diffusionRadius * 0.5) {
                             discard; // 丢弃该像素，不进行渲染
                           }else{
                             // distanceFromCenter/diffusionRadius 表示相对距离，越接近中心越透明
                             material.alpha = color.a * distanceFromCenter / diffusionRadius / 1.0;
                           }
                           return material;
                       }`
```
