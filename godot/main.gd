extends Node
# Точка входа: меню рейса -> полёт.
var world: Node3D
var hud: CanvasLayer
var menu: Control
var playing := false
var acc := 0.0
var shot := ""
var shot_t := 3.0
var dbg := ""
var t_all := 0.0
var tod := 0
var sel := {"plane": "a320", "from": "SVO", "to": "LED"}

func _ready():
	if not Sim.boot():
		var l := Label.new(); l.text = "Ошибка запуска движка JS"; add_child(l); return
	world = load("res://world.gd").new(); world.name = "World"; add_child(world)
	hud = load("res://hud.gd").new(); hud.name = "HUD"; add_child(hud); hud.visible = false
	hud.exit_pressed.connect(_to_menu)
	_show_menu()
	_args()

func _args():
	var a := OS.get_cmdline_user_args()
	for s in a:
		if s.begins_with("--plane="): sel.plane = s.substr(8)
		elif s.begins_with("--from="): sel.from = s.substr(7)
		elif s.begins_with("--to="): sel.to = s.substr(5)
		elif s.begins_with("--shot="): shot = s.substr(7)
		elif s.begins_with("--wait="): shot_t = float(s.substr(7))
		elif s.begins_with("--debug="): dbg = s.substr(8)
		elif s.begins_with("--cam="): world.cam_mode = int(s.substr(6))
		elif s.begins_with("--tod="): tod = int(s.substr(6))
	if "--auto" in a:
		_start()

func _show_menu():
	playing = false; hud.visible = false
	if menu: menu.queue_free()
	var cl := CanvasLayer.new(); cl.layer = 5; add_child(cl)
	menu = Control.new(); menu.set_anchors_preset(Control.PRESET_FULL_RECT); cl.add_child(menu)
	var bg := ColorRect.new(); bg.color = Color(0.04, 0.09, 0.16, 0.92); bg.set_anchors_preset(Control.PRESET_FULL_RECT); menu.add_child(bg)
	var box := VBoxContainer.new(); box.position = Vector2(60, 40); box.custom_minimum_size = Vector2(900, 500); menu.add_child(box)
	var t := Label.new(); t.text = "✈ Pilot Sim 3D"; t.add_theme_font_size_override("font_size", 40); box.add_child(t)
	var sub := Label.new(); sub.text = "Новый движок (Godot): реальный мир, физика прежняя. Выберите самолёт и маршрут."; box.add_child(sub)
	var pl := OptionButton.new(); var fr := OptionButton.new(); var to := OptionButton.new()
	for p in Sim.data.planes: pl.add_item("%s  (%d мест)" % [p.name, int(p.seats)])
	for a in Sim.data.airports: fr.add_item("%s — %s %s" % [a.id, a.city, a.name]); to.add_item("%s — %s %s" % [a.id, a.city, a.name])
	for o in [pl, fr, to]: o.custom_minimum_size = Vector2(700, 56); o.add_theme_font_size_override("font_size", 20); box.add_child(o)
	for i in range(Sim.data.planes.size()): if Sim.data.planes[i].id == sel.plane: pl.select(i)
	for i in range(Sim.data.airports.size()):
		if Sim.data.airports[i].id == sel.from: fr.select(i)
		if Sim.data.airports[i].id == sel.to: to.select(i)
	pl.item_selected.connect(func(i): sel.plane = Sim.data.planes[i].id)
	fr.item_selected.connect(func(i): sel.from = Sim.data.airports[i].id)
	to.item_selected.connect(func(i): sel.to = Sim.data.airports[i].id)
	var info := Label.new(); box.add_child(info)
	var go := Button.new(); go.text = "ВЫЛЕТ ▶"; go.custom_minimum_size = Vector2(300, 70); go.add_theme_font_size_override("font_size", 28)
	go.pressed.connect(_start); box.add_child(go)
	world.visible = false

func _start():
	var o := {"plane": sel.plane, "from": sel.from, "to": sel.to, "tod": tod, "wx": 1, "emerg": 0, "taxi": false, "seed": randi()}
	if sel.from == sel.to: return
	var r := Sim.start(o)
	if r == null: return
	if menu: menu.get_parent().queue_free(); menu = null
	world.visible = true
	var col := Color.WHITE
	for p in Sim.data.planes: if p.id == sel.plane: col = Color(str(p.color))
	world.build_plane(sel.plane, col)
	world.set_airports(r.aps, float(r.brg))
	world.set_tod(tod)
	hud.visible = true; playing = true; acc = 0.0
	Sim.ctl({"thr": 0.0, "brake": true})
	if dbg != "": Sim.vm.eval("sim_debug(%s)" % dbg, "dbg")
	hud.thr_s.set_value_no_signal(0.0)

func _to_menu():
	_show_menu()

func _process(delta: float):
	t_all += delta
	if shot != "" and t_all > shot_t and playing:
		get_viewport().get_texture().get_image().save_png(shot)
		get_tree().quit()
	if not playing: return
	var dt := minf(delta, 0.1)
	var w := Sim.step(dt)
	var s := Sim.state()
	if s.is_empty(): return
	world.update_state(s, dt)
	hud.update_state(s)
