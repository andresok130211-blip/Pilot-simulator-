extends CanvasLayer
# Интерфейс полёта: приборы, органы управления касанием, кнопки, сообщения.
signal exit_pressed
signal cabin_pressed
var info: Label
var topbar: Label
var svcbar: VBoxContainer
var wipers: Control
var appanel: PanelContainer
var ap_lbl := {}
var hint: Label
var log_l: Label
var evbox: Label
var alert: Label
var pads: Control
var thr := [0.0, 0.0]
var linked := true
var fingers := {}
var viewer := false
var look_mv := {}
var look_p0 := {}
var ckbar: HBoxContainer
var ctlbar: HBoxContainer
var lightp: Control
var lamp_btn := {}
var lamp_on := {}
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

const WARN := {"pullup": "ВЫТЯГИВАЙТЕ!", "gear": "ВЫПУСТИТЕ ШАССИ!", "sink": "СЛИШКОМ БЫСТРО СНИЖАЕМСЯ", "terrain": "ЗЕМЛЯ ВПЕРЕДИ! НАБЕРИТЕ ВЫСОТУ", "stall": "МАЛАЯ СКОРОСТЬ!",
	"over": "ПРЕВЫШЕНИЕ СКОРОСТИ", "flaps": "ЗАКРЫЛКИ!", "fuel0": "ТОПЛИВО ЗАКОНЧИЛОСЬ", "lowfuel": "МАЛО ТОПЛИВА"}
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
	b.text = text; b.custom_minimum_size = Vector2(w, 56 if w > 100 else 48)
	b.add_theme_font_size_override("font_size", 17 if w > 100 else 12)
	var sb := StyleBoxFlat.new(); sb.bg_color = Color(0.09, 0.11, 0.2, 0.88); sb.set_corner_radius_all(11); sb.border_color = Color(0.45, 0.55, 0.8, 0.5); sb.set_border_width_all(1)
	sb.content_margin_left = 2; sb.content_margin_right = 2; sb.content_margin_top = 2; sb.content_margin_bottom = 2
	for st in ["normal", "hover", "pressed", "disabled"]: b.add_theme_stylebox_override(st, sb)
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
	var sb := StyleBoxFlat.new(); sb.bg_color = Color(0.16, 0.55, 0.3, 0.95) if linked else Color(0.35, 0.3, 0.2, 0.95); sb.set_corner_radius_all(16)
	for st in ["normal", "hover", "pressed"]: b.add_theme_stylebox_override(st, sb)
	b.modulate = Color.WHITE

const LAMPS := [["Посадочные\nогни", "land"], ["Рулёжные\nогни", "taxi"], ["Стробы", "strobe"], ["Навигац.\nогни", "nav"], ["ЗАПУСК\nДВИГАТЕЛЕЙ", "!start"], ["Табло\nремни", "!belt"], ["Маяк", "beacon"], ["Логотип", "logo"], ["Плафон", "!dome"], ["Дворники", "!wipers"]]
func _build_lightp() -> void:
	lightp = Control.new(); lightp.visible = false; lightp.mouse_filter = Control.MOUSE_FILTER_IGNORE; add_child(lightp)
	var bg := Panel.new(); bg.position = Vector2(140, 150); bg.size = Vector2(1000, 330); bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sb := StyleBoxFlat.new(); sb.bg_color = Color(0.03, 0.04, 0.06, 0.82); sb.set_corner_radius_all(150); sb.border_color = Color(0.96, 0.94, 0.88, 0.95); sb.set_border_width_all(6); bg.add_theme_stylebox_override("panel", sb); lightp.add_child(bg)
	var t := _lbl(24); t.text = "ПОТОЛОЧНАЯ ПАНЕЛЬ — нажимайте, чтобы включить/выключить"; t.position = Vector2(300, 175); lightp.add_child(t)
	for i in range(LAMPS.size()):
		var col := i % 5; var row := i / 5
		var b := _button(str(LAMPS[i][0]), "lamp:" + str(LAMPS[i][1]), 150)
		b.custom_minimum_size = Vector2(150, 108); b.size = Vector2(150, 108); b.position = Vector2(205 + col * 172, 225 + row * 118)
		b.add_theme_font_size_override("font_size", 17)
		var sbb := StyleBoxFlat.new(); sbb.bg_color = Color(0.08, 0.1, 0.16, 0.95); sbb.set_corner_radius_all(54); sbb.border_color = Color(0.96, 0.94, 0.88, 0.9); sbb.set_border_width_all(4)
		for st in ["normal", "hover", "pressed", "disabled"]: b.add_theme_stylebox_override(st, sbb)
		lightp.add_child(b); lamp_btn[str(LAMPS[i][1])] = b
	for k in ["land", "strobe", "nav", "beacon"]: lamp_on[k] = true; _lamp_look(k, true)

