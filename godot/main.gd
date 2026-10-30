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
var tod := -1
var sel := {"plane": "a320", "from": "SVO", "to": "LED"}

func _ready():
	if not Sim.boot():
		var l := Label.new(); l.text = "Ошибка запуска движка JS"; add_child(l); return
	world = load("res://world.gd").new(); world.name = "World"; add_child(world)
	hud = load("res://hud.gd").new(); hud.name = "HUD"; add_child(hud); hud.visible = false
	hud.exit_pressed.connect(_to_menu)
	snd = load("res://sound.gd").new(); add_child(snd)
	menu = load("res://menu.gd").new(); menu.name = "Menu"; add_child(menu)
	menu.start_flight.connect(func(to, drill): _start(to, drill))
	menu.walk_request.connect(_walk)
	menu.replay_request.connect(_replay)
	menu.pf_status = func(): return world.tiles.pf_text()
	menu.prefetch_request.connect(func():
		var pts := []
		for a in Sim.data.airports: pts.append([float(a.lon), float(a.lat)])
		world.tiles.start_prefetch(pts)
		var h = Sim.g("game_hub")
		for a in Sim.data.airports:
			if a.id == h.loc: world.bld.prefetch(float(a.lon), float(a.lat)))
	menu.poi_request.connect(func(): _apply_poi(true))
	if not _args(): _show_menu()
	if screen_arg == "walk":
		menu.sel_to = "LED"; menu.pre = Sim.g("game_preflight", "\"LED\""); menu.pf_i = {"f": 1, "c": 1, "flex": false, "ck": [false, false, false, false, false]}; _walk(); return
	if screen_arg == "pre":
		menu.sel_to = "LED"; menu.pre = Sim.g("game_preflight", "\"LED\""); menu.pf_i = {"f": 1, "c": 1, "flex": false, "ck": [true, true, false, false, false]}
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
		elif s.begins_with("--orbit="):
			var q := s.substr(8).split(","); world.orbit = float(q[0]); world.orbit_up = float(q[1]); world.orbit_d = float(q[2])
		elif s.begins_with("--mode="): Sim.g("game_opt", "\"mode\",%s" % s.substr(7))
		elif s.begins_with("--poi="): Sim.g("game_opt", "\"poi\",%s" % JSON.stringify(s.substr(6)))
		elif s.begins_with("--tap="): taps.append(s.substr(6).split(","))
		elif s.begins_with("--tod="): tod = int(s.substr(6))
		elif s.begins_with("--endat="): endat = float(s.substr(8))
		elif s.begins_with("--screen="): screen_arg = s.substr(9)
	for s in a:
		if s.begins_with("--lesson="): _start("", "L:" + s.substr(9)); return true
		if s == "--daily": _start("", "D:"); return true
	if "--auto" in a:
		var cs = Sim.g("game_contracts")
		var to: String = sel.to
		var ok := false
		for it in cs.list: if it.to == sel.to: ok = true
		if not ok and not cs.list.is_empty(): to = cs.list[0].to
		_start(to, "")
		return true
	return false

func _walk():
	menu.close()
	world.visible = true
	var pid: String = Sim.g("game_hub").plane
	var col := Color.WHITE
	for p in Sim.data.planes: if p.id == pid: col = Color(str(p.color))
	world.build_plane(pid, col)
	world.set_tod(0 if tod < 0 else tod)
	var wk = load("res://walk.gd").new(); add_child(wk)
	wk.finished.connect(func(found: Array):
		world.visible = false; menu.walk_found = found; menu.open("pre"))
	wk.start(world, menu.pre.defects, false)

func _replay() -> void:
	menu.close(); world.visible = true; hud.visible = false; replaying = true; rp_i = 0.0; rp_speed = 1.0; world.cam_mode = 0; world.orbit = 30.0
	if rp_lb == null:
		var cl := CanvasLayer.new(); cl.layer = 7; add_child(cl)
		rp_lb = Label.new(); rp_lb.position = Vector2(30, 20); rp_lb.add_theme_font_size_override("font_size", 24); rp_lb.add_theme_color_override("font_outline_color", Color.BLACK); rp_lb.add_theme_constant_override("outline_size", 7); cl.add_child(rp_lb)
	rp_lb.visible = true

func _replay_stop() -> void:
	replaying = false; rp_lb.visible = false; world.visible = false; menu.show_result(last_r)

func _replay_tick(delta: float) -> void:
	rp_i += delta * 5.0 * rp_speed
	if rp_i >= rec.size() - 1: _replay_stop(); return
	var i := int(rp_i)
	var a: Dictionary = rec[i]; var b: Dictionary = rec[i + 1]; var f := rp_i - float(i)
	var s := {}
	for k in a.keys(): s[k] = lerpf(float(a[k]), float(b[k]), f)
	s["hdg"] = rad_to_deg(lerp_angle(deg_to_rad(float(a.hdg)), deg_to_rad(float(b.hdg)), f))
	world.orbit += delta * 8.0
	world.update_state(s, delta)
	rp_lb.text = "ПОВТОР  ×%d   (коснитесь: быстрее; два касания подряд — выход)   %d%%" % [int(rp_speed), int(100.0 * rp_i / float(rec.size()))]

