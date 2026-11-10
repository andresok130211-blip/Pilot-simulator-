extends Node
# Объёмная кабина (по фото 737): левое место капитана и правое — второго пилота, у каждого свои PFD/ND,
# по центру двигатели и системы, над головой потолочная панель, MCP на козырьке, пьедестал с CDU.
# Рисуется отдельным прозрачным SubViewport поверх мира; камера мира повторяет поворот головы.
var SEAT_X := 0.52
var glb := false
var gscale := 7.5
var geye := Vector3(1.05, 0.115, -0.075)   # глаза капитана в координатах модели
var is787 := false
var dome := false
var thr787: Array = []
const T787 := {"Interior_White": Color(0.74, 0.69, 0.58), "Console_Glay": Color(0.36, 0.42, 0.52), "Pedestal_White": Color(0.55, 0.62, 0.74), "Overhed_Panel": Color(0.22, 0.28, 0.38),
	"pedestal_lightglay": Color(0.52, 0.56, 0.62), "Cockpit_Alminium": Color(0.68, 0.7, 0.75), "Display_Flame": Color(0.14, 0.17, 0.22), "pedestal_main": Color(0.4, 0.44, 0.5),
	"pedestal_01": Color(0.42, 0.46, 0.52), "ModeControl_Panel1": Color(0.3, 0.34, 0.4), "SidePanel": Color(0.38, 0.42, 0.5), "Interior_Black": Color(0.17, 0.15, 0.14),
	"Pedestal_Black": Color(0.15, 0.16, 0.19), "Stick_Black": Color(0.12, 0.12, 0.13), "DreamLiner_LOGO1": Color(0.15, 0.35, 0.65), "material_21": Color(0.5, 0.36, 0.26)}
const EYE_Y := 0.2   # высота глаз над точкой отсчёта: 1,22 м от пола кабины
const ORIGIN := Vector3(0.0, 1.5, -14.0)   # точка между глазами пилотов в системе самолёта
var world: Node3D
var vp: SubViewport
var cam: Camera3D
var root: Node3D
var layer: CanvasLayer
var rect: TextureRect
var yaw := 0.0
var def_pitch := -0.24
var look_set := false
var pitch := -0.24
var tyaw := 0.0
var tpitch := -0.24
var seat := 0          # 0 — левое (капитан), 1 — правое
var zoom := false
var fov_now := 70.0
var active := false
var items: Array = []
var _st := {}
var _mats := {}
var scr := {}
var thr_lev: Array = []
var yokes: Array = []
var gear_lever: Node3D
var flap_lever: Node3D
var park_lever: Node3D
var spd_lever: Node3D
var mcp := {}
var pilots: Array = []
var light: DirectionalLight3D
var env: Environment
var amb_lamps: Array = []
var snd: Node
var hud: Node
var _lbl_cache := {}
var style := ""
var cur_pid := ""
var tint := Color(1, 1, 1)
var adash := Color(0.13, 0.19, 0.31)
const TINT := {"b738": Color(1.0, 0.92, 0.80), "b763": Color(0.88, 0.92, 0.76), "b77w": Color(0.84, 0.92, 1.08), "crj2": Color(0.78, 0.8, 0.78), "e190": Color(1.0, 0.84, 0.84), "e175": Color(0.86, 1.0, 0.9), "t204": Color(1.0, 0.78, 0.58)}
const ADASH := {"a321": Color(0.2, 0.2, 0.23), "a223": Color(0.1, 0.25, 0.23), "a333": Color(0.22, 0.15, 0.1), "a359": Color(0.08, 0.1, 0.2), "ssj": Color(0.25, 0.17, 0.2), "mc21": Color(0.14, 0.24, 0.14)}
const AIRBUS := ["ssj", "mc21", "a320", "a321", "a223", "a333", "a359"]

func setup(w: Node3D, h: Node, sn: Node) -> void:
	world = w; hud = h; snd = sn
	layer = CanvasLayer.new(); layer.layer = 0; layer.visible = false; add_child(layer)
	vp = SubViewport.new(); vp.own_world_3d = true; vp.transparent_bg = true; vp.size = Vector2i(1280, 640)
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED; vp.msaa_3d = Viewport.MSAA_2X
	add_child(vp)
	rect = TextureRect.new(); rect.texture = vp.get_texture(); rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE; rect.stretch_mode = TextureRect.STRETCH_SCALE; rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(rect)
	root = Node3D.new(); vp.add_child(root)
	cam = Camera3D.new(); cam.near = 0.03; cam.far = 12.0; cam.fov = 70.0; cam.current = true; vp.add_child(cam)
	var we := WorldEnvironment.new(); env = Environment.new(); env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR; env.ambient_light_color = Color(0.62, 0.64, 0.7); env.ambient_light_energy = 0.9
	we.environment = env; vp.add_child(we)
	light = DirectionalLight3D.new(); light.rotation_degrees = Vector3(-55, 25, 0); light.light_energy = 0.7; vp.add_child(light)
	configure("b738")

# перестраивает кабину под самолёт: Airbus-подобные — боковая ручка и светлая панель, остальные — штурвал
func configure(pid: String) -> void:
	var st := "airbus" if pid in AIRBUS else "boeing"
	if st == style and pid == cur_pid: return
	cur_pid = pid
	tint = TINT.get(pid, Color(1, 1, 1)); adash = ADASH.get(pid, Color(0.13, 0.19, 0.31))
	style = st
	glb = true
	thr787.clear(); mcpd.clear()
	is787 = st != "airbus"
	SEAT_X = 0.55 if is787 else 0.5625
	def_pitch = -0.4 if is787 else -0.42
	gscale = 1.0 if is787 else 7.5
	geye = Vector3(-0.55, 1.18, -1.05) if is787 else Vector3(1.05, 0.115, -0.075)
	if not look_set: tpitch = def_pitch; pitch = def_pitch
	for c in root.get_children(): c.queue_free()
	items.clear(); thr_lev.clear(); yokes.clear(); mcp.clear(); pilots.clear(); _st.clear()
	_build(); _flush()

# ---------- материалы и статика ----------
func _mat(c: Color) -> StandardMaterial3D:
	var k := c.to_html()
	if not _mats.has(k):
		var m := StandardMaterial3D.new(); m.albedo_color = c; m.roughness = 0.85; m.metallic_specular = 0.2
		_mats[k] = m
	return _mats[k]

func _sb(xf: Transform3D, size: Vector3, col: Color) -> void:
	var k := col.to_html()
	if not _st.has(k):
		var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES); _st[k] = st
	var bm := BoxMesh.new(); bm.size = size
	(_st[k] as SurfaceTool).append_from(bm, 0, xf)

func _sc(xf: Transform3D, r: float, h: float, col: Color) -> void:
	var k := col.to_html()
	if not _st.has(k):
		var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES); _st[k] = st
	var cm := CylinderMesh.new(); cm.top_radius = r; cm.bottom_radius = r; cm.height = h; cm.radial_segments = 10; cm.rings = 1
	(_st[k] as SurfaceTool).append_from(cm, 0, xf)

func _flush() -> void:
	for k in _st:
		var st: SurfaceTool = _st[k]
		var mesh := st.commit()
		var mi := MeshInstance3D.new(); mi.mesh = mesh; mi.material_override = _mat(Color.html(str(k))); root.add_child(mi)
	_st.clear()

func _xf(p: Vector3, rot := Vector3.ZERO) -> Transform3D:
	return Transform3D(Basis.from_euler(rot * (PI / 180.0)), p)

# панель: плоская плита с локальными осями (x вправо, y вверх, z — наружу к пилоту)
func _panel(c: Vector3, nrm: Vector3, up: Vector3, size: Vector2, col: Color) -> Node3D:
	var n := Node3D.new(); root.add_child(n)
	var z := nrm.normalized(); var x := up.cross(z).normalized(); var y := z.cross(x).normalized()
	n.transform = Transform3D(Basis(x, y, z), c)
	_sb(n.transform * _xf(Vector3(0, 0, -0.006)), Vector3(size.x, size.y, 0.012), col)
	return n

func _lab(par: Node3D, txt: String, p: Vector3, h := 0.008, col := Color(0.88, 0.9, 0.92)) -> Label3D:
	var l := Label3D.new(); l.text = txt; l.font_size = 40; l.pixel_size = h / 30.0; l.modulate = col; l.position = p + Vector3(0, 0, 0.0008)
	l.alpha_cut = Label3D.ALPHA_CUT_DISCARD; l.shaded = false; l.double_sided = false; l.outline_size = 0; l.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	par.add_child(l); return l

func _item(n: Node3D, kind: String, act: String, hit: Vector3, off: Vector3, mat: StandardMaterial3D = null, col := Color.BLACK) -> Dictionary:
	var it := {"n": n, "kind": kind, "act": act, "on": false, "mat": mat, "lcol": col, "hit": hit, "off": off, "t": 0.0, "rest": n.position, "ang": 0.0, "step": 0}
	items.append(it); return it

# кнопка с подсветкой
func _push(par: Node3D, p: Vector3, sz: Vector2, col: Color, act: String, label := "", lcol := Color(0.25, 1.0, 0.4), lit := false) -> Dictionary:
	var bm := BoxMesh.new(); bm.size = Vector3(sz.x, sz.y, 0.012)
	var mi := MeshInstance3D.new(); mi.mesh = bm; mi.position = p + Vector3(0, 0, 0.004)
	var m := StandardMaterial3D.new(); m.albedo_color = col; m.roughness = 0.6; mi.material_override = m; par.add_child(mi)
	_sb(par.transform * _xf(p + Vector3(0, 0, -0.001)), Vector3(sz.x + 0.006, sz.y + 0.006, 0.004), Color(0.02, 0.02, 0.025))
	var it := _item(mi, "push", act, Vector3(maxf(sz.x, 0.026) * 0.5, maxf(sz.y, 0.026) * 0.5, 0.012), Vector3.ZERO, m, lcol)
	it["col"] = col; it["on"] = lit; it["kk"] = "push"
	if label != "" and act != "":
		if _lab_on:
			var tl := _lab(par, label, p + Vector3(0, 0, 0.0115), minf(0.011, sz.x * 1.5 / maxf(float(label.length()), 4.0)), Color(1, 1, 1))
			tl.outline_size = 6; tl.outline_modulate = Color(0, 0, 0, 0.9)
		else: _lab(par, label, p + Vector3(0, -(sz.y * 0.5 + 0.0075), 0), 0.0058)
	return it

# тумблер
func _tog(par: Node3D, p: Vector3, label: String, act := "", on := false, col := Color(0.82, 0.83, 0.86), lab_up := false) -> Dictionary:
	_sc(par.transform * _xf(p + Vector3(0, 0, 0.002), Vector3(90, 0, 0)), 0.0075, 0.006, Color(0.03, 0.03, 0.035))
	var pv := Node3D.new(); pv.position = p + Vector3(0, 0, 0.004); par.add_child(pv)
	var cm := CapsuleMesh.new(); cm.radius = 0.0034; cm.height = 0.026; cm.radial_segments = 6; cm.rings = 2
	var mi := MeshInstance3D.new(); mi.mesh = cm; mi.material_override = _mat(col); mi.position = Vector3(0, 0, 0.011); mi.rotation_degrees = Vector3(90, 0, 0); pv.add_child(mi)
	var it := _item(pv, "tog", act, Vector3(0.0135, 0.0135, 0.02), Vector3(0, 0, 0.01)); it["on"] = on; it["ang"] = 0.5 if on else -0.5; pv.rotation.x = it["ang"]; it["kk"] = "tog"
	var lm := StandardMaterial3D.new(); lm.albedo_color = Color(0.05, 0.2, 0.08); lm.emission = Color(0.2, 1.0, 0.4); lm.emission_energy_multiplier = 1.8; lm.emission_enabled = on
	var lp := MeshInstance3D.new(); var lb := BoxMesh.new(); lb.size = Vector3(0.007, 0.004, 0.003); lp.mesh = lb; lp.material_override = lm; lp.position = p + Vector3(0.0, 0.0125, 0.002); par.add_child(lp)
	it["lamp"] = lm
	if label != "" and act != "": _lab(par, label, p + Vector3(0, (0.019 if lab_up else -0.019), 0), 0.0056)
	return it

# поворотная ручка
func _knob(par: Node3D, p: Vector3, label: String, steps := 3, act := "", r := 0.012, start := 0) -> Dictionary:
	var pv := Node3D.new(); pv.position = p + Vector3(0, 0, 0.004); par.add_child(pv)
	var cm := CylinderMesh.new(); cm.top_radius = r * 0.85; cm.bottom_radius = r; cm.height = 0.016; cm.radial_segments = 12; cm.rings = 1
	var mi := MeshInstance3D.new(); mi.mesh = cm; mi.material_override = _mat(Color(0.05, 0.05, 0.06)); mi.rotation_degrees = Vector3(90, 0, 0); mi.position = Vector3(0, 0, 0.008); pv.add_child(mi)
	var mk := MeshInstance3D.new(); var bm := BoxMesh.new(); bm.size = Vector3(0.003, r * 0.8, 0.002); mk.mesh = bm; mk.material_override = _mat(Color(0.95, 0.95, 0.95)); mk.position = Vector3(0, r * 0.45, 0.0165); pv.add_child(mk)
	var it := _item(pv, "knob", act, Vector3(maxf(r, 0.014), maxf(r, 0.014), 0.012), Vector3(0, 0, 0.008)); it["steps"] = steps; it["step"] = start; it["kk"] = "knob"
	pv.rotation.z = -(float(start) - float(steps - 1) * 0.5) * 0.7
	if label != "" and act != "": _lab(par, label, p + Vector3(0, -(r + 0.009), 0), 0.0056)
	_static_ring(par, p, r)
	return it

# крупная подсказка над рабочим органом (всегда повёрнута к пилоту, видна поверх панели)
func _hint(par: Node3D, txt: String, p: Vector3, col := Color(1.0, 0.93, 0.5)) -> void:
	var l := Label3D.new(); l.text = txt; l.font_size = 56; l.pixel_size = 0.00058; l.modulate = col; l.outline_size = 14; l.outline_modulate = Color(0, 0, 0, 0.95)
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED; l.no_depth_test = true; l.shaded = false; l.position = p; l.fixed_size = false
	l.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS; l.render_priority = 5
	par.add_child(l)

