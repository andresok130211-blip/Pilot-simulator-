shader_type spatial;
render_mode cull_back;

// Рельеф и поверхность считаются на видеокарте: высота — из DEM (ETOPO1) + детали, цвет — по биомам.
uniform sampler2D dem_tex : filter_linear, repeat_enable;
uniform sampler2D land_tex : filter_linear, repeat_disable;
uniform sampler2D bio_tex : filter_nearest, repeat_enable;
uniform vec2 s_ll = vec2(0.0);       // широта/долгота центра кольца, градусы
uniform vec2 s_dir = vec2(1.0, 0.0); // cos/sin курса оси X у центра
uniform vec4 land_win = vec4(0.0, 0.0, 1.0, 1.0); // lon_left, lat_top, 1/ширина, 1/высота (градусы)
uniform float cell = 100.0;
uniform vec4 hole = vec4(1.0, -1.0, 1.0, -1.0); // minx,maxx,minz,maxz (локально); если min>max — без выреза
uniform vec4 aps[8];
uniform int ap_n = 0;
uniform vec3 sun_dir = vec3(0.4, 0.8, 0.3);
uniform float season_snow = 0.0;

varying vec2 v_ll;
varying float v_h;
varying vec3 v_local;
varying float v_dem;
varying float v_ny;

const float M_PER_DEG = 111195.0;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
	float a = 0.5, s = 0.0;
	for (int i = 0; i < 4; i++) {
		s += a * vnoise(p);
		p = p * 2.03 + vec2(17.0, 9.0);
		a *= 0.5;
	}
	return s;
}

vec2 to_ll(vec2 p) {
	float north = p.x * s_dir.x - p.y * s_dir.y;
	float east = p.x * s_dir.y + p.y * s_dir.x;
	float lat = s_ll.x + north / M_PER_DEG;
	float lon = s_ll.y + east / (M_PER_DEG * cos(radians(clamp(lat, -85.0, 85.0))));
	return vec2(lat, lon);
}
float land_at(vec2 ll) {
	float dl = mod(ll.y - land_win.x + 180.0, 360.0) - 180.0;
	vec2 uv = vec2(dl * land_win.z, (land_win.y - ll.x) * land_win.w);
	if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
		return step(1.0, texture(dem_tex, vec2((ll.y + 180.0) / 360.0, (90.0 - ll.x) / 180.0)).r * 255.0);
	}
	return texture(land_tex, uv).r;
}
float dem_at(vec2 ll) {
	return texture(dem_tex, vec2((ll.y + 180.0) / 360.0, (90.0 - ll.x) / 180.0)).r * 255.0 * 35.0;
}

// высота поверхности в точке (локальные метры), land — доля суши
float height(vec2 p, out float land, out float dem, out vec2 ll) {
	ll = to_ll(p);
	land = land_at(ll);
	dem = dem_at(ll);
	vec2 q = vec2(ll.x, ll.y * 0.7) * M_PER_DEG;
	float h = max(dem, 1.5);
	// крупные формы
	float n1 = fbm(q / 26000.0);
	float rid = 1.0 - abs(2.0 * fbm(q / 9000.0 + 31.0) - 1.0);
	float amp = clamp(0.1 * dem - 40.0, 0.0, 700.0);
	float lod1 = 1.0 - smoothstep(2500.0, 7000.0, cell);
	h += (n1 - 0.45) * min(260.0, 40.0 + 0.06 * dem) * lod1 + (rid * rid - 0.35) * amp * (1.0 - smoothstep(3500.0, 12000.0, cell));
	// мелкие холмы
	float rough = clamp(0.02 * dem + 6.0, 6.0, 90.0);
	float lod2 = 1.0 - smoothstep(300.0, 900.0, cell);
	h += (fbm(q / 1800.0 + 5.0) - 0.5) * rough * lod2;
	float lod3 = 1.0 - smoothstep(80.0, 260.0, cell);
	h += (fbm(q / 420.0 + 11.0) - 0.5) * rough * 0.35 * lod3;
	// аэродромы: плоская площадка с плавным переходом
	for (int i = 0; i < 8; i++) {
		if (i >= ap_n) break;
		float d = length(p - aps[i].xy);
		float k = smoothstep(aps[i].w, aps[i].w * 3.0, d);
		h = mix(aps[i].z, h, k);
	}
	// берег и море
	float lk = smoothstep(0.42, 0.58, land);
	return mix(0.0, max(h, 0.8), lk);
}

