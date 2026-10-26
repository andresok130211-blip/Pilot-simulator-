extends CanvasLayer
# Меню карьеры: главная, выбор рейса, ангар, тренажёр, рекорды, настройки, итоги рейса.
signal start_flight(to: String, drill: String)
var root: Control
var body: VBoxContainer
var sel_to := ""
var scr := "hub"

func _ready():
	layer = 5

func open(screen := "hub"):
	scr = screen
	_render()

func close():
	if root: root.queue_free(); root = null

# ---------- каркас ----------
func _frame(title: String, back := "") -> VBoxContainer:
	if root: root.queue_free()
	root = Control.new(); root.set_anchors_preset(Control.PRESET_FULL_RECT); add_child(root)
	root.theme = _theme()
	var bg := ColorRect.new(); bg.color = Color(0.04, 0.08, 0.15, 0.97); bg.set_anchors_preset(Control.PRESET_FULL_RECT); root.add_child(bg)
	var top := HBoxContainer.new(); top.position = Vector2(40, 16); top.custom_minimum_size = Vector2(1200, 60); root.add_child(top)
	if back != "":
		var b := _btn("‹ Назад", func(): scr = back; _render(), 22); b.custom_minimum_size = Vector2(150, 54); top.add_child(b)
	var t := Label.new(); t.text = title; t.add_theme_font_size_override("font_size", 34); t.size_flags_horizontal = Control.SIZE_EXPAND_FILL; top.add_child(t)
	var sc := ScrollContainer.new(); sc.position = Vector2(40, 90); sc.size = Vector2(1200, 530); sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED; root.add_child(sc)
	sc.set_anchors_preset(Control.PRESET_FULL_RECT); sc.offset_left = 40; sc.offset_top = 90; sc.offset_right = -40; sc.offset_bottom = -16
	body = VBoxContainer.new(); body.size_flags_horizontal = Control.SIZE_EXPAND_FILL; body.add_theme_constant_override("separation", 10); sc.add_child(body)
	return body

var _th: Theme
func _theme() -> Theme:
	if _th: return _th
	_th = Theme.new()
	var mk := func(c: Color) -> StyleBoxFlat:
		var sb := StyleBoxFlat.new(); sb.bg_color = c; sb.set_corner_radius_all(14)
		sb.content_margin_left = 18; sb.content_margin_right = 18; sb.content_margin_top = 10; sb.content_margin_bottom = 10
		sb.border_color = Color(0.25, 0.4, 0.65, 0.5); sb.set_border_width_all(1); return sb
	_th.set_stylebox("normal", "Button", mk.call(Color(0.11, 0.19, 0.32)))
	_th.set_stylebox("hover", "Button", mk.call(Color(0.15, 0.26, 0.43)))
	_th.set_stylebox("pressed", "Button", mk.call(Color(0.2, 0.45, 0.8)))
	_th.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	_th.set_color("font_color", "Button", Color(0.93, 0.96, 1.0))
	_th.set_color("font_pressed_color", "Button", Color.WHITE)
	return _th

func _btn(text: String, cb: Callable, fs := 24) -> Button:
	var b := Button.new(); b.text = text; b.add_theme_font_size_override("font_size", fs); b.custom_minimum_size = Vector2(0, 58)
	b.mouse_filter = Control.MOUSE_FILTER_PASS; b.pressed.connect(cb); return b

func _lbl(text: String, fs := 22, col := Color(0.88, 0.93, 1.0)) -> Label:
	var l := Label.new(); l.text = text; l.add_theme_font_size_override("font_size", fs); l.add_theme_color_override("font_color", col)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART; l.size_flags_horizontal = Control.SIZE_EXPAND_FILL; return l

func _row() -> HBoxContainer:
	var h := HBoxContainer.new(); h.add_theme_constant_override("separation", 10); h.size_flags_horizontal = Control.SIZE_EXPAND_FILL; return h

func _render():
	match scr:
		"hub": _hub()
		"select": _select()
		"hangar": _hangar()
		"drill": _drill()
		"school": _school()
		"records": _records()
		"settings": _settings()
		_: _hub()

