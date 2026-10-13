/** Raw offscreen passes must leave Cesium's cached GL state intact. */
export function withOffscreenState(gl, draw, units = 1) {
  const saved = {
    program: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING),
    buffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING), active: gl.getParameter(gl.ACTIVE_TEXTURE),
    read: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), draw: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),
    viewport: gl.getParameter(gl.VIEWPORT), color: gl.getParameter(gl.COLOR_WRITEMASK),
    clear: gl.getParameter(gl.COLOR_CLEAR_VALUE), depthMask: gl.getParameter(gl.DEPTH_WRITEMASK),
  };
  const caps = [gl.DEPTH_TEST, gl.BLEND, gl.CULL_FACE, gl.SCISSOR_TEST];
  const enabled = caps.map(cap => gl.isEnabled(cap));
  const textures = [];
  for (let unit = 0; unit < units; unit++) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    textures.push({ two: gl.getParameter(gl.TEXTURE_BINDING_2D), three: gl.getParameter(gl.TEXTURE_BINDING_3D), sampler: gl.getParameter(gl.SAMPLER_BINDING) });
  }
  const vao = gl.createVertexArray();
  try {
    gl.bindVertexArray(vao);
    for (let unit = 0; unit < units; unit++) gl.bindSampler(unit, null);
    caps.forEach(cap => gl.disable(cap));
    gl.colorMask(true, true, true, true);
    gl.depthMask(false);
    gl.activeTexture(gl.TEXTURE0);
    return draw();
  } finally {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, saved.read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, saved.draw);
    gl.viewport(...saved.viewport);
    gl.useProgram(saved.program);
    gl.bindVertexArray(saved.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, saved.buffer);
    textures.forEach((texture, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture.two);
      gl.bindTexture(gl.TEXTURE_3D, texture.three);
      gl.bindSampler(unit, texture.sampler);
    });
    gl.activeTexture(saved.active);
    gl.colorMask(...saved.color);
    gl.clearColor(...saved.clear);
    gl.depthMask(saved.depthMask);
    caps.forEach((cap, index) => enabled[index] ? gl.enable(cap) : gl.disable(cap));
    gl.deleteVertexArray(vao);
  }
}