void vertex() {
	vec2 p = VERTEX.xz;
	float land, dem; vec2 ll;
	float h = height(p, land, dem, ll);
	float e = max(cell, 20.0);
	float l2, d2; vec2 ll2;
	float hx1 = height(p + vec2(e, 0.0), l2, d2, ll2);
	float hx0 = height(p - vec2(e, 0.0), l2, d2, ll2);
	float hz1 = height(p + vec2(0.0, e), l2, d2, ll2);
	float hz0 = height(p - vec2(0.0, e), l2, d2, ll2);
	NORMAL = normalize(vec3(-(hx1 - hx0), 2.0 * e, -(hz1 - hz0)));
	v_ny = NORMAL.y;
	VERTEX.y = h;
	v_ll = ll;
	v_h = h;
	v_dem = dem;
	v_local = VERTEX;
}

vec3 sstep3(vec3 a, vec3 b, float k) { return mix(a, b, clamp(k, 0.0, 1.0)); }

void fragment() {
	if (hole.x < hole.y && v_local.x > hole.x && v_local.x < hole.y && v_local.z > hole.z && v_local.z < hole.w) discard;
	float land = land_at(v_ll);
	vec2 q = vec2(v_ll.x, v_ll.y * 0.7) * M_PER_DEG;
	vec3 col;
	float rough = 0.9;
	float spec = 0.1;
	if (land < 0.5 && v_h < 1.0) {
		float sh = smoothstep(0.0, 0.5, land);
		vec3 deep = vec3(0.04, 0.17, 0.33);
		vec3 shallow = vec3(0.12, 0.42, 0.52);
		col = mix(deep, shallow, sh * sh);
		float w = vnoise(q / 90.0) * 0.5 + vnoise(q / 23.0) * 0.5;
		col *= 0.92 + 0.16 * w;
		rough = 0.18;
		spec = 0.6;
	} else {
		float h = v_h;
		float msl = v_dem;
		float f1 = fbm(q / 3200.0);
		float f2 = fbm(q / 1500.0 + 7.0);
		float f3 = vnoise(q / 120.0);
		col = vec3(0.41 + 0.16 * f1, 0.52 + 0.09 * f1, 0.24 + 0.05 * f1);
		// поля/пашня
		float ky = smoothstep(0.52, 0.66, f2);
		col = mix(col, vec3(0.65, 0.59, 0.36), ky * 0.7);
		// лес по влажности
		float wet = fbm(q / 5200.0 + 3.0);
		float forest = smoothstep(0.52, 0.62, wet) * (1.0 - smoothstep(520.0, 760.0, msl / 3.0 + h * 0.3));
		// биом
		float bio = texture(bio_tex, vec2((v_ll.y + 0.04 * sin(v_ll.x * 7.0) + 180.0) / 360.0, (90.0 - v_ll.x) / 180.0)).r * 255.0;
		int b = int(bio + 0.5);
		float bn = 0.9 + 0.2 * f1;
		if (b == 1) { col = mix(col, vec3(0.84, 0.73, 0.52) * bn, 0.9); forest = 0.0; }
		else if (b == 2) { col = mix(col, vec3(0.5, 0.53, 0.41) * bn, 0.7); forest = 0.0; }
		else if (b == 3) { col = mix(col, vec3(0.93, 0.95, 0.98), 0.92); forest = 0.0; }
		else if (b == 4) { col = mix(col, vec3(0.26, 0.38, 0.32), 0.6); }
		else if (b == 5) { col = mix(col, vec3(0.9, 0.88, 0.83), 0.9); forest = 0.0; }
		col = mix(col, vec3(0.15, 0.31, 0.17) * (0.9 + 0.2 * f3), forest);
		// пляж у моря
		float beach = (1.0 - smoothstep(0.5, 0.8, land)) * (1.0 - smoothstep(4.0, 14.0, h));
		col = mix(col, vec3(0.75, 0.7, 0.54), beach * 0.8);
		// склоны: скалы и снег
		float slope = 1.0 - clamp(v_ny, 0.0, 1.0);
		float rock = max(smoothstep(1400.0, 2600.0, msl), smoothstep(0.12, 0.3, slope));
		col = mix(col, vec3(0.46, 0.43, 0.39) * (0.85 + 0.3 * f3), rock * (1.0 - float(b == 3)));
		float snow = smoothstep(2500.0, 3300.0, msl - slope * 700.0);
		snow = max(snow, season_snow * smoothstep(0.0, 400.0, msl + 200.0 * (abs(v_ll.x) - 45.0) / 20.0));
		col = mix(col, vec3(0.94, 0.95, 0.97), snow);
		rough = 0.95;
		spec = 0.05;
	}
	ALBEDO = col;
	ROUGHNESS = rough;
	SPECULAR = spec;
}
