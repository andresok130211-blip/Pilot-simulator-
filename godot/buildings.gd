extends Node3D
# Объёмные здания: реальные контуры OpenStreetMap (Overpass, кеш на устройстве) или, пока данных нет, процедурная застройка городов.
const STEP := 0.02
const MAX_ALT := 2600.0
var mat: ShaderMaterial
var cells := {}          # "x_y" -> {node, real}
var jobs: Array = []     # очередь сборки мешей
var net_q: Array = []
var net_busy := false
var net_t := 0.0
var cities: Array = []
var cur := Vector2.ZERO
var online := true
var apts: Array = []

func setup(terrain_mat: ShaderMaterial) -> void:
	mat = ShaderMaterial.new(); mat.shader = load("res://building.gdshader")
	mat.set_shader_parameter("dem", terrain_mat.get_shader_parameter("dem")); mat.set_shader_parameter("coast", terrain_mat.get_shader_parameter("coast"))
	DirAccess.make_dir_recursive_absolute("user://bld")

static func _hash(a: int, b: int) -> float:
	var h := (a * 73856093) ^ (b * 19349663)
	h = (h ^ (h >> 13)) * 1274126177
	return float((h ^ (h >> 16)) & 0xFFFFFF) / 16777215.0

func update(lon: float, lat: float, alt: float, terrain_mat: ShaderMaterial, night: float) -> void:
	cur = Vector2(lon, lat)
	var show := alt < MAX_ALT
	visible = show
	if not show: return
	mat.set_shader_parameter("center_ll", cur); mat.set_shader_parameter("night", night)
	mat.set_shader_parameter("apt", terrain_mat.get_shader_parameter("apt")); mat.set_shader_parameter("apt_n", terrain_mat.get_shader_parameter("apt_n"))
	var cx := int(floor(lon / STEP)); var cy := int(floor(lat / STEP))
	var ring := 2 if alt < 700.0 else 1
	for dx in range(-ring, ring + 1):
		for dy in range(-ring, ring + 1):
			var k := "%d_%d" % [cx + dx, cy + dy]
			if not cells.has(k): _want(cx + dx, cy + dy, k)
	for k in cells.keys():
		var p: PackedStringArray = (k as String).split("_")
		if absi(int(p[0]) - cx) > ring + 1 or absi(int(p[1]) - cy) > ring + 1:
			if cells[k].node: cells[k].node.queue_free()
			cells.erase(k)
	for k in cells.keys():
		var n: Node3D = cells[k].node
		if n:
			var p2: PackedStringArray = (k as String).split("_")
			var o_lon := float(p2[0]) * STEP; var o_lat := float(p2[1]) * STEP
			n.position = Vector3((o_lon - lon) * 111320.0 * cos(deg_to_rad(o_lat)), 0.0, (lat - o_lat) * 110574.0)

func _process(dt: float) -> void:
	var budget := 50
	while budget > 0 and not jobs.is_empty():
		var j: Dictionary = jobs[0]
		var list: Array = j.list
		while j.i < list.size() and budget > 0:
			_add_building(j, list[j.i]); j.i += 1; budget -= 1
		if j.i >= list.size():
			jobs.pop_front(); _finish(j)
	net_t += dt
	if online and not net_busy and not net_q.is_empty() and net_t > 1.0: net_t = 0.0; _fetch(net_q.pop_front())

func _bounds(k: String) -> Array:
	var p := k.split("_"); var x := int(p[0]); var y := int(p[1])
	return [y * STEP, x * STEP, (y + 1) * STEP, (x + 1) * STEP]   # s, w, n, e

func _want(x: int, y: int, k: String) -> void:
	cells[k] = {"node": null, "real": false}
	var path := "user://bld/%d_%d.json" % [x, y]
	if FileAccess.file_exists(path):
		var f := FileAccess.open(path, FileAccess.READ)
		var data = JSON.parse_string(f.get_as_text())
		if data is Array and data.size() > 0: _queue(k, _from_real(k, data), true); return
		if data is Array: return   # кеш: в клетке зданий нет
	_queue(k, _procedural(k), false)
	if online: net_q.append(k)

func _queue(k: String, list: Array, real: bool) -> void:
	if list.is_empty(): return
	jobs.append({"key": k, "list": list, "i": 0, "v": PackedVector3Array(), "n": PackedVector3Array(), "c": PackedColorArray(), "idx": PackedInt32Array(), "real": real})

