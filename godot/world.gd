extends Node3D
# 3D-мир: рельеф, небо, самолёт, аэродромы, камеры. Позиции берутся из состояния JS-симулятора.
const R_E := 6371000.0
var terrain: MeshInstance3D
var mat: ShaderMaterial
var plane: Node3D
var cam: Camera3D
var sun: DirectionalLight3D
var env: Environment
var sky_mat: ProceduralSkyMaterial
var airports := []   # {node, lat, lon, elev, len, id}
var brg := 0.0
var cam_mode := 0    # 0 снаружи, 1 кабина, 2 башня
var tower_ll := Vector2.ZERO
var tower_alt := 0.0
var tower_set := false
var cur_ll := Vector2.ZERO
var plane_id := ""
var orbit := 0.0
var tiles
var orbit_up := 0.28
var orbit_d := 1.5
var clouds := []        # материалы облачных слоёв
var cloud_nodes := []
var light_mats := []
var light_k := 0.3
var cities := []        # [lon, lat, pop]

func _ready():
	_build_env(0)
	_build_terrain()
	_build_clouds()
	set_tod(0)
	cam = Camera3D.new(); cam.far = 600000.0; cam.near = 1.0; cam.fov = 62
	add_child(cam)

func set_tod(tod: int):
	var tops := [Color(0.20, 0.42, 0.78), Color(0.16, 0.19, 0.44), Color(0.03, 0.06, 0.15)]
	var hors := [Color(0.68, 0.80, 0.92), Color(0.95, 0.60, 0.40), Color(0.12, 0.19, 0.36)]
	sky_mat.sky_top_color = tops[tod]; sky_mat.sky_horizon_color = hors[tod]; sky_mat.ground_horizon_color = hors[tod]
	sky_mat.ground_bottom_color = hors[tod] * 0.8
	env.fog_light_color = hors[tod]
	sun.light_energy = [1.25, 0.8, 0.22][tod]
	sun.light_color = [Color(1, 1, 0.95), Color(1.0, 0.65, 0.4), Color(0.4, 0.5, 0.9)][tod]
	sun.rotation_degrees = [Vector3(-48, 35, 0), Vector3(-9, 60, 0), Vector3(-60, 35, 0)][tod]
	env.ambient_light_energy = [0.9, 0.55, 0.8][tod]
	mat.set_shader_parameter("night", [0.0, 0.25, 1.0][tod])
	var lk: float = [1.0, 0.62, 0.10][tod]
	for c in clouds: c.set_shader_parameter("lightk", lk); c.set_shader_parameter("tint", [Color(1, 1, 1), Color(1.0, 0.8, 0.7), Color(0.6, 0.7, 1.0)][tod])
	light_k = [0.3, 0.7, 1.0][tod]
	for lm in light_mats: lm.albedo_color = Color(1, 1, 1, light_k)

func _build_env(tod: int):
	var we := WorldEnvironment.new(); env = Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new(); sky_mat = ProceduralSkyMaterial.new()
	sky.sky_material = sky_mat; env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.fog_enabled = true; env.fog_density = 0.000008; env.fog_sky_affect = 0.0
	we.environment = env; add_child(we)
	sun = DirectionalLight3D.new(); add_child(sun)