var _rp_tap := -10.0
func _input(e: InputEvent) -> void:
	if replaying and e is InputEventScreenTouch and e.pressed:
		if t_all - _rp_tap < 0.6: _replay_stop()
		else: rp_speed = 1.0 if rp_speed >= 8.0 else rp_speed * 2.0
		_rp_tap = t_all

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
	world.set_tod(int(r.tod) if tod < 0 else tod)
	snd_opt = bool(Sim.g("game_hub").opts.get("sound", true)); snd.on = snd_opt; hud.set_pause(false); hud.set_lefty(bool(Sim.g("game_hub").opts.get("lefty", false)))
	hud.mode = int(Sim.g("game_hub").opts.get("mode", 0))
	var qual: int = int(Sim.g("game_hub").opts.get("quality", 1))
	world.set_quality(qual)
	world.bld.procedural_on = bool(Sim.g("game_hub").opts.get("fakebld", false))
	_apply_poi(false)
	world.tiles.set_enabled(bool(Sim.g("game_hub").opts.get("sat", true)) and qual >= 1)
	var lo0 := 999.0; var lo1 := -999.0; var la0 := 999.0; var la1 := -999.0
	for a in r.aps:
		lo0 = minf(lo0, float(a.lon)); lo1 = maxf(lo1, float(a.lon)); la0 = minf(la0, float(a.lat)); la1 = maxf(la1, float(a.lat))
	world.set_cities(Sim.g("sim_cities", JSON.stringify({"lo0": lo0 - 4.0, "lo1": lo1 + 4.0, "la0": la0 - 3.0, "la1": la1 + 3.0})))
	board_left = 0.0 if dbg != "" else world.BOARD_T
	rec.clear(); prof.clear(); rec_t = 0.0; prof_t = 0.0; replaying = false
	hud.visible = true; playing = true; acc = 0.0; end_t = 0.0
	Sim.ctl({"thr": 0.0, "brake": true})
	if dbg != "": Sim.vm.eval("sim_debug(%s)" % dbg, "dbg")
	hud.thr = [0.0, 0.0]; hud.pads.queue_redraw()

func _to_menu():
	if playing:
		_end_flight()
	else:
		_show_menu()

func _end_flight():
	playing = false; hud.visible = false
	var r := Sim.finish()
	last_r = r; menu.profile = prof.duplicate(); menu.has_replay = rec.size() > 20
	world.visible = false
	menu.show_result(r)

var end_t := 0.0
var screen_arg := ""
var board_left := 0.0
var snd
var endat := 2.0
var rec: Array = []        # кадры для повтора
var prof: Array = []       # высота по времени для графика
var rec_t := 0.0
var prof_t := 0.0
var last_r := {}
var replaying := false
var rp_i := 0.0
var rp_lb: Label
var rp_speed := 1.0
var snd_opt := true
var taps := []   # отладка: --tap=x,y,t (касание), --drag=x,y,x2,y2,t

func _process(delta: float):
	t_all += delta
	if shot != "" and t_all > shot_t and (playing or screen_arg != ""):
		get_viewport().get_texture().get_image().save_png(shot)
		get_tree().quit()
	if "--endtest" in OS.get_cmdline_user_args() and playing and t_all > endat: _end_flight(); screen_arg = "x"
	for tp in taps:
		if t_all > float(tp[2]) and tp.size() == 3:
			tp.append("x")
			for pr in [true, false]:
				var ev := InputEventScreenTouch.new(); ev.index = 0; ev.pressed = pr; ev.position = Vector2(float(tp[0]), float(tp[1])); Input.parse_input_event(ev)
	if replaying: _replay_tick(delta)
	if not playing:
		snd.eng = 0.0; snd.warn = false; return
	var dt := minf(delta, 0.1)
	var w: float = 0.0
	if hud.paused: pass
	elif board_left > 0.0: board_left -= delta
	else: w = Sim.step(dt)
	var s := Sim.state()
	if s.is_empty(): return
	world.update_state(s, dt)
	hud.cockpit = world.cam_mode == 1
	snd.on = snd_opt and not hud.paused
	snd.put(s)
	hud.update_state(s)
	world.cockpit_tick(s, hud.thr, hud.roll, hud.stick)
	if board_left <= 0.0 and not hud.paused:
		rec_t += delta; prof_t += delta
		if rec_t >= 0.2:
			rec_t = 0.0
			var keep := {}
			for k in ["lat", "lon", "alt", "hdg", "theta", "phi", "gear", "v", "ref"]: keep[k] = s.get(k, 0.0)
			rec.append(keep)
			if rec.size() > 6000: rec = rec.slice(1000)
		if prof_t >= 5.0: prof_t = 0.0; prof.append(float(s.get("alt", 0.0)))
	if s.get("done", false) and world.cam_mode == 0: world.orbit += delta * 16.0
	world.board_tick(board_left > 0.0 and world.cam_mode != 1, world.BOARD_T - board_left)
	hud.boarding(board_left)
	if s.get("done", false):
		end_t += delta
		if end_t > 3.0: _end_flight()

func _apply_poi(fetch: bool) -> void:
	var t := str(Sim.g("game_hub").opts.get("poi", "")).replace(";", ",")
	var p := t.split(",")
	if p.size() != 2 or not p[0].strip_edges().is_valid_float() or not p[1].strip_edges().is_valid_float():
		world.bld.set_poi(999.0, 0.0); return
	var la := p[0].strip_edges().to_float(); var lo := p[1].strip_edges().to_float()
	world.bld.set_poi(lo, la)
	if fetch: world.bld.prefetch(lo, la)
