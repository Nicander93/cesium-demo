type Rgba = readonly [number, number, number, number]

/** glTF material factors are linear; the asset palette is authored in sRGB. */
export function srgbToLinearColor(
  color: Rgba,
): [number, number, number, number] {
  const channel = (value: number) =>
    value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  return [channel(color[0]), channel(color[1]), channel(color[2]), color[3]]
}
