extends Node
# Синтезированный звук: гул двигателей (по тяге), шум ветра (по скорости), сигнал тревоги.
const RATE := 22050.0
var pl: AudioStreamPlayer
var pb: AudioStreamGeneratorPlayback
var thr := 0.0
var eng := 0.0
var spd := 0.0
var warn := false
var on := true
var ph := 0.0
var lp := 0.0
var wph := 0.0
var t := 0.0
var gear_v := 1.0
var flap_v := 0.0
var was_gnd := true
var whine := 0.0
var thump := 0.0
var squeal := 0.0
var whine_ph := 0.0
var click_e := 0.0
var click_f := 1800.0
func click(f := 1800.0) -> void:
	click_e = 1.0; click_f = f

func _ready():
	pl = AudioStreamPlayer.new(); var g := AudioStreamGenerator.new(); g.mix_rate = RATE; g.buffer_length = 0.25
	pl.stream = g; add_child(pl); pl.play(); pb = pl.get_stream_playback()

func put(s: Dictionary):
	thr = float(s.thr); eng = (float(s.eng[0]) + float(s.eng[1])) * 0.5; spd = float(s.ias)
	warn = s.alerts.size() > 0 or s.warnings.size() > 0
	var g := float(s.get("gear", 1.0)); var fl := float(s.get("flaps", 0.0))
	if absf(g - gear_v) > 0.0005 or absf(fl - flap_v) > 0.0005: whine = 0.25
	gear_v = g; flap_v = fl
	var gnd: bool = bool(s.get("onGround", true))
	if gnd and not was_gnd:
		thump = 1.0; squeal = clampf(spd / 90.0, 0.0, 1.0) * 0.6
	was_gnd = gnd

func _process(_d: float):
	if pb == null: return
	whine = maxf(0.0, whine - _d); thump = maxf(0.0, thump - _d * 3.5); squeal = maxf(0.0, squeal - _d * 1.2)
	var n := pb.get_frames_available()
	var f0 := 40.0 + 90.0 * thr
	var vol := eng * (0.10 + 0.22 * thr) if on else 0.0
	var wv := clampf(spd / 120.0, 0.0, 1.0) * 0.12 if on else 0.0
	for i in range(n):
		ph = fmod(ph + f0 / RATE, 1.0)
		var nz := randf() * 2.0 - 1.0
		lp += (nz - lp) * (0.08 + 0.25 * thr)
		var v := (sin(ph * TAU) * 0.35 + lp * 0.9) * vol + lp * wv
		t += 1.0 / RATE
		if whine > 0.0:
			whine_ph = fmod(whine_ph + (420.0 + 160.0 * gear_v) / RATE, 1.0)
			v += sin(whine_ph * TAU) * 0.05 * minf(1.0, whine * 4.0) + nz * 0.01
		if thump > 0.0:
			v += (sin(thump * 55.0 * TAU * 0.02) * 0.5 + lp * 0.6) * thump * 0.5 * (1.0 if on else 0.0)
		if squeal > 0.0:
			v += sin(fmod(t * 1400.0, 1.0) * TAU) * 0.04 * squeal * (1.0 if on else 0.0)
		if warn and on: v += (1.0 if fmod(t * 2.5, 1.0) < 0.5 and fmod(t * 880.0, 1.0) < 0.5 else -1.0) * 0.05 * (1.0 if fmod(t * 2.5, 1.0) < 0.5 else 0.0)
		if click_e > 0.001:
			click_e *= 0.9965
			v += (nz * 0.6 + sin(fmod(t * click_f, 1.0) * TAU) * 0.8) * click_e * 0.22
		pb.push_frame(Vector2(v, v))