# ---------- главная ----------
func _hub():
	var h = Sim.g("game_hub")
	var b := _frame("✈ Pilot Sim 3D")
	b.add_child(_lbl("%s · %d XP     %s     %s (%s)     %s" % [h.rank.name, int(h.xp), h.moneyText, h.city, h.loc, h.short], 24))
	b.add_child(_lbl("Рейсов: %d · Посадок: %d · Пассажиров: %d · Репутация: %d · Усталость: %d%%" % [int(h.flights), int(h.landings), int(h.pax), int(h.rep), int(h.fatigue)], 20, Color(0.7, 0.8, 0.95)))
	var go := _btn("ВЫБРАТЬ РЕЙС ✈", func(): scr = "select"; _render(), 34); go.custom_minimum_size = Vector2(0, 96); var gs := StyleBoxFlat.new(); gs.bg_color = Color(0.13, 0.5, 0.9); gs.set_corner_radius_all(18); go.add_theme_stylebox_override("normal", gs); b.add_child(go)
	var di = Sim.g("game_daily_info")
	var dl := _btn("Испытание дня  ·  %s" % ("лучшая посадка %.2f м/с" % float(di.best) if di.best != null else "ещё не пройдено"), func(): close(); start_flight.emit("", "D:"), 24)
	b.add_child(dl)
	var r := _row(); b.add_child(r)
	for it in [["Ангар", "hangar"], ["Школа", "school"], ["Тренажёр ЧП", "drill"], ["Рекорды", "records"], ["Настройки", "settings"]]:
		var bb := _btn(it[0], func(): scr = it[1]; _render()); bb.size_flags_horizontal = Control.SIZE_EXPAND_FILL; r.add_child(bb)
	if int(h.fatigue) >= 25:
		b.add_child(_btn("Отдых (−усталость) — 40 000 ₽", func(): Sim.g("game_rest"); Sim.persist(); _render()))

# ---------- выбор рейса ----------
func _select():
	var h = Sim.g("game_hub"); var c = Sim.g("game_contracts")
	var b := _frame("Рейсы из %s" % h.city, "hub")
	var pr := _row(); b.add_child(pr)
	for p in h.fleet:
		var bb := _btn(str(p.short) + (" ✔" if p.id == h.plane else ""), func(): Sim.g("game_set_plane", JSON.stringify(p.id)); Sim.persist(); sel_to = ""; _render(), 22)
		pr.add_child(bb)
	b.add_child(_lbl("%s: до %d пассажиров, дальность ≈ %d км, полоса от %d м. Цена топлива ×%.2f." % [c.plane, int(c.seats), int(c.range), int(c.minRwy), float(h.fuelMul)], 20, Color(0.7, 0.8, 0.95)))
	if c.list.is_empty():
		b.add_child(_lbl("Для этого самолёта с аэродрома нет подходящих рейсов. Смените самолёт.", 22, Color(1, 0.7, 0.5)))
	for it in c.list:
		var txt := "%s (%s) — %d км · ≈%d мин · %d пасс. · %s" % [it.city, it.to, int(it.km), int(it.eta), int(it.pax), it.revenueText]
		var bb := _btn(("▶ " if it.to == sel_to else "") + txt, func(): sel_to = it.to; _render(), 22)
		bb.alignment = HORIZONTAL_ALIGNMENT_LEFT; b.add_child(bb)
	if sel_to != "":
		var go := _btn("ЛЕТЕТЬ ✈", func(): close(); start_flight.emit(sel_to, ""), 34); go.custom_minimum_size = Vector2(0, 80); b.add_child(go)

# ---------- ангар ----------
func _hangar():
	var d = Sim.g("game_hangar")
	var b := _frame("Ангар", "hub")
	b.add_child(_lbl("%s   ⭐ репутация %d" % [_rub(d.money), int(d.rep)], 24))
	var cr := _row(); b.add_child(cr)
	var bc := _btn("Экипажи: %d/5 · нанять %s" % [int(d.crews), _rub(d.crewCost)], func(): Sim.g("game_crew"); Sim.persist(); _render(), 20); bc.size_flags_horizontal = Control.SIZE_EXPAND_FILL; cr.add_child(bc)
	var bp := _btn("Второй пилот: %s" % ("вкл" if d.copilot else "выкл"), func(): Sim.g("game_copilot"); Sim.persist(); _render(), 20); bp.size_flags_horizontal = Control.SIZE_EXPAND_FILL; cr.add_child(bp)
	for p in d.planes:
		var pn := PanelContainer.new(); b.add_child(pn)
		var v := VBoxContainer.new(); pn.add_child(v)
		v.add_child(_lbl("%s%s" % [p.name, "  ✔ выбран" if p.cur else ""], 26, Color(1, 1, 1)))
		v.add_child(_lbl("%d мест · дальность ≈ %d км · полоса от %d м%s" % [int(p.seats), int(p.range), int(p.minRwy), ("  · износ %d%%" % int(p.wear)) if (p.own or p.leased) else ""], 19, Color(0.7, 0.8, 0.95)))
		v.add_child(_lbl(str(p.desc), 18, Color(0.6, 0.7, 0.85)))
		var r := _row(); v.add_child(r)
		if p.own or p.leased:
			if not p.cur: r.add_child(_btn("Выбрать", func(): Sim.g("game_set_plane", JSON.stringify(p.id)); Sim.persist(); _render(), 20))
			if p.leased: r.add_child(_lbl("аренда: ещё %d рейс." % int(p.leaseLeft), 18))
			if p.wear > 0: r.add_child(_btn("ТО %s" % _rub(p.maint), func(): Sim.g("game_maint", JSON.stringify(p.id)); Sim.persist(); _render(), 20))
		else:
			var by := _btn("Купить %s" % _rub(p.price), func(): Sim.g("game_buy", JSON.stringify(p.id)); Sim.persist(); _render(), 20); by.disabled = d.money < p.price; r.add_child(by)
			var ls := _btn("Аренда на 5 рейсов %s" % _rub(p.lease), func(): Sim.g("game_lease", JSON.stringify(p.id)); Sim.persist(); _render(), 20); ls.disabled = d.money < p.lease; r.add_child(ls)

