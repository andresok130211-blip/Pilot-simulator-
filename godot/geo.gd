extends Node3D
# Дороги и леса из OpenStreetMap (Overpass, кеш на устройстве): ленты дорог по рельефу и деревья внутри лесных контуров.
const STEP := 0.02
const MAX_ALT := 1800.0
const MAX_TREES := 900
var mat: ShaderMaterial
var cells := {}          # "x_y" -> Node3D
var net_q: Array = []
var net_busy := false
var net_t := 0.0
var cur := Vector2.ZERO
var online := true
var trees_on := true
var tree_mesh: ArrayMesh
var build_q: Array = []

func setup(terrain_mat: ShaderMaterial, bld_shader: Shader) -> void:
	mat = ShaderMaterial.new(); mat.shader = bld_shader; mat.set_shader_parameter("plain", 1.0)
	mat.set_shader_parameter("dem", terrain_mat.get_shader_parameter("dem")); mat.set_shader_parameter("coast", terrain_mat.get_shader_parameter("coast"))
	DirAccess.make_dir_recursive_absolute("user://geo")
	tree_mesh = _make_tree()

func _make_tree() -> ArrayMesh:
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := 7
	for i in range(n):
		var a0 := TAU * i / n; var a1 := TAU * (i + 1) / n
		var p0 := Vector3(cos(a0) * 0.32, 0.18, sin(a0) * 0.32); var p1 := Vector3(cos(a1) * 0.32, 0.18, sin(a1) * 0.32)
		var tip := Vector3(0, 1.0, 0)
		st.set_color(Color(0.55, 0.7, 0.55)); st.set_normal(Vector3(cos(a0), 0.5, sin(a0)).normalized()); st.add_vertex(p0)
		st.set_color(Color(0.55, 0.7, 0.55)); st.set_normal(Vector3(cos(a1), 0.5, sin(a1)).normalized()); st.add_vertex(p1)
		st.set_color(Color(0.8, 0.95, 0.8)); st.set_normal(Vector3.UP); st.add_vertex(tip)
		var q0 := Vector3(cos(a0) * 0.05, 0.0, sin(a0) * 0.05); var q1 := Vector3(cos(a1) * 0.05, 0.0, sin(a1) * 0.05)
		for v in [q0, q1, Vector3(q1.x, 0.2, q1.z), q0, Vector3(q1.x, 0.2, q1.z), Vector3(q0.x, 0.2, q0.z)]:
			st.set_color(Color(0.3, 0.2, 0.12)); st.set_normal(Vector3(v.x, 0, v.z).normalized()); st.add_vertex(v)
	return st.commit()

func _bounds(k: String) -> Array:
	var p := k.split("_"); var x := int(p[0]); var y := int(p[1])
	return [y * STEP, x * STEP, (y + 1) * STEP, (x + 1) * STEP]

func update(lon: float, lat: float, alt: float, terrain_mat: ShaderMaterial, night: float) -> void:
	cur = Vector2(lon, lat)
	var show := alt < MAX_ALT
	visible = show
	if not show: return
	mat.set_shader_parameter("center_ll", cur); mat.set_shader_parameter("night", night)
	mat.set_shader_parameter("apt", terrain_mat.get_shader_parameter("apt")); mat.set_shader_parameter("apt_n", terrain_mat.get_shader_parameter("apt_n"))
	var cx := int(floor(lon / STEP)); var cy := int(floor(lat / STEP))
	for dx in range(-1, 2):
		for dy in range(-1, 2):
			var k := "%d_%d" % [cx + dx, cy + dy]
			if not cells.has(k): _want(cx + dx, cy + dy, k)
	for k in cells.keys():
		var p: PackedStringArray = (k as String).split("_")
		if absi(int(p[0]) - cx) > 2 or absi(int(p[1]) - cy) > 2:
			if cells[k] != null: (cells[k] as Node3D).queue_free()
			cells.erase(k)
	for k in cells.keys():
		var nd = cells[k]
		if nd != null:
			var p2: PackedStringArray = (k as String).split("_")
			var o_lon := float(p2[0]) * STEP; var o_lat := float(p2[1]) * STEP
			(nd as Node3D).position = Vector3((o_lon - lon) * 111320.0 * cos(deg_to_rad(o_lat)), 0.0, (lat - o_lat) * 110574.0)

