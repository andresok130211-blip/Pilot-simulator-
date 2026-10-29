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
	_build_cockpit()

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

func mip_tex(path: String) -> ImageTexture:
	var im: Image = (load(path) as Texture2D).get_image(); im.generate_mipmaps(); return ImageTexture.create_from_image(im)

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
	mat.set_shader_parameter("det_g", mip_tex("res://assets/tex/det_g.png")); mat.set_shader_parameter("det_r", mip_tex("res://assets/tex/det_r.png"))
	mat.set_shader_parameter("dem", load("res://assets/dem.png"))
	mat.set_shader_parameter("bio", load("res://assets/bio.png"))
	mat.set_shader_parameter("coast", load("res://assets/coast.png"))
	terrain.material_override = mat; add_child(terrain)
	tiles = load("res://tiles.gd").new(); add_child(tiles); tiles.setup(mat)


# ---------- облака ----------
func set_quality(q: int) -> void:
	for d in get_tree().get_nodes_in_group("det"): (d as Node3D).visible = q >= 1
	for i in range(cloud_nodes.size()): cloud_nodes[i].visible = q >= 1 or i == 0
	get_viewport().msaa_3d = Viewport.MSAA_2X if q >= 2 else Viewport.MSAA_DISABLED
	Engine.max_fps = 30 if q == 0 else 60

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
	_build_gear(L)
	_build_lights(L)
	_build_boarding(L)

# ---------- 3D-кабина: каркас остекления, козырёк, панель с приборами (SubViewport), рычаги, штурвалы ----------
var ck: Node3D
var ck_vp: SubViewport
var ck_instr: Control
var ck_lev: Array = []
var ck_yoke: Array = []
func _build_cockpit() -> void:
	ck = Node3D.new(); ck.scale = Vector3.ONE * 3.5; ck.position = Vector3(0, -0.35, 0); ck.visible = false; cam.add_child(ck)
	ck_vp = SubViewport.new(); ck_vp.size = Vector2i(1280, 190); ck_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS; add_child(ck_vp)
	ck_instr = Control.new(); ck_instr.set_script(load("res://instr.gd")); ck_instr.set("panel", true); ck_vp.add_child(ck_instr)
	var dk := Color(0.07, 0.075, 0.085); var md := Color(0.14, 0.15, 0.17)
	var pm := MeshInstance3D.new(); var qm := QuadMesh.new(); qm.size = Vector2(2.28, 0.34); pm.mesh = qm
	var mt := StandardMaterial3D.new(); mt.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; mt.albedo_texture = ck_vp.get_texture(); pm.material_override = mt
	pm.position = Vector3(0, -0.12, -0.95); ck.add_child(pm)
	_box(ck, Vector3(2.9, 0.06, 0.4), dk, Vector3(0, 0.085, -0.8))            # козырёк
	_box(ck, Vector3(2.9, 0.5, 0.06), md, Vector3(0, -0.58, -0.96))         # низ панели
	_box(ck, Vector3(2.9, 0.18, 0.3), dk, Vector3(0, 0.62, -0.8))           # верхняя рама с тумблерами
	for i in range(34):
		var on := (i * 7) % 5 == 0
		var sw := _box(ck, Vector3(0.035, 0.05, 0.03), Color(0.95, 0.6, 0.15) if on else Color(0.35, 0.37, 0.4), Vector3(-1.3 + i * 0.077, 0.52, -0.64))
		if on: (sw.material_override as StandardMaterial3D).emission_enabled = true; (sw.material_override as StandardMaterial3D).emission = Color(0.9, 0.55, 0.1)
	_box(ck, Vector3(0.06, 0.62, 0.05), dk, Vector3(0, 0.32, -0.95))        # центральная стойка
	for sx in [-1.0, 1.0]:
		var pil := _box(ck, Vector3(0.16, 0.7, 0.08), dk, Vector3(sx * 1.0, 0.33, -0.95)); pil.rotation_degrees = Vector3(0, 0, -sx * 12.0)
		var wall := _box(ck, Vector3(0.5, 1.4, 0.2), md, Vector3(sx * 1.45, -0.1, -0.8)); wall.rotation_degrees = Vector3(0, sx * 30.0, 0)
	_box(ck, Vector3(0.34, 0.24, 0.5), dk, Vector3(0.0, -0.32, -0.5))        # пьедестал
	ck_lev.clear()
	for i in range(2):
		var piv := Node3D.new(); piv.position = Vector3(-0.05 + i * 0.1, -0.3, -0.42); ck.add_child(piv)
		_box(piv, Vector3(0.02, 0.1, 0.02), Color(0.6, 0.62, 0.66), Vector3(0, 0.05, 0))
		_box(piv, Vector3(0.035, 0.035, 0.035), Color(0.12, 0.12, 0.14), Vector3(0, 0.115, 0))
		ck_lev.append(piv)
	ck_yoke.clear()
	for sx in [-0.62, 0.62]:
		var y := Node3D.new(); y.position = Vector3(sx, -0.36, -0.66); ck.add_child(y)
		var tm := TorusMesh.new(); tm.inner_radius = 0.085; tm.outer_radius = 0.115
		var ti := MeshInstance3D.new(); ti.mesh = tm; ti.material_override = _m(Color(0.08, 0.08, 0.09)); ti.rotation_degrees = Vector3(90, 0, 0); y.add_child(ti)
		_box(y, Vector3(0.03, 0.03, 0.2), dk, Vector3(0, 0, -0.1))
		ck_yoke.append(y)

