import { Cartesian3, Cartographic, Matrix3 } from 'cesium'

export interface ModelRayHit {
  object?: unknown
  position?: Cartesian3
}

/** Offscreen ray sampling must identify the model, rather than accepting unrelated scene depth. */
export function isTargetModelHit(hit: ModelRayHit, target: unknown): boolean {
  const object = hit.object
  return (
    typeof object === 'object' &&
    object !== null &&
    'primitive' in object &&
    object.primitive === target &&
    Boolean(hit.position) &&
    [hit.position!.x, hit.position!.y, hit.position!.z].every(Number.isFinite)
  )
}

/** Reject impossible depths before deriving an artistic display plane from sampled surfaces. */
export function chooseModelGroundHeight(
  heights: readonly number[],
  centerHeight: number,
  radius: number,
): number {
  if (!Number.isFinite(centerHeight) || !Number.isFinite(radius) || radius <= 0)
    throw new Error('模型高程包围范围无效')
  const margin = radius + 50
  const valid = heights
    .filter(
      (height) =>
        Number.isFinite(height) && Math.abs(height - centerHeight) <= margin,
    )
    .sort((a, b) => a - b)
  if (valid.length < 3)
    throw new Error('未取得至少3个位于模型包围范围内的可信高程')
  return valid[Math.floor((valid.length - 1) * 0.25)]
}

/** A cheap artistic baseline, explicitly derived from box bounds rather than measured ground. */
export function boxDisplayBaseHeight(value: unknown): number | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    !('center' in value) ||
    !('halfAxes' in value)
  )
    return undefined
  const box = value as { center: Cartesian3; halfAxes: Matrix3 }
  if (!(box.center instanceof Cartesian3) || !(box.halfAxes instanceof Matrix3))
    return undefined
  const heights: number[] = []
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) {
        const point = Matrix3.multiplyByVector(
          box.halfAxes,
          new Cartesian3(x, y, z),
          new Cartesian3(),
        )
        Cartesian3.add(box.center, point, point)
        const height = Cartographic.fromCartesian(point)?.height
        if (height === undefined || !Number.isFinite(height)) return undefined
        heights.push(height)
      }
  return Math.min(...heights)
}
