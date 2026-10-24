extends Node3D
# Кольца рельефа вокруг самолёта (разная детализация). Вся геометрия считается шейдером.
const RINGS := [
	{"half": 6000.0, "n": 192},
	{"half": 30000.0, "n": 192},
	{"half": 150000.0, "n": 192},
	{"half": 750000.0, "n": 192},
]
var origin := Vector2.ZERO     # мировая точка, соответствующая (0,0) сцены
var rings: Array = []
var dem_tex: ImageTexture
var bio_tex: ImageTexture
var land_tex: ImageTexture
var land_win := Vector4(0, 0, 1, 1)
var _land_center := Vector2(1e9, 1e9)
var _land_busy := false
var airports: Array = []  # [{pos:Vector2 мировая, elev, r}]
const LAND_SPAN := 16.0   # градусов
const LAND_N := 640
var snow := 0.0

func _ready() -> void:
	var shader := load("res://scripts/terrain.gdshader") as Shader
	var dem_img := Image.create_from_data(Geo.DEM_W, Geo.DEM_H, false, Image.FORMAT_R8, Geo._dem)
	dem_tex = ImageTexture.create_from_image(dem_img)
	var bio_img := Image.create_from_data(Geo.BIO_W, Geo.BIO_H, false, Image.FORMAT_R8, Geo._bio)
	bio_tex = ImageTexture.create_from_image(bio_img)
	var li := Image.create(LAND_N, LAND_N, false, Image.FORMAT_R8)
	land_tex = ImageTexture.create_from_image(li)
	for i in RINGS.size():
		var R: Dictionary = RINGS[i]
		var pm := PlaneMesh.new()
		pm.size = Vector2(R.half * 2.0, R.half * 2.0)
		pm.subdivide_width = R.n - 1
		pm.subdivide_depth = R.n - 1
		var mi := MeshInstance3D.new()
		mi.mesh = pm
		mi.custom_aabb = AABB(Vector3(-R.half, -500, -R.half), Vector3(R.half * 2, 12000, R.half * 2))
		mi.extra_cull_margin = 16384.0
		var mat := ShaderMaterial.new()
		mat.shader = shader
		mat.set_shader_parameter("dem_tex", dem_tex)
		mat.set_shader_parameter("bio_tex", bio_tex)
		mat.set_shader_parameter("land_tex", land_tex)
		mat.set_shader_parameter("cell", R.half * 2.0 / (R.n - 1))
		mi.material_override = mat
		add_child(mi)
		rings.append({"mi": mi, "mat": mat, "snap": R.half * 2.0 / (R.n - 1) * 8.0, "S": Vector2(1e12, 1e12), "half": R.half})

func set_airports(list: Array) -> void:
	airports = list

func _bearing_of_x(s: Vector2) -> Vector2:
	var a := Geo.ll(s.x, s.y)
	var b := Geo.ll(s.x + 2000.0, s.y)
	var north := (b.x - a.x) * 111195.0
	var east := (b.y - a.y) * 111195.0 * cos(deg_to_rad(a.x))
	if absf(b.y - a.y) > 180.0:
		east = (fposmod(b.y - a.y + 540.0, 360.0) - 180.0) * 111195.0 * cos(deg_to_rad(a.x))
	var n := sqrt(north * north + east * east)
	if n < 1e-6:
		return Vector2(1, 0)
	# угол оси X относительно севера: cos = north/n, sin = east/n
	return Vector2(north / n, east / n)

func update_center(p: Vector2) -> void:
	# p — мировые x,z самолёта
	for i in rings.size():
		var r: Dictionary = rings[i]
		var sn: float = r.snap
		var S := Vector2(round(p.x / sn) * sn, round(p.y / sn) * sn)
		if S != r.S:
			r.S = S
			_refresh_ring(i)
		var mi: MeshInstance3D = r.mi
		mi.position = Vector3(S.x - origin.x, -2.0 * i, S.y - origin.y)
	_check_land(p)

