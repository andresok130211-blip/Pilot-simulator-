extends Node3D
# Pilot Sim 3D: меню -> полёт -> результат. Физика — sim/flight.gd, мир — sim/world.gd.

enum S { MENU, FLIGHT, RESULT }
var state := S.MENU
var terrain: MeshInstance3D
var mat: ShaderMaterial
var plane_node: Node3D
var cam: Camera3D
var world: World
var f: Flight
var ui: CanvasLayer
var menu_root: Control
var hud_root: Control
var res_root: Control
var sel_plane := "a320"
var sel_from := "SVO"
var contracts: Array = []
var sel_contract := 0
var view_mode := 0   # 0 снаружи, 1 кабина, 2 башня
var tower_pos := Vector2.ZERO
var gear_node: Node3D
var lbl := {}
var stick_touch := -1
var stick_origin := Vector2.ZERO
var stick_val := Vector2.ZERO
var thr_slider: VSlider
var msg_label: Label
var warn_label: Label
var banner: Label
var shot := ""
var shot_args := []
var look: Dictionary

func _ready():
	GameData.load_all()
	look = JSON.parse_string(FileAccess.open("res://data/game.json", FileAccess.READ).get_as_text()).look
	var args := OS.get_cmdline_user_args()
	_build_env()
	_build_terrain()
	cam = Camera3D.new(); cam.far = 650000.0; cam.near = 2.0; cam.fov = 62; add_child(cam)
	ui = CanvasLayer.new(); add_child(ui)
	if args.size() >= 1 and args[0] == "shot":
		shot_args = args
		_auto_shot()
		return
	_show_menu()

# ---------------- окружение и земля ----------------
func _build_env():
	var we := WorldEnvironment.new(); var e := Environment.new()
	e.background_mode = Environment.BG_SKY
	var sky := Sky.new(); var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.20, 0.42, 0.78); sm.sky_horizon_color = Color(0.70, 0.82, 0.93)
	sm.ground_horizon_color = Color(0.70, 0.82, 0.93); sm.ground_bottom_color = Color(0.5, 0.62, 0.75)
	sky.sky_material = sm; e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY; e.ambient_light_energy = 0.9
	e.fog_enabled = true; e.fog_light_color = Color(0.72, 0.83, 0.93); e.fog_density = 0.000007
	e.fog_sky_affect = 0.0
	we.environment = e; add_child(we)
	var sun := DirectionalLight3D.new(); sun.rotation_degrees = Vector3(-48, 35, 0); sun.light_energy = 1.25
	add_child(sun)

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

# ---------------- UI-помощники ----------------
func _label(text: String, size := 22, col := Color.WHITE) -> Label:
	var l := Label.new(); l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9)); l.add_theme_constant_override("outline_size", 6)
	return l

func _button(text: String, size := 22, minw := 0.0) -> Button:
	var b := Button.new(); b.text = text; b.add_theme_font_size_override("font_size", size)
	b.custom_minimum_size = Vector2(minw, 56)
	return b

func _clear_ui():
	for c in ui.get_children(): c.queue_free()
	menu_root = null; hud_root = null; res_root = null

