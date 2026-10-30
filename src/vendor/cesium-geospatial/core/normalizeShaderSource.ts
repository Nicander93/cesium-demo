/** Shader source surgery uses LF anchors; Windows checkout line endings must not change semantics. */
export function normalizeShaderSource(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}
