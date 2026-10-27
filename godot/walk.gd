extends CanvasLayer
# Внешний осмотр: ходим по небольшой площадке вокруг самолёта, осматриваем узлы, находим неисправности.
signal finished(found: Array)
const GS := -2.3
const EYE := 1.7
const SPEED := 4.5
# неисправность из game_preflight -> [узел, что видно снаружи]
const DEF_MAP := {
	"нестабильна работа автопилота": ["tail", "Люфт в приводе руля высоты — автопилот будет вести себя нестабильно."],
	"замечание по генератору №2": ["eng2", "Подтёки масла у генератора правого двигателя."],
	"след утечки гидравлики": ["lg", "Пятно гидрожидкости под левой основной стойкой."],
	"сомнительные датчики воздушных данных": ["nose", "Трубка Пито загрязнена — воздушные данные под сомнением."],
	"сбои индикации": ["rw", "Разбит аэронавигационный огонь на правом крыле — проблемы с электрикой."],
}
var world: Node3D
var spots: Array = []
var defects: Array = []
var reveal_all := false
var root3: Node3D
var pos := Vector2(-9.0, -26.0)
var yaw := 0.0
var pitch := 0.0
var half := Vector2(26.0, 40.0)
var obst: Array = []
var st_id := -1
var st_org := Vector2.ZERO
var st_v := Vector2.ZERO
var look_id := -1
var ui: Control
var lb_top: Label
var lb_msg: Label
var b_insp: Button
var b_done: Button
var pad: Control
var msg_t := 0.0
var cur := -1
var turn_to := -999.0
var saved_cam := [1.0, 600000.0]

func _lbl(size: int, p: Vector2) -> Label:
	var l := Label.new(); l.position = p; l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", Color.WHITE); l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.95)); l.add_theme_constant_override("outline_size", 7)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE; ui.add_child(l); return l

func _btn(text: String, r: Rect2, col: Color) -> Button:
	var b := Button.new(); b.text = text; b.position = r.position; b.size = r.size; b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_theme_font_size_override("font_size", 24)
	var sb := StyleBoxFlat.new(); sb.bg_color = col; sb.set_corner_radius_all(14); sb.border_color = Color(1, 1, 1, 0.4); sb.set_border_width_all(2)
	for n in ["normal", "hover", "pressed", "disabled"]: b.add_theme_stylebox_override(n, sb)
	ui.add_child(b); return b

func start(w: Node3D, defs: Array, all := false):
	world = w; defects = defs; reveal_all = all
	layer = 6
	var L: float = w.board_L
	world.terrain.visible = false
	for cn in world.cloud_nodes: cn.visible = false
	for a in world.airports: a.node.visible = false
	world.board.visible = false
	world.plane.position = Vector3.ZERO; world.plane.rotation = Vector3.ZERO; world.plane.visible = true
	saved_cam = [world.cam.near, world.cam.far]; world.cam.near = 0.15; world.cam.far = 3000.0
	half = Vector2(L * 0.48 + 9.0, L * 0.5 + 16.0)
	pos = Vector2(-4.0, -L * 0.5 - 8.0); yaw = PI + 0.25
	_build_site(L)
	var ws := L * 0.46
	var defs_: Array = [
		["nose", "Носовая часть", 0.0, -L * 0.5 - 1.5, "Обтекатель целый, трубки Пито чистые."],
		["eng1", "Левый двигатель", -5.7, -L * 0.08, "Лопатки целы, течей нет, створки закрыты."],
		["eng2", "Правый двигатель", 5.7, -L * 0.08, "Лопатки целы, течей нет, генератор в порядке."],
		["lg", "Левая основная стойка", -3.8, L * 0.04, "Амортизатор в норме, шины целы, течей нет."],
		["rg", "Правая основная стойка", 3.8, L * 0.04, "Амортизатор в норме, шины целы, течей нет."],
		["lw", "Левое крыло", -ws, L * 0.10, "Закрылки и огни целы, обшивка без повреждений."],
		["rw", "Правое крыло", ws, L * 0.10, "Закрылки и огни целы, обшивка без повреждений."],
		["tail", "Хвостовое оперение", 0.0, L * 0.47, "Руль направления и стабилизатор без люфта."]]
	for d in defs_:
		var s := {"id": d[0], "name": d[1], "p": Vector2(float(d[2]), float(d[3])), "ok": d[4], "bad": "", "df": "", "st": 0}
		for t in defects:
			var m: Array = DEF_MAP.get(str(t), [])
			if m.size() > 0 and m[0] == s.id: s.bad = m[1]; s.df = str(t)
		var lb := Label3D.new(); lb.text = "?"; lb.billboard = BaseMaterial3D.BILLBOARD_ENABLED; lb.fixed_size = true; lb.pixel_size = 0.0016; lb.font_size = 64
		lb.no_depth_test = true; lb.outline_size = 14; lb.modulate = Color(1, 0.85, 0.2); lb.position = Vector3(s.p.x, GS + 2.6, s.p.y); root3.add_child(lb)
		s["mk"] = lb; spots.append(s)
	obst = [[Vector2(-5.7, -L * 0.08), 1.9], [Vector2(5.7, -L * 0.08), 1.9], [Vector2(-3.8, L * 0.04), 1.4], [Vector2(3.8, L * 0.04), 1.4], [Vector2(0, -L * 0.5 + 1.0), 2.4]]
	ui = Control.new(); ui.set_anchors_preset(Control.PRESET_FULL_RECT); ui.mouse_filter = Control.MOUSE_FILTER_IGNORE; add_child(ui)
	pad = Control.new(); pad.set_anchors_preset(Control.PRESET_FULL_RECT); pad.mouse_filter = Control.MOUSE_FILTER_IGNORE; pad.draw.connect(_draw_pad); ui.add_child(pad)
	lb_top = _lbl(24, Vector2(24, 14))
	var hint := _lbl(18, Vector2(24, 52)); hint.text = "Левый палец — идти, правый — смотреть. Подойдите к метке «?» и осмотрите узел."
	lb_msg = _lbl(24, Vector2(260, 130)); lb_msg.custom_minimum_size = Vector2(760, 0); lb_msg.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART; lb_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	b_insp = _btn("ОСМОТРЕТЬ", Rect2(880, 510, 380, 80), Color(0.13, 0.5, 0.9)); b_insp.visible = false
	b_done = _btn("ЗАКОНЧИТЬ ОСМОТР ›", Rect2(960, 14, 300, 58), Color(0.12, 0.2, 0.34))
	_refresh()