func _static_ring(par: Node3D, p: Vector3, r: float) -> void:
	_sc(par.transform * _xf(p + Vector3(0, 0, 0.0005), Vector3(90, 0, 0)), r + 0.004, 0.002, Color(0.55, 0.57, 0.6))

# ---------- кабина A320 из модели (TonyWony, CC BY 4.0) ----------
var mcpd := {}
var _lab_on := false
# задняя переборка с дверью в салон (когда смотришь назад из кабины)
func _rear(z: float, w: float, ybot: float, ytop: float, zfront: float) -> void:
	var wall := Color(0.62, 0.64, 0.68) * tint; var dr := Color(0.3, 0.33, 0.42) * tint
	var dark := Color(0.08, 0.08, 0.1)
	var yc := (ybot + ytop) * 0.5; var hh := ytop - ybot
	_sb(_xf(Vector3(0, yc, z)), Vector3(w * 2.0, hh, 0.06), wall)                       # переборка
	_sb(_xf(Vector3(0, ybot - 0.01, (z + zfront) * 0.5)), Vector3(w * 2.0, 0.04, z - zfront), Color(0.28, 0.3, 0.34))   # пол
	_sb(_xf(Vector3(0, ytop, (z + zfront) * 0.5)), Vector3(w * 2.0, 0.04, z - zfront), wall)                            # потолок
	for sx in [-1.0, 1.0]:
		_sb(_xf(Vector3(sx * w, yc, (z + zfront) * 0.5)), Vector3(0.04, hh, z - zfront), wall)                         # борта
	var dz := z - 0.04
	_sb(_xf(Vector3(0, ybot + 0.98, dz - 0.0)), Vector3(0.9, 1.96, 0.03), dark)           # проём
	_sb(_xf(Vector3(0, ybot + 0.98, dz - 0.03)), Vector3(0.82, 1.9, 0.03), dr)            # дверь
	_sb(_xf(Vector3(0, ybot + 1.45, dz - 0.05)), Vector3(0.18, 0.28, 0.02), Color(0.12, 0.2, 0.28))   # иллюминатор
	_sb(_xf(Vector3(0.3, ybot + 0.95, dz - 0.06)), Vector3(0.05, 0.14, 0.03), Color(0.75, 0.76, 0.8))  # ручка
	_sb(_xf(Vector3(0.38, ybot + 1.1, dz - 0.05)), Vector3(0.1, 0.14, 0.02), Color(0.1, 0.1, 0.12))   # замок/клавиатура
	var tl := _lab(root, "ВХОД В КАБИНУ", Vector3(0, ybot + 1.93, dz - 0.07), 0.05, Color(0.9, 0.92, 0.95)); tl.rotation_degrees.y = 180.0

func self_rear_par() -> Node3D:
	return root

func _ctl_strip(par: Node3D, o: Vector3, rot_x := 0.0, sc := 1.55, extra := false) -> void:
	var st := Node3D.new(); st.position = o; st.rotation_degrees = Vector3(rot_x, 0, 0); st.scale = Vector3.ONE * sc; par.add_child(st)
	_sb(st.transform * _xf(Vector3(0, 0.0, -0.002)), Vector3(0.98, 0.135 if not extra else 0.19, 0.008), Color(0.05, 0.06, 0.08))
	var dk := Color(0.2, 0.22, 0.27); var gl := Color(0.3, 1.0, 0.45)
	_lab_on = true
	# три окна значений
	for g in [["СКОР", -0.27, "spd", "spd-", "spd+", "АВТО", "spda"], ["КУРС", 0.0, "hdg", "hdg-", "hdg+", "HDG", "hdgm"], ["ВЫС", 0.27, "alt", "altd", "altu", "", ""]]:
		var gx: float = float(g[1])
		_sb(st.transform * _xf(Vector3(gx, 0.03, 0.0)), Vector3(0.14, 0.04, 0.004), Color(0.0, 0.03, 0.02))
		var lt := _lab(st, str(g[0]), Vector3(gx - 0.048, 0.054, 0.0), 0.0055, Color(0.7, 0.75, 0.8)); lt.position.x = gx - 0.0
		var dl := _lab(st, "---", Vector3(gx, 0.03, 0.0035), 0.016, Color(0.4, 1.0, 0.55)); mcpd[str(g[2])] = dl
		_push(st, Vector3(gx - 0.032, -0.012, 0.0), Vector2(0.056, 0.032), dk, str(g[3]), "−", gl)
		_push(st, Vector3(gx + 0.032, -0.012, 0.0), Vector2(0.056, 0.032), dk, str(g[4]), "+", gl)
		if str(g[6]) != "": _push(st, Vector3(gx, 0.065, 0.0), Vector2(0.06, 0.02), Color(0.16, 0.2, 0.28), str(g[6]), str(g[5]), Color(1.0, 0.8, 0.3))
	# режимные кнопки слева и справа
	_push(st, Vector3(-0.43, 0.025, 0.0), Vector2(0.075, 0.034), dk, "at", "АВТОТЯГА", gl)
	_push(st, Vector3(-0.43, -0.018, 0.0), Vector2(0.075, 0.034), dk, "nav", "МАРШРУТ", gl)
	_push(st, Vector3(0.43, 0.025, 0.0), Vector2(0.075, 0.034), dk, "ap", "АВТОПИЛОТ", gl)
	_push(st, Vector3(0.43, -0.018, 0.0), Vector2(0.075, 0.034), dk, "appr", "ПОСАДКА", gl)
	if extra:
		_push(st, Vector3(-0.30, -0.07, 0.0), Vector2(0.09, 0.03), Color(0.34, 0.16, 0.14), "gear", "ШАССИ", Color(0.3, 1.0, 0.45))
		_push(st, Vector3(-0.10, -0.07, 0.0), Vector2(0.09, 0.03), Color(0.34, 0.16, 0.14), "brake", "СТОЯН. ТОРМОЗ", Color(1.0, 0.45, 0.2))
		_push(st, Vector3(0.10, -0.07, 0.0), Vector2(0.09, 0.03), dk, "fl-", "ЗАКРЫЛКИ −", gl)
		_push(st, Vector3(0.30, -0.07, 0.0), Vector2(0.09, 0.03), dk, "fl+", "ЗАКРЫЛКИ +", gl)

# запуск двигателей и пожарные кнопки рядом с рычагами тяги
func _eng_strip(par: Node3D, o: Vector3, rot_x := 0.0, sc := 1.0, roty := 0.0) -> void:
	var st := Node3D.new(); st.position = o; st.rotation_degrees = Vector3(rot_x, roty, 0); st.scale = Vector3.ONE * sc; par.add_child(st)
	_sb(st.transform * _xf(Vector3(0, 0.0, -0.002)), Vector3(0.40, 0.07, 0.008), Color(0.05, 0.06, 0.08))
	var keep := _lab_on; _lab_on = true
	_push(st, Vector3(-0.12, 0.0, 0.0), Vector2(0.11, 0.045), Color(0.14, 0.3, 0.16), "start", "ЗАПУСК ДВИГ.", Color(0.3, 1.0, 0.45))
	_push(st, Vector3(0.05, 0.0, 0.0), Vector2(0.07, 0.045), Color(0.9, 0.06, 0.04), "ext", "ПОЖАР 1", Color(1.0, 0.2, 0.1))
	_push(st, Vector3(0.14, 0.0, 0.0), Vector2(0.07, 0.045), Color(0.9, 0.06, 0.04), "ext", "ПОЖАР 2", Color(1.0, 0.2, 0.1))
	_lab_on = keep

func _ap_strip(par: Node3D, o: Vector3, sc: float) -> void:
	var st := Node3D.new(); st.position = o; st.basis = Basis.looking_at(o - Vector3(-0.56, 0.2, 0.0), Vector3.UP).scaled(Vector3.ONE * sc); par.add_child(st)
	var keep := _lab_on; _lab_on = true
	var dk := Color(0.12, 0.13, 0.16); var gl := Color(0.3, 1.0, 0.45)
	var names := [["at", "АВТОТЯГА"], ["nav", "МАРШРУТ"], ["ap", "АВТОПИЛОТ"], ["appr", "ПОСАДКА"]]
	for i in range(4):
		_push(st, Vector3((i - 1.5) * 0.095, 0.0, 0.0), Vector2(0.085, 0.05), dk, str(names[i][0]), str(names[i][1]), gl)
	_lab_on = keep

func _fire_pair(par: Node3D, o: Vector3, rot_x: float, sc: float) -> void:
	var st := Node3D.new(); st.position = o; st.basis = Basis.looking_at(o - Vector3(-0.56, 0.2, 0.0), Vector3.UP).scaled(Vector3.ONE * sc); par.add_child(st)
	var keep := _lab_on; _lab_on = true
	_push(st, Vector3(-0.06, 0.0, 0.0), Vector2(0.08, 0.08), Color(0.9, 0.06, 0.04), "ext", "ПОЖАР 1", Color(1.0, 0.9, 0.5))
	_push(st, Vector3(0.06, 0.0, 0.0), Vector2(0.08, 0.08), Color(0.9, 0.06, 0.04), "ext", "ПОЖАР 2", Color(1.0, 0.9, 0.5))
	_lab_on = keep

# (метки кнопок вне пульта снова под кнопкой)
# горизонтальная площадка с кнопками (пьедестал): локальный +z смотрит вверх
func _pad(par: Node3D, o: Vector3, rot_x: float) -> Node3D:
	var n := Node3D.new(); n.position = o; n.rotation_degrees = Vector3(rot_x, 0, 0); par.add_child(n); return n

# ---------- настоящие детали модели: кнопки нажимаются, ручки вращаются ----------
const MCP_TILT := -0.31
func _lt(n: Node, top: Node) -> Transform3D:
	var t := Transform3D.IDENTITY; var c: Node = n
	while c != null and c != top:
		if c is Node3D: t = (c as Node3D).transform * t
		c = c.get_parent()
	return t

func _bind(m: Node3D, x: float, y: float, kind: String, act: String, label := "", acts := [], tol := 0.006) -> Dictionary:
	var sel: Array = []; var cen := Vector3.ZERO; var maxz := -1e9; var big := 0.0
	for mi in _meshes(m):
		if (mi as Node).is_queued_for_deletion() or (mi as Node).has_meta("bound"): continue
		var b: AABB = _lt(mi, m) * (mi as MeshInstance3D).get_aabb()
		var c := b.get_center()
		if absf(c.x - x) < tol and absf(c.y - y) < tol and c.z < -1.99 and c.z > -2.05 and maxf(b.size.x, maxf(b.size.y, b.size.z)) < 0.03:
			sel.append(mi); cen += c; maxz = maxf(maxz, b.end.z); big = maxf(big, maxf(b.size.x, b.size.y))
	if sel.is_empty(): return {}
	cen /= float(sel.size())
	var pv := Node3D.new(); m.add_child(pv)
	pv.transform = Transform3D(Basis(Vector3.RIGHT, MCP_TILT), cen)
	var face: StandardMaterial3D = null
	for mi in sel:
		(mi as Node).set_meta("bound", true); (mi as Node).reparent(pv, true)
		var me := (mi as MeshInstance3D).mesh
		for i in range(me.get_surface_count()):
			var mt := me.surface_get_material(i)
			if mt != null and str(mt.resource_name) == "ModeControl_Panel1" and (mi as MeshInstance3D).get_surface_override_material(i) is StandardMaterial3D:
				face = (mi as MeshInstance3D).get_surface_override_material(i) as StandardMaterial3D
	var zf := maxz - cen.z + 0.0006
	var hs := maxf(big * 0.5 + 0.002, 0.0095 if kind == "push" else 0.013)
	var it := _item(pv, "m" + kind, act, Vector3(hs, hs, 0.02), Vector3(0, 0, zf * 0.5))
	it["acts"] = acts; it["b0"] = pv.transform.basis; it["tgt"] = 0.0; it["ang"] = 0.0; it["fm"] = face; it["fcol"] = face.albedo_color if face != null else Color.BLACK
	if kind == "push" and label != "":
		var tl := _lab(pv, label, Vector3(0, 0, zf), 0.0042, Color(1, 1, 1)); tl.outline_size = 5; tl.outline_modulate = Color(0, 0, 0, 0.95)
	return it

func _mcp_window(m: Node3D, id: String, key: String, cap: String) -> void:
	var mi := m.find_child("Object_" + id, true, false) as MeshInstance3D
	if mi == null: return
	var c: Vector3 = (_lt(mi, m) * mi.get_aabb()).get_center()
	var nrm := Vector3(0, sin(-MCP_TILT), cos(MCP_TILT))
	var wp := Node3D.new(); m.add_child(wp); wp.transform = Transform3D(Basis(Vector3.RIGHT, MCP_TILT), c + nrm * 0.0042)
	_lab(wp, cap, Vector3(0, 0.0065, 0), 0.0034, Color(0.7, 0.75, 0.8))
	mcpd[key] = _lab(wp, "---", Vector3(0, -0.0015, 0), 0.0085, Color(0.4, 1.0, 0.55))

func _mcp_real(m: Node3D) -> void:
	_mcp_window(m, "1743", "spd", "СКОРОСТЬ"); _mcp_window(m, "1746", "hdg", "КУРС")
	_mcp_window(m, "1749", "vs", "ВЕРТ.СК."); _mcp_window(m, "1752", "alt", "ВЫСОТА")
	_bind(m, -0.119, 0.875, "knob", "spd", "", ["spd-", "spd+"])
	_bind(m, -0.01, 0.887, "knob", "hdg", "", ["hdg-", "hdg+"])
	_bind(m, 0.111, 0.888, "knob", "alt", "", ["altd", "altu"])
	_bind(m, -0.157, 0.882, "push", "at", "А/Т")
	_bind(m, -0.157, 0.86, "push", "spda", "АВТО")
	_bind(m, -0.083, 0.882, "push", "nav", "МАРШ")
	_bind(m, -0.083, 0.86, "push", "hdgm", "КУРС")
	_bind(m, 0.155, 0.883, "push", "ap", "АП")
	_bind(m, 0.155, 0.862, "push", "appr", "ПОС")

