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

func _ready():
	pl = AudioStreamPlayer.new(); var g := AudioStreamGenerator.new(); g.mix_rate = RATE; g.buffer_length = 0.25
	pl.stream = g; add_child(pl); pl.play(); pb = pl.get_stream_playback()

func put(s: Dictionary):
	thr = float(s.thr); eng = (float(s.eng[0]) + float(s.eng[1])) * 0.5; spd = float(s.ias)
	warn = s.alerts.size() > 0 or s.warnings.size() > 0

func _process(_d: float):
	if pb == null: return
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
		if warn and on: v += (1.0 if fmod(t * 2.5, 1.0) < 0.5 and fmod(t * 880.0, 1.0) < 0.5 else -1.0) * 0.05 * (1.0 if fmod(t * 2.5, 1.0) < 0.5 else 0.0)
		pb.push_frame(Vector2(v, v))
