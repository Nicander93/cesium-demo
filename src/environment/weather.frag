uniform sampler2D colorTexture;
uniform float u_rain;
uniform float u_time;
uniform float u_rainSpeed;
uniform float u_rainAngle;
uniform float u_rainLength;
in vec2 v_textureCoordinates;

float hash21(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453); }

void main() {
  vec4 color = texture(colorTexture, v_textureCoordinates);
  // A bounded foreground weather layer; no volume traversal or history buffer.
  if (u_rain > 0.001) {
    vec2 p = gl_FragCoord.xy / 115.0;
    p.y /= u_rainLength;
    p.x += p.y * tan(radians(u_rainAngle));
    vec2 cell = floor(p * vec2(12.0,1.4));
    float seed = hash21(vec2(cell.x,0.0));
    vec2 q = fract(p * vec2(12.0,1.4) + vec2(seed, -u_time * u_rainSpeed * (2.3 + seed)));
    float line = (1.0-smoothstep(0.018,0.055,abs(q.x-0.5))) * smoothstep(0.15,0.35,q.y) * (1.0-smoothstep(0.65,0.98,q.y));
    line *= step(hash21(cell),u_rain*0.7);
    color.rgb = mix(color.rgb, vec3(0.62,0.72,0.8),line*u_rain*0.23);
  }
  out_FragColor = color;
}