func cockpit_tick(s: Dictionary, thr: Array, roll: float, stick: float) -> void:
	ck.visible = cam_mode == 1
	if not ck.visible: return
	ck_instr.call("put", s, 2, true)
	for i in range(2): (ck_lev[i] as Node3D).rotation.x = -(float(thr[i]) - 0.25) * 1.0
	for y in ck_yoke:
		(y as Node3D).rotation.z = -roll * 0.9; (y as Node3D).position.z = -0.66 + stick * 0.05

# ---------- шасси и огни (в моделях их нет) ----------
var gear: Node3D
var nav_blink: Array = []
func _wheel(parent: Node3D, r: float, wd: float, pos: Vector3) -> void:
	_cyl(parent, r, wd, Color(0.07, 0.07, 0.08), pos, Vector3(0, 0, 90))
	_cyl(parent, r * 0.55, wd + 0.02, Color(0.6, 0.62, 0.66), pos, Vector3(0, 0, 90))

func _leg(parent: Node3D, x: float, z: float, top: float, bot: float, twin: float, r: float) -> void:
	var leg := Node3D.new(); leg.position = Vector3(x, 0, z); parent.add_child(leg)
	_cyl(leg, 0.13, top - bot, Color(0.75, 0.77, 0.8), Vector3(0, (top + bot) * 0.5 - top, 0))
	_cyl(leg, 0.07, (top - bot) * 0.5, Color(0.9, 0.9, 0.92), Vector3(0.0, -(top - bot) * 0.25, 0.22))   # шлиц-шарнир
	_box(leg, Vector3(0.1, 0.1, twin * 2.0 + 0.2), Color(0.3, 0.3, 0.33), Vector3(0, bot - top + r, 0))
	for sz in [-1.0, 1.0]:
		_wheel(leg, r, 0.34, Vector3(0, bot - top + r, sz * twin))

func _build_gear(L: float) -> void:
	gear = Node3D.new(); gear.position = Vector3(0, -1.1, 0); plane.add_child(gear)
	var top := -1.1; var bot := -2.3
	var gx := L * 0.068
	_leg(gear, 0.0, -L * 0.36, top, bot, 0.2, 0.42)
	for sx in [-1.0, 1.0]:
		_leg(gear, sx * gx, L * 0.04, top, bot, 0.45, 0.55)
		_box(gear, Vector3(0.05, 1.3, 1.6), Color(0.85, 0.86, 0.88), Vector3(sx * (gx - 0.55), -0.1, L * 0.04))   # створка

