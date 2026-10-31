extends CanvasLayer
# Салон: во время полёта встаём из кресла и ходим между рядами. Полёт продолжается.
signal closed
const L := 34.0
const ROWS := 22
const PITCH := 0.8
const SPEED := 2.2
var root3: Node3D
var cam: Camera3D
var world: Node3D
var hud: Node
var ui: Control
var pad: Control
var lb: Label
var b_exit: Button
var pos := Vector2(0.0, -L * 0.5 + 2.5)
var yaw := PI
var pitch := 0.0
var st_id := -1
var st_org := Vector2.ZERO
var st_v := Vector2.ZERO
var look_id := -1
var t := 0.0
var old_cam: Camera3D
var crew: Dictionary
var sign_mat: StandardMaterial3D
var belts := true
var chime: AudioStreamPlayer
var chime_t := -1.0

func start(w: Node3D, h: Node) -> void:
	world = w; hud = h; layer = 8
	root3 = Node3D.new(); root3.position = Vector3(0, 20000, 0); world.add_child(root3)
	_build()
	var cm: Node3D = (load("res://assets/people/Michelle.glb") as PackedScene).instantiate(); root3.add_child(cm); _sit(cm, false); crew = {"root": cm}
	var sg: MeshInstance3D = world._box(root3, Vector3(0.5, 0.14, 0.05), Color(0.2, 0.9, 0.3), Vector3(0, 2.05, -L * 0.5 + 0.8))
	sign_mat = sg.material_override; sign_mat.emission_enabled = true
	_layers(root3)
	for o in root3.get_children(): if o is OmniLight3D: o.light_cull_mask = 2
	_wl(world, 1)
	chime = AudioStreamPlayer.new(); var g := AudioStreamGenerator.new(); g.mix_rate = 22050.0; g.buffer_length = 0.5; chime.stream = g; add_child(chime); chime.play()
	cam = Camera3D.new(); cam.cull_mask = 2; cam.near = 0.05; cam.far = 80.0; cam.fov = 75.0; cam.rotation_order = EULER_ORDER_YXZ; root3.add_child(cam)
	for a in OS.get_cmdline_user_args(): if a.begins_with("--cz="): pos.y = float(a.substr(5))
	var en := Environment.new(); en.background_mode = Environment.BG_COLOR; en.background_color = Color(0.05, 0.06, 0.1)
	en.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR; en.ambient_light_color = Color(0.85, 0.87, 0.92); en.ambient_light_energy = 0.75
	cam.environment = en
	old_cam = world.cam; cam.make_current()
	ui = Control.new(); ui.set_anchors_preset(Control.PRESET_FULL_RECT); ui.mouse_filter = Control.MOUSE_FILTER_IGNORE; add_child(ui)
	pad = Control.new(); pad.set_anchors_preset(Control.PRESET_FULL_RECT); pad.mouse_filter = Control.MOUSE_FILTER_IGNORE; pad.draw.connect(_draw_pad); ui.add_child(pad)
	lb = Label.new(); lb.position = Vector2(24, 14); lb.add_theme_font_size_override("font_size", 22)
	lb.add_theme_color_override("font_outline_color", Color.BLACK); lb.add_theme_constant_override("outline_size", 7); ui.add_child(lb)
	b_exit = Button.new(); b_exit.text = "В КРЕСЛО ПИЛОТА ›"; b_exit.position = Vector2(930, 14); b_exit.size = Vector2(330, 58); b_exit.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b_exit.add_theme_font_size_override("font_size", 24)
	var sb := StyleBoxFlat.new(); sb.bg_color = Color(0.12, 0.2, 0.34); sb.set_corner_radius_all(14); sb.border_color = Color(1, 1, 1, 0.4); sb.set_border_width_all(2)
	for n in ["normal", "hover", "pressed", "disabled"]: b_exit.add_theme_stylebox_override(n, sb)
	ui.add_child(b_exit)

