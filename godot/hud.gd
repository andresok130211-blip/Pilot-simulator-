extends CanvasLayer
# Интерфейс полёта: приборы, органы управления касанием, кнопки, сообщения.
signal exit_pressed
var info: Label
var hint: Label
var log_l: Label
var evbox: Label
var alert: Label
var pads: Control
var thr := [0.0, 0.0]
var linked := true
var fingers := {}
var y_org := Vector2(1120, 470)
var yoke_knob := Vector2.ZERO
var stick := 0.0
var roll := 0.0
var btn := {}
var rows: VBoxContainer
var ev_row: HBoxContainer
var last_ev_keys := ""
var instr: Control
var mode := 0
var cockpit := false
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
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.pressed.connect(func(): _on_act(act))
	return b

var _ck_prev := false
var radio_p: PanelContainer
var last_s := {}
func toggle_radio():
	if radio_p and radio_p.visible: radio_p.visible = false; return
	if radio_p: radio_p.queue_free()
	radio_p = PanelContainer.new(); radio_p.position = Vector2(480, 110); add_child(radio_p)
	var v := VBoxContainer.new(); radio_p.add_child(v)
	var gnd: bool = bool(last_s.get("onGround", true)) and not bool(last_s.get("air", false))
	var air: bool = bool(last_s.get("air", false)) and not bool(last_s.get("onGround", false))
	for d in [["Руление", "taxi", gnd], ["Взлёт", "to", gnd], ["Эшелон выше", "climb", air], ["Посадка", "land", air], ["PAN-PAN", "pan", true], ["MAYDAY", "may", true]]:
		if d[2]:
			var b := _button(d[0], "radio:" + d[1], 220)
			b.pressed.connect(func(): radio_p.visible = false); v.add_child(b)

func _link_look():
	var b: Button = get_node("link"); b.text = "СВЯЗАНЫ" if linked else "РАЗДЕЛЬНО"
	b.modulate = Color(0.45, 1, 0.55) if linked else Color(1, 0.8, 0.5)

func boarding(left: float):
	var on := left > 0.0
	var l = get_node_or_null("board_l")
	if l == null:
		l = _lbl(34); l.name = "board_l"; l.position = Vector2(380, 90); add_child(l)
		var sk := _button("ПРОПУСТИТЬ", "skipboard", 220); sk.name = "board_skip"; sk.position = Vector2(530, 150); add_child(sk)
	l.visible = on; get_node("board_skip").visible = on
	if on: l.text = "Посадка пассажиров и экипажа… %d%%" % int((1.0 - left / 10.0) * 100.0)

func _on_act(a: String):
	match a:
		"view": get_parent().world.cycle_cam()
		"exit": exit_pressed.emit()
		"skipboard": get_parent().board_left = 0.0
		"altp": toggle_alts()
		"link": linked = not linked; _link_look()
		"radio": toggle_radio()
		_: Sim.act(a)

