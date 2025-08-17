import './index.less';
import { useEffect, useRef } from'react';
import * as Cesium from'cesium';
import EditCesium from'./EditCesium';
import dat from'dat.gui';
export default function Layout() {
const mapInstance = useRef<any>(null);
const bim = useRef<any>(null);
const point = useRef<any>(null);
const tiles = useRef<any>(null);
useEffect(() => {
    createCesium();
    return() => {
      mapInstance?.current?.destroy();
      mapInstance.current = null;
    };
  }, []);

constcreateCesium = () => {

      const map = ...... 你的初始化加载地图
      window.deepMap = map;
      addBim(map);

  };
constaddBim = async (map: any) => {
    try {
      tiles.current = awaitCesium.Cesium3DTileset.fromUrl(
        `dayanta/tileset.json`,
        {
          maximumScreenSpaceError: 2,
          cullRequestsWhileMovingMultiplier: 100,
          dynamicScreenSpaceError: true,
          preferLeaves: true,
          debugShowBoundingVolume: false,
          debugShowContentBoundingVolume: false,
        },
      );
      map.scene.primitives.add(tiles.current);
      map.zoomTo(tiles.current);
      const origin = Cesium.Cartesian3.fromDegrees(
        108.95186608439401,
        34.21980211937744,
        700,
      );
      const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(origin); //加载坐标
      bim.current = awaitCesium.Model.fromGltfAsync({
        url: '/model/Airplane.glb',
        modelMatrix: modelMatrix,
        scale: 100,
      });
      map.scene.primitives.add(bim.current);
      point.current = map.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          108.95186608439401,
          34.21980211937744,
          500,
        ),
        point: {
          pixelSize: 10,
          color: Cesium.Color.RED,
        },
      });
      addGui(map);
    } catch (error) {
      console.log(`Failed to load model. ${error}`);
    }
  };
constaddGui = (map: any) => {
    const bimEditCesium = newEditCesium(map, {
      rotateEnabled: true,
      translateEnabled: true,
      scaleEnabled: true,
    });
    bimEditCesium.addTo(bim.current);
    const tilesEditCesium = newEditCesium(map, {
      rotateEnabled: true,
      translateEnabled: true,
    });
    tilesEditCesium.addTo(tiles.current);
    const pointEditCesium = newEditCesium(map, {
      translateEnabled: true,
    });
    pointEditCesium.addTo(point.current);
    const bimModel = {
      rotateEnabled: true,
      translateEnabled: true,
      scaleEnabled: true,
    };
    const gui = new dat.GUI();
    const bimFolder = gui.addFolder('BIM');
    bimFolder.add(bimModel, 'rotateEnabled').onChange(() => {
      bimEditCesium.rotateEnabled = bimModel.rotateEnabled;
    });
    bimFolder.add(bimModel, 'translateEnabled').onChange(() => {
      bimEditCesium.translateEnabled = bimModel.translateEnabled;
    });
    bimFolder.add(bimModel, 'scaleEnabled').onChange(() => {
      bimEditCesium.scaleEnabled = bimModel.scaleEnabled;
    });

    const tilesModel = {
      rotateEnabled: true, // 旋转控制器
      translateEnabled: true, // 平移控制器
    };
    const tilesFolder = gui.addFolder('Tiles');
    tilesFolder.add(tilesModel, 'rotateEnabled').onChange(() => {
      tilesEditCesium.rotateEnabled = tilesModel.rotateEnabled;
    });
    tilesFolder.add(tilesModel, 'translateEnabled').onChange(() => {
      tilesEditCesium.translateEnabled = tilesModel.translateEnabled;
    });
    const pointModel = {
      translateEnabled: true,
    };
    const pointFolder = gui.addFolder('Point');
    pointFolder.add(pointModel, 'translateEnabled').onChange(() => {
      pointEditCesium.translateEnabled = pointModel.translateEnabled;
    });
    pointFolder.open();
    tilesFolder.open();
    bimFolder.open();
  };
return (
    <div className="layout">
      <div id="map3dContainer" />
    </div>
  );
}
