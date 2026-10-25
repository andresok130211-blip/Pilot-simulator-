shader_type spatial;
render_mode cull_disabled;
uniform sampler2D dem : filter_nearest, repeat_disable;
uniform sampler2D bio : filter_nearest, repeat_disable;
uniform sampler2D coast : filter_linear, repeat_disable;
uniform vec2 center_ll = vec2(37.4, 55.9);
uniform float dem_unit = 35.0;
uniform float time_of_day = 1.0;
uniform vec3 sun_dir = vec3(0.4, 0.8, 0.3);
uniform vec4 apt[4];   // lon, lat, высота (м), 0
uniform int apt_n = 0;
uniform vec4 rwy[4];   // lon, lat (центр), курс (рад), длина (м)
uniform vec4 rwy2[4];  // ширина, высота, 0, 0
uniform int rwy_n = 0;
uniform vec4 aps[8];
uniform int ap_n = 0;
varying float v_fl;
varying vec2 v_ll;
varying vec3 v_world;
varying float v_h;
const float R_E = 6371000.0;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
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
  float r1 = pow(1.0 - abs(2.0*fbm(ll*140.0)-1.0), 2.0);
  float r2 = pow(1.0 - abs(2.0*fbm(ll*42.0 + 5.0)-1.0), 2.0);
  float amp = clamp(0.45*h - 260.0, 0.0, 1500.0);
  float det = (fbm(ll*12.0) - 0.45) * min(300.0, 40.0 + 0.08*h) * w0
            + (r2 - 0.35) * amp * 0.8 * w2 + (r1 - 0.35) * amp * 0.45 * w1
            + (fbm(ll*420.0) - 0.5) * min(160.0, 0.06*h) * w3;
  h = max(0.0, h + det * smoothstep(0.0, 400.0, h));
  if (apt_n > 0) h = mix(apt_elev(ll), h, apt_k(ll));
  return h;
}
varying vec3 v_nrm;
void vertex(){
  vec3 v = VERTEX;
  float d = length(v.xz);
  v_ll = ll_of(v);
  float land = land_at(v_ll);
  float fl;
  float h = height_at(v_ll, d, v.xz, fl);
  float k = max(smoothstep(0.3, 0.7, land), 1.0 - smoothstep(0.35, 0.65, fl));
  h *= k;
  v_fl = fl;
  // нормаль по конечным разностям той же функции высоты
  float e = max(12.0, 0.04 * d);
  float f1, f2;
  float hx = height_at(ll_of(v + vec3(e, 0.0, 0.0)), d, v.xz + vec2(e, 0.0), f1) * k;
  float hz = height_at(ll_of(v + vec3(0.0, 0.0, e)), d, v.xz + vec2(0.0, e), f2) * k;
  v_nrm = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
  v_h = h;
  VERTEX.y = h - d*d/(2.0*R_E);
  v_world = VERTEX;
  NORMAL = v_nrm;
}
void fragment(){
  vec2 uvm = vec2((v_ll.x + 180.0) / 360.0, (90.0 - v_ll.y) / 180.0);
  float land = max(texture(coast, uvm).r, step(0.5, 1.0 - v_fl));
  if (apt_n > 0) land = max(land, 1.0 - apt_k(v_ll));
  float b = texture(bio, uvm).r * 255.0;
  vec3 col;
  float n1 = fbm(v_ll * 900.0), n2 = fbm(v_ll * 3200.0);
  if (land < 0.5) {
    col = mix(vec3(0.03, 0.17, 0.30), vec3(0.09, 0.33, 0.45), n2);
    ROUGHNESS = 0.15; SPECULAR = 0.8;
  } else {
    float h = v_h;
    col = vec3(0.40, 0.52, 0.25) + (n1 - 0.5) * vec3(0.16, 0.09, 0.05);
    float field = smoothstep(0.52, 0.66, fbm(v_ll * 2400.0));
    col = mix(col, vec3(0.65, 0.59, 0.36), field * 0.7);
    float forest = smoothstep(0.55, 0.65, fbm(v_ll * 1300.0 + 7.0)) * (1.0 - smoothstep(1200.0, 2000.0, h));
    col = mix(col, vec3(0.15, 0.31, 0.17), forest);
    if (b > 0.5 && b < 1.5) col = mix(col, vec3(0.84, 0.73, 0.52) * (0.9 + 0.2 * n1), 0.9);
    else if (b < 2.5 && b > 1.5) col = mix(col, vec3(0.50, 0.53, 0.41), 0.75);
    else if (b < 3.5 && b > 2.5) col = mix(col, vec3(0.94, 0.96, 0.98), 0.93);
    else if (b < 4.5 && b > 3.5) col = mix(col, vec3(0.26, 0.38, 0.32), 0.6);
    else if (b > 4.5) col = mix(col, vec3(0.89, 0.88, 0.83), 0.9);
    // высота: скалы и снег
    float slope = 1.0 - clamp(v_nrm.y, 0.0, 1.0);
    float rock = max(smoothstep(1400.0, 2600.0, h + (n2 - 0.5) * 500.0), smoothstep(0.22, 0.45, slope) * smoothstep(300.0, 900.0, h));
    col = mix(col, vec3(0.45, 0.42, 0.39), rock);
    float snow = smoothstep(2700.0, 3300.0, h + (n1 - 0.5) * 600.0 - slope * 900.0 - max(0.0, abs(v_ll.y) - 40.0) * 40.0);
    col = mix(col, vec3(0.95, 0.96, 0.98), snow);
    // полярные широты — снег ниже
    float polar = smoothstep(62.0, 72.0, abs(v_ll.y));
    col = mix(col, vec3(0.92, 0.94, 0.96), polar * 0.7);
    // пляж
    col = mix(col, vec3(0.78, 0.72, 0.52), (1.0 - smoothstep(2.0, 14.0, h)) * 0.7);
    ROUGHNESS = 0.95; SPECULAR = 0.05;
  }

  // ВПП, рулёжные дорожки и перрон (рисуются прямо на земле)
  for (int i = 0; i < 4; i++) {
    if (i >= rwy_n) break;
    vec2 dd = mdelta(v_ll, rwy[i].xy);
    float hd = rwy[i].z; float sh = sin(hd), ch = cos(hd);
    float u = dd.x * sh + dd.y * ch;          // вдоль полосы от центра
    float w = dd.x * ch - dd.y * sh;          // вправо от оси
    float Ln = rwy[i].w * 0.5, Wd = rwy2[i].x * 0.5;
    if (abs(u) > Ln + 250.0 || w < -Wd - 40.0 || w > 300.0) continue;
    float aa = max(fwidth(w), fwidth(u)) * 0.7 + 0.001;
    float ul = u + Ln;                         // от торца
    vec3 asp = vec3(0.20, 0.20, 0.21);
    float tw = step(abs(ul - 0.06 * rwy[i].w - 12.0), 0.0);
    // перрон
    if (ul > rwy[i].w * 0.28 && ul < rwy[i].w * 0.62 && w > 116.0 && w < 235.0) col = mix(col, vec3(0.42, 0.42, 0.43), 0.95);
    // рулёжная дорожка
    if (ul > -40.0 && ul < rwy[i].w + 40.0 && w > 95.0 && w < 117.0) col = mix(col, asp * 1.15, 0.95);
    for (int k = 0; k < 3; k++) {
      float cu = rwy[i].w * (k == 0 ? 0.06 : (k == 1 ? 0.5 : 0.93)) + 12.0;
      if (abs(ul - cu) < 11.0 && w > Wd && w < 100.0) col = mix(col, asp * 1.15, 0.95);
    }
    // обочина и полоса
    if (abs(u) < Ln + 60.0 && abs(w) < Wd + 12.0) col = mix(col, vec3(0.45, 0.46, 0.42), 0.6);
    if (abs(u) < Ln && abs(w) < Wd) {
      col = asp;
      float fade = 1.0 - smoothstep(0.6, 3.0, aa);
      float edge = (1.0 - smoothstep(0.0, aa + 0.4, abs(abs(w) - (Wd - 1.5)))) ;
      float cl = 1.0 - smoothstep(0.3, 0.3 + aa, abs(w));
      float dash = smoothstep(0.0, aa / 60.0 + 0.001, fract(ul / 60.0)) * (1.0 - smoothstep(0.5, 0.5 + aa / 60.0 + 0.001, fract(ul / 60.0)));
      float cdash = cl * dash * step(60.0, ul) * step(ul, rwy[i].w - 60.0) * fade;
      float thr = 0.0;
      for (int e = 0; e < 2; e++) {
        float ue = e == 0 ? ul : (rwy[i].w - ul);
        float f3 = fract(w / 3.6 + 0.5);
        float bars = smoothstep(0.2, 0.2 + aa / 3.6 + 0.001, f3) * (1.0 - smoothstep(0.6, 0.6 + aa / 3.6 + 0.001, f3));
        thr = max(thr, bars * step(8.0, ue) * step(ue, 38.0) * step(abs(w), Wd - 3.0) * fade);
        float zone = (1.0 - smoothstep(0.0, aa + 0.3, abs(abs(w) - 9.0) - 1.5)) * fade;
        thr = max(thr, zone * (step(abs(ue - 300.0), 22.0) + step(abs(ue - 450.0), 11.0)));
      }
      edge = edge * (0.4 + 0.6 * fade);
      col = mix(col, vec3(0.92), clamp(max(edge, max(cdash, thr)), 0.0, 1.0));
    }
  }
  if (land > 0.5) NORMAL = normalize((VIEW_MATRIX * vec4(normalize(v_nrm), 0.0)).xyz);
  ALBEDO = col;
}