func _ready():
	instr = Control.new(); instr.set_script(load("res://instr.gd")); add_child(instr)
	info = _lbl(22); info.position = Vector2(18, 10); add_child(info)
	hint = _lbl(24); hint.position = Vector2(18, 66); hint.add_theme_color_override("font_color", Color(0.6, 1, 0.75)); add_child(hint)
	alert = _lbl(34); alert.add_theme_color_override("font_color", Color(1, 0.35, 0.3)); alert.set_anchors_preset(Control.PRESET_CENTER_TOP); alert.position = Vector2(-220, 100); add_child(alert)
	log_l = _lbl(18); log_l.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT); log_l.position = Vector2(230, -330); add_child(log_l)
	evbox = _lbl(20); evbox.set_anchors_preset(Control.PRESET_TOP_RIGHT); evbox.position = Vector2(-560, 10); evbox.size = Vector2(540, 200); evbox.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT; add_child(evbox)
	# рычаги газа и штурвал рисуются одним слоем, касания обрабатываются в _input (мультитач)
	pads = Control.new(); pads.set_anchors_preset(Control.PRESET_FULL_RECT); pads.mouse_filter = Control.MOUSE_FILTER_IGNORE; pads.draw.connect(_draw_pads); add_child(pads)
	var lk := _button("СВЯЗАНЫ", "link", 112); lk.position = Vector2(10, 178); lk.name = "link"; add_child(lk); _link_look()
	# кнопки (ряды)
	rows = VBoxContainer.new(); rows.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE); rows.position = Vector2(120, -158); rows.size = Vector2(1000, 150); rows.mouse_filter = Control.MOUSE_FILTER_PASS
	rows.set_anchors_preset(Control.PRESET_BOTTOM_LEFT); rows.position = Vector2(130, -150); add_child(rows)
	var r1 := HBoxContainer.new(); var r2 := HBoxContainer.new(); rows.add_child(r1); rows.add_child(r2)
	var defs1 := [["ШАССИ", "gear"], ["ЗАКР −", "fl-"], ["ЗАКР +", "fl+"], ["ТОРМОЗ", "brake"], ["РЕВЕРС", "rev"], ["АВТОТОРМ", "abrk"], ["ТЕМП", "warp"]]
	var defs2 := [["А/П", "ap"], ["А/Т", "at"], ["ЗАХОД", "appr"], ["ВЫС −", "altd"], ["ВЫС +", "altu"], ["ЗАПАСНЫЕ", "altp"], ["ВИД", "view"], ["РАДИО", "radio"], ["МЕНЮ", "exit"]]
	for d in defs1: var b := _button(d[0], d[1], 108); btn[d[1]] = b; r1.add_child(b)
	for d in defs2: var b2 := _button(d[0], d[1], 108); btn[d[1]] = b2; r2.add_child(b2)
	ev_row = HBoxContainer.new(); ev_row.set_anchors_preset(Control.PRESET_TOP_RIGHT); ev_row.position = Vector2(-640, 210); add_child(ev_row)
	var start := _button("ЗАПУСК ДВИГАТЕЛЕЙ", "start", 240); start.position = Vector2(400, 200); start.name = "start"; add_child(start)
	# запасные
	altp = PanelContainer.new(); altp.visible = false; altp.position = Vector2(300, 90); add_child(altp)
	altp_v = VBoxContainer.new(); altp.add_child(altp_v)

const LV_X := [10.0, 68.0]
func _lv_rect(i: int) -> Rect2: return Rect2(LV_X[i], get_viewport().get_visible_rect().size.y - 390.0, 52, 330)

func _draw_pads():
	var fnt := ThemeDB.fallback_font
	for i in range(2):
		var r := _lv_rect(i); var v: float = thr[i]
		var sb := StyleBoxFlat.new(); sb.bg_color = Color(0.1, 0.12, 0.16, 0.7); sb.set_corner_radius_all(16); sb.border_color = Color(0.5, 0.6, 0.75, 0.8); sb.set_border_width_all(2)
		pads.draw_style_box(sb, r)
		var fl := StyleBoxFlat.new(); fl.bg_color = Color(0.3, 0.75, 1.0, 0.55); fl.set_corner_radius_all(14)
		if v > 0.02: pads.draw_style_box(fl, Rect2(r.position.x + 3, r.end.y - r.size.y * v, r.size.x - 6, r.size.y * v))
		pads.draw_rect(Rect2(r.position.x - 3, r.end.y - r.size.y * v - 7, r.size.x + 6, 14), Color(1, 1, 1, 0.95))
		pads.draw_string(fnt, r.position + Vector2(6, 22), "ВЗЛЁТ ▲", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1, 0.9))
		pads.draw_string(fnt, r.position + Vector2(2, r.size.y - 30), "РУЛЕНИЕ", HORIZONTAL_ALIGNMENT_LEFT, -1, 9, Color(1, 1, 1, 0.9))
		pads.draw_string(fnt, r.position + Vector2(8, r.size.y - 8), "%d%%" % int(v * 100.0), HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color.WHITE)
		pads.draw_string(fnt, r.position + Vector2(14, -6), "ДВ%d" % (i + 1), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color.WHITE)
	if cockpit and not fingers.values().has("yoke"): return
	var o := y_org if fingers.values().has("yoke") else Vector2(1160, get_viewport().get_visible_rect().size.y - 150.0)
	var k := o + yoke_knob * 95.0
	pads.draw_circle(o, 92, Color(0, 0, 0, 0.25)); pads.draw_arc(o, 92, 0, TAU, 48, Color(1, 1, 1, 0.5), 3.0)
	# штурвал U-образный: поворот по крену, смещение по тангажу
	var ang := yoke_knob.x * 1.1
	var pts := PackedVector2Array()
	for t in range(0, 17):
		var u := float(t) / 16.0 * PI
		pts.append(k + Vector2(-62.0 * cos(u), 22.0 + 46.0 * sin(u) - 22.0).rotated(ang))
	var gl := k + Vector2(-62, -26).rotated(ang); var gr := k + Vector2(62, -26).rotated(ang)
	pads.draw_line(gl, pts[0], Color(0.18, 0.2, 0.26, 0.95), 14.0); pads.draw_line(gr, pts[16], Color(0.18, 0.2, 0.26, 0.95), 14.0)
	pads.draw_polyline(pts, Color(0.18, 0.2, 0.26, 0.95), 14.0)
	pads.draw_circle(gl, 9, Color(1, 0.7, 0.2)); pads.draw_circle(gr, 9, Color(1, 0.7, 0.2))
	pads.draw_line(k + Vector2(0, 24).rotated(ang), k + Vector2(0, 90), Color(0.15, 0.17, 0.22, 0.9), 14.0)
	pads.draw_string(fnt, o + Vector2(-34, -78), "ШТУРВАЛ", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color(1, 1, 1, 0.8))