func _build_terrain():
	var rings := 330; var segs := 192
	var verts := PackedVector3Array(); var idx := PackedInt32Array()
	var r := 3.0
	verts.append(Vector3.ZERO)
	for i in range(rings + 1):
		for j in range(segs):
			var a := TAU * j / segs
			verts.append(Vector3(cos(a) * r, 0, sin(a) * r))
		r *= 1.0375
	for j in range(segs): idx.append_array([0, 1 + (j + 1) % segs, 1 + j])
	for i in range(rings):
		for j in range(segs):
			var a := 1 + i * segs + j; var b := 1 + i * segs + (j + 1) % segs
			var c := 1 + (i + 1) * segs + j; var d := 1 + (i + 1) * segs + (j + 1) % segs
			idx.append_array([a, c, b, b, c, d])
	var arr := []; arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts; arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new(); m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	m.custom_aabb = AABB(Vector3(-700000, -2000, -700000), Vector3(1400000, 20000, 1400000))
	terrain = MeshInstance3D.new(); terrain.mesh = m; terrain.extra_cull_margin = 16384.0
	mat = ShaderMaterial.new(); mat.shader = load("res://terrain.gdshader")
	mat.set_shader_parameter("dem", load("res://assets/dem.png"))
	mat.set_shader_parameter("bio", load("res://assets/bio.png"))
	mat.set_shader_parameter("coast", load("res://assets/coast.png"))
	terrain.material_override = mat; add_child(terrain)
	tiles = load("res://tiles.gd").new(); add_child(tiles); tiles.setup(mat)


# ---------- облака ----------
func _build_clouds():
	var pm := PlaneMesh.new(); pm.size = Vector2(320000, 320000); pm.subdivide_width = 64; pm.subdivide_depth = 64
	var defs := [[2300.0, 0.50, 5200.0], [7200.0, 0.34, 9000.0]]
	for d in defs:
		var m := ShaderMaterial.new(); m.shader = load("res://cloud.gdshader")
		m.set_shader_parameter("cover", d[1]); m.set_shader_parameter("scale", d[2])
		var mi := MeshInstance3D.new(); mi.mesh = pm; mi.material_override = m
		mi.set_meta("alt", d[0]); mi.custom_aabb = AABB(Vector3(-200000, -5000, -200000), Vector3(400000, 10000, 400000))
		mi.extra_cull_margin = 100000.0
		add_child(mi); clouds.append(m); cloud_nodes.append(mi)

func set_cities(arr: Array):
	cities = arr

func set_cloud_cover(c: float):
	if clouds.size() > 0: clouds[0].set_shader_parameter("cover", c)
	if clouds.size() > 1: clouds[1].set_shader_parameter("cover", c * 0.7)