# рычаг из деталей модели по номерам Object_N: поворачивается вокруг оси X
func _bind_lever(m: Node3D, ids: Array, act: String, label: String, base := 0.25) -> Dictionary:
	var sel: Array = []; var bb := AABB(); var first := true
	for id in ids:
		var mi := m.find_child("Object_" + str(id), true, false) as MeshInstance3D
		if mi == null or mi.is_queued_for_deletion(): continue
		var b: AABB = _lt(mi, m) * mi.get_aabb()
		bb = b if first else bb.merge(b); first = false; sel.append(mi)
	if sel.is_empty(): return {}
	var cen := bb.get_center(); cen.y = bb.position.y + bb.size.y * base
	var pv := Node3D.new(); m.add_child(pv); pv.position = cen
	for mi in sel: (mi as Node).reparent(pv, true)
	var hs := Vector3(maxf(bb.size.x * 0.5 + 0.012, 0.03), maxf(bb.size.y * 0.5 + 0.012, 0.03), maxf(bb.size.z * 0.5 + 0.012, 0.03))
	var it := _item(pv, "mlever", act, hs, bb.get_center() - cen)
	it["b0"] = pv.transform.basis; it["ang"] = 0.0
	var l := Label3D.new(); l.text = label; l.font_size = 40; l.pixel_size = 0.0005; l.modulate = Color(1, 0.95, 0.6); l.outline_size = 10; l.outline_modulate = Color(0, 0, 0, 0.95)
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED; l.no_depth_test = true; l.shaded = false; l.position = bb.get_center() + Vector3(0, bb.size.y * 0.5 + 0.02, 0.01); l.render_priority = 5
	l.free()
	return it

func _levers_real(m: Node3D) -> bool:
	var ok := true
	ok = not _bind_lever(m, [2724, 2723], "gear", "ШАССИ", 0.5).is_empty() and ok
	ok = not _bind_lever(m, [1320, 1319], "fl", "ЗАКРЫЛКИ").is_empty() and ok
	ok = not _bind_lever(m, [1186, 1185], "brake", "СТОЯН.ТОРМ").is_empty() and ok
	return ok

func _build_787() -> void:
	var m: Node3D = (load("res://assets/planes/B787_cockpit.glb") as PackedScene).instantiate()
	root.add_child(m)
	m.position = Vector3(-SEAT_X, EYE_Y, 0.0) - geye
	# убираем лишние детали далеко от кабины
	var inv := m.global_transform.affine_inverse()
	for mi in _meshes(m):
		var c: Vector3 = (inv * (mi as MeshInstance3D).global_transform * (mi as MeshInstance3D).get_aabb()).get_center()
		if absf(c.x) > 1.7 or c.z < -3.2 or c.z > 0.3 or c.y > 2.3 or c.y < -0.2: mi.queue_free()
	# стекло
	for mi in _meshes(m):
		var me := (mi as MeshInstance3D).mesh
		if me == null: continue
		for i in range(me.get_surface_count()):
			var mt := me.surface_get_material(i)
			if mt != null and str(mt.resource_name) == "787_Glass":
				(mi as MeshInstance3D).set_surface_override_material(i, null); (mi as MeshInstance3D).visible = false
			elif mt is StandardMaterial3D:
				var nm := (mt as StandardMaterial3D).duplicate() as StandardMaterial3D
				var rn := str(mt.resource_name)
				if T787.has(rn): nm.albedo_color = T787[rn] * tint
				else: nm.albedo_color = Color(nm.albedo_color.r * 0.62 * tint.r, nm.albedo_color.g * 0.64 * tint.g, nm.albedo_color.b * 0.68 * tint.b, nm.albedo_color.a)
				nm.cull_mode = BaseMaterial3D.CULL_DISABLED
				(mi as MeshInstance3D).set_surface_override_material(i, nm)
	# живые экраны: PFD / ND / ND / PFD
	var xs := [-0.575, -0.225, 0.225, 0.575]; var ks := ["pfd", "nd", "nd", "pfd"]
	for i in range(4):
		_gdisplay(m, Vector3(float(xs[i]), 0.69, -2.036), 0.22, str(ks[i]), Vector2i(256, 256), 0.0, Vector2(0.31, 0.22))
	_gdisplay(m, Vector3(0.0, 0.735, -2.036), 0.2, "eng", Vector2i(256, 176), 0.0, Vector2(0.22, 0.16))
	_gdisplay(m, Vector3(0.0, 0.57, -2.036), 0.17, "sys", Vector2i(280, 340), 0.0, Vector2(0.19, 0.19))
	# рычаги тяги двигаются вместе с тягой
	thr787.clear()
	for grp in [["1347", "1349", "1351", "1367"], ["1378", "1380", "1382", "1362"]]:
		var pv := Node3D.new(); m.add_child(pv); pv.position = Vector3(-0.03 if thr787.size() == 0 else 0.03, 0.36, -1.58)
		for nm in grp:
			var mi := m.find_child("Object_" + str(nm), true, false)
			if mi != null: mi.reparent(pv, true)
		thr787.append(pv)
	_mcp_real(m)
	_lab_on = true
	_eng_strip(m, Vector3(0.0, 0.4, -1.4), -70.0, 1.0)
	_lab_on = false
	# шасси, закрылки и стояночный тормоз — настоящие рычаги модели
	if not _levers_real(m):
		var gp := _pad(m, Vector3(0.0, 0.64, -2.03), 0.0)
		_push(gp, Vector3(0, 0, 0), Vector2(0.085, 0.045), Color(0.34, 0.16, 0.14), "gear", "ШАССИ", Color(0.3, 1.0, 0.45))
		var pd := _pad(m, Vector3(0.0, 0.575, -1.32), -75.0)
		_push(pd, Vector3(-0.16, 0, 0), Vector2(0.085, 0.045), Color(0.34, 0.16, 0.14), "brake", "СТОЯН.", Color(1.0, 0.45, 0.2))
		_push(pd, Vector3(0.0, 0, 0), Vector2(0.085, 0.045), Color(0.2, 0.22, 0.27), "fl-", "ЗАКР. −", Color(0.3, 1.0, 0.45))
		_push(pd, Vector3(0.16, 0, 0), Vector2(0.085, 0.045), Color(0.2, 0.22, 0.27), "fl+", "ЗАКР. +", Color(0.3, 1.0, 0.45))
	_lab_on = false
	_lights_in()
	_pilots_glb()
	_rear(1.9, 1.3, -1.0, 0.95, 0.4)

# A320: детали панели FCU по именам узлов модели
func _bind_node(m: Node3D, pat: String, kind: String, act: String, acts := [], travel := 0.0008) -> Dictionary:
	var mi := m.find_child(pat, true, false) as MeshInstance3D
	if mi == null or mi.is_queued_for_deletion() or mi.has_meta("bound"): return {}
	var b: AABB = _lt(mi, m) * mi.get_aabb()
	var pv := Node3D.new(); m.add_child(pv)
	pv.transform = Transform3D(Basis(Vector3(0, 0, 1), Vector3(0, 1, 0), Vector3(-1, 0, 0)), b.get_center())
	mi.set_meta("bound", true); mi.reparent(pv, true)
	var hs := clampf(maxf(b.size.y, b.size.z) * 0.5 + 0.003, 0.014, 0.017)
	var it := _item(pv, "m" + kind, act, Vector3(hs, hs, 0.03), Vector3(0, 0, -0.01))
	it["acts"] = acts; it["b0"] = pv.transform.basis; it["tgt"] = 0.0; it["ang"] = 0.0; it["fm"] = null; it["trv"] = travel
	return it

var fcu_lbl := {}
func _fcu_lab(m: Node3D, key: String, z: float, head: String) -> void:
	for k in range(1):
		var l := Label3D.new(); l.font_size = 64 if k == 0 else 30; l.pixel_size = 0.0001 if k == 0 else 0.00007
		l.modulate = Color(1.0, 0.72, 0.15) if k == 0 else Color(0.85, 0.95, 1.0); l.outline_size = 12; l.outline_modulate = Color(0, 0, 0, 1)
		l.shaded = false; l.double_sided = true; l.render_priority = 4
		l.position = Vector3(1.122, 0.074 if k == 0 else 0.083, z); l.no_depth_test = true; l.rotation_degrees = Vector3(0, -90, 0)
		l.text = head if k == 1 else "---"; m.add_child(l)
		if k == 0: fcu_lbl[key] = l

func _fcu_real(m: Node3D) -> void:
	fcu_lbl.clear()
	_fcu_lab(m, "spd", -0.028, "СКОР"); _fcu_lab(m, "hdg", -0.001, "КУРС"); _fcu_lab(m, "alt", 0.027, "ВЫС")
	_bind_node(m, "Cube_033_main*", "knob", "spd", ["spd-", "spd+"])
	_bind_node(m, "Cube_024_main*", "knob", "hdg", ["hdg-", "hdg+"])
	_bind_node(m, "Cube_032_main*", "knob", "alt", ["altd", "altu"])
	_bind_node(m, "Cube_023_main*", "push", "hdgm")
	_bind_node(m, "Cube_022_main*", "push", "spda")

# A320: в модели нет отдельных рычагов шасси/закрылков/тормоза — делаем объёмные рычаги, которые двигаются
func _lever3d(m: Node3D, p: Vector3, act: String, label: String, col: Color) -> void:
	var pv := Node3D.new(); m.add_child(pv); pv.position = p
	var sm := BoxMesh.new(); sm.size = Vector3(0.0035, 0.018, 0.0035)
	var st := MeshInstance3D.new(); st.mesh = sm; st.material_override = _mat(Color(0.55, 0.57, 0.6)); st.position = Vector3(0, 0.009, 0); pv.add_child(st)
	var kb := SphereMesh.new(); kb.radius = 0.0038; kb.height = 0.0076; kb.radial_segments = 10; kb.rings = 6
	var kn := MeshInstance3D.new(); kn.mesh = kb; kn.material_override = _mat(col); kn.position = Vector3(0, 0.0195, 0); pv.add_child(kn)
	var bm := BoxMesh.new(); bm.size = Vector3(0.012, 0.003, 0.012)
	var bs := MeshInstance3D.new(); bs.mesh = bm; bs.material_override = _mat(Color(0.05, 0.05, 0.06)); pv.add_child(bs)
	var it := _item(pv, "mlever", act, Vector3(0.013, 0.02, 0.013), Vector3(0, 0.012, 0))
	it["b0"] = pv.transform.basis; it["ang"] = 0.0; it["axis"] = Vector3(0, 0, 1)
	var l := Label3D.new(); l.text = label; l.font_size = 40; l.pixel_size = 0.00007; l.modulate = Color(1, 0.95, 0.6); l.outline_size = 10; l.outline_modulate = Color(0, 0, 0, 0.95)
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED; l.no_depth_test = true; l.shaded = false; l.position = p + Vector3(0, 0.036, 0); l.render_priority = 5
	l.free()

func _bind_lever_node(m: Node3D, pat: String, act: String, label: String, axis: Vector3) -> void:
	var mi := m.find_child(pat, true, false) as MeshInstance3D
	if mi == null or mi.is_queued_for_deletion() or mi.has_meta("bound"): return
	var b: AABB = _lt(mi, m) * mi.get_aabb()
	var pv := Node3D.new(); m.add_child(pv); pv.position = b.get_center()
	mi.set_meta("bound", true); mi.reparent(pv, true)
	var hs := clampf(maxf(b.size.x, maxf(b.size.y, b.size.z)) * 0.5 + 0.006, 0.012, 0.03)
	var it := _item(pv, "mlever", act, Vector3(hs, hs, hs), Vector3.ZERO)
	it["b0"] = pv.transform.basis; it["ang"] = 0.0; it["axis"] = axis
	var l := Label3D.new(); l.text = label; l.font_size = 40; l.pixel_size = 0.00007; l.modulate = Color(1, 0.95, 0.6); l.outline_size = 10; l.outline_modulate = Color(0, 0, 0, 0.95)
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED; l.no_depth_test = true; l.shaded = false; l.position = b.get_center() + Vector3(0, 0.03, 0); l.render_priority = 5
	l.free()

func _build_glb() -> void:
	if is787:
		_build_787(); return
	var m: Node3D = (load("res://assets/planes/A320_cockpit.glb") as PackedScene).instantiate()
	root.add_child(m)
	m.rotation_degrees = Vector3(0, 90, 0); m.scale = Vector3.ONE * gscale
	# глаза капитана -> (-SEAT_X, EYE_Y, 0)
	var e := Basis.from_euler(Vector3(0, deg_to_rad(90.0), 0)) * (geye * gscale)
	m.position = Vector3(-SEAT_X, EYE_Y, 0.0) - e
	_glb_trim(m, m)
	_glb_fix(m)
	# всё, что оказалось позади пилотов (обрывки обшивки), убираем — там будет задняя переборка
	var inv0 := root.global_transform.affine_inverse()
	for mi in _meshes(m):
		var cb: AABB = (inv0 * (mi as MeshInstance3D).global_transform) * (mi as MeshInstance3D).get_aabb()
		if cb.get_center().z > 0.3 and cb.position.z > 0.0: mi.queue_free()
	_fcu_real(m)
	_ap_strip(root, (m.transform * Vector3(1.115, 0.098, 0.0)), 0.9)
	_lever3d(m, Vector3(1.0, 0.003, 0.02), "gear", "ШАССИ", Color(0.9, 0.15, 0.12))
	_bind_lever_node(m, "a random_060_cockpit*", "fl", "ЗАКРЫЛКИ", Vector3(0, 0, 1))
	_bind_lever_node(m, "Cube_030__0", "brake", "СТОЯН.ТОРМ", Vector3(1, 0, 0))
	_lab_on = true
	_eng_strip(root, Vector3(-0.12, -0.30, -0.35), -35.0, 0.6)
	_fire_pair(root, Vector3(0.16, 0.53, -0.13), 0.0, 0.9)
	_lab_on = false
	_tone_down(m)
	for mi in _meshes(m):
		if String((mi as Node).name).begins_with("Cylinder_026") or String((mi as Node).name) == "Cylinder_fuselarge_0" or String((mi as Node).name).begins_with("Cylinder_002_white"): (mi as MeshInstance3D).visible = false
	# живые экраны поверх макетных
	var fx := 1.1294 - 0.0004
	for it in [[-0.0911, 0.0543, "pfd", Vector2i(256, 256)], [-0.0586, 0.0543, "nd", Vector2i(256, 256)], [-0.0011, 0.0573, "eng", Vector2i(256, 176)], [-0.0011, 0.0287, "sys", Vector2i(280, 340)], [0.0564, 0.0543, "nd", Vector2i(256, 256)], [0.0889, 0.0543, "pfd", Vector2i(256, 256)]]:
		_gdisplay(m, Vector3(fx, float(it[1]), float(it[0])), 0.0235 if it[2] != "eng" else 0.0235, str(it[2]), it[3])
	_lights_in()
	_pilots_glb()
	_rear(1.9, 1.3, -1.0, 0.95, 0.4)
	_hud_root_hint = true