func _all_buttons(n: Node, out: Array):
	for c in n.get_children():
		if c is Button and c.is_visible_in_tree() and not c.disabled: out.append(c)
		_all_buttons(c, out)

func _input(e: InputEvent):
	if not visible: return
	if e is InputEventScreenTouch:
		var idx: int = e.index
		if e.pressed:
			var bs := []; _all_buttons(self, bs)
			for b in bs:
				if b.get_global_rect().has_point(e.position): b.pressed.emit(); return
			if instr.mode > 0 and instr.radar_rect().has_point(e.position): instr.cycle_range(); return
			for i in range(2):
				if _lv_rect(i).grow(18).has_point(e.position): fingers[idx] = "t%d" % i; _set_thr(i, e.position); return
			if e.position.x > 700 and e.position.y > 230: fingers[idx] = "yoke"; y_org = e.position; _set_yoke(Vector2.ZERO)
		else:
			if fingers.get(idx, "") == "yoke": _set_yoke(Vector2.ZERO)
			fingers.erase(idx)
	elif e is InputEventScreenDrag:
		var f: String = fingers.get(e.index, "")
		if f == "yoke": _set_yoke(e.position - y_org)
		elif f.begins_with("t"): _set_thr(int(f.substr(1)), e.position)

func _set_thr(i: int, p: Vector2):
	var r := _lv_rect(i); var v := clampf((r.end.y - p.y) / r.size.y, 0.0, 1.0)
	if linked: thr = [v, v]; Sim.ctl({"thr": v, "split": false})
	else: thr[i] = v; Sim.ctl({"split": true, "t1": thr[0], "t2": thr[1], "thr": maxf(thr[0], thr[1])})
	pads.queue_redraw()

func _set_yoke(d: Vector2):
	d = d / 95.0
	if d.length() > 1.0: d = d.normalized()
	d = d * (0.45 + 0.55 * d.length())   # мягче у центра
	yoke_knob = d; roll = d.x; stick = -d.y
	Sim.ctl({"stick": stick, "roll": roll}); pads.queue_redraw()

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
		b.disabled = not a.ok; b.focus_mode = Control.FOCUS_NONE; b.mouse_filter = Control.MOUSE_FILTER_IGNORE; b.custom_minimum_size = Vector2(520, 50)
		var i: int = a.i
		b.pressed.connect(func(): if Sim.divert(i): altp.visible = false)
		altp_v.add_child(b)
	var x := Button.new(); x.mouse_filter = Control.MOUSE_FILTER_IGNORE; x.text = "Закрыть"; x.pressed.connect(func(): altp.visible = false); altp_v.add_child(x)

func update_state(s: Dictionary):
	if s.is_empty(): return
	var c: Dictionary = s.c
	last_s = s
	if cockpit != _ck_prev: _ck_prev = cockpit; pads.queue_redraw()
	instr.put(s, mode, cockpit)
	info.visible = mode == 0 and not cockpit
	log_l.position = Vector2(130, -540) if cockpit else Vector2(230, -330)
	evbox.position.y = 70.0 if cockpit else 10.0
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
	if c.atOn and not fingers.values().has("t0") and not fingers.values().has("t1"): thr = [float(c.thr), float(c.thr)]; pads.queue_redraw()

func _mark(k: String, on) -> void:
	if btn.has(k): btn[k].modulate = Color(0.55, 1, 0.65) if on else Color(1, 1, 1)