func _rub(n) -> String:
	var s := str(int(n)); var out := ""
	var c := 0
	for i in range(s.length() - 1, -1, -1):
		out = s[i] + out; c += 1
		if c % 3 == 0 and i > 0 and s[i - 1] != "-": out = " " + out
	return out + " ₽"

# ---------- школа ----------
func _school():
	var l = Sim.g("game_lessons"); var done := 0
	for e in l: if e.done: done += 1
	var b := _frame("Лётная школа  (%d/%d)" % [done, l.size()], "hub")
	b.add_child(_lbl("Пошаговые уроки. Деньги не начисляются, опыт (+60 XP) — за первое прохождение.", 20, Color(0.7, 0.8, 0.95)))
	for e in l:
		var bb := _btn(("✔ " if e.done else "") + str(e.title), func(): close(); start_flight.emit("", "L:" + str(e.id)), 24)
		bb.alignment = HORIZONTAL_ALIGNMENT_LEFT; b.add_child(bb)
		b.add_child(_lbl(str(e.desc), 17, Color(0.6, 0.7, 0.85)))

# ---------- тренажёр ЧП ----------
func _drill():
	var h = Sim.g("game_hub"); var l = Sim.g("game_drills")
	var b := _frame("Тренажёр ЧП", "hub")
	b.add_child(_lbl("Выберите аварию — она случится в нужный момент короткого рейса. Деньги и опыт не начисляются. Самолёт: %s." % h.short, 20, Color(0.7, 0.8, 0.95)))
	for e in l:
		var bb := _btn("%s" % e.short, func(): var c = Sim.g("game_contracts"); close(); start_flight.emit("", e.id), 22)
		bb.alignment = HORIZONTAL_ALIGNMENT_LEFT; b.add_child(bb)
		b.add_child(_lbl(str(e.desc), 17, Color(0.6, 0.7, 0.85)))

# ---------- рекорды ----------
func _records():
	var h = Sim.g("game_hub")
	var b := _frame("Рекорды", "hub")
	var st = h.stat
	b.add_child(_lbl("Рейсов: %d · Налёт, ч: %.1f · Серия 4★+: %d (лучшая %d) · Дальше всего: %d км" % [int(h.flights), float(st.min) / 60.0, int(st.streak), int(st.best), int(st.maxKm)], 22))
	b.add_child(_lbl("Лучшие посадки", 26, Color(1, 1, 1)))
	if h.top.is_empty(): b.add_child(_lbl("Пока нет посадок."))
	var i := 1
	for t in h.top:
		b.add_child(_lbl("%d. %s · %s — %.2f м/с" % [i, t.pl, t.ap, float(t.sink)], 22)); i += 1

# ---------- настройки ----------
func _settings():
	var h = Sim.g("game_hub")
	var b := _frame("Настройки", "hub")
	var o = h.opts
	_toggle(b, "Помощник: автопилот набирает высоту, снижается и ведёт по глиссаде", "assistAuto", o.assistAuto)
	_toggle(b, "Помощник: сам выпускает и убирает шасси и закрылки", "assistCfg", o.assistCfg)
	_toggle(b, "Подсказки на экране", "hints", o.hints)
	_toggle(b, "Спутниковые снимки земли (нужен интернет)", "sat", o.get("sat", true))
	_choice(b, "Режим пилотирования", "mode", ["лёгкий (помощники)", "нормальный (PFD, ручной заход)", "профи (все приборы, без помощи)"], int(o.get("mode", 0)))
	_choice(b, "Аварийные ситуации", "emerg", ["выкл", "редко", "иногда", "часто"], int(o.emerg))
	_choice(b, "Погода", "wxLvl", ["штиль", "обычная", "сложная"], int(o.wxLvl))
	_choice(b, "Время суток", "tod", ["случайно", "день", "закат", "ночь"], 0 if str(o.tod) == "rnd" else int(o.tod) + 1, true)
	_choice(b, "Сезон", "season", ["лето", "осень", "зима"], int(o.season))
	b.add_child(_lbl("Модели самолётов: amvlab/aircraft-models (CC BY 4.0). Снимки Земли: Sentinel-2 cloudless 2020 by EOX (CC BY-NC 4.0), содержит изменённые данные Copernicus Sentinel.", 15, Color(0.5, 0.6, 0.75)))
	b.add_child(_lbl("Версия: Godot-предпросмотр. Сохранение хранится на устройстве.", 16, Color(0.5, 0.6, 0.75)))

