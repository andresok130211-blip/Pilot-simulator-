extends CanvasLayer
# Интерфейс полёта: приборы, органы управления касанием, кнопки, сообщения.
signal exit_pressed
var info: Label
var hint: Label
var log_l: Label
var evbox: Label
var alert: Label
var thr_s: VSlider
var yoke: Control
var yoke_knob := Vector2.ZERO
var yoke_id := -1
var stick := 0.0
var roll := 0.0
var btn := {}
var rows: VBoxContainer
var ev_row: HBoxContainer
var last_ev_keys := ""
var altp: PanelContainer
var altp_v: VBoxContainer

func _lbl(size := 20) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", Color(1, 1, 1))
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.95))
	l.add_theme_constant_override("outline_size", 6)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

func _button(text: String, act: String, w := 128.0) -> Button:
	var b := Button.new()
	b.text = text; b.custom_minimum_size = Vector2(w, 56)
	b.add_theme_font_size_override("font_size", 17)
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(func(): _on_act(act))
	return b

func _on_act(a: String):
	match a:
		"view": get_parent().world.cycle_cam()
		"exit": exit_pressed.emit()
		"altp": toggle_alts()
		_: Sim.act(a)

func _ready():
	info = _lbl(22); info.position = Vector2(18, 10); add_child(info)
	hint = _lbl(24); hint.position = Vector2(18, 66); hint.add_theme_color_override("font_color", Color(0.6, 1, 0.75)); add_child(hint)
	alert = _lbl(34); alert.add_theme_color_override("font_color", Color(1, 0.35, 0.3)); alert.set_anchors_preset(Control.PRESET_CENTER_TOP); alert.position = Vector2(-220, 100); add_child(alert)
	log_l = _lbl(18); log_l.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT); log_l.position = Vector2(230, -330); add_child(log_l)
	evbox = _lbl(20); evbox.set_anchors_preset(Control.PRESET_TOP_RIGHT); evbox.position = Vector2(-560, 10); evbox.size = Vector2(540, 200); evbox.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT; add_child(evbox)
	# газ
	thr_s = VSlider.new(); thr_s.min_value = 0; thr_s.max_value = 1; thr_s.step = 0.01; thr_s.value = 0
	thr_s.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT); thr_s.position = Vector2(30, -300); thr_s.custom_minimum_size = Vector2(70, 270); thr_s.size = Vector2(70, 270)
	thr_s.value_changed.connect(func(v): Sim.ctl({"thr": v}))
	add_child(thr_s)
	var tl := _lbl(18); tl.text = "ГАЗ"; tl.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT); tl.position = Vector2(34, -330); add_child(tl)
	# штурвал
	yoke = Control.new(); yoke.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT); yoke.position = Vector2(-300, -300); yoke.size = Vector2(280, 280)
	yoke.draw.connect(_draw_yoke); add_child(yoke)
	yoke.gui_input.connect(_yoke_input)
	# кнопки (ряды)
	rows = VBoxContainer.new(); rows.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE); rows.position = Vector2(120, -158); rows.size = Vector2(1000, 150); rows.mouse_filter = Control.MOUSE_FILTER_PASS
	rows.set_anchors_preset(Control.PRESET_BOTTOM_LEFT); rows.position = Vector2(120, -150); add_child(rows)
	var r1 := HBoxContainer.new(); var r2 := HBoxContainer.new(); rows.add_child(r1); rows.add_child(r2)
	var defs1 := [["ШАССИ", "gear"], ["ЗАКР −", "fl-"], ["ЗАКР +", "fl+"], ["ТОРМОЗ", "brake"], ["РЕВЕРС", "rev"], ["АВТОТОРМ", "abrk"], ["ТЕМП", "warp"]]
	var defs2 := [["А/П", "ap"], ["А/Т", "at"], ["ЗАХОД", "appr"], ["ВЫС −", "altd"], ["ВЫС +", "altu"], ["ЗАПАСНЫЕ", "altp"], ["ВИД", "view"], ["МЕНЮ", "exit"]]
	for d in defs1: var b := _button(d[0], d[1], 120); btn[d[1]] = b; r1.add_child(b)
	for d in defs2: var b2 := _button(d[0], d[1], 120); btn[d[1]] = b2; r2.add_child(b2)
	ev_row = HBoxContainer.new(); ev_row.set_anchors_preset(Control.PRESET_TOP_RIGHT); ev_row.position = Vector2(-640, 210); add_child(ev_row)
	var start := _button("ЗАПУСК ДВИГАТЕЛЕЙ", "start", 240); start.position = Vector2(400, 200); start.name = "start"; add_child(start)
	# запасные
	altp = PanelContainer.new(); altp.visible = false; altp.position = Vector2(300, 90); add_child(altp)
	altp_v = VBoxContainer.new(); altp.add_child(altp_v)