func _build_site(L: float) -> void:
	root3 = Node3D.new(); world.add_child(root3)
	world._box(root3, Vector3(600, 0.1, 600), Color(0.28, 0.42, 0.22), Vector3(0, GS - 0.25, 0))
	world._box(root3, Vector3(half.x * 2.0 + 4.0, 0.12, half.y * 2.0 + 4.0), Color(0.42, 0.43, 0.45), Vector3(0, GS - 0.06, 0))
	world._box(root3, Vector3(0.3, 0.02, half.y * 2.0), Color(0.95, 0.8, 0.1), Vector3(0, GS + 0.02, 0))
	for sx in [-1.0, 1.0]:   # ограждение площадки
		world._box(root3, Vector3(0.15, 1.0, half.y * 2.0 + 4.0), Color(0.9, 0.35, 0.1), Vector3(sx * (half.x + 2.0), GS + 0.5, 0))
	for sz in [-1.0, 1.0]:
		world._box(root3, Vector3(half.x * 2.0 + 4.0, 1.0, 0.15), Color(0.9, 0.35, 0.1), Vector3(0, GS + 0.5, sz * (half.y + 2.0)))
	for p in [Vector3(-3, 0, -L * 0.5 - 4), Vector3(3, 0, -L * 0.5 - 4), Vector3(-9, 0, -L * 0.5 - 1), Vector3(9, 0, -L * 0.5 - 1)]:   # конусы
		world._cyl(root3, 0.25, 0.7, Color(1, 0.45, 0.1), Vector3(p.x, GS + 0.35, p.z))
	for sx in [-1.0, 1.0]:   # колодки
		world._box(root3, Vector3(0.3, 0.25, 0.8), Color(0.9, 0.8, 0.1), Vector3(sx * 3.8, GS + 0.12, L * 0.04 - 1.3))
	world._box(root3, Vector3(2.2, 2.4, 5.0), Color(0.9, 0.9, 0.92), Vector3(-half.x + 4.0, GS + 1.2, L * 0.3))   # топливозаправщик
	world._box(root3, Vector3(1.6, 1.2, 1.2), Color(0.95, 0.75, 0.1), Vector3(-9.0, GS + 0.6, -L * 0.3))        # наземное питание

func _draw_pad() -> void:
	var c := Vector2(150, 500)
	pad.draw_arc(c, 70.0, 0.0, TAU, 40, Color(1, 1, 1, 0.35), 3.0)
	pad.draw_circle(c + st_v * 55.0, 28.0, Color(1, 1, 1, 0.5))