# ---------------- меню ----------------
func _show_menu():
	state = S.MENU
	_clear_ui()
	if plane_node: plane_node.queue_free(); plane_node = null
	mat.set_shader_parameter("apt_n", 0); mat.set_shader_parameter("rwy_n", 0)
	var from: Dictionary = GameData.ap_by[sel_from]
	mat.set_shader_parameter("center_ll", Vector2(from.lon, from.lat))
	cam.position = Vector3(0, 600, 900); cam.look_at(Vector3(0, 100, 0))
	menu_root = PanelContainer.new(); menu_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	var sb := StyleBoxFlat.new(); sb.bg_color = Color(0.04, 0.07, 0.13, 0.88); menu_root.add_theme_stylebox_override("panel", sb)
	ui.add_child(menu_root)
	var mc := MarginContainer.new(); for s in ["left", "right", "top", "bottom"]: mc.add_theme_constant_override("margin_" + s, 24)
	menu_root.add_child(mc)
	var hb := HBoxContainer.new(); hb.add_theme_constant_override("separation", 24); mc.add_child(hb)
	# левая колонка — самолёт и вылет
	var left := VBoxContainer.new(); left.custom_minimum_size = Vector2(420, 0); hb.add_child(left)
	left.add_child(_label("✈ Pilot Sim 3D", 40))
	left.add_child(_label("Самолёт", 20, Color(0.6, 0.8, 1)))
	var po := OptionButton.new(); po.add_theme_font_size_override("font_size", 22); po.custom_minimum_size = Vector2(0, 56)
	for i in GameData.planes.size():
		var p: Dictionary = GameData.planes[i]; po.add_item("%s (%d мест)" % [p.name, p.seats], i)
		if p.id == sel_plane: po.select(i)
	po.item_selected.connect(func(i): sel_plane = GameData.planes[i].id; _rebuild_contracts())
	left.add_child(po)
	left.add_child(_label("Аэропорт вылета", 20, Color(0.6, 0.8, 1)))
	var fo := OptionButton.new(); fo.add_theme_font_size_override("font_size", 22); fo.custom_minimum_size = Vector2(0, 56)
	for i in GameData.airports.size():
		var a: Dictionary = GameData.airports[i]; fo.add_item("%s — %s (%s)" % [a.city, a.name, a.id], i)
		if a.id == sel_from: fo.select(i)
	fo.item_selected.connect(func(i): sel_from = GameData.airports[i].id; _rebuild_contracts())
	left.add_child(fo)
	left.add_child(_label("Управление: ползунок слева — тяга, перетаскивание справа — штурвал.", 17, Color(0.8, 0.85, 0.9)))
	# правая колонка — рейсы
	var right := VBoxContainer.new(); right.size_flags_horizontal = Control.SIZE_EXPAND_FILL; hb.add_child(right)
	right.add_child(_label("Доступные рейсы", 24, Color(0.6, 0.8, 1)))
	var sc := ScrollContainer.new(); sc.size_flags_vertical = Control.SIZE_EXPAND_FILL; right.add_child(sc)
	var vb := VBoxContainer.new(); vb.name = "Contracts"; vb.size_flags_horizontal = Control.SIZE_EXPAND_FILL; sc.add_child(vb)
	_rebuild_contracts()

func _rebuild_contracts():
	if menu_root == null: return
	var vb: VBoxContainer = menu_root.find_child("Contracts", true, false)
	if vb == null: return
	for c in vb.get_children(): c.queue_free()
	var p: Dictionary = GameData.plane_by[sel_plane]
	if GameData.ap_by[sel_from].rwy < p.minRwy:
		vb.add_child(_label("Полоса вылета слишком коротка для этого самолёта", 20, Color(1, 0.7, 0.6)))
	contracts = GameData.contracts_for(p, sel_from)
	if contracts.is_empty():
		vb.add_child(_label("Нет рейсов: смените самолёт или аэропорт", 20))
	for ct in contracts:
		var to: Dictionary = GameData.ap_by[ct.to]
		var b := _button("%s (%s) · %d км · %d пасс. · %s" % [to.city, to.id, ct.km, ct.pax, _rub(ct.revenue)], 22)
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.pressed.connect(_start_flight.bind(ct))
		vb.add_child(b)

func _rub(n: int) -> String:
	var s := str(n); var out := ""
	for i in s.length():
		out += s[i]
		if (s.length() - i - 1) % 3 == 0 and i < s.length() - 1: out += " "
	return out + " ₽"