var _hud_root_hint := false
func _glb_trim(m: Node3D, top: Node3D) -> void:
	# оставляем только кабину (нос самолёта), салон и хвост убираем
	var inv := top.global_transform.affine_inverse()
	for mi in _meshes(m):
		var ab: AABB = (inv * (mi as MeshInstance3D).global_transform) * (mi as MeshInstance3D).get_aabb()
		var cx := ab.position.x + ab.size.x * 0.5
		var keep := false
		var mm := (mi as MeshInstance3D).mesh
		if mm != null and mm.get_surface_count() > 0 and mm.surface_get_material(0) != null and str(mm.surface_get_material(0).resource_name).contains("fuselarge"): keep = true
		if keep and (mi as MeshInstance3D).name.begins_with("Cylinder_007"): mi.queue_free()
		if cx < 0.55 and not keep: mi.queue_free()

func _glb_fix(m: Node) -> void:
	for mi in _meshes(m):
		var me := (mi as MeshInstance3D).mesh
		if me == null: continue
		for i in range(me.get_surface_count()):
			var mt := me.surface_get_material(i)
			if mt is StandardMaterial3D and (str(mt.resource_name).contains("dash") or str(mt.resource_name).contains("standed_2") or str(mt.resource_name).contains("black_leather")):
				var nm := (mt as StandardMaterial3D).duplicate() as StandardMaterial3D
				nm.albedo_texture = null
				var rn := str(mt.resource_name)
				nm.albedo_color = adash if rn.contains("dash") else ((Color(0.3, 0.34, 0.42) * (adash * 3.2 + Color(0.2, 0.2, 0.2)).lerp(Color.WHITE, 0.5)) if rn.contains("standed_2") else adash.lerp(Color(0.2, 0.22, 0.28), 0.5))
				(mi as MeshInstance3D).set_surface_override_material(i, nm)

# светлые материалы модели (белые рамы, обшивка) красим в тёмно-серо-синюю гамму кабины
func _tone_down(m: Node) -> void:
	var done := {}
	for mi in _meshes(m):
		var mm := mi as MeshInstance3D
		for i in range(mm.get_surface_override_material_count()):
			var mat := mm.get_active_material(i)
			if mat is StandardMaterial3D:
				var sm := mat as StandardMaterial3D
				var ac := sm.albedo_color
				if sm.albedo_texture == null and (ac.r + ac.g + ac.b) / 3.0 > 0.72:
					if not done.has(sm):
						var d := sm.duplicate() as StandardMaterial3D
						d.albedo_color = Color(0.30, 0.34, 0.40); done[sm] = d
					mm.set_surface_override_material(i, done[sm])
				elif sm.albedo_texture != null and mm.name.to_lower().contains("frame"):
					pass

func _meshes(n: Node) -> Array:
	var out := []
	if n is MeshInstance3D: out.append(n)
	for c in n.get_children(): out.append_array(_meshes(c))
	return out

func _gdisplay(par: Node3D, p: Vector3, sz: float, kind: String, px: Vector2i, roty := -90.0, back := Vector2.ZERO) -> void:
	if not scr.has(kind):
		var sv := SubViewport.new(); sv.size = px; sv.render_target_update_mode = SubViewport.UPDATE_DISABLED; sv.transparent_bg = false; add_child(sv)
		var ins := Control.new(); ins.set_script(load("res://instr.gd")); ins.set("kind", kind); sv.add_child(ins)
		scr[kind] = {"vp": sv, "ins": ins}
	var qm := QuadMesh.new(); qm.size = Vector2(sz, sz * (0.69 if kind == "eng" else 1.0))
	var mi := MeshInstance3D.new(); mi.mesh = qm; mi.position = p; mi.rotation_degrees = Vector3(0, roty, 0)
	if back != Vector2.ZERO:
		var bq := QuadMesh.new(); bq.size = back; var bm := MeshInstance3D.new(); bm.mesh = bq; bm.position = p + Vector3(0, 0, -0.0015); bm.material_override = _mat(Color(0.02, 0.02, 0.03)); par.add_child(bm)
	var mt := StandardMaterial3D.new(); mt.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; mt.albedo_texture = (scr[kind].vp as SubViewport).get_texture(); mi.material_override = mt
	par.add_child(mi)
	if kind == "nd": _item(mi, "scr", "ndrange", Vector3(sz * 0.5, sz * 0.5, 0.01), Vector3.ZERO)

func _pilots_glb() -> void:
	for i in range(2):
		var pm: Node3D = (load("res://assets/people/readyplayer.me.glb") as PackedScene).instantiate()
		var sc := 0.95
		pm.scale = Vector3(sc, sc, sc); pm.rotation.y = PI
		pm.position = Vector3((-1.0 if i == 0 else 1.0) * SEAT_X, EYE_Y - 0.92 - 0.55, 0.12)
		root.add_child(pm); _dress(pm, i); pilots.append(pm)

# ---------- сборка ----------
func _build() -> void:
	if glb:
		_build_glb(); return
	var ab := style == "airbus"
	var dk := Color(0.17, 0.19, 0.23) if ab else Color(0.13, 0.14, 0.16); var md := Color(0.3, 0.32, 0.36) if ab else Color(0.24, 0.25, 0.28); var wall := Color(0.55, 0.56, 0.6) if ab else Color(0.46, 0.47, 0.5); var ceil_c := Color(0.55, 0.56, 0.58)
	var I := Transform3D.IDENTITY
	# оболочка кабины
	_sb(_xf(Vector3(0, -1.02, 0.0)), Vector3(2.4, 0.04, 2.6), Color(0.14, 0.14, 0.16))                # пол
	_sb(_xf(Vector3(0, 0.82, 0.0)), Vector3(2.4, 0.04, 2.6), ceil_c)                                   # потолок
	_sb(_xf(Vector3(0, -0.1, 1.1)), Vector3(2.4, 1.9, 0.06), wall)                                      # задняя стена
	_sb(_xf(Vector3(0.0, -0.25, 1.065)), Vector3(0.75, 1.5, 0.03), Color(0.32, 0.33, 0.36))           # дверь
	_sb(_xf(Vector3(0.28, -0.3, 1.045)), Vector3(0.04, 0.14, 0.03), Color(0.7, 0.7, 0.72))             # ручка двери
	for sx in [-1.0, 1.0]:
		_sb(_xf(Vector3(sx * 1.17, -0.62, 0.1)), Vector3(0.06, 0.8, 2.2), wall)                         # боковая стена снизу
		_sb(_xf(Vector3(sx * 1.17, 0.55, 0.1)), Vector3(0.06, 0.55, 2.2), wall)                         # сверху
		_sb(_xf(Vector3(sx * 1.17, 0.0, 1.0)), Vector3(0.06, 0.4, 0.4), wall)                           # за окном
		for zz in [-0.85, -0.2, 0.35]:
			_sb(_xf(Vector3(sx * 1.16, 0.12, zz)), Vector3(0.07, 0.62, 0.05), dk)                       # стойки боковых окон
		_sb(_xf(Vector3(sx * 1.16, 0.43, -0.2)), Vector3(0.07, 0.05, 1.3), dk)
		_sb(_xf(Vector3(sx * 1.1, -0.2, -0.3)), Vector3(0.1, 0.06, 1.3), md)                            # подоконник
	# лобовые: стёкла наклонены назад на 15°, нижняя кромка стекла — 1,1 м от пола кабины (пол y=-1.02, кромка y=0.08)
	var rk := 15.0; var tk := tan(deg_to_rad(rk)); var yb := 0.08; var gh := 0.62
	var zr := func(y: float) -> float: return -1.2 + (y - yb) * tk
	_sb(_xf(Vector3(0, yb - 0.13, zr.call(yb - 0.13)), Vector3(rk, 0, 0)), Vector3(2.4, 0.26, 0.06), dk)                 # нижний подоконник
	_sb(_xf(Vector3(0, yb + gh + 0.06, zr.call(yb + gh + 0.06)), Vector3(rk, 0, 0)), Vector3(2.4, 0.12, 0.06), Color(0.3, 0.31, 0.34))   # верхняя балка
	for px in [-1.0, -0.43, 0.0, 0.43, 1.0]:
		_sb(_xf(Vector3(px, yb + gh * 0.5, zr.call(yb + gh * 0.5)), Vector3(rk, 0, 0)), Vector3(0.05 if absf(px) < 0.9 else 0.1, gh, 0.06), dk)
	var gq := MeshInstance3D.new(); var gqm := QuadMesh.new(); gqm.size = Vector2(2.0, gh / cos(deg_to_rad(rk))); gq.mesh = gqm
	var gmt := StandardMaterial3D.new(); gmt.albedo_color = Color(0.6, 0.8, 1.0, 0.06); gmt.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA; gmt.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; gmt.cull_mode = BaseMaterial3D.CULL_DISABLED
	gq.material_override = gmt; gq.transform = _xf(Vector3(0, yb + gh * 0.5, zr.call(yb + gh * 0.5) + 0.032), Vector3(rk, 0, 0)); root.add_child(gq)
	# козырёк
	_sb(_xf(Vector3(0, -0.035, -0.98), Vector3(-6, 0, 0)), Vector3(2.3, 0.035, 0.42), Color(0.05, 0.055, 0.06))
	# основная приборная панель
	var pn := _panel(Vector3(0, -0.34, -0.82), Vector3(0, 0.15, 1.0), Vector3(0, 1, -0.15), Vector2(2.3, 0.62), dk)
	_main_panel(pn)
	_glareshield()
	_overhead()
	_pedestal()
	_yokes_seats()
	_side_consoles()
	_lights_in()
	_pilots()

func _display(pn: Node3D, p: Vector2, sz: Vector2, kind: String, px: Vector2i) -> void:
	_sb(pn.transform * _xf(Vector3(p.x, p.y, 0.0)), Vector3(sz.x + 0.016, sz.y + 0.016, 0.006), Color(0.03, 0.03, 0.035))
	if not scr.has(kind):
		var sv := SubViewport.new(); sv.size = px; sv.render_target_update_mode = SubViewport.UPDATE_DISABLED; sv.transparent_bg = false; add_child(sv)
		var ins := Control.new(); ins.set_script(load("res://instr.gd")); ins.set("kind", kind); sv.add_child(ins)
		scr[kind] = {"vp": sv, "ins": ins}
	var qm := QuadMesh.new(); qm.size = sz
	var mi := MeshInstance3D.new(); mi.mesh = qm; mi.position = Vector3(p.x, p.y, 0.0032)
	var m := StandardMaterial3D.new(); m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; m.albedo_texture = (scr[kind].vp as SubViewport).get_texture(); mi.material_override = m
	pn.add_child(mi)
	if kind == "nd": _item(mi, "scr", "ndrange", Vector3(sz.x * 0.5, sz.y * 0.5, 0.01), Vector3.ZERO)

