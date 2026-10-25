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

func _ready():
	_build_env(0)
	_build_terrain()
	cam = Camera3D.new(); cam.far = 600000.0; cam.near = 1.0; cam.fov = 62
	add_child(cam)

func set_tod(tod: int):
	var tops := [Color(0.20, 0.42, 0.78), Color(0.16, 0.19, 0.44), Color(0.01, 0.02, 0.06)]
	var hors := [Color(0.68, 0.80, 0.92), Color(0.95, 0.60, 0.40), Color(0.10, 0.16, 0.30)]
	sky_mat.sky_top_color = tops[tod]; sky_mat.sky_horizon_color = hors[tod]; sky_mat.ground_horizon_color = hors[tod]
	sky_mat.ground_bottom_color = hors[tod] * 0.8
	env.fog_light_color = hors[tod]
	sun.light_energy = [1.25, 0.8, 0.06][tod]
	sun.light_color = [Color(1, 1, 0.95), Color(1.0, 0.65, 0.4), Color(0.4, 0.5, 0.9)][tod]
	sun.rotation_degrees = [Vector3(-48, 35, 0), Vector3(-9, 60, 0), Vector3(-60, 35, 0)][tod]
	env.ambient_light_energy = [0.9, 0.55, 0.35][tod]

func _build_env(tod: int):
	var we := WorldEnvironment.new(); env = Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new(); sky_mat = ProceduralSkyMaterial.new()
	sky.sky_material = sky_mat; env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.fog_enabled = true; env.fog_density = 0.000008; env.fog_sky_affect = 0.0
	we.environment = env; add_child(we)
	sun = DirectionalLight3D.new(); add_child(sun)
	set_tod(tod)

func _build_terrain():
	var rings := 330; var segs := 256
	var verts := PackedVector3Array(); var idx := PackedInt32Array()
	var r := 30.0
	for i in range(rings + 1):
		for j in range(segs):
			var a := TAU * j / segs
			verts.append(Vector3(cos(a) * r, 0, sin(a) * r))
		r *= 1.0306
	for i in range(rings):
		for j in range(segs):
			var a := i * segs + j; var b := i * segs + (j + 1) % segs
			var c := (i + 1) * segs + j; var d := (i + 1) * segs + (j + 1) % segs
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

# ---------- самолёт ----------
func _mk(mesh: Mesh, col: Color, pos: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new(); mi.mesh = mesh
	var sm := StandardMaterial3D.new(); sm.albedo_color = col; sm.roughness = 0.5; mi.material_override = sm
	mi.position = pos; mi.rotation_degrees = rot; return mi

func build_plane(pid: String, color: Color):
	if plane: plane.queue_free()
	plane_id = pid
	plane = Node3D.new(); add_child(plane)
	var info := {}
	for p in Sim.data.planes:
		if p.id == pid: info = p
	var seats: float = info.get("seats", 150)
	var L := clampf(28.0 + seats * 0.075, 26.0, 62.0)   # длина фюзеляжа
	var R := clampf(1.5 + seats * 0.0025, 1.6, 3.1)
	var span := L * 0.92
	var body := Color(0.96, 0.96, 0.98)
	var fus := CapsuleMesh.new(); fus.radius = R; fus.height = L
	plane.add_child(_mk(fus, body, Vector3.ZERO, Vector3(90, 0, 0)))
	var stripe := CylinderMesh.new(); stripe.top_radius = R * 1.01; stripe.bottom_radius = R * 1.01; stripe.height = L * 0.5
	plane.add_child(_mk(stripe, color, Vector3(0, -R * 0.35, 0), Vector3(90, 0, 0)))
	var wing := BoxMesh.new(); wing.size = Vector3(span, 0.4, L * 0.15)
	plane.add_child(_mk(wing, Color(0.86, 0.88, 0.92), Vector3(0, -R * 0.35, L * 0.06)))
	var tail := BoxMesh.new(); tail.size = Vector3(span * 0.34, 0.3, L * 0.09)
	plane.add_child(_mk(tail, Color(0.86, 0.88, 0.92), Vector3(0, R * 0.3, L * 0.43)))
	var fin := BoxMesh.new(); fin.size = Vector3(0.35, R * 2.4, L * 0.12)
	plane.add_child(_mk(fin, color, Vector3(0, R * 1.9, L * 0.42)))
	var eng := CylinderMesh.new(); eng.top_radius = R * 0.5; eng.bottom_radius = R * 0.5; eng.height = L * 0.11
	for s in [-1, 1]: plane.add_child(_mk(eng, Color(0.7, 0.72, 0.76), Vector3(s * span * 0.2, -R * 0.95, -L * 0.02), Vector3(90, 0, 0)))
	# шасси
	var leg := CylinderMesh.new(); leg.top_radius = 0.18; leg.bottom_radius = 0.18; leg.height = 2.6
	var wh := CylinderMesh.new(); wh.top_radius = 0.55; wh.bottom_radius = 0.55; wh.height = 0.5
	var gear := Node3D.new(); gear.name = "gear"; plane.add_child(gear)
	for g in [[0.0, -L * 0.34], [-span * 0.09, L * 0.04], [span * 0.09, L * 0.04]]:
		gear.add_child(_mk(leg, Color(0.3, 0.3, 0.33), Vector3(g[0], -R - 0.6, g[1])))
		gear.add_child(_mk(wh, Color(0.08, 0.08, 0.09), Vector3(g[0], -R - 1.9, g[1]), Vector3(0, 0, 90)))

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

func set_airports(aps: Array, route_brg: float):
	for a in airports: a.node.queue_free()
	airports.clear(); brg = route_brg
	for a in aps:
		var n := Node3D.new(); add_child(n)
		var mi := MeshInstance3D.new(); mi.mesh = _airport_mesh(float(a.len)); n.add_child(mi)
		var tb := BoxMesh.new(); tb.size = Vector3(float(a.len) * 0.16, 16, 36)
		var tm := MeshInstance3D.new(); tm.mesh = tb
		var sm := StandardMaterial3D.new(); sm.albedo_color = Color(0.72, 0.76, 0.84); tm.material_override = sm
		tm.position = Vector3(float(a.len) * 0.45, 8, 255); n.add_child(tm)
		airports.append({"node": n, "lat": a.lat, "lon": a.lon, "elev": a.elev, "len": a.len, "id": a.id})
		n.rotation.y = deg_to_rad(90.0 - route_brg)

func _local(lat: float, lon: float, clat: float, clon: float) -> Vector2:
	return Vector2((lon - clon) * 111320.0 * cos(deg_to_rad(lat)), (clat - lat) * 110574.0)

# ---------- кадр ----------
func update_state(s: Dictionary, delta: float):
	var lat: float = s.lat; var lon: float = s.lon
	cur_ll = Vector2(lon, lat)
	mat.set_shader_parameter("center_ll", cur_ll)
	var alt: float = s.alt
	plane.position = Vector3(0, alt + 3.0, 0)
	var hdg: float = s.hdg
	plane.rotation_order = EULER_ORDER_YXZ
	plane.rotation = Vector3(float(s.theta), -deg_to_rad(hdg), -float(s.phi))
	var g := plane.get_node_or_null("gear"); if g: g.visible = float(s.gear) > 0.5
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
	_camera(s, hdg, alt)

func _camera(s: Dictionary, hdg: float, alt: float):
	var back := Vector3(0, 0, 1).rotated(Vector3.UP, -deg_to_rad(hdg))
	var pp := plane.position
	if cam_mode == 0:
		var span := 38.0
		cam.position = pp + back * (span * 1.5) + Vector3(0, span * 0.28 + 2.0, 0)
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
