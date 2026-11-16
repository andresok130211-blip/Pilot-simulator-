extends Node
# Отчёт о работе: FPS, ошибки движка, устройство. Кнопка в Настройках копирует его в буфер обмена.
var samples: Array[float] = []
var acc := 0.0
var frames := 0
var plane := ""
var where := ""
var events: Array[String] = []

func _process(delta: float) -> void:
	acc += delta; frames += 1
	if acc >= 1.0:
		samples.append(float(frames) / acc)
		if samples.size() > 1800: samples.pop_front()
		acc = 0.0; frames = 0

func note(s: String) -> void:
	events.append("%02d:%02d %s" % [int(Time.get_ticks_msec() / 60000.0), int(Time.get_ticks_msec() / 1000.0) % 60, s])
	if events.size() > 40: events.pop_front()

func _log_errors() -> Array[String]:
	var out: Array[String] = []
	var f := FileAccess.open("user://logs/godot.log", FileAccess.READ)
	if f == null: return ["(лог движка недоступен)"]
	var seen := {}
	while not f.eof_reached():
		var l := f.get_line()
		if l.contains("eaked") or l.contains("V-Sync") or l.contains("PagedAllocator") or l.contains("ALSA") or l.contains("ERR_CANT_OPEN"): continue
		if l.contains("ERROR") or l.contains("SCRIPT ERROR") or l.contains("WARNING") and not l.contains("audio"):
			var k := l.substr(0, 120)
			if not seen.has(k): seen[k] = true; out.append(k)
	return out.slice(maxi(0, out.size() - 25))

func build() -> String:
	var t := PackedStringArray()
	t.append("ОТЧЁТ Pilot Sim 3D")
	t.append("Устройство: %s | %s | %s" % [OS.get_model_name(), OS.get_name(), OS.get_version()])
	t.append("Видео: %s | экран %s" % [RenderingServer.get_video_adapter_name(), str(DisplayServer.window_get_size())])
	t.append("Самолёт: %s  Экран: %s" % [plane, where])
	if samples.size() > 0:
		var s := samples.duplicate(); s.sort()
		var sum := 0.0
		for v in s: sum += v
		t.append("FPS: средний %.0f, минимум %.0f, 5%% худших ≤ %.0f (замеров %d)" % [sum / s.size(), s[0], s[int(s.size() * 0.05)], s.size()])
	else:
		t.append("FPS: нет замеров (сначала полетайте)")
	t.append("Память: %.0f МБ" % (float(OS.get_static_memory_usage()) / 1048576.0))
	t.append("События:"); t.append_array(events)
	t.append("Ошибки движка:"); t.append_array(_log_errors())
	return "\n".join(t)

func copy() -> String:
	var s := build()
	DisplayServer.clipboard_set(s)
	var f := FileAccess.open("user://report.txt", FileAccess.WRITE)
	if f: f.store_string(s)
	return s