func _main_panel(pn: Node3D) -> void:
	var dk := Color(0.085, 0.09, 0.1)
	_display(pn, Vector2(-0.7, 0.115), Vector2(0.22, 0.22), "pfd", Vector2i(256, 256))
	_display(pn, Vector2(-0.44, 0.115), Vector2(0.22, 0.22), "nd", Vector2i(256, 256))
	_display(pn, Vector2(0.0, 0.17), Vector2(0.19, 0.13), "eng", Vector2i(256, 176))
	_display(pn, Vector2(0.0, -0.025), Vector2(0.17, 0.2), "sys", Vector2i(280, 340))
	_display(pn, Vector2(0.44, 0.115), Vector2(0.22, 0.22), "nd", Vector2i(256, 256))
	_display(pn, Vector2(0.7, 0.115), Vector2(0.22, 0.22), "pfd", Vector2i(256, 256))
	# ряды кнопок под дисплеями (DSPL, MENU, CTR, TFC, WXR, STA, WPT, ARPT, DATA, POS)
	var nd_l := ["WXR", "STA", "WPT", "ARPT", "DATA", "POS", "TFC", "CTR"]
	for side in [-1.0, 1.0]:
		for i in range(8):
			var x: float = side * (0.31 + i * 0.0 ) + (-0.034 * 3.5 + i * 0.034) * 1.0 if false else side * 0.44 + (-0.119 + i * 0.034)
			_push(pn, Vector3(x, -0.0, 0.0), Vector2(0.024, 0.014), Color(0.3, 0.32, 0.36), "", nd_l[i])
		# автомат/сигнальные кнопки под PFD
		for i in range(6):
			var x2: float = side * 0.7 + (-0.085 + i * 0.034)
			_push(pn, Vector3(x2, -0.0, 0.0), Vector2(0.024, 0.014), Color(0.3, 0.32, 0.36), "", ["SPD", "ALT", "FPV", "MTRS", "BARO", "RST"][i])
	# шасси, автоторможение, закрылки-индикаторы
	var gl := _panel_sub(pn, Vector3(0.245, -0.075, 0.0))
	gear_lever = _gear_lever(pn, Vector3(0.245, -0.12, 0.0))
	for i in range(3):
		var lm := StandardMaterial3D.new(); lm.albedo_color = Color(0.1, 0.5, 0.15); lm.emission_enabled = true; lm.emission = Color(0.1, 1.0, 0.25); lm.emission_energy_multiplier = 1.4
		var mi := MeshInstance3D.new(); var bm := BoxMesh.new(); bm.size = Vector3(0.016, 0.016, 0.006); mi.mesh = bm; mi.material_override = lm; mi.position = Vector3(0.214 + i * 0.03, -0.205, 0.003); pn.add_child(mi)
		(mcp as Dictionary).get_or_add("gl", []).append(lm)
	_lab(pn, "GEAR", Vector3(0.245, -0.052, 0), 0.007)
	_hint(pn, "ШАССИ", Vector3(0.245, 0.0, 0.07))
	_hint(pn, "АВТОТОРМОЗ", Vector3(-0.245, -0.04, 0.07))
	var ab := _knob(pn, Vector3(-0.245, -0.12, 0.0), "AUTO BRAKE", 6, "abrk", 0.018, 1)
	ab["lab"] = true; mcp["abrk"] = ab
	for i in range(6): _lab(pn, ["RTO", "OFF", "1", "2", "3", "MAX"][i], Vector3(-0.245 + (i - 2.5) * 0.017, -0.07, 0), 0.005, Color(0.7, 0.75, 0.8))
	# нижний ряд мелких кнопок и тумблеров по панели
	var bl := ["FUEL", "HYD", "ELEC", "DOOR", "ENG", "FLT", "AIR", "PRESS", "ADIRU", "FMC"]
	for side in [-1.0, 1.0]:
		for i in range(10): _push(pn, Vector3(side * 0.69 + (-0.153 + i * 0.034), -0.205, 0.0), Vector2(0.024, 0.014), Color(0.22, 0.24, 0.28), "", bl[i])
	for i in range(6): _tog(pn, Vector3(-0.1 + i * 0.04, -0.255, 0.0), ["L", "R", "ALT", "TEST", "RESET", "OVRD"][i])
	# резервные приборы (маленькие круглые)
	for i in range(3):
		_sc(pn.transform * _xf(Vector3(-0.1 + i * 0.1, -0.12, 0.003), Vector3(90, 0, 0)), 0.03, 0.005, Color(0.01, 0.015, 0.02))
		_sc(pn.transform * _xf(Vector3(-0.1 + i * 0.1, -0.12, 0.0055), Vector3(90, 0, 0)), 0.024, 0.004, [Color(0.15, 0.3, 0.55), Color(0.1, 0.2, 0.15), Color(0.2, 0.2, 0.22)][i])
	_lab(pn, "ISFD", Vector3(-0.1, -0.16, 0), 0.006)
	# часы
	_lab(pn, "UTC", Vector3(-0.97, 0.2, 0), 0.01, Color(1, 0.8, 0.3)); mcp["clk"] = _lab(pn, "12:00", Vector3(-0.97, 0.175, 0), 0.016, Color(1, 0.8, 0.3))
	# сигнальные лампы пожара/предупреждений слева и справа
	for side in [-1.0, 1.0]:
		var wn := _push(pn, Vector3(side * 1.0, 0.12, 0.0), Vector2(0.05, 0.05), Color(0.5, 0.05, 0.04), "", "FIRE", Color(1, 0.15, 0.1))
		var cn := _push(pn, Vector3(side * 1.0, 0.04, 0.0), Vector2(0.05, 0.05), Color(0.5, 0.35, 0.02), "", "CAUT", Color(1, 0.7, 0.1))
		wn["lit_on"] = false; cn["lit_on"] = false

func _panel_sub(pn: Node3D, p: Vector3) -> Node3D:
	_sb(pn.transform * _xf(p), Vector3(0.12, 0.02, 0.004), Color(0.04, 0.04, 0.045)); return pn

func _gear_lever(pn: Node3D, p: Vector3) -> Node3D:
	_sb(pn.transform * _xf(p + Vector3(0, 0, 0.001)), Vector3(0.05, 0.1, 0.004), Color(0.03, 0.03, 0.035))   # направляющая
	var pv := Node3D.new(); pv.position = p + Vector3(0, 0, 0.004); pn.add_child(pv)
	var cm := CylinderMesh.new(); cm.top_radius = 0.0035; cm.bottom_radius = 0.0035; cm.height = 0.05; cm.radial_segments = 6
	var st := MeshInstance3D.new(); st.mesh = cm; st.material_override = _mat(Color(0.75, 0.76, 0.8)); st.rotation_degrees = Vector3(90, 0, 0); st.position = Vector3(0, 0, 0.026); pv.add_child(st)
	var wm := CylinderMesh.new(); wm.top_radius = 0.017; wm.bottom_radius = 0.017; wm.height = 0.016; wm.radial_segments = 14
	var kn := MeshInstance3D.new(); kn.mesh = wm; kn.material_override = _mat(Color(0.05, 0.05, 0.06)); kn.rotation_degrees = Vector3(90, 0, 0); kn.position = Vector3(0, 0, 0.056); pv.add_child(kn)
	var it := _item(pv, "lever", "gear", Vector3(0.028, 0.03, 0.03), Vector3(0, 0, 0.04)); it["kk"] = "gear"
	return pv

func _glareshield() -> void:
	var gs := _panel(Vector3(0, -0.03, -0.92), Vector3(0, 0.88, 0.48), Vector3(0, 0.48, -0.88), Vector2(0.9, 0.125), Color(0.06, 0.065, 0.07))
	_lab(gs, "FCU" if style == "airbus" else "MCP", Vector3(-0.44, 0.052, 0), 0.008, Color(0.9, 0.9, 0.95))
	# дисплеи MCP
	var vals := [["SPD", -0.30], ["HDG", -0.1], ["ALT", 0.12], ["V/S", 0.31]]
	for v in vals:
		_sb(gs.transform * _xf(Vector3(float(v[1]), 0.036, 0.0)), Vector3(0.1, 0.026, 0.004), Color(0.0, 0.0, 0.0))
		mcp[str(v[0])] = _lab(gs, "---", Vector3(float(v[1]) - 0.04, 0.036 + 0.0105, 0.0), 0.017, Color(1.0, 0.6, 0.15))
		_lab(gs, str(v[0]), Vector3(float(v[1]) - 0.045, 0.057, 0), 0.0055, Color(0.8, 0.8, 0.85))
	_hint(gs, "АВТОПИЛОТ", Vector3(0.42, 0.1, 0.05)); _hint(gs, "АВТОТЯГА", Vector3(-0.43, 0.1, 0.05)); _hint(gs, "ВЫСОТА ▲▼", Vector3(0.135, -0.075, 0.05)); _hint(gs, "ПОСАДКА", Vector3(-0.046, -0.06, 0.05)); _hint(gs, "НАВИГАЦИЯ", Vector3(0.328, -0.06, 0.05))
	# ручки
	_knob(gs, Vector3(-0.30, 0.0, 0), "", 8, "", 0.016); _knob(gs, Vector3(-0.1, 0.0, 0), "", 8, "", 0.016); _knob(gs, Vector3(0.12, 0.0, 0), "", 8, "", 0.016); _knob(gs, Vector3(0.31, 0.0, 0), "", 8, "", 0.016)
	_push(gs, Vector3(0.12, -0.036, 0), Vector2(0.024, 0.014), Color(0.3, 0.32, 0.36), "altu", "▲")
	_push(gs, Vector3(0.15, -0.036, 0), Vector2(0.024, 0.014), Color(0.3, 0.32, 0.36), "altd", "▼")
	# кнопки режимов
	var mode_l := [["N1", ""], ["SPD", ""], ["LVL CHG", ""], ["HDG SEL", ""], ["APP", "appr"], ["ALT HLD", ""], ["V/S", ""], ["VNAV", ""], ["LNAV", "nav"], ["VOR LOC", ""]]
	for i in range(mode_l.size()):
		var x: float = -0.42 + i * 0.0935
		var it := _push(gs, Vector3(x, 0.0, 0), Vector2(0.034, 0.016), Color(0.22, 0.23, 0.26), str(mode_l[i][1]), str(mode_l[i][0]), Color(0.3, 1.0, 0.4))
		it["hot"] = i
	_tog(gs, Vector3(-0.43, 0.036, 0), "A/T", "at", true, Color(0.85, 0.85, 0.88), true)
	_tog(gs, Vector3(-0.395, 0.036, 0), "F/D", "", true, Color(0.85, 0.85, 0.88), true)
	_push(gs, Vector3(0.40, 0.034, 0), Vector2(0.036, 0.02), Color(0.2, 0.25, 0.3), "ap", "CMD A", Color(0.3, 1, 0.4))
	_push(gs, Vector3(0.40, -0.012, 0), Vector2(0.036, 0.02), Color(0.2, 0.25, 0.3), "ap", "CMD B", Color(0.3, 1, 0.4))
	_push(gs, Vector3(0.44, 0.034, 0), Vector2(0.036, 0.02), Color(0.25, 0.25, 0.28), "", "CWS A")
	_push(gs, Vector3(0.44, -0.012, 0), Vector2(0.036, 0.02), Color(0.25, 0.25, 0.28), "", "CWS B")
	_push(gs, Vector3(-0.43, -0.032, 0), Vector2(0.04, 0.014), Color(0.3, 0.1, 0.1), "ap", "DISENGAGE")
	# мастер-лампы по краям козырька
	for side in [-1.0, 1.0]:
		var g2 := _panel(Vector3(side * 0.68, -0.03, -0.92), Vector3(0, 0.88, 0.48), Vector3(0, 0.48, -0.88), Vector2(0.34, 0.125), Color(0.06, 0.065, 0.07))
		var mw := _push(g2, Vector3(-0.1 * side, 0.02, 0), Vector2(0.05, 0.04), Color(0.45, 0.04, 0.03), "", "WARNING", Color(1, 0.15, 0.1))
		var mc := _push(g2, Vector3(0.0, 0.02, 0), Vector2(0.05, 0.04), Color(0.45, 0.33, 0.02), "", "CAUTION", Color(1, 0.7, 0.1))
		mw["flash"] = true; mc["flash"] = true
		for i in range(6):
			_push(g2, Vector3(-0.12 + i * 0.045, -0.04, 0), Vector2(0.032, 0.016), Color(0.18, 0.2, 0.23), "", ["FLT", "FUEL", "ELEC", "APU", "OVHT", "ANTI"][i], Color(1, 0.7, 0.1))
	for i in range(6): _lab(gs, "", Vector3.ZERO, 0.001)