# ---------- самолёт ----------
func _mk(mesh: Mesh, col: Color, pos: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new(); mi.mesh = mesh
	var sm := StandardMaterial3D.new(); sm.albedo_color = col; sm.roughness = 0.5; mi.material_override = sm
	mi.position = pos; mi.rotation_degrees = rot; return mi

# модели самолётов: amvlab/aircraft-models (CC BY 4.0), см. assets/planes/LICENSE-CC-BY-4.0.txt
const MODELS := {"ssj": "A320", "crj2": "A320", "e190": "A320", "e175": "A320", "mc21": "A320", "t204": "B737", "a320": "A320", "b738": "B737",
	"a223": "A320", "a321": "A320", "b763": "B787", "a333": "B787", "b789": "B787", "a359": "A350", "b77w": "A350"}
const MODEL_LEN := {"A320": 37.7, "B737": 37.9, "B787": 56.6, "A350": 67.4}
const MODEL_YAW := 90.0   # нос модели направлен по +X

func build_plane(pid: String, color: Color):
	if plane: plane.queue_free()
	plane_id = pid
	plane = Node3D.new(); add_child(plane)
	var seats := 150.0
	for p in Sim.data.planes:
		if p.id == pid: seats = float(p.get("seats", 150))
	var m: String = MODELS.get(pid, "A320")
	var inst: Node3D = load("res://assets/planes/%s_nologo.glb" % m).instantiate()
	var L := clampf(28.0 + seats * 0.075, 26.0, 62.0)
	if m == "B787" or m == "A350": L = maxf(L, MODEL_LEN[m] * 0.95)
	var k: float = L / float(MODEL_LEN[m])
	inst.scale = Vector3.ONE * k; inst.rotation_degrees = Vector3(0, MODEL_YAW, 0)
	plane.add_child(inst)
	_build_boarding(L)

# ---------- посадка пассажиров: люди, трап, заправщик, багаж ----------
var board: Node3D
var boarding_on := false
var walkers := []
var board_L := 37.0
func _build_boarding(L: float):
	board_L = L
	board = Node3D.new(); plane.add_child(board)
	var zd := -L * 0.27; var gy := -2.9    # уровень земли относительно центра самолёта
	var cap := CapsuleMesh.new(); cap.radius = 0.24; cap.height = 1.7
	walkers.clear()
	for i in range(18):
		var mi := _mk(cap, Color.from_hsv(randf(), 0.5, 0.75) if i > 2 else Color(0.1, 0.12, 0.25), Vector3(0, gy + 0.85, zd))
		board.add_child(mi); walkers.append([mi, float(i) / 18.0, randf_range(-1.2, 1.2)])
	var st := BoxMesh.new(); st.size = Vector3(2.6, 3.0, 1.6)
	board.add_child(_mk(st, Color(0.75, 0.75, 0.8), Vector3(-L * 0.06 - 2.6, gy + 1.5, zd)))
	var term := BoxMesh.new(); term.size = Vector3(8, 9, L * 0.9)
	board.add_child(_mk(term, Color(0.6, 0.68, 0.78), Vector3(-34, gy + 4.5, 0)))
	var truck := BoxMesh.new(); truck.size = Vector3(2.6, 2.4, 7)
	board.add_child(_mk(truck, Color(0.9, 0.7, 0.1), Vector3(L * 0.34, gy + 1.2, L * 0.02)))
	var cart := BoxMesh.new(); cart.size = Vector3(1.8, 1.3, 3.2)
	var cm := _mk(cart, Color(0.35, 0.4, 0.45), Vector3(-9, gy + 0.65, L * 0.12)); cm.name = "cart"; board.add_child(cm)

func board_tick(on: bool, t: float):
	if board == null: return
	boarding_on = on
	board.visible = on
	if not on: return
	var zd := -board_L * 0.27; var gy := -2.9
	for w in walkers:
		var u := fposmod(t * 0.07 + float(w[1]), 1.0)
		var x := lerpf(-27.0, -board_L * 0.06 - 2.6, u)
		w[0].position = Vector3(x, gy + 0.85 + absf(sin(t * 7.0 + float(w[1]) * 20.0)) * 0.06, zd + float(w[2]) * (1.0 - u))
		w[0].visible = u < 0.97
	var c := board.get_node_or_null("cart")
	if c: c.position.z = board_L * 0.12 + sin(t * 0.4) * 5.0

# ---------- аэродромы ----------
func _quad(st: SurfaceTool, x0: float, x1: float, z0: float, z1: float, y: float, col: Color):
	st.set_color(col)
	for p in [Vector3(x0, y, z0), Vector3(x1, y, z0), Vector3(x1, y, z1), Vector3(x0, y, z0), Vector3(x1, y, z1), Vector3(x0, y, z1)]:
		st.add_vertex(p)

func _airport_mesh(len: float) -> ArrayMesh:
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var asph := Color(0.17, 0.18, 0.20); var white := Color(0.93, 0.93, 0.93)
	_quad(st, -60, len + 60, -22, 22, 0.35, asph)                       # полоса
	_quad(st, 0, len, -22, -21.2, 0.40, white); _quad(st, 0, len, 21.2, 22, 0.40, white)
	var x := 80.0
	while x < len - 120.0:
		_quad(st, x, x + 30, -0.5, 0.5, 0.40, white); x += 50.0
	for k in range(-4, 5):
		if k == 0: continue
		_quad(st, 10, 55, k * 4.0 - 1.0, k * 4.0 + 1.0, 0.40, white); _quad(st, len - 55, len - 10, k * 4.0 - 1.0, k * 4.0 + 1.0, 0.40, white)
	var tz := 106.0; var gz := 205.0
	_quad(st, -40, len + 40, tz - 11, tz + 11, 0.30, asph.lightened(0.04))   # рулёжная
	for f in [0.06, 0.5, 0.93]:
		_quad(st, len * f - 0.0, len * f + 24, 22, tz, 0.30, asph.lightened(0.04))
	_quad(st, len * 0.28, len * 0.62, tz + 11, 235, 0.30, asph.lightened(0.10))  # перрон
	_quad(st, len * 0.45 - 4, len * 0.45 + 4, tz + 11, gz, 0.36, Color(0.9, 0.8, 0.2))
	var m := st.commit()
	var mt := StandardMaterial3D.new(); mt.vertex_color_use_as_albedo = true; mt.roughness = 1.0; mt.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.surface_set_material(0, mt)
	# терминал
	var tb := BoxMesh.new(); tb.size = Vector3(len * 0.16, 14, 40)
	var tmi := MeshInstance3D.new(); tmi.mesh = tb
	return m

func _light_node(len: float) -> Node3D:
	var pts := []   # [pos, color]
	var W := Color(1, 0.95, 0.85); var G := Color(0.2, 1, 0.3); var Rr := Color(1, 0.2, 0.15); var B := Color(0.3, 0.5, 1); var A := Color(1, 0.75, 0.2)
	var x := 0.0
	while x <= len:
		var c := A if x > len - 600.0 else W
		pts.append([Vector3(x, 0.6, -23.0), c]); pts.append([Vector3(x, 0.6, 23.0), c]); x += 60.0
	for k in range(-5, 6):
		pts.append([Vector3(-1.5, 0.6, k * 4.2), G]); pts.append([Vector3(len + 1.5, 0.6, k * 4.2), Rr])
	for k in range(1, 11):
		var ax := -30.0 * k
		pts.append([Vector3(ax, 1.0, 0), W])
		if k % 2 == 0 or k <= 3:
			for q in [-2, -1, 1, 2]: pts.append([Vector3(ax, 1.0, q * 3.0), W])
	for k in range(0, 6): pts.append([Vector3(len * 0.5 + k * 30.0 - 90.0, 0.6, 0.0), W])   # осевые
	for k in range(4):
		pts.append([Vector3(300.0, 0.8, -32.0 - k * 5.0), Rr if k < 2 else W])   # PAPI
		pts.append([Vector3(len - 300.0, 0.8, 32.0 + k * 5.0), Rr if k < 2 else W])
	var tx := -40.0
	while tx < len + 40.0:
		pts.append([Vector3(tx, 0.6, 106.0 - 11.0), B]); pts.append([Vector3(tx, 0.6, 106.0 + 11.0), B]); tx += 45.0
	for k in range(8): pts.append([Vector3(len * 0.28 + k * len * 0.045, 12.0, 235.0), W])
	var qm := QuadMesh.new(); qm.size = Vector2(0.013, 0.013)
	var mm := MultiMesh.new(); mm.transform_format = MultiMesh.TRANSFORM_3D; mm.use_colors = true
	mm.mesh = qm; mm.instance_count = pts.size()
	for i in range(pts.size()):
		mm.set_instance_transform(i, Transform3D(Basis(), pts[i][0])); mm.set_instance_color(i, pts[i][1])
	var mt := StandardMaterial3D.new()
	mt.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; mt.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED; mt.billboard_keep_scale = true
	mt.fixed_size = true; mt.vertex_color_use_as_albedo = true; mt.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mt.albedo_texture = _glow_tex(); mt.albedo_color = Color(1, 1, 1, light_k); mt.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mt.no_depth_test = false
	light_mats.append(mt)
	var mi := MultiMeshInstance3D.new(); mi.multimesh = mm; mi.material_override = mt
	mi.custom_aabb = AABB(Vector3(-400, -5, -300), Vector3(len + 800, 60, 600)); mi.extra_cull_margin = 200.0
	return mi

var _gt: GradientTexture2D
func _glow_tex() -> Texture2D:
	if _gt == null:
		_gt = GradientTexture2D.new(); _gt.fill = GradientTexture2D.FILL_RADIAL; _gt.fill_from = Vector2(0.5, 0.5); _gt.fill_to = Vector2(1.0, 0.5)
		_gt.width = 64; _gt.height = 64
		var g := Gradient.new(); g.set_color(0, Color(1, 1, 1, 1)); g.set_color(1, Color(1, 1, 1, 0)); g.add_point(0.35, Color(1, 1, 1, 0.8))
		_gt.gradient = g
	return _gt

func set_airports(aps: Array, route_brg: float):
	for a in airports: a.node.queue_free()
	light_mats.clear()
	airports.clear(); brg = route_brg
	for a in aps:
		var n := Node3D.new(); add_child(n)
		var mi := MeshInstance3D.new(); mi.mesh = _airport_mesh(float(a.len)); n.add_child(mi)
		var tb := BoxMesh.new(); tb.size = Vector3(float(a.len) * 0.16, 16, 36)
		var tm := MeshInstance3D.new(); tm.mesh = tb
		var sm := StandardMaterial3D.new(); sm.albedo_color = Color(0.72, 0.76, 0.84); tm.material_override = sm
		tm.position = Vector3(float(a.len) * 0.45, 8, 255); n.add_child(tm)
		n.add_child(_light_node(float(a.len)))
		# башня и ангар
		var tw := BoxMesh.new(); tw.size = Vector3(7, 36, 7)
		var twm := MeshInstance3D.new(); twm.mesh = tw; twm.material_override = sm
		twm.position = Vector3(float(a.len) * 0.55, 18, 262); n.add_child(twm)
		var cab := BoxMesh.new(); cab.size = Vector3(12, 6, 12)
		var cm := _mk(cab, Color(0.25, 0.4, 0.5), Vector3(float(a.len) * 0.55, 39, 262)); n.add_child(cm)
		airports.append({"node": n, "lat": a.lat, "lon": a.lon, "elev": a.elev, "len": a.len, "id": a.id})
		n.rotation.y = deg_to_rad(90.0 - route_brg)

func _local(lat: float, lon: float, clat: float, clon: float) -> Vector2:
	return Vector2((lon - clon) * 111320.0 * cos(deg_to_rad(lat)), (clat - lat) * 110574.0)

# ---------- кадр ----------
func update_state(s: Dictionary, delta: float):
	var lat: float = s.lat; var lon: float = s.lon
	cur_ll = Vector2(lon, lat)
	mat.set_shader_parameter("center_ll", cur_ll)
	tiles.update_pos(lon, lat)
	var alt: float = s.alt
	plane.position = Vector3(0, alt + 3.0, 0)
	var hdg: float = s.hdg
	plane.rotation_order = EULER_ORDER_YXZ
	plane.rotation = Vector3(float(s.theta), -deg_to_rad(hdg), -float(s.phi))
	plane.visible = cam_mode != 1
	# аэродромы: ближайшие 8 -> шейдер, узлы -> позиции
	var near := []
	for a in airports:
		var l := _local(a.lat, a.lon, lat, lon)
		var c := l + Vector2.RIGHT.rotated(deg_to_rad(90.0 - brg)) * (float(a.len) * 0.5)   # центр полосы
		# направление полосы в мировых (x=восток, z=юг): (sin brg, -cos brg)
		var dirv := Vector2(sin(deg_to_rad(brg)), -cos(deg_to_rad(brg)))
		c = l + dirv * (float(a.len) * 0.5)
		var d := c.length()
		var y := float(a.elev) - d * d / (2.0 * R_E)
		a.node.position = Vector3(l.x, y, l.y)
		a.node.visible = d < 120000.0
		near.append([d, Vector4(c.x, c.y, float(a.elev), float(a.len))])
	near.sort_custom(func(p, q): return p[0] < q[0])
	var arr := PackedVector4Array(); arr.resize(8)
	var n := mini(8, near.size())
	for i in range(n): arr[i] = near[i][1]
	mat.set_shader_parameter("aps", arr); mat.set_shader_parameter("ap_n", n)
	# выравнивание рельефа под ближайшими аэродромами (до 4), чтобы полоса не уходила под землю
	var ln := []
	for a in airports: ln.append([_local(a.lat, a.lon, lat, lon).length(), a])
	ln.sort_custom(func(p, q): return p[0] < q[0])
	var apt := PackedVector4Array(); apt.resize(4)
	var m := mini(4, ln.size())
	for i in range(m):
		var a = ln[i][1]
		apt[i] = Vector4(float(a.lon), float(a.lat), float(a.elev), 0.0)
	mat.set_shader_parameter("apt", apt); mat.set_shader_parameter("apt_n", m)
	# города: 8 ближайших (по краю) -> шейдер
	var cl := []
	for c in cities:
		var cc := _local(c[1], c[0], lat, lon)
		var rr := 1100.0 + 8200.0 * sqrt(float(c[2]) / 1.0e6)
		cl.append([cc.length() - rr, Vector4(c[0], c[1], rr, c[2])])
	cl.sort_custom(func(p, q): return p[0] < q[0])
	var carr := PackedVector4Array(); carr.resize(8)
	var cn := mini(8, cl.size())
	for i in range(cn): carr[i] = cl[i][1]
	mat.set_shader_parameter("cty", carr); mat.set_shader_parameter("cty_n", cn)
	# облачные слои
	var gx := lon * 111320.0 * cos(deg_to_rad(lat)); var gz := -lat * 110574.0
	for i in range(cloud_nodes.size()):
		var cn_: MeshInstance3D = cloud_nodes[i]
		cn_.position = Vector3(0, float(cn_.get_meta("alt")), 0)
		clouds[i].set_shader_parameter("ground_off", Vector2(gx, gz))
	_camera(s, hdg, alt)

func _camera(s: Dictionary, hdg: float, alt: float):
	var back := Vector3(0, 0, 1).rotated(Vector3.UP, -deg_to_rad(hdg))
	var pp := plane.position
	if cam_mode == 0:
		var span := 38.0
		cam.position = pp + back.rotated(Vector3.UP, deg_to_rad(orbit - (50.0 if boarding_on else 0.0))) * (span * orbit_d * (0.8 if boarding_on else 1.0)) + Vector3(0, span * orbit_up + 2.0, 0)
		cam.look_at(pp + Vector3(0, 1.0, 0), Vector3.UP)
	elif cam_mode == 1:
		var fwd := -back
		cam.position = pp + fwd * 14.0 + Vector3(0, 1.5, 0)
		cam.rotation_order = EULER_ORDER_YXZ
		cam.rotation = Vector3(float(s.theta), -deg_to_rad(hdg), -float(s.phi) * 0.9)
	else:
		var tl := _local(tower_ll.y, tower_ll.x, cur_ll.y, cur_ll.x)
		if not tower_set or tl.length() > 4500.0 or tl.length() < 150.0:
			tower_set = true
			var fwd := -back
			var side := Vector3(back.z, 0, -back.x)
			var off := fwd * (float(s.v) * 9.0 + 600.0) + side * 260.0   # точка впереди по курсу сбоку
			tower_ll = Vector2(cur_ll.x + off.x / (111320.0 * cos(deg_to_rad(cur_ll.y))), cur_ll.y - off.z / 110574.0)
			tower_alt = maxf(alt - 40.0, float(s.ref) + 12.0)
			tl = _local(tower_ll.y, tower_ll.x, cur_ll.y, cur_ll.x)
		cam.position = Vector3(tl.x, tower_alt, tl.y)
		cam.look_at(pp, Vector3.UP)

func cycle_cam():
	cam_mode = (cam_mode + 1) % 3
	tower_set = false