func _draw_yoke():
	var c := yoke.size / 2.0
	yoke.draw_circle(c, 130, Color(0, 0, 0, 0.25))
	yoke.draw_arc(c, 130, 0, TAU, 48, Color(1, 1, 1, 0.5), 3.0)
	yoke.draw_line(c - Vector2(110, 0), c + Vector2(110, 0), Color(1, 1, 1, 0.25), 2.0)
	yoke.draw_line(c - Vector2(0, 110), c + Vector2(0, 110), Color(1, 1, 1, 0.25), 2.0)
	yoke.draw_circle(c + yoke_knob * 110.0, 34, Color(1, 1, 1, 0.8))

func _yoke_input(e: InputEvent):
	var c := yoke.size / 2.0
	if e is InputEventScreenTouch or e is InputEventMouseButton:
		if e.pressed: yoke_id = 1; _set_yoke(e.position - c)
		else: yoke_id = -1; _set_yoke(Vector2.ZERO)
	elif (e is InputEventScreenDrag or e is InputEventMouseMotion) and yoke_id == 1:
		_set_yoke(e.position - c)

func _set_yoke(d: Vector2):
	d = d / 110.0
	if d.length() > 1.0: d = d.normalized()
	yoke_knob = d; roll = d.x; stick = -d.y
	Sim.ctl({"stick": stick, "roll": roll}); yoke.queue_redraw()

func _unhandled_key_input(e: InputEvent):
	pass

func toggle_alts():
	altp.visible = not altp.visible
	if altp.visible: refresh_alts()

func refresh_alts():
	for ch in altp_v.get_children(): ch.queue_free()
	var h := _lbl(20); h.text = "Запасные аэродромы"; altp_v.add_child(h)
	var list := Sim.alts()
	for a in list:
		var b := Button.new(); b.text = "%s — %d км%s" % [a.label, int(a.d / 1000.0), "" if a.ok else "  (не подходит)"]
		b.disabled = not a.ok; b.focus_mode = Control.FOCUS_NONE; b.custom_minimum_size = Vector2(520, 50)
		var i: int = a.i
		b.pressed.connect(func(): if Sim.divert(i): altp.visible = false)
		altp_v.add_child(b)
	var x := Button.new(); x.text = "Закрыть"; x.pressed.connect(func(): altp.visible = false); altp_v.add_child(x)

func update_state(s: Dictionary):
	if s.is_empty(): return
	var c: Dictionary = s.c
	info.text = "СК %d км/ч   ВЫС %d м   В/С %+d м/с   КУРС %03d°   М %.2f   до ВПП %.1f км   топливо %d кг   закр %s   шасси %s" % [
		float(s.ias) * 3.6, float(s.h), float(s.vs), float(s.hdg), float(s.mach), float(s.dist) / 1000.0, float(s.fuel), str(s.flapName), "▼" if float(s.gear) > 0.98 else ("▲" if float(s.gear) < 0.02 else "…")]
	hint.text = str(s.hint)
	alert.text = "  ".join(s.alerts) if s.alerts.size() > 0 else ("  ".join(s.warnings) if s.warnings.size() > 0 else "")
	log_l.text = "\n".join(s.msgs)
	if s.ev:
		var t := "⚠ " + str(s.ev.title) + "\n"
		for st in s.ev.steps: t += ("✓ " if st.done else "• ") + str(st.t) + "\n"
		evbox.text = t
	else: evbox.text = ""
	var key := ""
	for b in s.evBtns: key += b.k + "|"
	if key != last_ev_keys:
		last_ev_keys = key
		for ch in ev_row.get_children(): ch.queue_free()
		for b in s.evBtns:
			var bb := _button(str(b.t), "ev:" + str(b.k), 200); ev_row.add_child(bb)
	_mark("gear", c.gear); _mark("brake", c.brake); _mark("ap", c.apOn); _mark("at", c.atOn); _mark("appr", c.appr); _mark("rev", c.rev)
	var st = get_node_or_null("start"); if st: st.visible = not s.air and float(s.thr) < 0.01 and s.eng[0] == 0 and s.eng[1] == 0
	if c.atOn or c.apOn and not c.has("x"): thr_s.set_value_no_signal(float(c.thr))

func _mark(k: String, on) -> void:
	if btn.has(k): btn[k].modulate = Color(0.55, 1, 0.65) if on else Color(1, 1, 1)