func _wl(n: Node, m: int) -> void:
	if n is Light3D and not root3.is_ancestor_of(n): (n as Light3D).light_cull_mask = m
	for c in n.get_children(): _wl(c, m)

func _layers(n: Node) -> void:
	if n is MeshInstance3D: (n as MeshInstance3D).layers = 2
	for c in n.get_children(): _layers(c)

func _ding() -> void:
	var pb := chime.get_stream_playback() as AudioStreamGeneratorPlayback
	for i in range(11000):
		var tt := float(i) / 22050.0; var f := 880.0 if tt < 0.25 else 660.0
		var v := sin(tt * f * TAU) * exp(-fposmod(tt, 0.25) * 9.0) * 0.25
		pb.push_frame(Vector2(v, v))

func _wool(col: Color, k: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new(); m.albedo_texture = world.mip_tex("res://assets/tex/wool_albedo.png"); m.albedo_color = col
	m.normal_enabled = true; m.normal_texture = load("res://assets/tex/wool_normal.png"); m.normal_scale = 0.8
	m.uv1_triplanar = true; m.uv1_scale = Vector3(k, k, k); m.roughness = 0.95; return m

func _sit(model: Node3D, sitting: bool) -> void:
	var sk: Skeleton3D = _skel(model); if sk == null: return
	var pre := "mixamorig_" if sk.find_bone("mixamorig_Hips") >= 0 else ""
	for a in [["LeftArm", -1.25], ["RightArm", 1.25]]: _g(sk, pre + a[0], Basis(Vector3(0, 0, 1), float(a[1]) * (-1.0 if pre != "" else 1.0)), true)
	if sitting:
		for l in ["Left", "Right"]:
			_g(sk, pre + l + "UpLeg", Basis(Vector3(1, 0, 0), -PI * 0.5), true)
			_g(sk, pre + l + "Leg", Basis.IDENTITY, true)
		for l in ["Left", "Right"]: _g(sk, pre + l + "ForeArm", Basis(Vector3(1, 0, 0), -0.9) , false)

func _tint(n: Node, rng: RandomNumberGenerator) -> void:
	if n is MeshInstance3D:
		var mi := n as MeshInstance3D
		if mi.name == "Wolf3D_Headwear": mi.visible = rng.randf() < 0.35
		elif mi.name == "Wolf3D_Outfit_Top" or mi.name == "Wolf3D_Body":
			var mt := mi.get_active_material(0).duplicate() as StandardMaterial3D
			mt.albedo_color = Color.from_hsv(rng.randf(), 0.45, 0.95) if mi.name == "Wolf3D_Outfit_Top" else Color.WHITE
			mi.material_override = mt
	for c in n.get_children(): _tint(c, rng)

func _skel(n: Node) -> Skeleton3D:
	if n is Skeleton3D: return n
	for c in n.get_children():
		var r := _skel(c)
		if r != null: return r
	return null

# повернуть кость так, чтобы её глобальная ориентация = rot * покой (rel_rest) или rot (иначе локально поверх покоя)
func _g(sk: Skeleton3D, bone: String, rot: Basis, from_rest: bool) -> void:
	var i := sk.find_bone(bone); if i < 0: return
	var par := sk.get_bone_parent(i)
	var pg: Basis = sk.get_bone_global_pose(par).basis if par >= 0 else Basis.IDENTITY
	var want: Basis = rot * sk.get_bone_global_rest(i).basis if from_rest else sk.get_bone_global_rest(i).basis * rot
	if from_rest and bone.ends_with("Leg") and not bone.ends_with("UpLeg"): want = sk.get_bone_global_rest(i).basis
	sk.set_bone_pose_rotation(i, (pg.inverse() * want).get_rotation_quaternion())

func _build() -> void:
	var W := 3.4; var H := 2.2
	var wall := Color(0.86, 0.87, 0.9); var carpet := Color(0.16, 0.2, 0.3)
	(world._box(root3, Vector3(W, 0.1, L), carpet, Vector3(0, -0.05, 0))).material_override = _wool(Color(0.35, 0.4, 0.55), 1.6)
	world._box(root3, Vector3(0.7, 0.02, L), Color(0.45, 0.1, 0.12), Vector3(0, 0.01, 0))
	world._box(root3, Vector3(W, 0.1, L), Color(0.93, 0.94, 0.96), Vector3(0, H + 0.05, 0))
	for sx in [-1.0, 1.0]:
		world._box(root3, Vector3(0.1, H, L), wall, Vector3(sx * W * 0.5, H * 0.5, 0))
	for sz in [-1.0, 1.0]:
		world._box(root3, Vector3(W, H + 0.2, 0.1), Color(0.75, 0.77, 0.82), Vector3(0, H * 0.5, sz * L * 0.5))
	world._box(root3, Vector3(1.0, 1.9, 0.12), Color(0.25, 0.27, 0.32), Vector3(0, 0.95, -L * 0.5 + 0.1))   # дверь в кабину
	world._box(root3, Vector3(1.0, 1.9, 0.12), Color(0.3, 0.3, 0.34), Vector3(1.1, 0.95, L * 0.5 - 0.1))     # туалет
	world._box(root3, Vector3(1.3, 1.1, 0.7), Color(0.7, 0.72, 0.76), Vector3(-1.0, 0.55, L * 0.5 - 0.6))     # галерея
	var seatc := [Color(0.7, 0.8, 1.0), Color(1.0, 0.6, 0.6)]
	var rng := RandomNumberGenerator.new(); rng.seed = 7
	var pcount := 0
	var pm := ["res://assets/people/readyplayer.me.glb", "res://assets/people/Michelle.glb"]
	for r in range(ROWS):
		var z: float = -L * 0.5 + 4.0 + r * PITCH * 1.35
		if z > L * 0.5 - 4.0: break
		for sx in [-1.0, 1.0]:
			for k in range(3):
				var x: float = sx * (0.55 + k * 0.5)
				var c: Color = seatc[(r / 6) % 2]
				var sm := _wool(c, 2.0)
				(world._box(root3, Vector3(0.46, 0.18, 0.46), c, Vector3(x, 0.4, z))).material_override = sm
				(world._box(root3, Vector3(0.46, 0.4, 0.1), c, Vector3(x, 0.2, z + 0.16))).material_override = sm
				(world._box(root3, Vector3(0.44, 0.7, 0.12), c, Vector3(x, 0.8, z + 0.24))).material_override = sm
				(world._box(root3, Vector3(0.28, 0.14, 0.1), c, Vector3(x, 1.22, z + 0.24))).material_override = sm
				if rng.randf() < 0.3 and pcount < 34:
					pcount += 1
					var m: Node3D = (load(pm[0]) as PackedScene).instantiate()
					_tint(m, rng)
					var sc: float = 0.92 + rng.randf() * 0.1
					m.scale = Vector3(sc, sc, sc); m.rotation.y = PI + (rng.randf() - 0.5) * 0.3
					m.position = Vector3(x, 0.52 - 0.97 * sc, z + 0.05)
					root3.add_child(m); _sit(m, true)
		for sx in [-1.0, 1.0]:
			var wm: MeshInstance3D = world._box(root3, Vector3(0.04, 0.38, 0.28), Color(0.55, 0.78, 1.0), Vector3(sx * (W * 0.5 - 0.06), 1.15, z))
			(wm.material_override as StandardMaterial3D).emission_enabled = true; (wm.material_override as StandardMaterial3D).emission = Color(0.4, 0.65, 1.0)
		world._box(root3, Vector3(0.9, 0.12, 0.5), Color(0.8, 0.82, 0.86), Vector3(-1.2 * 0.0 + 1.0, 1.85, z)).visible = false
	for z in [-L * 0.5 + 1.5, 0.0, L * 0.5 - 1.5]:
		var o := OmniLight3D.new(); o.position = Vector3(0, 2.0, z); o.omni_range = 14.0; o.light_energy = 1.1; root3.add_child(o)
	for z in [-L * 0.25, L * 0.25]:
		var o2 := OmniLight3D.new(); o2.position = Vector3(0, 2.0, z); o2.omni_range = 12.0; o2.light_energy = 0.9; root3.add_child(o2)

func _draw_pad() -> void:
	var c := Vector2(150, 500)
	pad.draw_arc(c, 70.0, 0.0, TAU, 40, Color(1, 1, 1, 0.35), 3.0)
	pad.draw_circle(c + st_v * 55.0, 28.0, Color(1, 1, 1, 0.5))

func _input(e: InputEvent) -> void:
	if e is InputEventScreenTouch:
		var idx: int = e.index
		if e.pressed:
			if b_exit.get_global_rect().has_point(e.position): _close(); return
			if e.position.x < 520.0 and e.position.y > 230.0 and st_id < 0: st_id = idx; st_org = e.position; pad.queue_redraw()
			elif look_id < 0: look_id = idx
		else:
			if idx == st_id: st_id = -1; st_v = Vector2.ZERO; pad.queue_redraw()
			if idx == look_id: look_id = -1
	elif e is InputEventScreenDrag:
		var idx2: int = e.index
		if idx2 == st_id: st_v = ((e.position - st_org) / 70.0).limit_length(1.0); pad.queue_redraw()
		elif idx2 == look_id:
			yaw -= e.relative.x * 0.006; pitch = clampf(pitch - e.relative.y * 0.005, -1.0, 1.0)

func _close() -> void:
	_wl(world, 0xFFFFF)
	if is_instance_valid(old_cam): old_cam.make_current()
	root3.queue_free(); queue_free(); closed.emit()

func _process(dt: float) -> void:
	t += dt
	var f := Vector2(-sin(yaw), -cos(yaw)); var r := Vector2(cos(yaw), -sin(yaw))
	var kd := Vector2(Input.get_axis("ui_left", "ui_right"), Input.get_axis("ui_down", "ui_up"))
	var v := st_v + Vector2(kd.x, -kd.y)
	pos += (r * v.x + f * -v.y) * SPEED * dt
	pos.y = clampf(pos.y, -L * 0.5 + 0.8, L * 0.5 - 1.6)
	var in_rows := pos.y > -L * 0.5 + 3.0 and pos.y < L * 0.5 - 3.0
	pos.x = clampf(pos.x, -0.28 if in_rows else -1.3, 0.28 if in_rows else 1.3)
	var s: Dictionary = hud.last_s
	var bank := deg_to_rad(float(s.get("roll", 0.0))) * 0.25
	cam.position = Vector3(pos.x, 1.62 + sin(t * 9.0) * 0.02 * st_v.length(), pos.y)
	cam.rotation = Vector3(pitch, yaw, bank + sin(t * 0.7) * 0.004)
	lb.text = hud.info.text if hud.info else ""
	# бортпроводница ходит по проходу
	var cz: float = -4.0 + sin(t * 0.12) * 12.0
	var dz: float = cos(t * 0.12) * 12.0 * 0.12
	crew.root.position = Vector3(0.0, 0.0, cz); crew.root.rotation.y = 0.0 if dz > 0.0 else PI
	var sw := sin(t * 5.0) * 0.5
	var sk := _skel(crew.root)
	if sk:
		for l in [["Left", sw], ["Right", -sw]]: _g(sk, "mixamorig_" + l[0] + "UpLeg", Basis(Vector3(1, 0, 0), float(l[1])), false)
	var on: bool = float(s.get("h", 9999.0)) < 2800.0
	if on != belts: belts = on; _ding()
	sign_mat.albedo_color = Color(1.0, 0.25, 0.2) if belts else Color(0.2, 0.9, 0.3); sign_mat.emission = sign_mat.albedo_color