func _lamp_look(k: String, on: bool) -> void:
	if not lamp_btn.has(k): return
	var b: Button = lamp_btn[k]
	var sbb := StyleBoxFlat.new(); sbb.bg_color = Color(0.1, 0.45, 0.2, 0.95) if on else Color(0.08, 0.1, 0.16, 0.95); sbb.set_corner_radius_all(54); sbb.border_color = Color(0.5, 1, 0.6) if on else Color(0.96, 0.94, 0.88, 0.9); sbb.set_border_width_all(4)
	for st in ["normal", "hover", "pressed", "disabled"]: b.add_theme_stylebox_override(st, sbb)

func _lamp(k: String) -> void:
	var on: bool = not bool(lamp_on.get(k, false)); lamp_on[k] = on
	_lamp_look(k, on)
	var w: Node3D = get_parent().world
	match k:
		"!start": Sim.act("start")
		"!belt": get_parent()._seatbelt_sign(on)
		"!dome": w.ckp.dome = on
		"!wipers": wipers.visible = on
		"taxi", "logo": w.set_light(k, on)
		_: w.set_light(k, on)

func set_viewer(on: bool) -> void:
	viewer = on
	pads.visible = not on
	for k2 in ["c_warp"]: btn[k2].visible = not on
	if lightp: lightp.visible = false
	(ckbar.get_child(ckbar.get_child_count() - 1) as Button).text = "ВЫХОД" if on else "ПАУЗА"
	for n in [info, hint, alert, log_l, evbox, get_node("link"), get_node("start")]: n.visible = not on
	if on:
		var t := _lbl(24); t.name = "view_t"; t.position = Vector2(20, 12); t.text = "ОСМОТР САМОЛЁТА — ВИД: двигайте пальцем; кабина: нажимайте тумблеры"; add_child(t)
		svcbar = VBoxContainer.new(); svcbar.add_theme_constant_override("separation", 4); svcbar.position = Vector2(14, 64); add_child(svcbar)
		var ht := _lbl(16); ht.text = "НАЗЕМНЫЕ СЛУЖБЫ"; svcbar.add_child(ht)
		for it in [["jet", "Телетрап"], ["fuel", "Топливозаправщик"], ["cat", "Кейтеринг"], ["tug", "Буксировщик / пушбэк"], ["walk", "Обход самолёта"]]:
			var sb := _button(str(it[1]), "svc:" + str(it[0]), 210); sb.custom_minimum_size = Vector2(210, 40); sb.add_theme_font_size_override("font_size", 16); sb.name = "svc_" + str(it[0]); svcbar.add_child(sb)
	else:
		if get_node_or_null("view_t"): get_node("view_t").queue_free()
		if svcbar: svcbar.queue_free(); svcbar = null

func boarding(left: float):
	var on := left > 0.0
	var l = get_node_or_null("board_l")
	if l == null:
		l = _lbl(34); l.name = "board_l"; l.position = Vector2(200, 90); add_child(l)
		var sk := _button("ПРОПУСТИТЬ", "skipboard", 220); sk.name = "board_skip"; sk.position = Vector2(530, 150); add_child(sk)
	l.visible = on; get_node("board_skip").visible = on
	for n in [instr, pads, rows, get_node("link"), get_node("cabin"), info, hint, log_l]: n.visible = not on
	if (cockpit or viewer) and not on:
		rows.visible = false; get_node("cabin").visible = false
	if viewer:
		for n in [info, hint, log_l, get_node("link"), pads]: n.visible = false
		instr.visible = cockpit
	if ckbar: ckbar.visible = (cockpit or viewer) and not on
	if svcbar: svcbar.visible = not cockpit and not on
	if ctlbar: ctlbar.visible = false
	if on:
		var bt: float = get_parent().world.BOARD_T - left
		l.text = "%s… %d%%" % [get_parent().world.board_phase(bt), int(bt / get_parent().world.BOARD_T * 100.0)]
		l.add_theme_font_size_override("font_size", 26)