func _overhead() -> void:
	var up := Vector3(0, -0.664, -0.748)
	var ov := _panel(Vector3(0, 0.66, -0.56), Vector3(0, -0.748, 0.664), up, Vector2(1.5, 0.86), Color(0.34, 0.36, 0.4))
	# x в локали панели зеркален: мировой +x = локальный -x. Секции раскладываем как видит пилот.
	var sec := func(title: String, c: Vector2, sz: Vector2) -> void:
		_sb(ov.transform * _xf(Vector3(-c.x, c.y, 0.0)), Vector3(sz.x, sz.y, 0.004), Color(0.21, 0.23, 0.27))
		_lab(ov, title, Vector3(-c.x - sz.x * 0.5 + 0.01, c.y + sz.y * 0.5 - 0.011, 0), 0.0075, Color(0.95, 0.95, 0.97))
	# --- левый блок: FLT CONTROL, FUEL, ELEC, HYD (x от -0.72 до -0.3)
	sec.call("FLIGHT CONTROL", Vector2(-0.6, 0.35), Vector2(0.28, 0.12))
	for i in range(4): _push(ov, Vector3(-(-0.7 + i * 0.07), 0.345, 0), Vector2(0.04, 0.024), Color(0.22, 0.24, 0.27), "", ["FLT A", "FLT B", "SPLR A", "SPLR B"][i], Color(0.3, 0.9, 1))
	_tog(ov, Vector3(0.62, 0.3, 0), "YAW DAMP", "", true)
	sec.call("FUEL", Vector2(-0.58, 0.18), Vector2(0.34, 0.16))
	for i in range(6): _push(ov, Vector3(-(-0.7 + i * 0.05), 0.2, 0), Vector2(0.034, 0.03), Color(0.22, 0.24, 0.27), "", ["L FWD", "L AFT", "R FWD", "R AFT", "CTR L", "CTR R"][i], Color(0.3, 1, 0.5), true)
	_tog(ov, Vector3(0.52, 0.14, 0), "X-FEED", "", false)
	_tog(ov, Vector3(0.58, 0.14, 0), "FUEL TEST", "", false)
	sec.call("ELECTRICAL", Vector2(-0.6, 0.0), Vector2(0.32, 0.2))
	for i in range(5): _tog(ov, Vector3(0.72 - i * 0.056, -0.04, 0), ["BAT", "GEN 1", "GEN 2", "APU GEN", "STBY"][i], "", i < 3, Color(0.82, 0.83, 0.86), false)
	_knob(ov, Vector3(0.72, 0.03, 0), "AC", 5, "", 0.012, 2); _knob(ov, Vector3(0.64, 0.03, 0), "DC", 5, "", 0.012, 2); _knob(ov, Vector3(0.56, 0.03, 0), "STBY", 3, "", 0.012, 1)
	for i in range(4): _push(ov, Vector3(0.72 - i * 0.056, -0.09, 0), Vector2(0.034, 0.02), Color(0.22, 0.24, 0.27), "", ["BUS 1", "BUS 2", "TR1", "TR2"][i], Color(1, 0.7, 0.1))
	sec.call("HYDRAULICS", Vector2(-0.6, -0.2), Vector2(0.32, 0.16))
	for i in range(4): _push(ov, Vector3(0.72 - i * 0.07, -0.19, 0), Vector2(0.04, 0.028), Color(0.22, 0.24, 0.27), "", ["ENG 1", "ENG 2", "ELEC 1", "ELEC 2"][i], Color(1, 0.7, 0.1), true)
	sec.call("AIR COND / BLEED", Vector2(-0.6, -0.36), Vector2(0.34, 0.14))
	for i in range(5): _push(ov, Vector3(0.74 - i * 0.065, -0.35, 0), Vector2(0.04, 0.026), Color(0.22, 0.24, 0.27), "", ["L PACK", "R PACK", "BLD 1", "BLD 2", "APU BLD"][i], Color(0.3, 1, 0.5), i < 4)
	# --- центральный блок: двигатели, APU, IRS, ANTI-ICE
	sec.call("ENGINE START", Vector2(0.0, 0.33), Vector2(0.4, 0.15))
	_knob(ov, Vector3(0.1, 0.34, 0), "START 1", 4, "start", 0.016, 1); _knob(ov, Vector3(-0.1, 0.34, 0), "START 2", 4, "start", 0.016, 1)
	_knob(ov, Vector3(0.0, 0.34, 0), "IGN", 3, "", 0.012, 1)
	_push(ov, Vector3(0.27, 0.33, 0), Vector2(0.06, 0.06), Color(0.9, 0.06, 0.04), "ext", "ENG 1 FIRE", Color(1.0, 0.2, 0.1)); _push(ov, Vector3(-0.27, 0.33, 0), Vector2(0.06, 0.06), Color(0.9, 0.06, 0.04), "ext", "ENG 2 FIRE", Color(1.0, 0.2, 0.1))
	_tog(ov, Vector3(0.16, 0.32, 0), "L EEC", "", true); _tog(ov, Vector3(-0.16, 0.32, 0), "R EEC", "", true)
	sec.call("ANTI-ICE", Vector2(0.0, 0.17), Vector2(0.4, 0.12))
	for i in range(6): _tog(ov, Vector3(0.16 - i * 0.064, 0.15, 0), ["ENG 1", "ENG 2", "WING", "PROBE A", "PROBE B", "WSHLD"][i], "", false)
	sec.call("APU", Vector2(0.0, 0.02), Vector2(0.4, 0.12))
	_knob(ov, Vector3(0.08, 0.02, 0), "APU", 3, "", 0.016, 0); _tog(ov, Vector3(-0.02, 0.02, 0), "MAINT", "", false)
	_push(ov, Vector3(-0.1, 0.02, 0), Vector2(0.044, 0.026), Color(0.3, 0.1, 0.1), "", "APU FIRE", Color(1, 0.15, 0.1)); _push(ov, Vector3(0.16, 0.02, 0), Vector2(0.036, 0.026), Color(0.22, 0.24, 0.27), "", "LOW OIL", Color(1, 0.7, 0.1))
	sec.call("IRS / NAV", Vector2(0.0, -0.13), Vector2(0.4, 0.14))
	_knob(ov, Vector3(0.12, -0.13, 0), "IRS L", 4, "", 0.014, 2); _knob(ov, Vector3(-0.12, -0.13, 0), "IRS R", 4, "", 0.014, 2)
	for i in range(4): _push(ov, Vector3(0.04 - i * 0.027, -0.12, 0), Vector2(0.022, 0.018), Color(0.22, 0.24, 0.27), "", ["ALIGN", "ON DC", "FAULT", "DC FAIL"][i], Color(1, 0.7, 0.1))
	_knob(ov, Vector3(0.16, -0.17, 0), "DSPL", 3, "", 0.01, 1); _knob(ov, Vector3(-0.16, -0.17, 0), "SRC", 3, "", 0.01, 1)
	sec.call("FIRE PROTECTION", Vector2(0.0, -0.3), Vector2(0.4, 0.16))
	for i in range(3):
		var fp := _push(ov, Vector3(0.12 - i * 0.12, -0.29, 0), Vector2(0.05, 0.05), Color(0.5, 0.06, 0.05), "", ["ENG 1", "APU", "ENG 2"][i], Color(1, 0.12, 0.08))
		fp["lit_on"] = false
	for i in range(4): _push(ov, Vector3(0.14 - i * 0.09, -0.36, 0), Vector2(0.034, 0.016), Color(0.22, 0.24, 0.27), "", ["TEST", "LOOP A", "LOOP B", "EXT"][i], Color(0.3, 1, 0.5))
	# --- правый блок: LIGHTS, SIGNS, WINDOW HEAT, WIPERS
	sec.call("EXTERIOR LIGHTS", Vector2(0.6, 0.3), Vector2(0.36, 0.22))
	var ex := [["LAND L", "land", true], ["LAND R", "land", true], ["RWY L", "", false], ["RWY R", "", false], ["TAXI", "", false], ["STROBE", "strobe", true], ["POSITION", "nav", true], ["BEACON", "beacon", true], ["LOGO", "", false], ["WING", "", false]]
	for i in range(ex.size()):
		var col := i % 5; var row := i / 5
		var tg := _tog(ov, Vector3(-(0.43 + col * 0.07), 0.34 - row * 0.09, 0), str(ex[i][0]), "light:" + str(ex[i][1]) if str(ex[i][1]) != "" else "", bool(ex[i][2]), Color(0.82, 0.83, 0.86), false)
		tg["lkind"] = str(ex[i][1])
	sec.call("PASSENGER SIGNS", Vector2(0.6, 0.12), Vector2(0.36, 0.1))
	_knob(ov, Vector3(-0.46, 0.12, 0), "SEAT BELTS", 3, "seatbelt", 0.014, 1); _knob(ov, Vector3(-0.58, 0.12, 0), "NO SMOKING", 3, "", 0.014, 1); _tog(ov, Vector3(-0.7, 0.12, 0), "EMER EXIT", "", false)
	sec.call("PANEL LIGHTS", Vector2(0.6, -0.02), Vector2(0.36, 0.14))
	for i in range(6): _knob(ov, Vector3(-(0.46 + i * 0.06), -0.02, 0), ["PANEL", "FLOOD", "DOME", "MAP", "STORM", "DIM"][i], 5, "", 0.012, 3)
	sec.call("WINDOW HEAT / WIPERS", Vector2(0.6, -0.18), Vector2(0.36, 0.14))
	for i in range(4): _push(ov, Vector3(-(0.45 + i * 0.05), -0.17, 0), Vector2(0.034, 0.024), Color(0.22, 0.24, 0.27), "", ["L SIDE", "L FWD", "R FWD", "R SIDE"][i], Color(0.3, 1, 0.5), true)
	_knob(ov, Vector3(-0.7, -0.17, 0), "WIPER L", 4, "", 0.014, 0); _knob(ov, Vector3(-0.76, -0.17, 0), "WIPER R", 4, "", 0.014, 0)
	sec.call("PRESSURIZATION", Vector2(0.6, -0.34), Vector2(0.36, 0.14))
	_knob(ov, Vector3(-0.46, -0.34, 0), "FLT ALT", 5, "", 0.013, 2); _knob(ov, Vector3(-0.54, -0.34, 0), "LAND ALT", 5, "", 0.013, 2); _knob(ov, Vector3(-0.62, -0.34, 0), "MODE", 3, "", 0.013, 0)
	_tog(ov, Vector3(-0.7, -0.34, 0), "OUTFLOW", "", false); _tog(ov, Vector3(-0.76, -0.34, 0), "PAX OXY", "", false)
	_lab(ov, "OVERHEAD", Vector3(-0.0, -0.405, 0), 0.01, Color(0.6, 0.62, 0.66))

func _pedestal() -> void:
	var dk := Color(0.1, 0.105, 0.115); var md := Color(0.2, 0.21, 0.23)
	_sb(_xf(Vector3(0, -0.8, 0.0)), Vector3(0.36, 0.5, 1.4), dk)
	var top := _panel(Vector3(0, -0.545, 0.1), Vector3(0, 1, 0), Vector3(0, 0, -1), Vector2(0.34, 0.7), md)   # верхняя плоскость
	# рычаги тяги
	for i in range(2):
		var pv := Node3D.new(); pv.position = Vector3(-0.04 + i * 0.08, 0.0, 0.0); top.add_child(pv)
		var piv := Node3D.new(); piv.position = Vector3(0, -0.0, 0.16); pv.add_child(piv)
		var cm := BoxMesh.new(); cm.size = Vector3(0.016, 0.012, 0.13)
		var arm := MeshInstance3D.new(); arm.mesh = cm; arm.material_override = _mat(Color(0.12, 0.12, 0.13)); arm.position = Vector3(0, 0.0, 0.0); piv.add_child(arm)
		var kn := MeshInstance3D.new(); var sm := SphereMesh.new(); sm.radius = 0.02; sm.height = 0.04; kn.mesh = sm; kn.material_override = _mat(Color(0.06, 0.06, 0.07)); kn.position = Vector3(0, 0.0, -0.07); piv.add_child(kn)
		thr_lev.append(piv)
		_item(piv, "lever", "", Vector3(0.03, 0.04, 0.09), Vector3(0, 0, -0.04))
	_push(top, Vector3(-0.04, 0.005, 0.07), Vector2(0.03, 0.02), Color(0.7, 0.7, 0.72), "ga", "TO/GA")
	_push(top, Vector3(0.04, 0.005, 0.07), Vector2(0.03, 0.02), Color(0.7, 0.7, 0.72), "ga", "TO/GA")
	_push(top, Vector3(0.0, 0.005, 0.04), Vector2(0.034, 0.02), Color(0.3, 0.1, 0.1), "rev", "REVERSE")
	_eng_strip(top, Vector3(0.0, 0.004, 0.33), 0.0, 0.8)
	_push(top, Vector3(-0.0, 0.005, 0.01), Vector2(0.034, 0.02), Color(0.3, 0.3, 0.34), "at", "A/T DISC")
	# спойлеры и закрылки (рычаги по бокам)
	spd_lever = _side_lever(top, Vector3(-0.105, 0.0, 0.03), "SPEED BRAKE", Color(0.85, 0.7, 0.1), "")
	flap_lever = _side_lever(top, Vector3(0.105, 0.0, 0.03), "FLAPS", Color(0.1, 0.1, 0.11), "fl")
	# стояночный тормоз
	park_lever = _side_lever(top, Vector3(0.105, 0.0, 0.22), "PARK BRAKE", Color(0.8, 0.12, 0.1), "brake")
	_hint(top, "СТОЯНОЧНЫЙ ТОРМОЗ", Vector3(0.105, 0.12, 0.25)); _hint(top, "ЗАКРЫЛКИ", Vector3(0.105, 0.11, 0.0)); _hint(top, "ТЯГА", Vector3(0.0, 0.1, 0.3)); _hint(top, "РЕВЕРС", Vector3(0.0, 0.07, -0.02))
	# колёса триммера
	for sx in [-1.0, 1.0]:
		var tw := Node3D.new(); tw.position = Vector3(sx * 0.19, 0.0, 0.02); top.add_child(tw)
		var tm := CylinderMesh.new(); tm.top_radius = 0.07; tm.bottom_radius = 0.07; tm.height = 0.02; tm.radial_segments = 20
		var wmi := MeshInstance3D.new(); wmi.mesh = tm; wmi.material_override = _mat(Color(0.08, 0.08, 0.09)); wmi.rotation_degrees = Vector3(0, 0, 90); wmi.position = Vector3(0, -0.01, 0.0); tw.add_child(wmi)
		for k in range(8):
			var ang := TAU * k / 8.0
			_sb(top.transform * _xf(Vector3(sx * 0.19, -0.01 + sin(ang) * 0.07, 0.02 + cos(ang) * 0.07)), Vector3(0.024, 0.006, 0.006), Color(0.9, 0.9, 0.92))
		var ti := _item(tw, "knob", "", Vector3(0.03, 0.07, 0.07), Vector3.ZERO); ti["steps"] = 8; ti["spin"] = true
	# CDU: два блока по 50 клавиш
	var cdu := _panel(Vector3(0, -0.56, -0.36), Vector3(0, 0.55, 0.83), Vector3(0, 0.83, -0.55), Vector2(0.32, 0.26), Color(0.08, 0.08, 0.09))
	for ci in range(2):
		var ox := -0.08 + ci * 0.16 if false else (-0.08 if ci == 0 else 0.08)
		_sb(cdu.transform * _xf(Vector3(ox, 0.07, 0.0)), Vector3(0.12, 0.08, 0.004), Color(0.0, 0.03, 0.0))
		var lt := _lab(cdu, "FMC  %s\nIDENT\nACTIVE NAV DATA" % ["CDU-L", "CDU-R"][ci], Vector3(ox - 0.055, 0.1, 0.0), 0.0075, Color(0.35, 1, 0.5)); mcp["cdu%d" % ci] = lt
		for r in range(6):
			for c in range(5):
				var kk := _push(cdu, Vector3(ox - 0.05 + c * 0.025, 0.0 - r * 0.0215, 0.0), Vector2(0.018, 0.015), Color(0.25, 0.26, 0.29) if (r * 5 + c) % 3 else Color(0.33, 0.34, 0.37), "", "")
				kk["cdu"] = true
		for c in range(4): _push(cdu, Vector3(ox - 0.04 + c * 0.027, -0.13, 0.0), Vector2(0.022, 0.012), Color(0.35, 0.2, 0.1), "", ["EXEC", "DEL", "CLR", "NEXT"][c])
	# радио и связь
	var rp := _panel(Vector3(0, -0.545, 0.55), Vector3(0, 1, 0), Vector3(0, 0, -1), Vector2(0.34, 0.3), md)
	_sb(rp.transform * _xf(Vector3(0, 0.1, 0.0)), Vector3(0.28, 0.04, 0.004), Color(0, 0, 0))
	mcp["com"] = _lab(rp, "118.100    121.500", Vector3(-0.065, 0.113, 0), 0.015, Color(1.0, 0.55, 0.15))
	var ra := _push(rp, Vector3(-0.1, 0.06, 0), Vector2(0.044, 0.022), Color(0.25, 0.3, 0.35), "radio", "RADIO"); ra["lit_on"] = false
	_push(rp, Vector3(0.0, 0.06, 0), Vector2(0.044, 0.022), Color(0.25, 0.3, 0.35), "", "XFER"); _push(rp, Vector3(0.1, 0.06, 0), Vector2(0.044, 0.022), Color(0.25, 0.3, 0.35), "", "TEST")
	_knob(rp, Vector3(-0.1, 0.0, 0), "COM", 4, "", 0.016, 1); _knob(rp, Vector3(0.1, 0.0, 0), "NAV", 4, "", 0.016, 1); _knob(rp, Vector3(0.0, 0.0, 0), "VOL", 5, "", 0.014, 3)
	for i in range(8): _push(rp, Vector3(-0.115 + i * 0.033, -0.06, 0), Vector2(0.024, 0.016), Color(0.25, 0.26, 0.3), "", ["VHF1", "VHF2", "HF", "INT", "CAB", "PA", "NAV", "ADF"][i], Color(0.3, 1, 0.5), i < 2)
	var xp := _panel(Vector3(0, -0.545, 0.88), Vector3(0, 1, 0), Vector3(0, 0, -1), Vector2(0.34, 0.2), md)
	_sb(xp.transform * _xf(Vector3(0, 0.05, 0.0)), Vector3(0.14, 0.036, 0.004), Color(0, 0, 0)); _lab(xp, "XPNDR 2000", Vector3(-0.06, 0.06, 0), 0.015, Color(1, 0.55, 0.15))
	for i in range(8): _push(xp, Vector3(-0.115 + i * 0.033, -0.02, 0), Vector2(0.024, 0.016), Color(0.25, 0.26, 0.3), "", str(i))
	_knob(xp, Vector3(-0.12, -0.07, 0), "MODE", 5, "", 0.013, 2); _tog(xp, Vector3(0.0, -0.07, 0), "IDENT", "", false); _tog(xp, Vector3(0.1, -0.07, 0), "TCAS", "", true)