func _blink_light(pos: Vector3, col: Color, sz: float, strobe: bool) -> void:
	var sm := SphereMesh.new(); sm.radius = sz; sm.height = sz * 2.0
	var mt := StandardMaterial3D.new(); mt.albedo_color = col; mt.emission_enabled = true; mt.emission = col; mt.emission_energy_multiplier = 3.0; mt.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var mi := MeshInstance3D.new(); mi.mesh = sm; mi.material_override = mt; mi.position = pos; plane.add_child(mi)
	var g := Sprite3D.new(); g.texture = _glow_tex(); g.billboard = BaseMaterial3D.BILLBOARD_ENABLED; g.modulate = Color(col.r, col.g, col.b, 0.8); g.pixel_size = sz * 6.0 / 128.0
	g.shaded = false; g.no_depth_test = false; g.transparent = true; mi.add_child(g)
	if strobe: nav_blink.append(mi)

func _build_lights(L: float) -> void:
	nav_blink.clear()
	var ws := L * 0.44
	_blink_light(Vector3(-ws, 0.1, L * 0.11), Color(1, 0.1, 0.1), 0.12, false)
	_blink_light(Vector3(ws, 0.1, L * 0.11), Color(0.1, 1, 0.2), 0.12, false)
	_blink_light(Vector3(0, 2.6, L * 0.5), Color(1, 1, 1), 0.1, false)
	_blink_light(Vector3(-ws, 0.15, L * 0.115), Color(1, 1, 1), 0.1, true)
	_blink_light(Vector3(ws, 0.15, L * 0.115), Color(1, 1, 1), 0.1, true)
	_blink_light(Vector3(0, 2.15, -L * 0.1), Color(1, 0.15, 0.1), 0.14, true)   # маяк
	_blink_light(Vector3(0, -1.9, -L * 0.34), Color(1, 1, 0.9), 0.14, false)    # фара

func _blink_tick() -> void:
	var t := Time.get_ticks_msec() % 1200
	for i in range(nav_blink.size()):
		var on := (t < 90) or (t > 180 and t < 270) if i < 2 else t < 500
		(nav_blink[i] as Node3D).visible = on

# ---------- подготовка к вылету: телетрап, посадка, багаж, заправка, буксировщик ----------
const BOARD_T := 14.0
var board: Node3D
var boarding_on := false
var bd := {}
var board_L := 37.0
var _pm := {}
func _m(c: Color, alpha := 1.0) -> StandardMaterial3D:
	var k := "%s%s" % [c, alpha]
	if not _pm.has(k):
		var sm := StandardMaterial3D.new(); sm.albedo_color = Color(c.r, c.g, c.b, alpha); sm.roughness = 0.7
		if alpha < 1.0: sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_pm[k] = sm
	return _pm[k]

func _box(parent: Node3D, size: Vector3, col: Color, pos: Vector3, alpha := 1.0) -> MeshInstance3D:
	var bm := BoxMesh.new(); bm.size = size
	var mi := MeshInstance3D.new(); mi.mesh = bm; mi.material_override = _m(col, alpha); mi.position = pos; parent.add_child(mi); return mi