func _refresh() -> void:
	var n := 0
	for s in spots: if s.st > 0: n += 1
	lb_top.text = "Внешний осмотр — осмотрено %d из %d" % [n, spots.size()]
	for s in spots:
		var lb: Label3D = s.mk
		lb.text = "?" if s.st == 0 else ("OK" if s.st == 1 else "!")
		lb.modulate = Color(1, 0.85, 0.2) if s.st == 0 else (Color(0.4, 1, 0.5) if s.st == 1 else Color(1, 0.3, 0.25))

func _input(e: InputEvent) -> void:
	if e is InputEventScreenTouch:
		var idx: int = e.index
		if e.pressed:
			if b_insp.visible and b_insp.get_global_rect().has_point(e.position): _inspect(); return
			if b_done.get_global_rect().has_point(e.position): _finish(); return
			if e.position.x < 520.0 and e.position.y > 230.0 and st_id < 0: st_id = idx; st_org = e.position; pad.queue_redraw()
			elif look_id < 0: look_id = idx
		else:
			if idx == st_id: st_id = -1; st_v = Vector2.ZERO; pad.queue_redraw()
			if idx == look_id: look_id = -1
	elif e is InputEventScreenDrag:
		var idx2: int = e.index
		if idx2 == st_id: st_v = ((e.position - st_org) / 70.0).limit_length(1.0); pad.queue_redraw()
		elif idx2 == look_id:
			yaw -= e.relative.x * 0.006; pitch = clampf(pitch - e.relative.y * 0.005, -1.0, 1.0); turn_to = -999.0

func _inspect() -> void:
	if cur < 0: return
	var s: Dictionary = spots[cur]
	s.st = 2 if s.bad != "" else 1
	lb_msg.text = "%s\n%s" % [s.name, s.bad if s.bad != "" else s.ok]
	lb_msg.add_theme_color_override("font_color", Color(1, 0.5, 0.4) if s.bad != "" else Color(0.6, 1, 0.65)); msg_t = 5.0
	var d: Vector2 = s.p - pos; turn_to = atan2(-d.x, -d.y)
	_refresh()

func _finish() -> void:
	var found: Array = []
	for s in spots:
		if s.df != "" and (s.st == 2 or reveal_all): found.append(s.df)
	world.terrain.visible = true
	for cn in world.cloud_nodes: cn.visible = true
	world.cam.near = saved_cam[0]; world.cam.far = saved_cam[1]
	root3.queue_free(); queue_free()
	finished.emit(found)

func _process(dt: float) -> void:
	var f := Vector2(-sin(yaw), -cos(yaw)); var r := Vector2(cos(yaw), -sin(yaw))
	var kd := Vector2(Input.get_axis("ui_left", "ui_right"), Input.get_axis("ui_down", "ui_up"))
	var v := st_v + Vector2(kd.x, -kd.y)
	pos += (r * v.x + f * -v.y) * SPEED * dt
	pos.x = clampf(pos.x, -half.x, half.x); pos.y = clampf(pos.y, -half.y, half.y)
	var L: float = world.board_L
	if absf(pos.y) < L * 0.5 - 1.0 and absf(pos.x) < 2.8: pos.x = 2.8 * signf(pos.x if pos.x != 0.0 else -1.0)
	for o in obst:
		var d: Vector2 = pos - o[0]
		if d.length() < float(o[1]): pos = o[0] + d.normalized() * float(o[1])
	if turn_to > -900.0:
		yaw = lerp_angle(yaw, turn_to, minf(1.0, dt * 4.0)); pitch = lerpf(pitch, 0.0, minf(1.0, dt * 4.0))
	var cam: Camera3D = world.cam
	cam.rotation_order = EULER_ORDER_YXZ
	cam.position = Vector3(pos.x, GS + EYE + sin(Time.get_ticks_msec() * 0.009) * 0.03 * st_v.length(), pos.y)
	cam.rotation = Vector3(pitch, yaw, 0.0)
	cur = -1; var best := 9.0
	for i in range(spots.size()):
		var dd: float = (spots[i].p - pos).length()
		if dd < best: best = dd; cur = i
		spots[i].mk.visible = dd < 26.0
	b_insp.visible = cur >= 0
	if cur >= 0: b_insp.text = "ОСМОТРЕТЬ: " + str(spots[cur].name)
	msg_t -= dt
	lb_msg.visible = msg_t > 0.0
