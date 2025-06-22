import * as Cesium from 'cesium';

/**
 * 基于 Shader 的 Cesium 遮罩实现
 * 通过自定义材质和着色器实现高性能遮罩效果
 */

interface MaskOptions {
    maskColor?: number[];
    fadeDistance?: number;
}

export class ShaderMask {
    private viewer: Cesium.Viewer;
    private options: {
        maskColor: number[];
        fadeDistance: number;
    };
    private maskPolygons: number[][][] = []; // 存储遮罩多边形
    private maskEntities: Cesium.Entity[] = []; // 存储遮罩实体
    public globalMaskEntity: Cesium.Entity | null = null;

    constructor(viewer: Cesium.Viewer, options: MaskOptions = {}) {
        this.viewer = viewer;
        this.options = {
            maskColor: options.maskColor || [0.0, 0.0, 0.0, 0.5], // 遮罩颜色 RGBA
            fadeDistance: options.fadeDistance || 1000.0, // 边缘渐变距离（米）
        };
        
        this.initializeShaderMaterial();
    }

    /**
     * 初始化自定义着色器材质
     */
    private initializeShaderMaterial(): void {
        // 注册自定义材质类型
        (Cesium.Material as any).MaskType = 'Mask';
        (Cesium.Material as any)._materialCache?.addMaterial((Cesium.Material as any).MaskType, {
            fabric: {
                type: (Cesium.Material as any).MaskType,
                uniforms: {
                    maskColor: new Cesium.Color(0.0, 0.0, 0.0, 0.5),
                    fadeDistance: 1000.0,
                    // 简化：只支持一个矩形区域
                    minLng: -180.0,
                    maxLng: 180.0,
                    minLat: -90.0,
                    maxLat: 90.0,
                    enableMask: false,
                    time: 0.0
                },
                source: this.getFragmentShader()
            }
        });

        // 创建全球覆盖的矩形，使用自定义材质
        this.globalMaskEntity = this.viewer.entities.add({
            rectangle: {
                coordinates: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
                material: new Cesium.Material({
                    fabric: {
                        type: (Cesium.Material as any).MaskType,
                        uniforms: {
                            maskColor: new Cesium.Color(...this.options.maskColor),
                            fadeDistance: this.options.fadeDistance,
                            minLng: -180.0,
                            maxLng: 180.0,
                            minLat: -90.0,
                            maxLat: 90.0,
                            enableMask: false,
                            time: 0.0
                        }
                    }
                }) as any,
                height: 0,
                extrudedHeight: 0
            }
        });
    }

    /**
     * 获取片段着色器代码
     */
    private getFragmentShader(): string {
        return `
            uniform vec4 maskColor;
            uniform float fadeDistance;
            uniform float minLng;
            uniform float maxLng;
            uniform float minLat;
            uniform float maxLat;
            uniform bool enableMask;
            uniform float time;
            
            czm_material czm_getMaterial(czm_materialInput materialInput) {
                czm_material material = czm_getDefaultMaterial(materialInput);
                
                // 获取当前像素的地理坐标
                vec2 st = materialInput.st;
                
                // 将纹理坐标转换为经纬度
                float longitude = mix(-180.0, 180.0, st.x);
                float latitude = mix(-90.0, 90.0, st.y);
                
                // 默认不遮罩
                float maskAlpha = 0.0;
                
                if (enableMask) {
                    // 检查是否在指定的矩形区域外
                    bool outsideRegion = longitude < minLng || longitude > maxLng || 
                                        latitude < minLat || latitude > maxLat;
                    
                    if (outsideRegion) {
                        maskAlpha = maskColor.a;
                        
                        // 计算到边界的距离，实现边缘渐变
                        if (fadeDistance > 0.0) {
                            float distToLng = min(abs(longitude - minLng), abs(longitude - maxLng));
                            float distToLat = min(abs(latitude - minLat), abs(latitude - maxLat));
                            float minDist = min(distToLng, distToLat);
                            
                            // 基于距离计算渐变
                            float fadeRatio = clamp(minDist / (fadeDistance * 0.01), 0.0, 1.0);
                            maskAlpha *= fadeRatio;
                        }
                    }
                }
                
                // 应用遮罩效果
                material.diffuse = mix(vec3(1.0), maskColor.rgb, maskAlpha);
                material.alpha = maskAlpha;
                
                return material;
            }
        `;
    }

    /**
     * 添加遮罩多边形（简化版：只支持矩形区域）
     * @param coordinates 矩形坐标数组 [[lng, lat], [lng, lat], ...]
     */
    addMaskPolygon(coordinates: number[][]): void {
        if (!coordinates || coordinates.length < 2) {
            console.warn('矩形区域至少需要2个顶点');
            return;
        }

        // 计算边界框
        const lngs = coordinates.map(coord => coord[0]);
        const lats = coordinates.map(coord => coord[1]);
        
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);