func _side_lever(top: Node3D, p: Vector3, label: String, col: Color, act: String) -> Node3D:
	_sb(top.transform * _xf(p + Vector3(0, 0.0, 0.0)), Vector3(0.03, 0.004, 0.17), Color(0.02, 0.02, 0.025))
	var pv := Node3D.new(); pv.position = p + Vector3(0, 0.0, 0.0); top.add_child(pv)
	var st := MeshInstance3D.new(); var bm := BoxMesh.new(); bm.size = Vector3(0.008, 0.045, 0.008); st.mesh = bm; st.material_override = _mat(Color(0.7, 0.72, 0.76)); st.position = Vector3(0, 0.0225, 0); pv.add_child(st)
	var kn := MeshInstance3D.new(); var cm := BoxMesh.new(); cm.size = Vector3(0.026, 0.02, 0.02); kn.mesh = cm; kn.material_override = _mat(col); kn.position = Vector3(0, 0.05, 0); pv.add_child(kn)
	var it := _item(pv, "lever", act, Vector3(0.026, 0.035, 0.02), Vector3(0, 0.04, 0)); it["kk"] = "lev"
	_lab(top, label, p + Vector3(0, 0.0, 0.1), 0.006)
	top.rotation = top.rotation
	return pv

func _yokes_seats() -> void:
	var dk := Color(0.07, 0.07, 0.08); var seatc := Color(0.18, 0.2, 0.26)
	for sgn in [-1.0, 1.0]:
		var x: float = sgn * SEAT_X
		# сиденье
		_sb(_xf(Vector3(x, -0.78, 0.18)), Vector3(0.5, 0.1, 0.5), seatc)
		_sb(_xf(Vector3(x, -0.33, 0.42), Vector3(-6, 0, 0)), Vector3(0.48, 0.75, 0.1), seatc)
		_sb(_xf(Vector3(x, 0.1, 0.45)), Vector3(0.22, 0.2, 0.08), seatc)
		_sb(_xf(Vector3(x + sgn * 0.3, -0.55, 0.15)), Vector3(0.07, 0.04, 0.38), dk)
		_sb(_xf(Vector3(x - sgn * 0.3, -0.55, 0.15)), Vector3(0.07, 0.04, 0.38), dk)
		_sb(_xf(Vector3(x, -0.9, 0.2)), Vector3(0.1, 0.25, 0.1), dk)
		if style == "airbus":
			# боковая ручка снаружи от каждого пилота
			var sx: float = sgn * 0.88
			_sb(_xf(Vector3(sx, -0.55, -0.02)), Vector3(0.1, 0.06, 0.2), Color(0.2, 0.21, 0.24))   # подлокотник-площадка
			var y := Node3D.new(); y.position = Vector3(sx, -0.5, -0.02); root.add_child(y)
			var bm := MeshInstance3D.new(); var bb := BoxMesh.new(); bb.size = Vector3(0.05, 0.03, 0.06); bm.mesh = bb; bm.material_override = _mat(dk); y.add_child(bm)
			var hm := MeshInstance3D.new(); var cm := CapsuleMesh.new(); cm.radius = 0.022; cm.height = 0.16; hm.mesh = cm; hm.material_override = _mat(Color(0.06, 0.06, 0.07)); hm.position = Vector3(0, 0.08, -0.01); hm.rotation_degrees = Vector3(-12, 0, 0); y.add_child(hm)
			var rb := MeshInstance3D.new(); var rbb := BoxMesh.new(); rbb.size = Vector3(0.012, 0.008, 0.012); rb.mesh = rbb; rb.material_override = _mat(Color(0.9, 0.15, 0.1)); rb.position = Vector3(-sgn * 0.02, 0.14, -0.03); y.add_child(rb)
			y.set_meta("ss", true); yokes.append(y)
			continue
		# колонка
		_sb(_xf(Vector3(x, -0.6, -0.55)), Vector3(0.05, 0.38, 0.05), Color(0.12, 0.12, 0.13))
		var y := Node3D.new(); y.position = Vector3(x, -0.38, -0.5); root.add_child(y)
		var tm := TorusMesh.new(); tm.inner_radius = 0.1; tm.outer_radius = 0.118; tm.rings = 18; tm.ring_segments = 8
		var ti := MeshInstance3D.new(); ti.mesh = tm; ti.material_override = _mat(Color(0.06, 0.06, 0.07)); ti.rotation_degrees = Vector3(90, 0, 0); y.add_child(ti)
		var hub := MeshInstance3D.new(); var hm2 := CylinderMesh.new(); hm2.top_radius = 0.035; hm2.bottom_radius = 0.035; hm2.height = 0.06; hub.mesh = hm2; hub.material_override = _mat(dk); hub.rotation_degrees = Vector3(90, 0, 0); y.add_child(hub)
		for sx2 in [-1.0, 1.0]:
			var gp := MeshInstance3D.new(); var gm := BoxMesh.new(); gm.size = Vector3(0.025, 0.07, 0.03); gp.mesh = gm; gp.material_override = _mat(Color(0.05, 0.05, 0.06)); gp.position = Vector3(sx2 * 0.118, 0.0, 0.0); y.add_child(gp)
			var bt := MeshInstance3D.new(); var bb2 := BoxMesh.new(); bb2.size = Vector3(0.012, 0.012, 0.012); bt.mesh = bb2; bt.material_override = _mat(Color(0.9, 0.9, 0.2)); bt.position = Vector3(sx2 * 0.118, 0.025, 0.02); y.add_child(bt)
		yokes.append(y)

func _side_consoles() -> void:
	var dk := Color(0.1, 0.105, 0.115); var md := Color(0.2, 0.21, 0.23)
	for sgn in [-1.0, 1.0]:
		var x: float = sgn * 1.08
		# боковая панель с тиллером и ручками окна
		var sp := _panel(Vector3(x - sgn * 0.01, -0.35, 0.0), Vector3(-sgn, 0.25, 0.1), Vector3(0, 1, 0), Vector2(0.7, 0.3), dk)
		_knob(sp, Vector3(-0.2 * sgn, 0.06, 0), "WINDOW", 3, "", 0.018, 1)
		for i in range(6): _push(sp, Vector3(0.02 + i * 0.045 * sgn, 0.06, 0), Vector2(0.03, 0.02), Color(0.25, 0.26, 0.3), "", ["VENT", "HEAT", "SHADE", "SLIDE", "OXY", "TEST"][i])
		for i in range(5): _tog(sp, Vector3(-0.1 + i * 0.05, -0.04, 0), ["MAP", "PA", "INT", "CALL", "ACP"][i], "", i % 2 == 0)
		# тиллер
		var tl := _panel(Vector3(x - sgn * 0.12, -0.55, -0.25), Vector3(-sgn * 0.5, 0.7, 0.5), Vector3(0, 1, -0.5), Vector2(0.12, 0.12), md)
		var tk := _knob(tl, Vector3(0, 0.0, 0), "TILLER", 3, "", 0.03, 1)
		_item(tl, "scr", "", Vector3(0.001, 0.001, 0.001), Vector3(100, 0, 0))
		# карманы, кружка, наушники
		_sb(_xf(Vector3(x - sgn * 0.06, -0.15, 0.62)), Vector3(0.1, 0.12, 0.3), md)
		_sb(_xf(Vector3(x - sgn * 0.05, -0.4, 0.6), Vector3(0, 0, 0)), Vector3(0.2, 0.3, 0.06), Color(0.14, 0.14, 0.16))
		_sb(_xf(Vector3(sgn * 0.8, -0.65, 0.75)), Vector3(0.28, 0.06, 0.24), Color(0.12, 0.1, 0.08))   # лётная сумка
	# подсветка кнопок разных зон — центральный столб
	_sb(_xf(Vector3(0, -0.62, -1.0)), Vector3(0.2, 0.12, 0.2), Color(0.05, 0.05, 0.055))

func _lights_in() -> void:
	for p in [Vector3(0, 0.74, 0.1), Vector3(-0.5, 0.6, 0.5), Vector3(0.5, 0.6, 0.5)]:
		var o := OmniLight3D.new(); o.position = p; o.omni_range = 2.8; o.light_energy = 0.25; o.light_color = Color(1, 0.92, 0.8); vp.add_child(o); amb_lamps.append(o)

func _pilots() -> void:
	for i in range(2):
		var m: Node3D = (load("res://assets/people/readyplayer.me.glb") as PackedScene).instantiate()
		var sc := 0.95
		m.scale = Vector3(sc, sc, sc); m.rotation.y = PI
		m.position = Vector3((-1.0 if i == 0 else 1.0) * SEAT_X, -0.73 - 0.97 * sc, 0.12)
		root.add_child(m); _dress(m, i); pilots.append(m)

func _skel(n: Node) -> Skeleton3D:
	if n is Skeleton3D: return n
	for c in n.get_children():
		var r := _skel(c)
		if r != null: return r
	return null

func _g(sk: Skeleton3D, bone: String, rot: Basis, from_rest: bool) -> void:
	var i := sk.find_bone(bone); if i < 0: return
	var par := sk.get_bone_parent(i)
	var pg: Basis = sk.get_bone_global_pose(par).basis if par >= 0 else Basis.IDENTITY
	var want: Basis = rot * sk.get_bone_global_rest(i).basis if from_rest else sk.get_bone_global_rest(i).basis * rot
	if from_rest and bone.ends_with("Leg") and not bone.ends_with("UpLeg"): want = sk.get_bone_global_rest(i).basis
	sk.set_bone_pose_rotation(i, (pg.inverse() * want).get_rotation_quaternion())

func _dress(n: Node, idx: int) -> void:
	# белая рубашка, тёмные брюки, фуражка скрыта; руки вперёд к штурвалу, сидя
	var sk := _skel(n)
	if sk != null:
		for a in [["LeftArm", -1.0], ["RightArm", 1.0]]: _g(sk, str(a[0]), Basis(Vector3(0, 0, 1), float(a[1])), true)
		for l in ["Left", "Right"]:
			_g(sk, l + "UpLeg", Basis(Vector3(1, 0, 0), -PI * 0.5), true)
			_g(sk, l + "Leg", Basis.IDENTITY, true)
		for l in ["Left", "Right"]: _g(sk, l + "ForeArm", Basis(Vector3(1, 0, 0), -0.9), false)
	for mi in _meshes(n):
		var nm := String((mi as Node).name).to_lower()
		for k in ["head", "hair", "eye", "teeth", "glass", "beard", "brow", "lash", "cap", "hat"]:
			if nm.contains(k): (mi as MeshInstance3D).visible = false
	_tint(n, idx)

func _tint(n: Node, idx: int) -> void:
	if n is MeshInstance3D:
		var mi := n as MeshInstance3D
		match mi.name:
			"Wolf3D_Headwear": mi.visible = false
			"Wolf3D_Beard": mi.visible = idx == 1
			"Wolf3D_Outfit_Top":
				var mt := mi.get_active_material(0).duplicate() as StandardMaterial3D
				mt.albedo_texture = null; mt.albedo_color = Color(0.93, 0.94, 0.96); mi.material_override = mt
			"Wolf3D_Outfit_Bottom":
				var mb := mi.get_active_material(0).duplicate() as StandardMaterial3D
				mb.albedo_texture = null; mb.albedo_color = Color(0.07, 0.08, 0.14); mi.material_override = mb
			"Wolf3D_Outfit_Footwear":
				var mf := mi.get_active_material(0).duplicate() as StandardMaterial3D
				mf.albedo_texture = null; mf.albedo_color = Color(0.04, 0.04, 0.05); mi.material_override = mf
	for c in n.get_children(): _tint(c, idx)

# ---------- управление ----------
func set_active(on: bool) -> void:
	if on == active: return
	active = on; layer.visible = on
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if on else SubViewport.UPDATE_DISABLED
	for k in scr: (scr[k].vp as SubViewport).render_target_update_mode = SubViewport.UPDATE_ALWAYS if on else SubViewport.UPDATE_DISABLED
	if on: _resize()

func _resize() -> void:
	var ws := Vector2(DisplayServer.window_get_size())
	if ws.x < 100.0: ws = Vector2(1280, 640)
	var k := minf(1.0, 1600.0 / ws.x)
	vp.size = Vector2i(int(ws.x * k), int(ws.y * k))

func look_drag(d: Vector2) -> void:
	var s := 0.0042 if not zoom else 0.0022
	tyaw = clampf(tyaw - d.x * s, -2.5, 2.5); tpitch = clampf(tpitch - d.y * s, -1.25, 1.0)
	yaw = tyaw; pitch = tpitch

func look_to(name: String) -> void:
	match name:
		"fwd": tyaw = 0.0; tpitch = def_pitch
		"left": tyaw = 1.45 if seat == 0 else 0.5; tpitch = -0.1
		"right": tyaw = -0.5 if seat == 0 else -1.45; tpitch = -0.1
		"up": tyaw = 0.0; tpitch = 0.85
		"down": tyaw = 0.0; tpitch = -0.75
		"other": tyaw = -1.15 if seat == 0 else 1.15; tpitch = -0.1
	if name == "fwd": zoom = false

func toggle_zoom() -> void: zoom = not zoom

func swap_seat() -> void:
	seat = 1 - seat; tyaw = 0.0; tpitch = def_pitch

func eye_local() -> Vector3:
	return ORIGIN + Vector3((SEAT_X if seat == 1 else -SEAT_X), EYE_Y, 0.0) + head_off()

