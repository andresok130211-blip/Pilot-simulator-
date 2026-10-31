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
	crew = world._person(Color(0.08, 0.12, 0.3), true); root3.add_child(crew.root); crew.root.position = Vector3(0, 0, -6.0)
	var sg: MeshInstance3D = world._box(root3, Vector3(0.5, 0.14, 0.05), Color(0.2, 0.9, 0.3), Vector3(0, 2.05, -L * 0.5 + 0.8))
	sign_mat = sg.material_override; sign_mat.emission_enabled = true
	_layers(root3)
	for o in root3.get_children(): if o is OmniLight3D: o.light_cull_mask = 2
	_wl(world, 1)
	chime = AudioStreamPlayer.new(); var g := AudioStreamGenerator.new(); g.mix_rate = 22050.0; g.buffer_length = 0.5; chime.stream = g; add_child(chime); chime.play()
	cam = Camera3D.new(); cam.cull_mask = 2; cam.near = 0.05; cam.far = 80.0; cam.fov = 75.0; cam.rotation_order = EULER_ORDER_YXZ; root3.add_child(cam)
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

func _build() -> void:
	var W := 3.4; var H := 2.2
	var wall := Color(0.86, 0.87, 0.9); var carpet := Color(0.16, 0.2, 0.3)
	world._box(root3, Vector3(W, 0.1, L), carpet, Vector3(0, -0.05, 0))
	world._box(root3, Vector3(0.7, 0.02, L), Color(0.45, 0.1, 0.12), Vector3(0, 0.01, 0))
	world._box(root3, Vector3(W, 0.1, L), Color(0.93, 0.94, 0.96), Vector3(0, H + 0.05, 0))
	for sx in [-1.0, 1.0]:
		world._box(root3, Vector3(0.1, H, L), wall, Vector3(sx * W * 0.5, H * 0.5, 0))
	for sz in [-1.0, 1.0]:
		world._box(root3, Vector3(W, H + 0.2, 0.1), Color(0.75, 0.77, 0.82), Vector3(0, H * 0.5, sz * L * 0.5))
	world._box(root3, Vector3(1.0, 1.9, 0.12), Color(0.25, 0.27, 0.32), Vector3(0, 0.95, -L * 0.5 + 0.1))   # дверь в кабину
	world._box(root3, Vector3(1.0, 1.9, 0.12), Color(0.3, 0.3, 0.34), Vector3(1.1, 0.95, L * 0.5 - 0.1))     # туалет
	world._box(root3, Vector3(1.3, 1.1, 0.7), Color(0.7, 0.72, 0.76), Vector3(-1.0, 0.55, L * 0.5 - 0.6))     # галерея
	var seatc := [Color(0.1, 0.25, 0.55), Color(0.55, 0.12, 0.15)]
	var skin := [Color(0.9, 0.72, 0.6), Color(0.65, 0.45, 0.33), Color(0.45, 0.3, 0.2), Color(0.95, 0.8, 0.7)]
	var rng := RandomNumberGenerator.new(); rng.seed = 7
	for r in range(ROWS):
		var z: float = -L * 0.5 + 4.0 + r * PITCH * 1.35
		if z > L * 0.5 - 4.0: break
		for sx in [-1.0, 1.0]:
			for k in range(3):
				var x: float = sx * (0.55 + k * 0.5)
				var c: Color = seatc[0]
				world._box(root3, Vector3(0.46, 0.45, 0.46), c, Vector3(x, 0.25, z))
				world._box(root3, Vector3(0.46, 0.75, 0.12), c, Vector3(x, 0.75, z + 0.24))
				if rng.randf() < 0.6:
					world._box(root3, Vector3(0.3, 0.45, 0.2), Color.from_hsv(rng.randf(), 0.35, 0.6), Vector3(x, 0.78, z + 0.12))
					world._box(root3, Vector3(0.2, 0.22, 0.2), skin[rng.randi() % 4], Vector3(x, 1.12, z + 0.12))
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
	crew.root.rotation.y += PI
	var sw := sin(t * 5.0) * 0.5
	(crew.l as Node3D).rotation.x = sw; (crew.r as Node3D).rotation.x = -sw
	var on: bool = float(s.get("h", 9999.0)) < 2800.0
	if on != belts: belts = on; _ding()
	sign_mat.albedo_color = Color(1.0, 0.25, 0.2) if belts else Color(0.2, 0.9, 0.3); sign_mat.emission = sign_mat.albedo_color