        this.maskPolygons.push(coordinates);
        this.updateShaderUniforms(minLng, maxLng, minLat, maxLat);
    }

    /**
     * 设置矩形遮罩区域
     * @param bounds 边界 [minLng, minLat, maxLng, maxLat]
     */
    setMaskBounds(bounds: [number, number, number, number]): void {
        const [minLng, minLat, maxLng, maxLat] = bounds;
        this.updateShaderUniforms(minLng, maxLng, minLat, maxLat);
    }

    /**
     * 移除所有遮罩多边形
     */
    clearMaskPolygons(): void {
        this.maskPolygons = [];
        this.disableMask();
    }

    /**
     * 启用遮罩
     */
    enableMask(): void {
        if (this.globalMaskEntity) {
            const material = this.globalMaskEntity.rectangle?.material as unknown as Cesium.Material;
            (material as any).uniforms.enableMask = true;
        }
    }

    /**
     * 禁用遮罩
     */
    disableMask(): void {
        if (this.globalMaskEntity) {
            const material = this.globalMaskEntity.rectangle?.material as unknown as Cesium.Material;
            (material as any).uniforms.enableMask = false;
        }
    }

    /**
     * 更新着色器的uniform变量
     */
    private updateShaderUniforms(minLng: number, maxLng: number, minLat: number, maxLat: number): void {
        if (!this.globalMaskEntity) return;

        const material = this.globalMaskEntity.rectangle?.material as unknown as Cesium.Material;
        const uniforms = (material as any).uniforms;

        uniforms.minLng = minLng;
        uniforms.maxLng = maxLng;
        uniforms.minLat = minLat;
        uniforms.maxLat = maxLat;
        uniforms.enableMask = true;
    }

    /**
     * 设置遮罩颜色
     * @param color RGBA数组 [r, g, b, a]
     */
    setMaskColor(color: number[]): void {
        if (this.globalMaskEntity) {
            const material = this.globalMaskEntity.rectangle?.material as unknown as Cesium.Material;
            (material as any).uniforms.maskColor = new Cesium.Color(...color);
        }
    }

    /**
     * 设置边缘渐变距离
     * @param distance 距离（度）
     */
    setFadeDistance(distance: number): void {
        if (this.globalMaskEntity) {
            const material = this.globalMaskEntity.rectangle?.material as unknown as Cesium.Material;
            (material as any).uniforms.fadeDistance = distance;
        }
    }

    /**
     * 销毁遮罩
     */
    destroy(): void {
        if (this.globalMaskEntity) {
            this.viewer.entities.remove(this.globalMaskEntity);
            this.globalMaskEntity = null;
        }
        this.maskPolygons = [];
        this.maskEntities = [];
    }
}

// 使用示例
export class MaskExample {
    private viewer!: Cesium.Viewer;
    private shaderMask!: ShaderMask;

    constructor() {
        this.initViewer();
    }

    private async initViewer(): Promise<void> {
        // 初始化 Cesium Viewer
        this.viewer = new Cesium.Viewer('cesiumContainer', {
            terrainProvider: await Cesium.createWorldTerrainAsync(),
            timeline: false,
            animation: false
        });

        // 等待viewer初始化完成后再设置遮罩
        this.setupMask();
        this.addTestData();
    }

    private setupMask(): void {
        // 创建着色器遮罩
        this.shaderMask = new ShaderMask(this.viewer, {
            maskColor: [0.0, 0.0, 0.0, 0.6], // 黑色半透明遮罩
            fadeDistance: 0.5 // 边缘渐变距离（度）
        });

        // 添加一个矩形遮罩区域（北京周边）
        const beijingArea: number[][] = [
            [116.0, 39.5],
            [117.0, 39.5],
            [117.0, 40.5],
            [116.0, 40.5],
            [116.0, 39.5]
        ];
        this.shaderMask.addMaskPolygon(beijingArea);

        // 添加一个圆形遮罩区域（上海周边）
        const shanghaiCenter: [number, number] = [121.5, 31.2];
        const radius = 0.5;
        const shanghaiArea = this.generateCircleCoordinates(shanghaiCenter, radius, 16);
        this.shaderMask.addMaskPolygon(shanghaiArea);
    }

    /**
     * 生成圆形坐标
     */
    private generateCircleCoordinates(center: [number, number], radius: number, segments: number = 32): number[][] {
        const coordinates: number[][] = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            const lng = center[0] + radius * Math.cos(angle);
            const lat = center[1] + radius * Math.sin(angle);
            coordinates.push([lng, lat]);
        }
        return coordinates;
    }

    private addTestData(): void {
        // 添加一些测试数据点
        const testPoints = [
            { name: '北京', position: [116.4, 39.9] },
            { name: '上海', position: [121.5, 31.2] },
            { name: '广州', position: [113.3, 23.1] },
            { name: '深圳', position: [114.1, 22.5] }
        ];

        testPoints.forEach(point => {
            this.viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(point.position[0], point.position[1]),
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.YELLOW,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2
                },
                label: {
                    text: point.name,
                    font: '14pt sans-serif',
                    pixelOffset: new Cesium.Cartesian2(0, -50),
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE
                }
            });
        });

        // 设置相机视角
        this.viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(116.4, 39.9, 2000000)
        });
    }

    // 动态控制方法
    toggleMask(): void {
        if (this.shaderMask.globalMaskEntity?.show) {
            this.shaderMask.globalMaskEntity.show = false;
        } else if (this.shaderMask.globalMaskEntity) {
            this.shaderMask.globalMaskEntity.show = true;
        }
    }

    changeMaskColor(r: number, g: number, b: number, a: number): void {
        this.shaderMask.setMaskColor([r, g, b, a]);
    }

    changeFadeDistance(distance: number): void {
        this.shaderMask.setFadeDistance(distance);
    }
}