func _want(x: int, y: int, k: String) -> void:
	cells[k] = null
	var path := "user://geo/%d_%d.json" % [x, y]
	if FileAccess.file_exists(path):
		var f := FileAccess.open(path, FileAccess.READ)
		var data = JSON.parse_string(f.get_as_text())
		if data is Dictionary: build_q.append([k, data]); return
	if online: net_q.append(k)

func prefetch(lon: float, lat: float) -> void:
	var cx := int(floor(lon / STEP)); var cy := int(floor(lat / STEP))
	for dx in range(-2, 3):
		for dy in range(-2, 3):
			var k := "%d_%d" % [cx + dx, cy + dy]
			if not FileAccess.file_exists("user://geo/%d_%d.json" % [cx + dx, cy + dy]) and not net_q.has(k): net_q.append(k)

func _process(dt: float) -> void:
	if not build_q.is_empty():
		var job: Array = build_q.pop_front()
		if cells.has(job[0]): _build(job[0], job[1])
	net_t += dt
	if online and not net_busy and not net_q.is_empty() and net_t > 0.8:
		net_t = 0.0
		var bi := 0; var bd := 1e9
		for qi in range(net_q.size()):
			var pp: PackedStringArray = (net_q[qi] as String).split("_")
			var dd := Vector2((float(pp[0]) + 0.5) * STEP - cur.x, (float(pp[1]) + 0.5) * STEP - cur.y).length()
			if dd < bd: bd = dd; bi = qi
		var kk: String = net_q[bi]; net_q.remove_at(bi); _fetch(kk)

func _fetch(k: String) -> void:
	net_busy = true
	var b := _bounds(k)
	var bb := "(%f,%f,%f,%f)" % [b[0], b[1], b[2], b[3]]
	var q := "[out:json][timeout:25];(way[\"highway\"~\"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$\"]%s;way[\"natural\"=\"wood\"]%s;way[\"landuse\"=\"forest\"]%s;);out tags geom;" % [bb, bb, bb]
	var rq := HTTPRequest.new(); rq.timeout = 30.0; rq.body_size_limit = 24 * 1024 * 1024; add_child(rq)
	rq.request_completed.connect(func(res: int, code: int, _h: PackedStringArray, body: PackedByteArray):
		rq.queue_free(); net_busy = false
		if res != 0 or code != 200: return
		var js = JSON.parse_string(body.get_string_from_utf8())
		if not (js is Dictionary) or not js.has("elements"): return
		var roads := []; var forests := []
		for el in js.elements:
			if el.get("type", "") != "way" or not el.has("geometry"): continue
			var tg: Dictionary = el.get("tags", {})
			var pts := []
			for g in el.geometry: pts.append(snappedf(float(g.lat), 0.000001)); pts.append(snappedf(float(g.lon), 0.000001))
			if tg.has("highway"): roads.append([str(tg.highway), pts])
			else: forests.append(pts)
		var data := {"r": roads, "f": forests}
		var p := k.split("_")
		var f := FileAccess.open("user://geo/%d_%d.json" % [int(p[0]), int(p[1])], FileAccess.WRITE)
		if f: f.store_string(JSON.stringify(data))
		if cells.has(k): build_q.append([k, data]))
	if rq.request("https://overpass-api.de/api/interpreter?data=" + q.uri_encode()) != OK:
		rq.queue_free(); net_busy = false

const W := {"motorway": 14.0, "trunk": 12.0, "primary": 10.0, "secondary": 8.0, "tertiary": 7.0, "residential": 5.0, "unclassified": 5.0}

func _to_m(pts: Array, o_lat: float, o_lon: float) -> PackedVector2Array:
	var cl := cos(deg_to_rad(o_lat)); var poly := PackedVector2Array()
	for i in range(0, pts.size() - 1, 2): poly.append(Vector2((float(pts[i + 1]) - o_lon) * 111320.0 * cl, (o_lat - float(pts[i])) * 110574.0))
	return poly

