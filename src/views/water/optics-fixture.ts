import * as Cesium from 'cesium'

/** Host-owned reference geometry for the output experiment; no network or hydraulic data. */
export function addOpticsFixture(
  viewer: Cesium.Viewer,
  height: number,
): () => void {
  const owned: Cesium.Entity[] = []
  owned.push(
    viewer.entities.add({
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(
          119.029,
          33.5905,
          119.035,
          33.594,
        ),
        height: height - 14,
        material: Cesium.Color.fromCssColorString('#666651'),
      },
    }),
  )
  for (const [longitude, latitude, size, color] of [
    [119.0312, 33.59283, 24, '#ddd7c8'],
    [119.0325, 33.59265, 20, '#b99863'],
    [119.033, 33.59215, 18, '#4c6265'],
  ] as const) {
    const position = Cesium.Cartesian3.fromDegrees(
      longitude,
      latitude,
      height + 14,
    )
    owned.push(
      viewer.entities.add({
        position,
        orientation: Cesium.Transforms.headingPitchRollQuaternion(
          position,
          new Cesium.HeadingPitchRoll(),
        ),
        box: {
          dimensions: new Cesium.Cartesian3(size, size, 48),
          material: Cesium.Color.fromCssColorString(color),
        },
      }),
    )
  }
  return () => {
    for (const entity of owned) viewer.entities.remove(entity)
  }
}