func _toggle(b: VBoxContainer, text: String, key: String, val: bool):
	var c := CheckBox.new(); c.text = text; c.button_pressed = val; c.add_theme_font_size_override("font_size", 21); c.custom_minimum_size = Vector2(0, 54)
	c.toggled.connect(func(v): Sim.g("game_opt", "%s,%s" % [JSON.stringify(key), "true" if v else "false"]); Sim.persist())
	b.add_child(c)

func _choice(b: VBoxContainer, text: String, key: String, names: Array, cur: int, tod := false):
	var r := _row(); b.add_child(r)
	r.add_child(_lbl(text, 21))
	var ob := OptionButton.new(); ob.add_theme_font_size_override("font_size", 21); ob.custom_minimum_size = Vector2(240, 54)
	for n in names: ob.add_item(n)
	ob.select(cur)
	ob.item_selected.connect(func(i):
		var v = (("\"rnd\"" if i == 0 else str(i - 1)) if tod else str(i))
		Sim.g("game_opt", "%s,%s" % [JSON.stringify(key), v]); Sim.persist())
	r.add_child(ob)

# ---------- итоги рейса ----------
func show_result(r: Dictionary):
	var b := _frame(str(r.title))
	scr = "result"
	if r.kind == "ok": b.add_child(_lbl("★".repeat(int(r.stars)) + "☆".repeat(5 - int(r.stars)) + ("   Скорость снижения: %.2f м/с" % float(r.sink) if r.sink != null else ""), 28, Color(1, 0.85, 0.3)))
	if str(r.reason) != "": b.add_child(_lbl(str(r.reason), 22, Color(1, 0.7, 0.6)))
	if not r.drill and r.kind != "abort":
		var rows := [["Выручка", r.revenue, 1], ["Топливо (%d кг)" % int(r.fuelUsed), -r.fuelCost, 1], ["Обслуживание", -r.ops, 1], ["Аэропортовые сборы", -r.fee, 1]]
		if r.repair: rows.append(["Ремонт", -r.repair, 1])
		if r.crewInc: rows.append(["Доход ваших экипажей", r.crewInc, 1])
		for it in rows:
			if int(it[1]) == 0: continue
			b.add_child(_lbl("%s: %s%s" % [it[0], "+" if int(it[1]) > 0 else "", _rub(it[1])], 22, Color(0.5, 1, 0.6) if int(it[1]) > 0 else Color(1, 0.6, 0.6)))
		b.add_child(_lbl("ИТОГО: %s%s    (баланс %s)" % ["+" if int(r.net) >= 0 else "", _rub(r.net), _rub(r.money)], 28, Color(1, 1, 1)))
	if int(r.xp) > 0: b.add_child(_lbl("Опыт: +%d XP" % int(r.xp), 22))
	for e in r.evLog: b.add_child(_lbl("ЧП «%s»: %s" % [e.title, {"ok": "решено ✔", "late": "с опозданием", "fail": "провалено ✖"}.get(str(e.outcome), str(e.outcome))], 20, Color(0.8, 0.9, 1)))
	if str(r.get("extra", "")) != "": b.add_child(_lbl(str(r.extra), 24, Color(0.5, 1, 0.7)))
	if str(r.rankUp) != "": b.add_child(_lbl("Новое звание: %s" % r.rankUp, 28, Color(1, 0.85, 0.3)))
	var r2 := _row(); b.add_child(r2)
	var bm := _btn("В меню", func(): scr = "hub"; _render()); bm.size_flags_horizontal = Control.SIZE_EXPAND_FILL; r2.add_child(bm)
	var ba := _btn("Ещё рейс", func(): scr = "select"; _render()); ba.size_flags_horizontal = Control.SIZE_EXPAND_FILL; r2.add_child(ba)