func _build(k: String, data: Dictionary) -> void:
	var b := _bounds(k); var o_lat: float = b[0]; var o_lon: float = b[1]
	var root := Node3D.new(); add_child(root); cells[k] = root
	# дороги
	var v := PackedVector3Array(); var n := PackedVector3Array(); var c := PackedColorArray(); var idx := PackedInt32Array()
	for r in data.get("r", []):
		var poly := _to_m(r[1], o_lat, o_lon); var w: float = W.get(str(r[0]), 5.0) * 0.5
		var col := Color(0.2, 0.2, 0.22) if str(r[0]) != "motorway" else Color(0.26, 0.26, 0.28)
		for i in range(poly.size() - 1):
			var d := poly[i + 1] - poly[i]; var ln := d.length()
			if ln < 0.5: continue
			var nm := Vector2(-d.y, d.x) / ln * w; var base := v.size()
			for q in [poly[i] + nm, poly[i] - nm, poly[i + 1] - nm, poly[i + 1] + nm]:
				v.append(Vector3(q.x, 0.7, q.y)); n.append(Vector3.UP); c.append(col)
			idx.append_array(PackedInt32Array([base, base + 1, base + 2, base, base + 2, base + 3]))
	if not v.is_empty():
		var arr := []; arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = v; arr[Mesh.ARRAY_NORMAL] = n; arr[Mesh.ARRAY_COLOR] = c; arr[Mesh.ARRAY_INDEX] = idx
		var m := ArrayMesh.new(); m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		var mi := MeshInstance3D.new(); mi.mesh = m; mi.material_override = mat; mi.extra_cull_margin = 400.0; mi.custom_aabb = AABB(Vector3(-100, -200, -100), Vector3(3000, 600, 3000)); root.add_child(mi)
	# деревья
	if not trees_on: return
	var xf: Array = []
	var rng := RandomNumberGenerator.new(); rng.seed = hash(k)
	var polys: Array = []; var area := 0.0
	for f in data.get("f", []):
		var poly2 := _to_m(f, o_lat, o_lon)
		if poly2.size() < 4: continue
		polys.append(poly2)
		var a := 0.0
		for i in range(poly2.size()): a += poly2[i].x * poly2[(i + 1) % poly2.size()].y - poly2[(i + 1) % poly2.size()].x * poly2[i].y
		area += absf(a) * 0.5
	if polys.is_empty() or area < 1000.0: return
	var sp := maxf(11.0, sqrt(area / float(MAX_TREES)))
	for poly3 in polys:
		var mn := Vector2(1e9, 1e9); var mx := Vector2(-1e9, -1e9)
		for p in poly3: mn = mn.min(p); mx = mx.max(p)
		var x := mn.x
		while x < mx.x:
			var z := mn.y
			while z < mx.y:
				var pt := Vector2(x + rng.randf() * sp * 0.8, z + rng.randf() * sp * 0.8)
				if xf.size() < MAX_TREES and Geometry2D.is_point_in_polygon(pt, poly3):
					var h := 7.0 + rng.randf() * 9.0
					xf.append([Transform3D(Basis.from_scale(Vector3(h * 0.38, h, h * 0.38)), Vector3(pt.x, 0.0, pt.y)), Color.from_hsv(0.28 + rng.randf() * 0.08, 0.55, 0.35 + rng.randf() * 0.25)])
				z += sp
			x += sp
	if xf.is_empty(): return
	var mm := MultiMesh.new(); mm.transform_format = MultiMesh.TRANSFORM_3D; mm.use_colors = true; mm.mesh = tree_mesh; mm.instance_count = xf.size()
	for i in range(xf.size()): mm.set_instance_transform(i, xf[i][0]); mm.set_instance_color(i, xf[i][1])
	var mmi := MultiMeshInstance3D.new(); mmi.multimesh = mm; mmi.material_override = mat; mmi.extra_cull_margin = 400.0; mmi.custom_aabb = AABB(Vector3(-100, -200, -100), Vector3(3000, 600, 3000)); root.add_child(mmi)
