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