var paused := false
var pause_ui: Control
func set_pause(on: bool) -> void:
	paused = on; pause_ui.visible = on; fingers.clear()

func _build_pause() -> void:
	pause_ui = Control.new(); pause_ui.set_anchors_preset(Control.PRESET_FULL_RECT); pause_ui.visible = false; pause_ui.mouse_filter = Control.MOUSE_FILTER_IGNORE; add_child(pause_ui)
	var bg := ColorRect.new(); bg.color = Color(0, 0.03, 0.08, 0.7); bg.set_anchors_preset(Control.PRESET_FULL_RECT); bg.mouse_filter = Control.MOUSE_FILTER_IGNORE; pause_ui.add_child(bg)
	var t := _lbl(48); t.text = "ПАУЗА"; t.position = Vector2(520, 130); pause_ui.add_child(t)
	var b1 := _button("ПРОДОЛЖИТЬ", "resume", 320); b1.position = Vector2(480, 250); b1.custom_minimum_size = Vector2(320, 80); b1.add_theme_font_size_override("font_size", 28); pause_ui.add_child(b1)
	var b2 := _button("ЗАВЕРШИТЬ РЕЙС", "exit", 320); b2.position = Vector2(480, 360); b2.custom_minimum_size = Vector2(320, 70); b2.add_theme_font_size_override("font_size", 24); pause_ui.add_child(b2)

func _build_appanel() -> void:
	appanel = PanelContainer.new(); appanel.visible = false
	var sb := StyleBoxFlat.new(); sb.bg_color = Color(0.03, 0.06, 0.1, 0.8); sb.set_corner_radius_all(10); sb.content_margin_left = 8; sb.content_margin_right = 8; sb.content_margin_top = 4; sb.content_margin_bottom = 5
	appanel.add_theme_stylebox_override("panel", sb); add_child(appanel)
	var hb := HBoxContainer.new(); hb.add_theme_constant_override("separation", 12); appanel.add_child(hb)
	for g in [["КУРС", "hdg", "hdgm", "РЕЖИМ"], ["СКОРОСТЬ", "spd", "spda", "АВТО"], ["ВЫСОТА", "alt", "", ""]]:
		var col := VBoxContainer.new(); col.add_theme_constant_override("separation", 2); hb.add_child(col)
		var t := _lbl(15); t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER; col.add_child(t); ap_lbl[str(g[1])] = t
		var row := HBoxContainer.new(); row.add_theme_constant_override("separation", 3); col.add_child(row)
		var kd: String = "altd" if g[1] == "alt" else str(g[1]) + "-"; var ku: String = "altu" if g[1] == "alt" else str(g[1]) + "+"
		for it in [["−", kd], ["+", ku], [str(g[3]), str(g[2])]]:
			if str(it[1]) == "" or str(it[1]) == "-" : continue
			var b := _button(str(it[0]), str(it[1]), 44 if str(it[0]).length() < 2 else 66); b.custom_minimum_size = Vector2(44 if str(it[0]).length() < 2 else 66, 36); b.add_theme_font_size_override("font_size", 14); row.add_child(b); btn["ap_" + str(it[1])] = b

