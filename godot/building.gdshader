shader_type spatial;
render_mode cull_disabled;
#include "res://terrain_h.gdshaderinc"
uniform float night = 0.0;
uniform float glow = 0.0;
varying float v_y;
varying vec3 v_wp;
varying vec3 v_col;
void vertex(){
  vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
  float d = length(wp.xz);
  vec2 ll = ll_of(vec3(wp.x, 0.0, wp.z));
  float fl;
  float g = height_at(ll, d, wp.xz, fl);
  v_y = VERTEX.y;
  VERTEX.y = g + VERTEX.y - d * d / (2.0 * R_E);
  v_wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
  v_col = COLOR.rgb;
}
void fragment(){
  float wall = 1.0 - abs(NORMAL.y);
  vec3 c = v_col;
  float em = 0.0;
  if (wall > 0.5 && glow < 0.5) {
    float u = (v_wp.x + v_wp.z * 1.0) / 3.6;
    float rw = v_y / 3.2;
    vec2 f = fract(vec2(u, rw));
    float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78) * step(1.0, v_y);
    float lit = step(0.55, hashi(ivec2(int(floor(u)), int(floor(rw)))));
    c = mix(c, c * 0.35 + vec3(0.04, 0.08, 0.14), win);
    em = win * lit * night;
  }
  ALBEDO = c;
  vec3 e = vec3(1.0, 0.8, 0.5) * em * 0.9;
  if (glow > 0.5) { ALBEDO = vec3(0.0); e = v_col * 0.9; }
  EMISSION = e;
  ROUGHNESS = 0.88;
}