# ---------------- полёт ----------------
func _start_flight(ct: Dictionary, opts := {}):
	var p: Dictionary = GameData.plane_by[sel_plane]
	var from: Dictionary = GameData.ap_by[ct.from]
	var to: Dictionary = GameData.ap_by[ct.to]
	var brg := GameData.bearing(from, to)
	f = Flight.new()
	var o := {"rec_alt": GameData.recommended_cruise(ct.km)}
	o.merge(opts, true)
	f.setup(p, from, to, ct.km * 1000.0, ct.pax, min(p.fuelCap, ct.fuel), brg, o)
	world = World.new(); world.setup(from, to, ct.km * 1000.0, brg)
	f.terrain_cb = Callable(world, "terrain_rel")
	# взлётная позиция: на торце полосы
	f.x = 60.0
	# шейдер: аэродромы и полосы
	var apt := []; var rw := []; var rw2 := []
	for k in 2:
		var ap: Dictionary = from if k == 0 else to
		var wx0 := 0.0 if k == 0 else f.D
		var a := world.ll(wx0, 0.0); var b := world.ll(wx0 + ap.rwy, 0.0)
		var mid := world.ll(wx0 + ap.rwy * 0.5, 0.0)
		var hd := world.axis_bearing(wx0 + ap.rwy * 0.5, 0.0) * Flight.DEG
		apt.append(Vector4(mid.x, mid.y, ap.elev, 0))
		rw.append(Vector4(mid.x, mid.y, hd, ap.rwy))
		rw2.append(Vector4(45, ap.elev, 0, 0))
	for k in 2: apt.append(Vector4(0, 0, 0, 0)); rw.append(Vector4(0, 0, 0, 0)); rw2.append(Vector4(0, 0, 0, 0))
	mat.set_shader_parameter("apt", PackedVector4Array(apt)); mat.set_shader_parameter("apt_n", 2)
	mat.set_shader_parameter("rwy", PackedVector4Array(rw)); mat.set_shader_parameter("rwy2", PackedVector4Array(rw2)); mat.set_shader_parameter("rwy_n", 2)
	if plane_node: plane_node.queue_free()
	plane_node = PlaneModel.build(p, look.get(p.id, {})); add_child(plane_node)
	gear_node = plane_node.get_node("Gear")
	f.c.brake = true
	_build_hud()
	state = S.FLIGHT
	banner.text = "Отпустите ТОРМОЗ, дайте тягу ползунком и на скорости %d км/ч потяните штурвал на себя" % int(round(f.vr * 3.6 / 10.0) * 10)
	_update_visuals(0.0)

func _build_hud():
	_clear_ui()
	hud_root = Control.new(); hud_root.set_anchors_preset(Control.PRESET_FULL_RECT); hud_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(hud_root)
	var top := VBoxContainer.new(); top.position = Vector2(18, 10); hud_root.add_child(top)
	for k in ["spd", "alt", "vs", "hdg", "cfg", "ap"]:
		lbl[k] = _label("", 24); top.add_child(lbl[k])
	msg_label = _label("", 22, Color(1, 1, 0.8)); msg_label.position = Vector2(18, 220); hud_root.add_child(msg_label)
	warn_label = _label("", 34, Color(1, 0.35, 0.3)); warn_label.set_anchors_preset(Control.PRESET_CENTER_TOP); warn_label.position = Vector2(480, 90); hud_root.add_child(warn_label)
	banner = _label("", 24, Color(0.7, 1, 0.8)); banner.set_anchors_preset(Control.PRESET_CENTER_TOP); banner.position = Vector2(240, 10); banner.size = Vector2(800, 40); banner.autowrap_mode = TextServer.AUTOWRAP_WORD; hud_root.add_child(banner)
	# ползунок тяги
	thr_slider = VSlider.new(); thr_slider.min_value = 0; thr_slider.max_value = 1; thr_slider.step = 0.01
	thr_slider.custom_minimum_size = Vector2(70, 330); thr_slider.position = Vector2(16, 250)
	thr_slider.value_changed.connect(func(v): f.c.thr = v; if f.c.at_on and not f.on_ground: f.c.at_on = false)
	hud_root.add_child(thr_slider)
	# кнопки
	var grid := GridContainer.new(); grid.columns = 5; grid.position = Vector2(760, 470)
	grid.add_theme_constant_override("h_separation", 6); grid.add_theme_constant_override("v_separation", 6)
	hud_root.add_child(grid)
	var add := func(name: String, key: String, w := 110.0):
		var b := _button(name, 18, w); b.pressed.connect(_act.bind(key)); b.focus_mode = Control.FOCUS_NONE; grid.add_child(b); lbl["b_" + key] = b
	add.call("ШАССИ", "gear"); add.call("ЗАКР +", "fl+"); add.call("ЗАКР −", "fl-"); add.call("ТОРМОЗ", "brake"); add.call("РЕВЕРС", "rev")
	add.call("А/П", "ap"); add.call("А/Т", "at"); add.call("ЗАХОД", "appr"); add.call("ВЫС +", "altu"); add.call("ВЫС −", "altd")
	add.call("2-й КРУГ", "ga"); add.call("УСКОР.", "warp"); add.call("ВИД", "view"); add.call("АВТОТОРМ.", "abrk"); add.call("ВЫХОД", "quit")