func _ap_update(s: Dictionary, c: Dictionary) -> void:
	if appanel == null: return
	appanel.visible = not viewer and not cockpit and not paused and float(get_parent().board_left) <= 0.0
	if not appanel.visible: return
	appanel.position = Vector2(300, 408) if cockpit else Vector2(440, 112)
	var hd := int(float(c.hdgSel)) if c.get("hdgSel") != null else int(round(float(s.hdg)))
	var mode := "HDG" if c.get("hdgM", false) else ("NAV" if c.get("nav", true) else "—")
	ap_lbl["hdg"].text = "КУРС %03d°  [%s]" % [hd, mode]
	ap_lbl["spd"].text = ("СКОР %d км/ч  [выбр.]" % int(float(c.spdSel) * 3.6)) if c.get("spdSel") != null else "СКОРОСТЬ [авто]"
	ap_lbl["alt"].text = "ВЫС %d м%s" % [int(c.apAlt), "" if c.apOn else "  (АП выкл.)"]
	btn["ap_hdgm"].modulate = Color(0.55, 1, 0.65) if c.get("hdgM", false) else Color(1, 1, 1)
	btn["ap_spda"].modulate = Color(1, 0.85, 0.45) if c.get("spdSel") != null else Color(0.55, 1, 0.65)

func _svc(k: String) -> void:
	var w = get_parent().world
	w.svc_toggle(k)
	var on: bool = w.walk_on if k == "walk" else float(w.svc_goal[k]) > 0.5
	var b := svcbar.get_node("svc_" + k) as Button
	var sb := b.get_theme_stylebox("normal").duplicate() as StyleBoxFlat
	sb.bg_color = Color(0.1, 0.45, 0.25, 0.92) if on else Color(0.09, 0.11, 0.2, 0.88)
	for st in ["normal", "hover", "pressed", "disabled"]: b.add_theme_stylebox_override(st, sb)

func _on_act(a: String):
	match a:
		"view":
			if viewer: get_parent().world.cam_mode = 1 - get_parent().world.cam_mode
			else: get_parent().world.cycle_cam()
		"ck:fwd", "ck:left", "ck:right", "ck:up", "ck:down", "ck:other": get_parent().world.ckp.look_to(a.substr(3))
		"ck:zoom": get_parent().world.ckp.toggle_zoom()
		"svc:jet", "svc:fuel", "svc:cat", "svc:tug", "svc:walk": _svc(a.substr(4))
		"ck:seat": get_parent().world.ckp.swap_seat()
		"pause":
			if viewer: exit_pressed.emit()
			else: set_pause(true)
		"cabin": cabin_pressed.emit()
		"resume": set_pause(false)
		"exit": set_pause(false); exit_pressed.emit()
		"skipboard": get_parent().board_left = 0.0
		"altp": toggle_alts()
		"link": linked = not linked; _link_look()
		"radio": toggle_radio()
		_:
			if a.begins_with("lamp:"): _lamp(a.substr(5))
			else: Sim.act(a)