# голова вращается вокруг шеи: глаза смещаются, появляется объём
func head_off() -> Vector3:
	var hb := Basis.from_euler(Vector3(pitch, yaw, 0.0), EULER_ORDER_YXZ)
	var v := Vector3(0.0, 0.07, -0.11)
	return hb * v - Basis.from_euler(Vector3(-0.24, 0.0, 0.0), EULER_ORDER_YXZ) * v

# камера мира повторяет голову пилота
func apply(wcam: Camera3D, plane: Node3D) -> void:
	var hb := Basis.from_euler(Vector3(pitch, yaw, 0.0), EULER_ORDER_YXZ)
	var gt := plane.global_transform
	wcam.global_transform = Transform3D(gt.basis.orthonormalized() * hb, gt * eye_local())
	wcam.fov = fov_now

func tick(s: Dictionary, thr: Array, roll: float, stick: float, dt: float) -> void:
	if not active: return
	yaw = lerpf(yaw, tyaw, minf(1.0, dt * 9.0)); pitch = lerpf(pitch, tpitch, minf(1.0, dt * 9.0))
	fov_now = lerpf(fov_now, 38.0 if zoom else 72.0, minf(1.0, dt * 8.0))
	cam.fov = fov_now
	var ex := -SEAT_X if seat == 0 else SEAT_X
	cam.transform = Transform3D(Basis.from_euler(Vector3(pitch, yaw, 0.0), EULER_ORDER_YXZ), Vector3(ex, EYE_Y, 0) + head_off())
	pilots[0].visible = seat == 1; pilots[1].visible = seat == 0
	# освещение по времени суток
	var nk := clampf((world.light_k - 0.3) / 0.7, 0.0, 1.0)
	env.ambient_light_energy = lerpf(0.95, 0.32, nk); light.light_energy = lerpf(0.7, 0.05, nk)
	for o in amb_lamps: (o as OmniLight3D).light_energy = lerpf(0.12, 0.55, nk) * (3.0 if dome else 1.0)
	if dome: env.ambient_light_energy = maxf(env.ambient_light_energy, 0.85)
	# экраны
	for k in scr: (scr[k].ins as Control).call("put", s, 2, true)
	var c: Dictionary = s.c
	if glb:
		for i in range(mini(thr787.size(), 2)):
			if is_instance_valid(thr787[i]): (thr787[i] as Node3D).rotation.x = -float(thr[i]) * 0.5
		_sync(s, c, dt); return
	_mcp(s, c)
	for i in range(2): (thr_lev[i] as Node3D).rotation.x = (float(thr[i]) * 0.9) - 0.0
	for y in yokes:
		if (y as Node3D).has_meta("ss"):
			(y as Node3D).rotation.z = -roll * 0.5; (y as Node3D).rotation.x = -stick * 0.5
		else:
			(y as Node3D).rotation.z = -roll * 0.9; (y as Node3D).position.z = -0.5 + stick * 0.06
	var gr := float(s.gear)
	gear_lever.rotation.x = 0.0 if c.gear else -0.0
	gear_lever.position.y = (-0.12 + (0.03 if c.gear else -0.02)) if false else gear_lever.position.y
	var gy := -0.1 if c.gear else -0.14
	gear_lever.position.y = lerpf(gear_lever.position.y, gy, minf(1.0, dt * 8.0))
	for lm in mcp.get("gl", []): (lm as StandardMaterial3D).emission_enabled = gr > 0.98
	flap_lever.position.z = lerpf(flap_lever.position.z, 0.03 + float(c.flaps) * 0.022, minf(1.0, dt * 6.0))
	park_lever.rotation.x = lerpf(park_lever.rotation.x, -0.9 if c.brake else 0.0, minf(1.0, dt * 8.0))
	_sync(s, c, dt)

func _mcp(s: Dictionary, c: Dictionary) -> void:
	var v: float = float(s.ias) * 3.6
	(mcp["SPD"] as Label3D).text = "%03d" % int(v) if c.atOn else "---"
	(mcp["HDG"] as Label3D).text = "%03d" % int(float(s.hdg))
	(mcp["ALT"] as Label3D).text = "%05d" % int(float(c.apAlt))
	(mcp["V/S"] as Label3D).text = "%+04d" % int(float(s.vs) * 196.85) if c.apOn else "----"
	var tm := Time.get_ticks_msec() / 1000
	(mcp["clk"] as Label3D).text = "%02d:%02d:%02d" % [(tm / 3600) % 24, (tm / 60) % 60, tm % 60]

func _sync(s: Dictionary, c: Dictionary, dt: float) -> void:
	var tt := Time.get_ticks_msec() * 0.001
	var warn: bool = s.alerts.size() > 0 or s.warnings.size() > 0
	if not fcu_lbl.is_empty():
		(fcu_lbl["spd"] as Label3D).text = str(int(float(c.spdSel) * 3.6)) if c.get("spdSel") != null else "АВТО"
		(fcu_lbl["hdg"] as Label3D).text = "%03d" % (int(float(c.hdgSel)) if c.get("hdgSel") != null else int(round(float(s.hdg))))
		(fcu_lbl["alt"] as Label3D).text = str(int(c.apAlt))
	for it in items:
		var n: Node3D = it.n
		var kind: String = it.kind
		var act: String = it.act
		var label_on := false
		# состояние из симулятора
		match act:
			"gear": it["on"] = bool(c.gear)
			"ap": it["on"] = bool(c.apOn)
			"at": it["on"] = bool(c.atOn)
			"appr": it["on"] = bool(c.appr)
			"nav": it["on"] = bool(c.get("nav", true))
			"brake": it["on"] = bool(c.brake)
			"rev": it["on"] = bool(c.rev)
			"hdgm": it["on"] = bool(c.get("hdgM", false))
			"spda": it["on"] = c.get("spdSel") != null
			"start": it["on"] = (float(s.eng[0]) > 0.5 and float(s.eng[1]) > 0.5) or fmod(tt, 1.0) < 0.5
			"ext":
				var fl := false
				for al in s.alerts: if str(al).begins_with("ПОЖАР"): fl = true
				it["on"] = fl and fmod(tt, 0.6) < 0.3
		if it.has("hot") and not act in ["appr", "nav"]: pass
		if it.has("flash"): it["on"] = warn and fmod(tt, 0.8) < 0.4
		if kind == "push":
			var m: StandardMaterial3D = it.mat
			if it.get("lit_on", true) != false or it.has("flash"):
				var on: bool = it["on"]
				m.emission_enabled = on; m.emission = it.lcol; m.emission_energy_multiplier = 1.6
				m.albedo_color = (it.col as Color).lerp(it.lcol, 0.55) if on else it.col
			else:
				m.emission_enabled = false
			if it.t > 0.0:
				it["t"] = maxf(0.0, float(it.t) - dt * 5.0)
				n.position = (it.rest as Vector3) + Vector3(0, 0, -0.005 * sin(clampf(float(it.t), 0.0, 1.0) * PI))
		elif kind == "mpush":
			var fm = it.get("fm")
			if fm != null:
				var on: bool = it["on"]; var f := fm as StandardMaterial3D
				f.emission_enabled = on; f.emission = Color(0.3, 1.0, 0.45); f.emission_energy_multiplier = 1.4
				f.albedo_color = (it.fcol as Color).lerp(Color(0.3, 1.0, 0.45), 0.5) if on else it.fcol
			if it.t > 0.0:
				it["t"] = maxf(0.0, float(it.t) - dt * 5.0)
				n.position = (it.rest as Vector3) + n.transform.basis.z * (-float(it.get("trv", 0.0025)) * sin(clampf(float(it.t), 0.0, 1.0) * PI))
		elif kind == "mlever":
			var tg := 0.0
			match act:
				"gear": tg = 0.0 if c.gear else 0.7
				"brake": tg = -0.6 if c.brake else 0.0
				"fl": tg = float(c.flaps) * -0.12
			it["ang"] = lerpf(float(it.ang), tg, minf(1.0, dt * 8.0))
			n.transform.basis = (it.b0 as Basis) * Basis(it.get("axis", Vector3.RIGHT) as Vector3, float(it.ang))
		elif kind == "mknob":
			it["ang"] = lerpf(float(it.ang), float(it.tgt), minf(1.0, dt * 12.0))
			n.transform.basis = (it.b0 as Basis) * Basis(Vector3(0, 0, 1), float(it.ang))
		elif kind == "tog":
			if it.has("lamp"): (it.lamp as StandardMaterial3D).emission_enabled = bool(it.on)
			var target: float = 0.5 if it.on else -0.5
			it["ang"] = lerpf(float(it.ang), target, minf(1.0, dt * 14.0)); n.rotation.x = float(it.ang)
		elif kind == "knob":
			if it.has("rt"):
				it["rt"] = float(it.rt) - dt
				if float(it.rt) <= 0.0: it["step"] = 1; it.erase("rt")
			if it.has("spin"): n.rotation.x = lerpf(n.rotation.x, float(it.step) * 0.8, minf(1.0, dt * 8.0))
			else:
				var tz: float = -(float(it.step) - float(int(it.steps) - 1) * 0.5) * 0.7
				n.rotation.z = lerpf(n.rotation.z, tz, minf(1.0, dt * 14.0))
	if mcpd.has("hdg"):
		(mcpd["hdg"] as Label3D).text = "%03d" % (int(float(c.hdgSel)) if c.get("hdgSel") != null else int(round(float(s.hdg))))
		(mcpd["spd"] as Label3D).text = ("%d" % int(float(c.spdSel) * 3.6)) if c.get("spdSel") != null else "АВТО"
		(mcpd["alt"] as Label3D).text = "%d" % int(c.apAlt)
		if mcpd.has("vs"): (mcpd["vs"] as Label3D).text = "%+d" % int(float(s.vs) * 196.85)
	# автоторможение — ручка показывает режим
	if mcp.has("abrk"):
		var ab: Dictionary = mcp["abrk"]
		ab["step"] = clampi(int(c.get("abrk", 0)) + 1, 0, 5)

# ---------- касания ----------
func knob_at(pos: Vector2) -> Dictionary:
	var it := _hit(pos)
	return it if (not it.is_empty() and it.kind == "mknob") else {}

func knob_step(it: Dictionary, dir: int) -> void:
	it["tgt"] = float(it.tgt) + 0.3 * float(dir)
	it["t"] = 1.0
	if snd: snd.call("click", 900.0)
	hud.call("_on_act", str((it.acts as Array)[1 if dir > 0 else 0]))

func pick(pos: Vector2) -> void:
	var best := _hit(pos)
	if not best.is_empty(): _activate(best, pos)

func _hit(pos: Vector2) -> Dictionary:
	if not active: return {}
	var vs := get_viewport().get_visible_rect().size
	var p := Vector2(pos.x / vs.x * float(vp.size.x), pos.y / vs.y * float(vp.size.y))
	var o := cam.project_ray_origin(p); var d := cam.project_ray_normal(p)
	var best: Dictionary = {}; var bt := 1e9
	for it in items:
		var n: Node3D = it.n
		if not n.is_inside_tree(): continue
		var inv := n.global_transform.affine_inverse()
		var lo := inv * o; var ld := inv.basis * d
		var c: Vector3 = it.off; var h: Vector3 = it.hit
		var t0 := -1e9; var t1 := 1e9; var ok := true
		for ax in range(3):
			var a := lo[ax] - c[ax]; var b := ld[ax]
			if absf(b) < 1e-9:
				if absf(a) > h[ax]: ok = false; break
			else:
				var ta := (-h[ax] - a) / b; var tb := (h[ax] - a) / b
				if ta > tb: var sw := ta; ta = tb; tb = sw
				t0 = maxf(t0, ta); t1 = minf(t1, tb)
				if t0 > t1: ok = false; break
		if ok and t1 > 0.0:
			var tt := maxf(t0, 0.0)
			if tt < bt: bt = tt; best = it
	return best

func _activate(it: Dictionary, pos: Vector2) -> void:
	var act: String = it.act
	var kind: String = it.kind
	if kind == "mlever" and act == "fl":
		var ly := ((it.n as Node3D).global_transform.affine_inverse() * _ray_pt(pos, it)).y
		act = "fl-" if ly > 0.0 else "fl+"
	if kind == "mknob":
		var lx := ((it.n as Node3D).global_transform.affine_inverse() * _ray_pt(pos, it)).x
		var dir := 1 if lx > 0.0 else -1
		it["tgt"] = float(it.tgt) + 0.55 * float(dir)
		act = str((it.acts as Array)[1 if dir > 0 else 0])
	it["t"] = 1.0
	if snd: snd.call("click", 1500.0 if kind == "push" else (2400.0 if kind == "tog" else 900.0))
	if kind == "tog": it["on"] = not bool(it["on"])
	elif kind == "knob":
		it["step"] = (int(it["step"]) + 1) % maxi(int(it["steps"]), 2)
	elif kind == "push" and not act in ["gear", "ap", "at", "appr", "nav", "brake", "rev"]:
		if it.get("lit_on", true) != false: it["on"] = not bool(it["on"])
	match act:
		"": pass
		"ndrange": (scr["nd"].ins as Control).call("cycle_range")
		"seatbelt": world.get_parent().call("_seatbelt_sign", int(it["step"]) != 0) if world.get_parent().has_method("_seatbelt_sign") else null
		"fl":
			var up: bool = true
			var inv := (it.n as Node3D).global_transform.affine_inverse()
			up = (inv * _ray_pt(pos, it)).y > 0.04
			hud.call("_on_act", "fl-" if up else "fl+")
		_:
			if act.begins_with("light:"):
				world.call("set_light", act.substr(6), bool(it["on"]))
			else: hud.call("_on_act", act)
	if it.has("lkind") and str(it.lkind) != "" and not act.begins_with("light:"): pass

func _ray_pt(pos: Vector2, it: Dictionary) -> Vector3:
	var vs := get_viewport().get_visible_rect().size
	var p := Vector2(pos.x / vs.x * float(vp.size.x), pos.y / vs.y * float(vp.size.y))
	var o := cam.project_ray_origin(p); var d := cam.project_ray_normal(p)
	var n: Node3D = it.n
	return o + d * (o.distance_to(n.global_position) * 1.0)