func _refresh_ring(i: int) -> void:
	var r: Dictionary = rings[i]
	var S: Vector2 = r.S
	var ll := Geo.ll(S.x, S.y)
	var mat: ShaderMaterial = r.mat
	mat.set_shader_parameter("s_ll", ll)
	mat.set_shader_parameter("s_dir", _bearing_of_x(S))
	# вырез под внутренним кольцом
	if i > 0:
		var inner: Dictionary = rings[i - 1]
		var ih: float = inner.half * 0.999
		var IS: Vector2 = inner.S
		var lo := IS - S - Vector2(ih, ih)
		var hi := IS - S + Vector2(ih, ih)
		mat.set_shader_parameter("hole", Vector4(lo.x, hi.x, lo.y, hi.y))
	var arr: Array = []
	var n := 0
	for a in airports:
		var d: Vector2 = a.pos - S
		if absf(d.x) < r.half + 20000.0 and absf(d.y) < r.half + 20000.0 and n < 8:
			arr.append(Vector4(d.x, d.y, a.elev, a.r))
			n += 1
	while arr.size() < 8:
		arr.append(Vector4(0, 0, 0, 0))
	mat.set_shader_parameter("aps", PackedVector4Array(arr))
	mat.set_shader_parameter("ap_n", n)
	mat.set_shader_parameter("land_win", land_win)
	mat.set_shader_parameter("season_snow", snow)

func refresh_all() -> void:
	for i in rings.size():
		rings[i].S = Vector2(1e12, 1e12)

func _check_land(p: Vector2) -> void:
	if _land_busy:
		return
	var ll := Geo.ll(p.x, p.y)
	var c := Vector2(ll.x, ll.y)
	var d := Vector2(absf(c.x - _land_center.x), absf(fposmod(c.y - _land_center.y + 180.0, 360.0) - 180.0))
	if d.x > LAND_SPAN * 0.22 or d.y > LAND_SPAN * 0.22:
		_build_land(c)

func _build_land(c: Vector2) -> void:
	_land_busy = true
	_land_center = c
	var lon_left := c.y - LAND_SPAN / 2.0
	var lat_top := minf(c.x + LAND_SPAN / 2.0, 89.9)
	var data := PackedByteArray()
	data.resize(LAND_N * LAND_N)
	var col0 := int(floor((lon_left + 180.0) / Geo.GEO_RES))
	var row0 := int(floor((90.0 - lat_top) / Geo.GEO_RES))
	for y in LAND_N:
		var row := row0 + y
		if row < 0 or row >= Geo.GEO_H:
			continue
		var lo: int = Geo._land_off[row]
		var hi: int = Geo._land_off[row + 1]
		var k := lo
		while k < hi:
			# серия суши: от runs[k] до runs[k+1] (в абсолютных столбцах)
			var a: int = Geo._land_runs[k]
			var b: int = Geo.GEO_W
			if k + 1 < hi:
				b = Geo._land_runs[k + 1]
			k += 2
			for off in [0, Geo.GEO_W, -Geo.GEO_W]:
				var x0: int = maxi(a + off - col0, 0)
				var x1: int = mini(b + off - col0, LAND_N)
				var yy := y * LAND_N
				for x in range(x0, x1):
					data[yy + x] = 255
	var img := Image.create_from_data(LAND_N, LAND_N, false, Image.FORMAT_R8, data)
	land_tex.update(img)
	land_win = Vector4(lon_left, lat_top, 1.0 / LAND_SPAN, 1.0 / LAND_SPAN)
	for r in rings:
		(r.mat as ShaderMaterial).set_shader_parameter("land_win", land_win)
	_land_busy = false

# высота поверхности на ЦП (приближённо, без мелких деталей), м над уровнем моря
func height_at(wx: float, wz: float) -> float:
	var ll := Geo.ll(wx, wz)
	var land := Geo.land_f(ll.y, ll.x)
	if land < 0.5:
		return 0.0
	var dem := Geo.dem_f(ll.y, ll.x)
	var h := maxf(dem, 1.5)
	for a in airports:
		var d := Vector2(wx, wz).distance_to(a.pos)
		var k := smoothstep(a.r, a.r * 3.0, d)
		h = lerpf(a.elev, h, k)
	return h