func _ready():
	instr = Control.new(); instr.set_script(load("res://instr.gd")); add_child(instr)
	info = _lbl(22); info.position = Vector2(18, 10); add_child(info)
	wipers = WiperDraw.new(); wipers.visible = false; wipers.mouse_filter = Control.MOUSE_FILTER_IGNORE; wipers.size = Vector2(1280, 238); wipers.clip_contents = true; add_child(wipers); move_child(wipers, 0)
	topbar = _lbl(17); topbar.set_anchors_preset(Control.PRESET_CENTER_TOP); topbar.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER; topbar.size = Vector2(560, 30); topbar.position = Vector2(-280, 6)
	var tsb := StyleBoxFlat.new(); tsb.bg_color = Color(0.04, 0.07, 0.12, 0.72); tsb.set_corner_radius_all(14); tsb.content_margin_left = 16; tsb.content_margin_right = 16; tsb.content_margin_top = 3; tsb.content_margin_bottom = 3
	topbar.add_theme_stylebox_override("normal", tsb); topbar.mouse_filter = Control.MOUSE_FILTER_IGNORE; add_child(topbar)
	hint = _lbl(24); hint.position = Vector2(18, 66); hint.add_theme_color_override("font_color", Color(0.6, 1, 0.75)); add_child(hint)
	alert = _lbl(34); alert.add_theme_color_override("font_color", Color(1, 0.35, 0.3)); alert.set_anchors_preset(Control.PRESET_CENTER_TOP); alert.position = Vector2(-220, 100); add_child(alert)
	log_l = _lbl(18); log_l.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT); log_l.position = Vector2(230, -330); add_child(log_l)
	evbox = _lbl(20); evbox.set_anchors_preset(Control.PRESET_TOP_RIGHT); evbox.position = Vector2(-560, 10); evbox.size = Vector2(540, 200); evbox.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT; add_child(evbox)
	# рычаги газа и штурвал рисуются одним слоем, касания обрабатываются в _input (мультитач)
	pads = Control.new(); pads.set_anchors_preset(Control.PRESET_FULL_RECT); pads.mouse_filter = Control.MOUSE_FILTER_IGNORE; pads.draw.connect(_draw_pads); add_child(pads)
	var lk := _button("СВЯЗАНЫ", "link", 118); lk.position = Vector2(33, 536); lk.add_theme_font_size_override("font_size", 14); lk.name = "link"; add_child(lk); _link_look()
	var cb := _button("САЛОН", "cabin", 114); cb.position = Vector2(157, 536); cb.add_theme_font_size_override("font_size", 16); cb.name = "cabin"; add_child(cb)
	# кнопки (ряды)
	rows = VBoxContainer.new(); rows.add_theme_constant_override("separation", 5); rows.position = Vector2(298, 452); add_child(rows)
	var r1 := HBoxContainer.new(); var r2 := HBoxContainer.new(); r1.add_theme_constant_override("separation", 5); r2.add_theme_constant_override("separation", 5); rows.add_child(r1); rows.add_child(r2)
	var defs1 := [["ШАССИ", "gear"], ["ЗАКР −", "fl-"], ["ЗАКР +", "fl+"], ["ТОРМОЗ", "brake"], ["×1", "warp"], ["А/П", "ap"], ["А/Т", "at"], ["НАВ", "nav"], ["ВЫС −", "altd"]]
	var defs2 := [["ВЫС +", "altu"], ["ПОСАДКА", "appr"], ["АВТО\nРУЛ", "taxi"], ["РЕВЕРС", "rev"], ["АВТОТОРМ", "abrk"], ["ВИД", "view"], ["РАДИО", "radio"], ["ЗАПАСН.", "altp"], ["ПАУЗА", "pause"]]
	for d in defs1: var b := _button(d[0], d[1], 74); btn[d[1]] = b; r1.add_child(b)
	for d in defs2: var b2 := _button(d[0], d[1], 74); btn[d[1]] = b2; r2.add_child(b2)
	ckbar = HBoxContainer.new(); ckbar.add_theme_constant_override("separation", 4); ckbar.position = Vector2(1000, 4); ckbar.visible = false; add_child(ckbar)
	for d in [["СБРОС\nГОЛОВЫ", "ck:fwd"], ["ДРУГОЙ\nПИЛОТ", "ck:other"], ["МЕСТО\nКАП/2П", "ck:seat"], ["ЗУМ", "ck:zoom"], ["×1", "warp"], ["ЗАПАСН.", "altp"], ["ВИД", "view"], ["ПАУЗА", "pause"]]:
		var kb := _button(d[0], d[1], 86); kb.add_theme_font_size_override("font_size", 13)
		if d[1] == "warp" or d[1] == "altp": btn["c_" + d[1]] = kb
		if d[1] in ["ck:other", "ck:seat", "ck:zoom", "altp", "ck:fwd"]: kb.visible = false
		ckbar.add_child(kb)
	_build_lightp()
	ctlbar = HBoxContainer.new(); ctlbar.add_theme_constant_override("separation", 4); ctlbar.position = Vector2(286, 530); ctlbar.visible = false; add_child(ctlbar)
	for d in [["АВТО-\nПИЛОТ", "ap"], ["АВТО-\nТЯГА", "at"], ["ШАССИ", "gear"], ["ЗАКР −", "fl-"], ["ЗАКР +", "fl+"], ["СТОЯН.\nТОРМОЗ", "brake"], ["ВЫС ▲", "altu"], ["ВЫС ▼", "altd"], ["ПОСАДКА", "appr"], ["НАВ", "nav"]]:
		var cb2 := _button(d[0], d[1], 74); cb2.add_theme_font_size_override("font_size", 13); cb2.custom_minimum_size = Vector2(74, 50)
		btn["k_" + d[1]] = cb2; ctlbar.add_child(cb2)
	_build_appanel()
	ev_row = HBoxContainer.new(); ev_row.set_anchors_preset(Control.PRESET_TOP_RIGHT); ev_row.position = Vector2(-640, 210); add_child(ev_row)
	var start := _button("ЗАПУСК ДВИГАТЕЛЕЙ", "start", 240); start.position = Vector2(400, 200); start.name = "start"; add_child(start)
	# запасные
	altp = PanelContainer.new(); altp.visible = false; altp.position = Vector2(300, 90); add_child(altp)
	altp_v = VBoxContainer.new(); altp.add_child(altp_v)
	_build_pause()

