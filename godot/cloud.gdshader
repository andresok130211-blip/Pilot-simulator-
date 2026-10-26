shader_type spatial;
render_mode unshaded, cull_disabled, blend_mix, depth_draw_never;
uniform vec2 ground_off = vec2(0.0);   // смещение в метрах (чтобы облака стояли над землёй)
uniform float cover = 0.5;
uniform float scale = 5000.0;
uniform float lightk = 1.0;
uniform vec3 tint = vec3(1.0);
uniform float fade_range = 140000.0;
varying vec3 v_w;
float hashi(ivec2 q){ uint h = uint(q.x) * 747796405u + uint(q.y) * 2891336453u; h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u; h = (h >> 22u) ^ h; return float(h & 16777215u) / 16777215.0; }
float hash(vec2 p){ return hashi(ivec2(floor(p + 0.5))); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); ivec2 q = ivec2(i);
  return mix(mix(hashi(q), hashi(q+ivec2(1,0)), f.x), mix(hashi(q+ivec2(0,1)), hashi(q+ivec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.07 + 3.1; a *= 0.5; } return s; }
void vertex(){
  vec3 w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
  w.y -= (w.x*w.x + w.z*w.z) / (2.0 * 6371000.0);
  v_w = w;
  VERTEX = (inverse(MODEL_MATRIX) * vec4(w, 1.0)).xyz;
}
void fragment(){
  vec2 p = (v_w.xz + ground_off) / scale;
  float n = fbm(p);
  float a = smoothstep(1.0 - cover, 1.0 - cover + 0.22, n);
  float d = length(v_w.xz - CAMERA_POSITION_WORLD.xz);
  a *= 1.0 - smoothstep(fade_range * 0.5, fade_range, d);
  a *= smoothstep(30.0, 350.0, abs(CAMERA_POSITION_WORLD.y - v_w.y));   // внутри слоя не слепит
  float shade = 0.78 + 0.22 * smoothstep(0.3, 0.9, fbm(p * 3.0 + 9.0));
  ALBEDO = tint * shade * lightk;
  ALPHA = a * 0.92;
}