func _act(k: String):
	if f == null or f.done: return
	var c := f.c
	match k:
		"gear": f.set_gear(not c.gear)
		"fl+": f.set_flaps(c.flaps + 1)
		"fl-": f.set_flaps(c.flaps - 1)
		"brake": c.brake = not c.brake
		"rev":
			if f.on_ground and f.v > 15.0: c.rev = not c.rev
			else: f.msg("Реверс — только на пробеге")
		"ap":
			if not f.on_ground: c.ap_on = not c.ap_on; if not c.ap_on: c.appr = false
		"at":
			if not f.on_ground: c.at_on = not c.at_on
		"appr":
			if not f.on_ground:
				if not c.ap_on: c.ap_on = true; c.at_on = true
				c.appr = not c.appr
		"altu": c.ap_alt = min(f.p.ceiling - 600.0, c.ap_alt + (600.0 if c.ap_alt >= 3000.0 else 300.0))
		"altd": c.ap_alt = max(300.0, c.ap_alt - (600.0 if c.ap_alt > 3000.0 else 300.0))
		"ga": f.go_around()
		"warp": c.warp = {1: 2, 2: 4, 4: 8, 8: 16, 16: 32}.get(c.warp, 1)
		"view": view_mode = (view_mode + 1) % 3; tower_pos = Vector2(INF, 0)
		"abrk": c.abrk = (c.abrk + 1) % 4; f.msg("Автоторможение: " + ("режим %d" % c.abrk if c.abrk else "выкл"))
		"quit": _show_menu()

func _input(e):
	if state != S.FLIGHT: return
	var vp := get_viewport().get_visible_rect().size
	if e is InputEventScreenTouch or (e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT):
		var p: Vector2 = e.position
		if e.pressed and p.x > vp.x * 0.5 and p.y < vp.y * 0.72 and stick_touch < 0:
			stick_touch = e.index if e is InputEventScreenTouch else 0
			stick_origin = p
		elif (not e.pressed) and (stick_touch == (e.index if e is InputEventScreenTouch else 0)):
			stick_touch = -1; stick_val = Vector2.ZERO
	elif e is InputEventScreenDrag or (e is InputEventMouseMotion and stick_touch == 0):
		var idx: int = e.index if e is InputEventScreenDrag else 0
		if idx == stick_touch:
			var d: Vector2 = (e.position - stick_origin) / 110.0
			stick_val = Vector2(clamp(d.x, -1.0, 1.0), clamp(d.y, -1.0, 1.0))

func _process(dt: float):
	if state != S.FLIGHT or f == null: return
	var c := f.c
	# управление
	var kx := Input.get_axis("ui_left", "ui_right"); var ky := Input.get_axis("ui_up", "ui_down")
	var sx: float = stick_val.x if stick_touch >= 0 else kx
	var sy: float = stick_val.y if stick_touch >= 0 else ky
	c.roll = sx
	c.stick = -sy   # от себя — вниз
	if Input.is_key_pressed(KEY_W): thr_slider.value = min(1.0, thr_slider.value + dt * 0.5)
	if Input.is_key_pressed(KEY_S): thr_slider.value = max(0.0, thr_slider.value - dt * 0.5)
	if not f.done:
		f.update(dt)
	if c.at_on and not f.on_ground and absf(thr_slider.value - c.thr) > 0.005:
		thr_slider.set_value_no_signal(c.thr)
	_update_visuals(dt)
	_update_hud()
	if f.done and state == S.FLIGHT:
		state = S.RESULT
		await get_tree().create_timer(2.2).timeout
		_show_result()