const LV_X := [38.0, 155.0]
var lefty := false
func _lv_rect(i: int) -> Rect2: return Rect2(LV_X[i] if not lefty else 1280.0 - LV_X[1 - i] - 104.0, 304.0, 104, 222)
func yoke_home() -> Vector2:
	if cockpit: return Vector2(130, 535) if lefty else Vector2(1150, 530)
	return Vector2(185, 445) if lefty else Vector2(1095, 445)
func set_lefty(on: bool) -> void:
	lefty = on; y_org = Vector2(160, 470) if on else Vector2(1120, 470)
	get_node("link").position = Vector2(1009, 536) if on else Vector2(33, 536)
	get_node("cabin").position = Vector2(1133, 536) if on else Vector2(157, 536)
	pads.queue_redraw()

func _draw_pads():
	var fnt := ThemeDB.fallback_font
	for i in range(2):
		var r := _lv_rect(i); var v: float = thr[i]
		var sb := StyleBoxFlat.new(); sb.bg_color = Color(0.34, 0.35, 0.4, 0.92); sb.set_corner_radius_all(20); sb.border_color = Color(0.62, 0.68, 0.8, 0.9); sb.set_border_width_all(3)
		pads.draw_style_box(sb, r)
		pads.draw_colored_polygon(PackedVector2Array([r.position + Vector2(8, 30), r.position + Vector2(r.size.x - 8, 30), r.position + Vector2(8, 118)]), Color(0.45, 0.55, 0.3, 0.9))
		pads.draw_line(r.position + Vector2(2, 138), r.position + Vector2(r.size.x - 2, 60), Color(1, 1, 1, 0.95), 5.0)
		var lvl := r.end.y - 34.0 - (r.size.y - 70.0) * v
		pads.draw_rect(Rect2(r.position.x + 4, lvl, r.size.x - 8, r.end.y - 34.0 - lvl), Color(0.3, 0.75, 1.0, 0.28))
		pads.draw_rect(Rect2(r.position.x - 3, lvl - 5, r.size.x + 6, 10), Color(1, 1, 1, 0.97))
		var dy := r.end.y - 34.0 - (r.size.y - 70.0) * 0.18
		for dx in range(0, int(r.size.x) - 8, 12): pads.draw_line(Vector2(r.position.x + 4 + dx, dy), Vector2(r.position.x + 12 + dx, dy), Color(1, 1, 1, 0.85), 2.0)
		pads.draw_string(fnt, r.position + Vector2(12, 24), "ВЗЛЁТ ▲", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color(1, 1, 1, 0.95))
		pads.draw_string(fnt, Vector2(r.position.x + 8, dy + 22), "▼ РУЛЕНИЕ", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(1, 1, 1, 0.95))
		pads.draw_string(fnt, Vector2(r.position.x + 30, r.end.y - 8), "%d%%" % int(v * 100.0), HORIZONTAL_ALIGNMENT_LEFT, -1, 22, Color.WHITE)
		pads.draw_string(fnt, r.position + Vector2(36, -6), "ДВ%d" % (i + 1), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color.WHITE)
	if cockpit and not fingers.values().has("yoke"):
		var h0 := yoke_home()
		pads.draw_arc(h0, 90, 0, TAU, 48, Color(0.9, 0.95, 1, 0.3), 3.0)
		pads.draw_string(fnt, h0 + Vector2(-30, -10), "ШТУРВАЛ", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color(1, 1, 1, 0.5))
		return
	var o := y_org if fingers.values().has("yoke") else yoke_home()
	var k := o + yoke_knob * 95.0
	pads.draw_circle(o, 100, Color(0.45, 0.48, 0.5, 0.55)); pads.draw_arc(o, 100, 0, TAU, 48, Color(0.9, 0.95, 1, 0.8), 3.0)
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
	pads.draw_string(fnt, o + Vector2(-30, -78), "ШТУРВАЛ", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color(1, 1, 1, 0.8))