func _cyl(parent: Node3D, r: float, h: float, col: Color, pos: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var cm := CylinderMesh.new(); cm.top_radius = r; cm.bottom_radius = r; cm.height = h
	var mi := MeshInstance3D.new(); mi.mesh = cm; mi.material_override = _m(col); mi.position = pos; mi.rotation_degrees = rot; parent.add_child(mi); return mi

# человек: туловище, голова, качающиеся руки и ноги
func _person(col: Color, crew: bool, bag := false) -> Dictionary:
	var root := Node3D.new()
	_box(root, Vector3(0.44, 0.62, 0.26), col, Vector3(0, 1.18, 0))
	var hm := SphereMesh.new(); hm.radius = 0.13; hm.height = 0.26
	var hd := MeshInstance3D.new(); hd.mesh = hm; hd.material_override = _m(Color(0.9, 0.72, 0.58)); hd.position = Vector3(0, 1.6, 0); root.add_child(hd)
	if crew: _box(root, Vector3(0.3, 0.08, 0.3), Color(0.08, 0.1, 0.2), Vector3(0, 1.75, 0))
	var parts := {"root": root}
	for sd in [-1, 1]:
		var lg := Node3D.new(); lg.position = Vector3(sd * 0.11, 0.88, 0); root.add_child(lg)
		_box(lg, Vector3(0.15, 0.86, 0.17), Color(0.15, 0.17, 0.25), Vector3(0, -0.43, 0))
		var ar := Node3D.new(); ar.position = Vector3(sd * 0.28, 1.45, 0); root.add_child(ar)
		_box(ar, Vector3(0.1, 0.6, 0.12), col, Vector3(0, -0.3, 0))
		parts["l" if sd < 0 else "r"] = lg; parts["a" + ("l" if sd < 0 else "r")] = ar
	if bag: _box(root, Vector3(0.18, 0.32, 0.4), Color(0.2, 0.2, 0.25), Vector3(0.4, 0.45, 0))
	return parts

func _build_boarding(L: float):
	board_L = L
	bd.clear()
	board = Node3D.new(); plane.add_child(board)
	var gs := -2.3            # уровень площадки относительно центра самолёта
	var zd := -L * 0.30       # передняя левая дверь
	var fl := -0.05           # пол телетрапа
	var padm: MeshInstance3D = _box(board, Vector3(80, 0.12, L * 2.4), Color(1, 1, 1), Vector3(-6, gs - 0.06, 0))
	var sm := StandardMaterial3D.new(); sm.albedo_texture = mip_tex("res://assets/tex/det_r.png"); sm.albedo_color = Color(0.9, 0.91, 0.93); sm.uv1_triplanar = true; sm.uv1_scale = Vector3(0.18, 0.18, 0.18); sm.roughness = 0.95
	padm.material_override = sm
	_box(board, Vector3(0.3, 0.02, 40), Color(0.95, 0.8, 0.1), Vector3(0, gs + 0.01, -L * 0.5 - 22))
	# терминал
	_box(board, Vector3(12, 12, L * 1.1), Color(0.62, 0.7, 0.8), Vector3(-27, gs + 6, 0))
	_box(board, Vector3(0.2, 3, L * 1.0), Color(0.15, 0.25, 0.35), Vector3(-20.95, gs + 3.5, 0))
	# телетрап: стеклянный тоннель, выдвигается к двери
	var br := Node3D.new(); br.name = "bridge"; board.add_child(br)
	bd["bridge"] = br
	_box(br, Vector3(1, 0.15, 2.6), Color(0.55, 0.56, 0.6), Vector3(0, fl - 0.08, 0))
	_box(br, Vector3(1, 0.15, 2.6), Color(0.8, 0.8, 0.84), Vector3(0, fl + 2.6, 0))
	_box(br, Vector3(1, 2.6, 0.08), Color(0.35, 0.5, 0.6), Vector3(0, fl + 1.3, 1.3), 0.45)
	_box(br, Vector3(1, 2.6, 0.08), Color(0.35, 0.5, 0.6), Vector3(0, fl + 1.3, -1.3), 0.45)
	_cyl(br, 1.7, 2.9, Color(0.85, 0.85, 0.88), Vector3(0, fl + 1.2, 0), Vector3(0, 0, 0))
	_box(board, Vector3(0.6, fl - gs, 0.6), Color(0.3, 0.3, 0.34), Vector3(-6, gs + (fl - gs) * 0.5, zd))
	# люди
	var pax := []
	var cols := [Color(0.8, 0.25, 0.2), Color(0.2, 0.45, 0.8), Color(0.9, 0.7, 0.2), Color(0.3, 0.65, 0.4), Color(0.6, 0.35, 0.7), Color(0.85, 0.85, 0.85), Color(0.25, 0.25, 0.3)]
	for i in range(34):
		var crew := i < 4
		var p := _person(Color(0.08, 0.12, 0.3) if crew else cols[i % cols.size()], crew, i % 3 == 1)
		board.add_child(p.root); p["t0"] = 0.4 + i * 0.2 if crew else 1.6 + (i - 4) * 0.21; p["lane"] = randf_range(-0.8, 0.8); pax.append(p)
	bd["pax"] = pax
	# наземный персонал: регулировщик у носа, заправщик, багаж
	var mar := _person(Color(1.0, 0.5, 0.1), false); board.add_child(mar.root); mar.root.position = Vector3(-3.5, gs, -L * 0.5 - 7); mar.root.rotation.y = PI; bd["mar"] = mar
	var rmp := _person(Color(1.0, 0.5, 0.1), false); board.add_child(rmp.root); rmp.root.position = Vector3(9.5, gs, -L * 0.06); rmp.root.rotation.y = PI * 0.5; bd["rmp"] = rmp
	_box(board, Vector3(2.6, 2.2, 6.5), Color(0.9, 0.7, 0.1), Vector3(17, gs + 1.1, -L * 0.03))
	_cyl(board, 1.15, 5.0, Color(0.85, 0.85, 0.88), Vector3(17, gs + 3.1, L * 0.0), Vector3(90, 0, 0))
	_cyl(board, 0.07, 9.5, Color(0.1, 0.1, 0.1), Vector3(12.0, gs + 1.9, -L * 0.03), Vector3(0, 0, 70))
	# багажный погрузчик: наклонная лента и чемоданы
	var belt := _box(board, Vector3(0.9, 0.16, 6.4), Color(0.2, 0.2, 0.22), Vector3(5.2, gs + 1.35, L * 0.12)); belt.rotation_degrees = Vector3(0, 0, 0)
	belt.rotation_degrees = Vector3(0, 90, 0); belt.rotation_degrees.z = 0
	belt.mesh.size = Vector3(6.4, 0.16, 0.9); belt.rotation_degrees = Vector3(0, 0, 24)
	_box(board, Vector3(1.6, 1.0, 2.2), Color(0.9, 0.85, 0.2), Vector3(8.2, gs + 0.5, L * 0.12))
	var bags := []
	for i in range(6):
		var bg := _box(board, Vector3(0.7, 0.4, 0.5), Color.from_hsv(randf(), 0.5, 0.6), Vector3(0, 0, 0)); bags.append(bg)
	bd["bags"] = bags
	# кейтеринг на задней левой двери
	var ct := _box(board, Vector3(5.0, 2.6, 2.4), Color(0.9, 0.9, 0.95), Vector3(-9.5, gs + 1.7, L * 0.30))
	var plat := _box(board, Vector3(2.4, 0.2, 2.2), Color(0.7, 0.72, 0.78), Vector3(-5.0, gs + 1.4, L * 0.30)); bd["plat"] = plat
	# буксировщик заходит к носу
	var tug := Node3D.new(); board.add_child(tug); bd["tug"] = tug
	_box(tug, Vector3(2.4, 1.0, 3.6), Color(0.7, 0.15, 0.12), Vector3(0, gs + 0.5, 0)); _box(tug, Vector3(1.8, 0.8, 1.4), Color(0.8, 0.8, 0.85), Vector3(0, gs + 1.3, 0.6))
	_box(tug, Vector3(0.12, 0.12, 3.0), Color(0.2, 0.2, 0.22), Vector3(0, gs + 0.45, -3.2))
	# конусы
	var cn := CylinderMesh.new(); cn.top_radius = 0.02; cn.bottom_radius = 0.22; cn.height = 0.6
	for q in [[-5.5, -L * 0.5 - 3.0], [5.5, -L * 0.5 - 3.0], [-14.0, -L * 0.1], [14.0, L * 0.35], [-14.0, L * 0.4], [11.0, -L * 0.3]]:
		board.add_child(_mk(cn, Color(1, 0.45, 0.1), Vector3(q[0], gs + 0.3, q[1])))
	# проблесковый маяк
	var bm := SphereMesh.new(); bm.radius = 0.2; bm.height = 0.4
	var bc := _mk(bm, Color(1, 0.1, 0.1), Vector3(0, 2.6, -L * 0.05)); (bc.material_override as StandardMaterial3D).emission_enabled = true; (bc.material_override as StandardMaterial3D).emission = Color(1, 0.1, 0.1)
	board.add_child(bc); bd["beacon"] = bc

func _walk(p: Dictionary, t: float, ph: float, amp := 0.7):
	var s := sin(t * 9.0 + ph) * amp
	p.l.rotation.x = s; p.r.rotation.x = -s; p.al.rotation.x = -s * 0.8; p.ar.rotation.x = s * 0.8

func board_phase(t: float) -> String:
	if t < 1.5: return "Экипаж прибывает, наземная бригада готовит самолёт"
	if t < 9.0: return "Посадка пассажиров, погрузка багажа и заправка"
	if t < 10.5: return "Двери закрываются, телетрап отъезжает"
	return "Подключён буксировщик — готовность к запуску"

func board_tick(on: bool, bt: float):
	if board == null: return
	boarding_on = on
	board.visible = on
	if not on: return
	var t := bt
	var L := board_L; var gs := -2.3; var zd := -L * 0.30; var fl := -0.05
	var door_x := -2.55; var base_x := -20.9
	# телетрап: тоннель между терминалом и дверью, отъезжает после посадки
	var ex := door_x - clampf((t - 9.0) / 1.2, 0.0, 1.0) * 5.0
	var br: Node3D = bd.bridge; br.position = Vector3((base_x + ex) * 0.5, 0, zd)
	for ch in br.get_children():
		if ch is MeshInstance3D and ch.mesh is BoxMesh:
			(ch.mesh as BoxMesh).size.x = ex - base_x
	# люди идут по телетрапу к двери
	for p in bd.pax:
		var u := (t - float(p.t0)) / 4.2
		var vis: bool = u >= 0.0 and u < 1.0
		p.root.visible = vis
		if vis:
			var x := lerpf(base_x + 0.5, door_x - 0.3, u)
			p.root.position = Vector3(x, fl + absf(sin(t * 9.0 + float(p.t0) * 3.0)) * 0.04, zd + float(p.lane) * 0.9)
			p.root.rotation.y = -PI * 0.5
			_walk(p, t, float(p.t0) * 3.0)
	# регулировщик с жезлами и рабочий у погрузчика
	var m: Dictionary = bd.mar; m.al.rotation.z = -2.4 + sin(t * 5.0) * 0.5; m.ar.rotation.z = 2.4 - sin(t * 5.0) * 0.5
	var rp: Dictionary = bd.rmp; rp.ar.rotation.x = -1.2 + sin(t * 4.0) * 0.4
	# чемоданы ползут по ленте, потом исчезают в люке
	var i := 0
	for bg in bd.bags:
		var u := fposmod(t * 0.45 + i / 6.0, 1.0)
		bg.position = Vector3(lerpf(7.6, 2.8, u), gs + lerpf(0.9, 2.0, u), L * 0.12)
		bg.rotation_degrees = Vector3(0, 0, 24); bg.visible = t < 9.0; i += 1
	# платформа кейтеринга поднимается к двери и опускается
	var plat: MeshInstance3D = bd.plat
	plat.position.y = gs + lerpf(1.4, 3.1, clampf(t / 2.5, 0.0, 1.0)) - clampf((t - 8.0) / 1.5, 0.0, 1.0) * 1.7
	# буксировщик подъезжает к носу
	var tug: Node3D = bd.tug
	var k := clampf((t - 10.4) / 2.6, 0.0, 1.0)
	tug.position = Vector3(lerpf(-16.0, 0.0, minf(k * 1.3, 1.0)), 0, -L * 0.5 - lerpf(16.0, 5.2, k))
	tug.rotation.y = lerpf(0.5, 0.0, minf(k * 1.3, 1.0))
	# маяк мигает после закрытия дверей
	(bd.beacon as MeshInstance3D).visible = t > 9.5 and fmod(t * 3.0, 1.0) < 0.5

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
		_airport_details(n, float(a.len))
		airports.append({"node": n, "lat": a.lat, "lon": a.lon, "elev": a.elev, "len": a.len, "id": a.id})
		n.rotation.y = deg_to_rad(90.0 - route_brg)

func _airport_details(par: Node3D, len: float) -> void:
	var n := Node3D.new(); n.add_to_group("det"); par.add_child(n)
	var rnd := RandomNumberGenerator.new(); rnd.seed = int(len * 7.0)
	for k in range(2):   # ангары
		var hx := len * (0.22 + 0.07 * k)
		_box(n, Vector3(60, 14, 48), Color(0.75, 0.77, 0.8), Vector3(hx, 7, 330))
		var rf := _cyl(n, 24.0, 60.0, Color(0.55, 0.6, 0.68), Vector3(hx, 14, 330), Vector3(0, 0, 90))
		(rf.mesh as CylinderMesh).height = 60.0; rf.scale = Vector3(0.28, 1, 1); rf.rotation_degrees = Vector3(90, 0, 90)
		_box(n, Vector3(30, 11, 0.5), Color(0.25, 0.3, 0.38), Vector3(hx, 5.5, 306))
	var hm := _m(Color(1, 0.9, 0.6)); hm.emission_enabled = true; hm.emission = Color(1, 0.85, 0.5); hm.emission_energy_multiplier = 1.2
	var x := len * 0.2
	while x < len * 0.72:   # фонари перрона
		_box(n, Vector3(0.4, 14, 0.4), Color(0.3, 0.3, 0.33), Vector3(x, 7, 218))
		var hd := _box(n, Vector3(2.4, 0.4, 0.8), Color(1, 1, 1), Vector3(x, 14.2, 218)); hd.material_override = hm
		x += 70.0
	var cols := [Color(0.95, 0.75, 0.1), Color(0.9, 0.9, 0.92), Color(0.85, 0.3, 0.2), Color(0.2, 0.5, 0.85)]
	for i in range(14):   # наземная техника
		var vx := len * (0.3 + 0.35 * rnd.randf()); var vz := 200.0 + rnd.randf() * 40.0
		var c: Color = cols[i % 4]
		_box(n, Vector3(5.0, 2.0, 2.4), c, Vector3(vx, 1.3, vz))
		_box(n, Vector3(2.0, 1.4, 2.3), Color(0.15, 0.2, 0.28), Vector3(vx + 1.6, 2.7, vz))
		if i % 3 == 0:
			for j in range(3): _box(n, Vector3(2.6, 1.0, 1.8), Color(0.35, 0.37, 0.4), Vector3(vx - 4.5 - j * 3.0, 0.9, vz))   # багажные тележки
	for i in range(60):   # деревья по периметру
		var tx := len * (-0.1 + 1.2 * rnd.randf()); var tz := (420.0 + rnd.randf() * 260.0) * (1.0 if rnd.randf() < 0.7 else -1.0)
		if tz < 0 and absf(tz) < 520.0: tz -= 300.0
		var h := 7.0 + rnd.randf() * 7.0
		_cyl(n, 0.4, h * 0.4, Color(0.3, 0.2, 0.12), Vector3(tx, h * 0.2, tz))
		var cone := CylinderMesh.new(); cone.top_radius = 0.1; cone.bottom_radius = 3.0 + rnd.randf() * 2.0; cone.height = h
		var ci := MeshInstance3D.new(); ci.mesh = cone; ci.material_override = _m(Color(0.1, 0.3 + rnd.randf() * 0.1, 0.14)); ci.position = Vector3(tx, h * 0.55, tz); n.add_child(ci)

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
	var gp: float = clampf(float(s.get("gear", 1.0)), 0.0, 1.0)
	if gear: gear.visible = gp > 0.03; gear.scale = Vector3(1, gp, 1)
	_blink_tick()
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

func _bo() -> float:
	return 40.0 + sin(Time.get_ticks_msec() * 0.0004) * 22.0

func _camera(s: Dictionary, hdg: float, alt: float):
	var back := Vector3(0, 0, 1).rotated(Vector3.UP, -deg_to_rad(hdg))
	var pp := plane.position
	if cam_mode == 0 and boarding_on:
		var sw := sin(Time.get_ticks_msec() * 0.0004)
		cam.position = plane.to_global(Vector3(-10.0 + sw * 7.0, 6.5, -board_L * 0.5 - 20.0 - sw * 3.0))
		cam.look_at(plane.to_global(Vector3(-4.0, 0.5, -board_L * 0.3 + 3.0)), Vector3.UP)
	elif cam_mode == 0:
		var span := 38.0
		cam.position = pp + back.rotated(Vector3.UP, deg_to_rad(orbit - (_bo() if boarding_on else 0.0))) * (span * orbit_d * (0.85 if boarding_on else 1.0)) + Vector3(0, span * orbit_up + 2.0, 0)
		cam.look_at(pp + Vector3(0, 1.0, 0), Vector3.UP)
	elif cam_mode == 1:
		var fwd := -back
		cam.position = pp + fwd * 14.0 + Vector3(0, 1.5, 0)
		cam.rotation_order = EULER_ORDER_YXZ
		cam.rotation = Vector3(float(s.theta) - 0.28, -deg_to_rad(hdg), -float(s.phi) * 0.9)
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