func _update_visuals(dt: float):
	var pll := world.ll(f.x, f.y_pos)
	var beta := world.axis_bearing(f.x, f.y_pos)
	var hdg := beta + f.psi / Flight.DEG
	mat.set_shader_parameter("center_ll", pll)
	var gh: float = plane_node.get_meta("ground_h")
	var alt: float = f.h + f.elev + gh
	plane_node.position = Vector3(0, alt, 0)
	plane_node.rotation_degrees = Vector3(f.theta / Flight.DEG, -hdg, -f.phi / Flight.DEG)
	gear_node.visible = f.gear_pos > 0.4
	var fwd := Vector3(sin(deg_to_rad(hdg)), 0, -cos(deg_to_rad(hdg)))   # север = -Z
	var span: float = sqrt(f.p.S * f.p.ar)
	if view_mode == 0:
		var back := fwd * -(span * 1.45) + Vector3(0, span * 0.3 + 2.0, 0)
		cam.near = 2.0
		cam.position = plane_node.position + back
		var tgt := plane_node.position + fwd * 20.0 + Vector3(0, -f.gamma * 40.0 * 0.3, 0)
		cam.look_at(tgt, Vector3.UP)
		plane_node.visible = true
	elif view_mode == 1:
		cam.near = 0.5
		plane_node.visible = false
		var nose: float = look.get(f.p.id, {}).get("len", span) * 0.36
		cam.position = plane_node.position + fwd * (nose - 4.0) + Vector3(0, 1.3, 0)
		cam.rotation_degrees = Vector3(f.theta / Flight.DEG, -hdg, -f.phi / Flight.DEG)
	else:
		cam.near = 2.0
		plane_node.visible = true
		var rel := Vector2(plane_node.position.x, plane_node.position.z)
		if tower_pos.x == INF or tower_pos.distance_to(rel) > 6000.0 or (tower_pos - rel).dot(Vector2(fwd.x, fwd.z)) < -400.0:
			var side := 1.0 if int(f.time / 30.0) % 2 == 0 else -1.0
			tower_pos = rel + Vector2(fwd.x, fwd.z) * max(1500.0, f.v * 9.0) + Vector2(-fwd.z, fwd.x) * 260.0 * side
		cam.position = Vector3(tower_pos.x, max(f.elev + 10.0, alt - 35.0), tower_pos.y)
		cam.look_at(plane_node.position, Vector3.UP)

func _update_hud():
	var c := f.c
	lbl.spd.text = "СКОРОСТЬ  %d км/ч%s" % [round(f.ias() * 3.6), "   (Vr %d)" % round(f.vr * 3.6) if f.on_ground and f.td == null else ""]
	lbl.alt.text = "ВЫСОТА  %d м   (цель %d)" % [round(f.h), round(c.ap_alt)] if c.ap_on else "ВЫСОТА  %d м" % round(f.h)
	lbl.vs.text = "ВЕРТ.  %+.1f м/с   ДО ВПП %.1f км" % [f.vs(), f.dist() / 1000.0]
	lbl.hdg.text = "КУРС  %03d°   ТЯГА %d%%   ТОПЛИВО %d кг" % [round(f.heading()), round(f.thr_act * 100.0), round(f.fuel)]
	lbl.cfg.text = "ШАССИ %s   ЗАКРЫЛКИ %s   %s%s" % ["ВЫП" if f.gear_pos > 0.95 else ("УБР" if f.gear_pos < 0.05 else "…"), ["0", "1", "2", "3", "ПОЛН"][c.flaps], "ТОРМОЗ " if c.brake else "", "РЕВЕРС" if c.rev else ""]
	lbl.ap.text = "%s%s%s%s   УСКОР. ×%d" % ["А/П " if c.ap_on else "", "А/Т " if c.at_on else "", "ЗАХОД " if c.appr else "", "ГЛИССАДА" if f.appr_cap else "", f.effective_warp()]
	var ms := ""
	for m in f.msgs.slice(-4): ms += m.text + "\n"
	msg_label.text = ms
	var w := ""
	for k in f.warnings.keys():
		match k:
			"stall": w = "СВАЛИВАНИЕ"
			"pullup": w = "PULL UP"
			"sink": w = "SINK RATE"
			"gear": w = "ШАССИ!"
			"terrain": w = "TERRAIN"
			"over": w = "ПРЕВЫШЕНИЕ СКОРОСТИ"
			"flaps": w = "ЗАКРЫЛКИ!"
			"lowfuel": w = "МАЛО ТОПЛИВА"
	warn_label.text = w
	if banner.text != "" and (not f.on_ground or f.v > 40.0): banner.text = ""
	lbl.b_brake.modulate = Color(1, 0.6, 0.5) if c.brake else Color.WHITE
	lbl.b_ap.modulate = Color(0.6, 1, 0.7) if c.ap_on else Color.WHITE
	lbl.b_at.modulate = Color(0.6, 1, 0.7) if c.at_on else Color.WHITE
	lbl.b_appr.modulate = Color(0.6, 1, 0.7) if c.appr else Color.WHITE