func _all_buttons(n: Node, out: Array):
	for c in n.get_children():
		if c is Button and c.is_visible_in_tree() and not c.disabled: out.append(c)
		_all_buttons(c, out)

func _input(e: InputEvent):
	if not visible: return
	if e is InputEventScreenTouch:
		var idx: int = e.index
		if e.pressed:
			var bs := []; _all_buttons(pause_ui if paused else self, bs)
			for b in bs:
				if b.get_global_rect().has_point(e.position): b.pressed.emit(); return
			if paused: return
			if cockpit and e.position.y < 40.0: get_parent().world.toggle_lights(); return
			if instr.mode > 0 and not cockpit and instr.radar_rect().has_point(e.position): instr.cycle_range(); return
			if viewer:
				if cockpit: fingers[idx] = "look"; look_mv[idx] = 0.0; look_p0[idx] = e.position
				else: fingers[idx] = "orb"
				return
			for i in range(2):
				if _lv_rect(i).grow(18).has_point(e.position): fingers[idx] = "t%d" % i; _set_thr(i, e.position); return
			if cockpit:
				if yoke_home().distance_to(e.position) < 92.0: fingers[idx] = "yoke"; y_org = e.position; _set_yoke(Vector2.ZERO)
				else: fingers[idx] = "look"; look_mv[idx] = 0.0; look_p0[idx] = e.position
				return
			if (e.position.x < 580 if lefty else e.position.x > 700) and e.position.y > 230: fingers[idx] = "yoke"; y_org = e.position; _set_yoke(Vector2.ZERO)
		else:
			if fingers.get(idx, "") == "yoke": _set_yoke(Vector2.ZERO)
			if fingers.get(idx, "") == "look" and float(look_mv.get(idx, 99.0)) < 14.0: get_parent().world.ckp.pick(look_p0[idx])
			fingers.erase(idx)
	elif e is InputEventScreenDrag:
		var f: String = fingers.get(e.index, "")
		if f == "orb":
			var w3: Node3D = get_parent().world
			w3.orbit -= e.relative.x * 0.35; w3.orbit_up = clampf(w3.orbit_up + e.relative.y * 0.004, -0.2, 1.4)
		elif f == "look":
			look_mv[e.index] = float(look_mv.get(e.index, 0.0)) + e.relative.length()
			if float(look_mv[e.index]) >= 14.0: get_parent().world.ckp.look_drag(e.relative)
		elif f == "yoke": _set_yoke(e.position - y_org)
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

const CARD := ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"]
func _topbar(s: Dictionary) -> void:
	topbar.visible = not viewer and not paused
	if not topbar.visible: return
	var hd := fposmod(float(s.hdg), 360.0)
	var tm := int(float(s.t))
	var w: Dictionary = s.wx
	topbar.text = "ВЕТЕР %03d°/%d   %02d:%02d   %03d° %s   %s %.0f км %03d°" % [
		int(round(float(w.dir) / 10.0) * 10.0) % 360, int(round(float(w.spd))), tm / 60, tm % 60, int(hd), CARD[int(round(hd / 45.0)) % 8], str(s.rw1.id), float(s.dist) / 1000.0, int(fposmod(float(s.brg), 360.0))]
	topbar.position.y = 46.0 if cockpit else 80.0

