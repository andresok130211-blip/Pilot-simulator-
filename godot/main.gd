extends Node
# Точка входа: меню рейса -> полёт.
var world: Node3D
var hud: CanvasLayer
var menu: CanvasLayer
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
	menu = load("res://menu.gd").new(); menu.name = "Menu"; add_child(menu)
	menu.start_flight.connect(func(to, drill): _start(to, drill))
	if not _args(): _show_menu()
	if screen_arg != "": menu.open(screen_arg)

func _args() -> bool:
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
		elif s.begins_with("--screen="): screen_arg = s.substr(9)
	if "--auto" in a:
		var cs = Sim.g("game_contracts")
		var to: String = sel.to
		var ok := false
		for it in cs.list: if it.to == sel.to: ok = true
		if not ok and not cs.list.is_empty(): to = cs.list[0].to
		_start(to, "")
		return true
	return false

func _show_menu():
	playing = false; hud.visible = false; world.visible = false
	menu.open("hub")

func _start(to := "", drill := ""):
	var r := Sim.begin(to, drill)
	if r.is_empty(): return
	menu.close()
	world.visible = true
	var pid: String = Sim.g("game_hub").plane
	var col := Color.WHITE
	for p in Sim.data.planes: if p.id == pid: col = Color(str(p.color))
	world.build_plane(pid, col)
	world.set_airports(r.aps, float(r.brg))
	world.set_tod(int(r.tod))
	hud.visible = true; playing = true; acc = 0.0; end_t = 0.0
	Sim.ctl({"thr": 0.0, "brake": true})
	if dbg != "": Sim.vm.eval("sim_debug(%s)" % dbg, "dbg")
	hud.thr_s.set_value_no_signal(0.0)

func _to_menu():
	if playing:
		_end_flight()
	else:
		_show_menu()

func _end_flight():
	playing = false; hud.visible = false
	var r := Sim.finish()
	world.visible = false
	menu.show_result(r)

var end_t := 0.0
var screen_arg := ""

func _process(delta: float):
	t_all += delta
	if shot != "" and t_all > shot_t and (playing or screen_arg != ""):
		get_viewport().get_texture().get_image().save_png(shot)
		get_tree().quit()
	if "--endtest" in OS.get_cmdline_user_args() and playing and t_all > 2.0: _end_flight(); screen_arg = "x"
	if not playing: return
	var dt := minf(delta, 0.1)
	var w := Sim.step(dt)
	var s := Sim.state()
	if s.is_empty(): return
	world.update_state(s, dt)
	hud.update_state(s)
	if s.get("done", false):
		end_t += delta
		if end_t > 3.0: _end_flight()