func _finish(j: Dictionary) -> void:
	var k: String = j.key
	if not cells.has(k) or (j.v as PackedVector3Array).is_empty(): return
	if cells[k].real and not j.real: return
	if cells[k].node: cells[k].node.queue_free()
	var arr := []; arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = j.v; arr[Mesh.ARRAY_NORMAL] = j.n; arr[Mesh.ARRAY_COLOR] = j.c; arr[Mesh.ARRAY_INDEX] = j.idx
	var m := ArrayMesh.new(); m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mi := MeshInstance3D.new(); mi.mesh = m; mi.material_override = mat; mi.extra_cull_margin = 400.0; mi.custom_aabb = AABB(Vector3(-100, -200, -100), Vector3(3000, 600, 3000))
	add_child(mi); cells[k].node = mi; cells[k].real = j.real

# ---- данные ----
func _from_real(k: String, data: Array) -> Array:
	# data: [[высота, [lat, lon, lat, lon, ...]], ...] -> [высота, контур в метрах, цвет]
	var b := _bounds(k); var o_lat: float = b[0]; var o_lon: float = b[1]; var cl := cos(deg_to_rad(o_lat))
	var out := []
	for e in data:
		var pts: Array = e[1]; var poly := PackedVector2Array()
		for i in range(0, pts.size() - 1, 2): poly.append(Vector2((float(pts[i + 1]) - o_lon) * 111320.0 * cl, (o_lat - float(pts[i])) * 110574.0))
		if poly.size() > 3 and poly[0].distance_to(poly[poly.size() - 1]) < 0.5: poly.remove_at(poly.size() - 1)
		if poly.size() < 3: continue
		out.append([float(e[0]), poly])
	return out

func prefetch(lon: float, lat: float) -> void:
	var cx := int(floor(lon / STEP)); var cy := int(floor(lat / STEP))
	for dx in range(-1, 2):
		for dy in range(-1, 2):
			var k := "%d_%d" % [cx + dx, cy + dy]
			if not FileAccess.file_exists("user://bld/%d_%d.json" % [cx + dx, cy + dy]) and not net_q.has(k):
				cells[k] = {"node": null, "real": false}; net_q.append(k)

func _procedural(k: String) -> Array:
	var b := _bounds(k); var o_lat: float = b[0]; var o_lon: float = b[1]; var cl := cos(deg_to_rad(o_lat))
	var w := STEP * 111320.0 * cl; var h := STEP * 110574.0
	var cen := Vector2(o_lon + STEP * 0.5, o_lat + STEP * 0.5)
	var best := 0.0; var pop := 0.0; var cc := Vector2.ZERO
	for c in cities:
		var dx := (float(c[0]) - cen.x) * 111320.0 * cl; var dy := (float(c[1]) - cen.y) * 110574.0
		var rr := 1100.0 + 8200.0 * sqrt(float(c[2]) / 1.0e6)
		var dens := 1.0 - sqrt(dx * dx + dy * dy) / (rr * 1.15)
		if dens > best: best = dens; pop = float(c[2]); cc = Vector2(dx, dy)
	if best <= 0.02: return []
	for a in apts:
		if Vector2((float(a[0]) - cen.x) * 111320.0 * cl, (float(a[1]) - cen.y) * 110574.0).length() < 2300.0: return []
	var out := []
	var kx := int(b[1] / STEP); var ky := int(b[0] / STEP)
	var blk := 64.0
	var tall := clampf(sqrt(pop / 1.0e6), 0.0, 3.0)
	for i in range(int(w / blk)):
		for j in range(int(h / blk)):
			var r := _hash(kx * 131 + i, ky * 197 + j)
			if r > best * 1.25: continue
			var px := (float(i) + 0.5) * blk + (r - 0.5) * 12.0; var py := (float(j) + 0.5) * blk
			var cdist := Vector2(px - w * 0.5 + cen.x * 0.0, py - h * 0.5).distance_to(cc)
			var core := clampf(1.0 - cdist / (1500.0 + 2500.0 * tall), 0.0, 1.0)
			var hh := 7.0 + 9.0 * _hash(i, j + 5) + core * core * (30.0 + 55.0 * tall) * (0.4 + 0.6 * _hash(j, i + 9))
			var sx := 24.0 + 26.0 * _hash(i + 3, j); var sy := 20.0 + 24.0 * _hash(i, j + 7)
			var poly := PackedVector2Array([Vector2(px - sx * 0.5, py - sy * 0.5), Vector2(px + sx * 0.5, py - sy * 0.5), Vector2(px + sx * 0.5, py + sy * 0.5), Vector2(px - sx * 0.5, py + sy * 0.5)])
			out.append([hh, poly])
	return out