# ---------------- результат ----------------
func _show_result():
	state = S.RESULT
	_clear_ui()
	res_root = PanelContainer.new(); res_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	var sb := StyleBoxFlat.new(); sb.bg_color = Color(0.04, 0.07, 0.13, 0.9); res_root.add_theme_stylebox_override("panel", sb)
	ui.add_child(res_root)
	var vb := VBoxContainer.new(); vb.set_anchors_preset(Control.PRESET_CENTER); vb.position = Vector2(300, 100); vb.custom_minimum_size = Vector2(680, 0)
	res_root.add_child(vb)
	var k: String = f.result.kind
	var ok := k == "ok" or (k == "" and f.td != null)
	vb.add_child(_label("Рейс завершён" if ok else "Рейс не удался", 42, Color(0.6, 1, 0.7) if ok else Color(1, 0.5, 0.45)))
	if f.result.reason != "": vb.add_child(_label(f.result.reason, 24))
	if f.td != null:
		vb.add_child(_label("Касание: %.2f м/с, %d км/ч, %.0f м за порогом, отклонение %.0f м" % [f.td.sink, round(f.td.ias * 3.6), f.td.past, f.td.lat], 22))
	vb.add_child(_label("Время полёта: %d мин   Топлива осталось: %d кг" % [round(f.time / 60.0), round(f.fuel)], 22))
	for i in f.incidents: vb.add_child(_label("• " + i.text, 20, Color(1, 0.85, 0.6)))
	var b := _button("В меню", 26, 260); b.pressed.connect(_show_menu); vb.add_child(b)

# ---------------- автокадр для проверки ----------------
func _auto_shot():
	# godot -- shot PLANE FROM TO X H view out.png
	var a := shot_args
	sel_plane = a[1]; sel_from = a[2]
	var ct := GameData.make_contract(GameData.plane_by[sel_plane], GameData.ap_by[a[2]], GameData.ap_by[a[3]])
	_start_flight(ct, {})
	f.x = float(a[4]); f.h = float(a[5]); view_mode = int(a[6])
	if f.h > 1.0:
		f.on_ground = false; f.airborne_once = true; f.v = 120.0 if f.h < 1500.0 else 220.0; f.c.gear = f.h < 800.0; f.gear_pos = 1.0 if f.c.gear else 0.0
		f.c.flaps = 2 if f.h < 800.0 else 0; f.flap_act = float(f.c.flaps); f.theta = 0.04
	f.c.brake = false
	for i in 30: f.step(1.0 / 60.0)
	_update_visuals(0.0)
	await get_tree().create_timer(1.0).timeout
	_update_visuals(0.0)
	await get_tree().create_timer(0.5).timeout
	get_viewport().get_texture().get_image().save_png(a[7])
	get_tree().quit()
