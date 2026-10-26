extends Node
# Обёртка над встроенным JS-движком: вся логика игры живёт в assets/sim.js (тот же код, что в версии для браузера).
var vm: JSVM
var ok := false
var data: Dictionary = {}

func boot() -> bool:
	if ok: return true
	vm = JSVM.new()
	if not vm.init():
		push_error("JS init failed"); return false
	var f := FileAccess.open("res://assets/sim.js", FileAccess.READ)
	var r: String = vm.eval(f.get_as_text(), "sim.js")
	if r.begins_with("ERR"):
		push_error(r); return false
	data = _json(vm.call("sim_data", ""))
	var sf := FileAccess.open("user://save.json", FileAccess.READ)
	var js := "{}"
	if sf: js = sf.get_as_text()
	vm.call("game_load", JSON.stringify(js))
	ok = true
	return true

func _json(s: String):
	if s == "" or s == "undefined": return null
	return JSON.parse_string(s)

func start(o: Dictionary) -> Dictionary:
	return _json(vm.call("sim_start", JSON.stringify(o)))

func step(dt: float) -> float:
	var r := vm.eval("sim_step(%f)" % dt, "s")
	return float(r) if r != "" else 1.0

func ctl(o: Dictionary) -> void:
	vm.eval("sim_ctl(%s)" % JSON.stringify(o), "c")

func act(a: String) -> void:
	vm.eval("sim_act(%s)" % JSON.stringify(a), "a")

func state() -> Dictionary:
	var r = _json(vm.call("sim_state", ""))
	return r if r != null else {}

func alts() -> Array:
	var r = _json(vm.call("sim_alts", ""))
	return r if r != null else []

func divert(i: int) -> bool:
	return vm.eval("sim_divert(%d)" % i, "d") == "true"

func routes(plane: String, from: String, seed_: int) -> Array:
	var r = _json(vm.call("sim_routes", '"%s","%s",%d' % [plane, from, seed_]))
	return r if r != null else []

# ---------- карьера ----------
func g(fn: String, args := ""):
	return _json(vm.call(fn, args))

func persist() -> void:
	var f := FileAccess.open("user://save.json", FileAccess.WRITE)
	if f: f.store_string(vm.call("game_dump_json", ""))

func begin(to: String, drill := "") -> Dictionary:
	# drill: "" обычный рейс, "L:<id>" урок, "D:" испытание дня, иначе id аварии
	var a := "%s,null,null,null" % JSON.stringify(to)
	if drill.begins_with("L:"): a = "%s,null,'lesson',%s" % [JSON.stringify(to), JSON.stringify(drill.substr(2))]
	elif drill == "D:": a = "%s,null,'daily',null" % JSON.stringify(to)
	elif drill != "": a = "%s,%s,null,null" % [JSON.stringify(to), JSON.stringify(drill)]
	var r = _json(vm.call("game_begin", a))
	return r if r != null else {}

func finish() -> Dictionary:
	var r = _json(vm.call("game_finish", ""))
	persist()
	return r if r != null else {}
