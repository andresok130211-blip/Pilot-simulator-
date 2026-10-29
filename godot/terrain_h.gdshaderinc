uniform sampler2D dem : filter_nearest, repeat_disable;
uniform sampler2D coast : filter_linear, repeat_disable;
uniform vec2 center_ll = vec2(37.4, 55.9);
uniform vec4 apt[4];   // lon, lat, высота (м), 0
uniform int apt_n = 0;
const float R_E = 6371000.0;

float hashi(ivec2 q){ uint h = uint(q.x) * 747796405u + uint(q.y) * 2891336453u; h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u; h = (h >> 22u) ^ h; return float(h & 16777215u) / 16777215.0; }
float hash(vec2 p){ return hashi(ivec2(floor(p + 0.5))); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); ivec2 q = ivec2(i);
  return mix(mix(hashi(q), hashi(q+ivec2(1,0)), f.x), mix(hashi(q+ivec2(0,1)), hashi(q+ivec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; } return s; }

vec2 ll_of(vec3 v){
  float lat = center_ll.y - v.z / 110574.0;
  float lon = center_ll.x + v.x / (111320.0 * cos(radians(clamp(lat, -85.0, 85.0))));
  return vec2(lon, lat);
}
float dem_px(ivec2 p){
  ivec2 sz = textureSize(dem, 0);
  p = clamp(p, ivec2(0), sz - ivec2(1));
  vec3 c = texelFetch(dem, p, 0).rgb * 255.0;
  return c.r * 256.0 + c.g;
}
float elev(vec2 ll){
  ivec2 sz = textureSize(dem, 0);
  vec2 q = vec2((ll.x + 180.0) / 360.0 * float(sz.x), (90.0 - ll.y) / 180.0 * float(sz.y)) - 0.5;
  ivec2 i = ivec2(floor(q)); vec2 f = fract(q);
  return mix(mix(dem_px(i), dem_px(i + ivec2(1,0)), f.x), mix(dem_px(i + ivec2(0,1)), dem_px(i + ivec2(1,1)), f.x), f.y);
}
vec2 mdelta(vec2 ll, vec2 c){ return vec2((ll.x - c.x) * 111320.0 * cos(radians(c.y)), (ll.y - c.y) * 110574.0); }
float apt_k(vec2 ll){   // 0 у аэродрома, 1 вдали
  float k = 1.0;
  for (int i = 0; i < 4; i++) { if (i >= apt_n) break; k = min(k, smoothstep(3200.0, 11000.0, length(mdelta(ll, apt[i].xy)))); }
  return k;
}
float apt_elev(vec2 ll){
  float best = 1e9; float e = 0.0;
  for (int i = 0; i < 4; i++) { if (i >= apt_n) break; float d = length(mdelta(ll, apt[i].xy)); if (d < best) { best = d; e = apt[i].z; } }
  return e;
}
float land_at(vec2 ll){
  float l = textureLod(coast, vec2((ll.x + 180.0) / 360.0, (90.0 - ll.y) / 180.0), 0.0).r;
  return apt_n > 0 ? max(l, 1.0 - apt_k(ll)) : l;
}
float height_at(vec2 ll, float d, vec2 xz, out float fl){
  float h = elev(ll);
  float sp = 0.04 * d + 20.0;
  float w1 = 1.0 - smoothstep(350.0, 800.0, sp);      // ~800 м
  float w2 = 1.0 - smoothstep(1000.0, 2400.0, sp);    // ~2.6 км
  float w3 = 1.0 - smoothstep(40.0, 110.0, sp);       // ~265 м
  float w0 = 1.0 - smoothstep(6000.0, 14000.0, sp);   // ~9 км
  float amp = clamp(0.45*h - 260.0, 0.0, 1500.0);
  float r1 = 0.0, r2 = 0.0;
  if (amp > 0.0 && w2 > 0.0) r2 = pow(1.0 - abs(2.0*fbm(ll*42.0 + 5.0)-1.0), 2.0);
  if (amp > 0.0 && w1 > 0.0) r1 = pow(1.0 - abs(2.0*fbm(ll*140.0)-1.0), 2.0);
  float det = 0.0;
  if (w0 > 0.0) det += (fbm(ll*12.0) - 0.45) * min(300.0, 70.0 + 0.08*h) * w0;
  if (w2 > 0.0 && h > 3.0) det += (fbm(ll*34.0 + 11.0) - 0.5) * 55.0 * w2;   // холмистая равнина
  if (w2 > 0.0 && amp > 0.0) det += (r2 - 0.35) * amp * 0.8 * w2;
  if (w1 > 0.0 && amp > 0.0) det += (r1 - 0.35) * amp * 0.45 * w1;
  if (w3 > 0.0) det += (fbm(ll*420.0) - 0.5) * min(160.0, 0.06*h) * w3;
  h = max(0.0, h + det * smoothstep(0.0, 400.0, h));
  if (apt_n > 0) h = mix(apt_elev(ll), h, apt_k(ll));
  return h;
}