func update_state(s: Dictionary):
	if s.is_empty(): return
	var c: Dictionary = s.c
	last_s = s
	if cockpit != _ck_prev: _ck_prev = cockpit; pads.queue_redraw()
	instr.put(s, mode, cockpit)
	info.visible = mode == 0 and not cockpit and not viewer
	_topbar(s)
	if lightp: lightp.visible = false
	if cockpit and not viewer:
		pads.visible = false; get_node("link").visible = false
	if viewer:
		for n in [hint, alert, log_l, evbox]: n.visible = false
	log_l.position = Vector2(130, -540) if cockpit else Vector2(300, -300)
	evbox.position.y = 70.0 if cockpit else 10.0
	info.text = "СК %d км/ч   ВЫС %d м   В/С %+d м/с   КУРС %03d°   М %.2f   до ВПП %.1f км   топливо %d кг   закр %s   шасси %s" % [
		float(s.ias) * 3.6, float(s.h), float(s.vs), float(s.hdg), float(s.mach), float(s.dist) / 1000.0, float(s.fuel), str(s.flapName), "▼" if float(s.gear) > 0.98 else ("▲" if float(s.gear) < 0.02 else "…")]
	hint.text = str(s.hint)
	var wt := []
	for k in ["pullup", "gear", "sink", "terrain", "stall", "over", "flaps", "fuel0", "lowfuel"]:
		if s.warnings.has(k) and not (k == "flaps" and s.warnings.has("gear")) and not (k == "lowfuel" and s.warnings.has("fuel0")): wt.append(WARN[k])
	alert.text = "  ".join(s.alerts) if s.alerts.size() > 0 else "  ".join(wt.slice(0, 2))
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
	_labels(s, c)
	_mark("gear", c.gear); _mark("brake", c.brake); _mark("ap", c.apOn); _mark("at", c.atOn); _mark("appr", c.appr); _mark("rev", c.rev)
	var st = get_node_or_null("start"); if st: st.visible = not viewer and not cockpit and not s.air and float(s.thr) < 0.01 and s.eng[0] == 0 and s.eng[1] == 0
	if c.atOn and not fingers.values().has("t0") and not fingers.values().has("t1"): thr = [float(c.thr), float(c.thr)]; pads.queue_redraw()

func _labels(s: Dictionary, c: Dictionary):
	var gr := float(s.gear)
	btn["gear"].text = "ШАССИ\n" + ("▼" if gr > 0.98 else ("▲" if gr < 0.02 else "…"))
	btn["fl-"].text = "ЗАКР −\n(%s)" % str(s.flapName)
	btn["k_gear"].text = "ШАССИ\n" + ("▼" if gr > 0.98 else ("▲" if gr < 0.02 else "…")); btn["k_fl-"].text = "ЗАКР −\n(%s)" % str(s.flapName)
	btn["warp"].text = "×%d" % int(c.warp); btn["c_warp"].text = "×%d" % int(c.warp)
	btn["abrk"].text = "АВТОТОРМ\n" + ["—", "1", "2", "MAX"][clampi(int(c.get("abrk", 0)), 0, 3)]
	btn["view"].text = "ВИД:\n" + ["СНАРУЖИ", "КАБИНА", "БАШНЯ", "КРЫЛО", "ХВОСТ", "ШАССИ", "СЗАДИ", "СПЕРЕДИ"][get_parent().world.cam_mode]
	_mark("nav", c.get("nav", true)); _mark("taxi", c.get("taxiAuto", false)); _ap_update(s, c)

func _mark(k: String, on) -> void:
	if btn.has("k_" + k): btn["k_" + k].modulate = Color(0.55, 1, 0.65) if on else Color(1, 1, 1)
	if btn.has(k): btn[k].modulate = Color(0.55, 1, 0.65) if on else Color(1, 1, 1)


class WiperDraw extends Control:
	var t := 0.0
	func _process(d: float) -> void:
		t += d; queue_redraw()
	func _draw() -> void:
		if not get_parent().get("cockpit"): return
		var a := 0.45 + 0.55 * (0.5 + 0.5 * sin(t * 3.2))
		for px in [420.0, 760.0]:
			var piv := Vector2(px, 236.0)
			var ang := deg_to_rad(-10.0 - 62.0 * a)
			var tip := piv + Vector2(cos(ang), sin(ang)) * 250.0
			draw_line(piv, tip, Color(0.04, 0.04, 0.05, 0.9), 7.0)
			draw_line(piv.lerp(tip, 0.18), tip, Color(0.12, 0.12, 0.14, 0.95), 4.0)