# ---- меш ----
func _color(h: float, r: float) -> Color:
	if h > 40.0: return Color(0.55, 0.65, 0.75).lerp(Color(0.7, 0.72, 0.75), r)
	if h > 20.0: return Color(0.72, 0.7, 0.66).lerp(Color(0.6, 0.62, 0.68), r)
	var pal := [Color(0.82, 0.75, 0.62), Color(0.78, 0.5, 0.4), Color(0.85, 0.84, 0.8), Color(0.7, 0.68, 0.62), Color(0.88, 0.8, 0.55)]
	return pal[int(r * 4.99)]

func _add_building(j: Dictionary, e: Array) -> void:
	var h: float = clampf(float(e[0]), 3.0, 420.0); var poly: PackedVector2Array = e[1]
	var v: PackedVector3Array = j.v; var n: PackedVector3Array = j.n; var c: PackedColorArray = j.c; var idx: PackedInt32Array = j.idx
	var r := _hash(int(poly[0].x * 7.0), int(poly[0].y * 5.0))
	var col := _color(h, r)
	var area := 0.0
	for i in range(poly.size()):
		var p := poly[i]; var q := poly[(i + 1) % poly.size()]
		area += p.x * q.y - q.x * p.y
	var sg := 1.0 if area > 0.0 else -1.0
	if absf(area) < 30.0: return
	for i in range(poly.size()):
		var p := poly[i]; var q := poly[(i + 1) % poly.size()]
		var d := q - p; var ln := d.length()
		if ln < 0.01: continue
		var nm := Vector3(d.y, 0.0, -d.x) / ln * sg
		var base := v.size()
		v.append(Vector3(p.x, -8.0, p.y)); v.append(Vector3(q.x, -8.0, q.y)); v.append(Vector3(q.x, h, q.y)); v.append(Vector3(p.x, h, p.y))
		for t in range(4): n.append(nm); c.append(col)
		idx.append_array(PackedInt32Array([base, base + 2, base + 1, base, base + 3, base + 2]))
	var tri := Geometry2D.triangulate_polygon(poly)
	if tri.size() >= 3:
		var rb := v.size()
		for p in poly: v.append(Vector3(p.x, h, p.y)); n.append(Vector3.UP); c.append(col * 0.75)
		for t in range(0, tri.size(), 3): idx.append_array(PackedInt32Array([rb + tri[t], rb + tri[t + 2], rb + tri[t + 1]]))

# ---- сеть ----
func _fetch(k: String) -> void:
	if not cells.has(k): return
	net_busy = true
	var b := _bounds(k)
	var q := "[out:json][timeout:25];way[\"building\"](%f,%f,%f,%f);out tags geom;" % [b[0], b[1], b[2], b[3]]
	var rq := HTTPRequest.new(); rq.timeout = 30.0; rq.body_size_limit = 24 * 1024 * 1024; add_child(rq)
	rq.request_completed.connect(func(res: int, code: int, _h: PackedStringArray, body: PackedByteArray):
		rq.queue_free(); net_busy = false
		if res != 0 or code != 200: return
		var js = JSON.parse_string(body.get_string_from_utf8())
		if not (js is Dictionary) or not js.has("elements"): return
		var data := []
		for el in js.elements:
			if el.get("type", "") != "way" or not el.has("geometry"): continue
			var tg: Dictionary = el.get("tags", {})
			var hh := 0.0
			if tg.has("height"): hh = float(str(tg.height).replace(",", "."))
			elif tg.has("building:levels"): hh = float(str(tg["building:levels"])) * 3.3 + 1.5
			if hh <= 0.0: hh = 6.0 + 8.0 * _hash(int(el.get("id", 0)) % 9973, 7)
			var pts := []
			for g in el.geometry: pts.append(snappedf(float(g.lat), 0.000001)); pts.append(snappedf(float(g.lon), 0.000001))
			data.append([snappedf(hh, 0.1), pts])
		var p := k.split("_")
		var f := FileAccess.open("user://bld/%d_%d.json" % [int(p[0]), int(p[1])], FileAccess.WRITE)
		if f: f.store_string(JSON.stringify(data))
		if cells.has(k): _queue(k, _from_real(k, data), true))
	if rq.request("https://overpass-api.de/api/interpreter?data=" + q.uri_encode()) != OK:
		rq.queue_free(); net_busy = false
