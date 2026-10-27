extends Control
# Приборы: PFD (горизонт, скорость, высота, курс) и панель двигателей/систем. Режим 0 — скрыто, 1 — PFD, 2 — всё.
var s := {}
var mode := 0
var cockpit := false
var font: Font

func _ready():
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	font = ThemeDB.fallback_font

func put(st: Dictionary, m: int, ck: bool):
	s = st; mode = m; cockpit = ck; queue_redraw()

func _t(p: Vector2, txt: String, sz := 18, col := Color.WHITE):
	draw_string(font, p, txt, HORIZONTAL_ALIGNMENT_LEFT, -1, sz, col)

func _draw():
	if s.is_empty(): return
	if cockpit: _cockpit(); return
	_topbar()
	if mode == 0: return
	_pfd(Vector2(190, 100), 135.0)
	if mode == 2: _eng(Vector2(1000, 100))
	_radar(radar_rect().get_center(), 115.0)

# верхняя плашка: маршрут, остаток, время
func _topbar():
	if mode == 0: return
	var r := Rect2(470, 8, 560, 52)
	draw_rect(r, Color(0.05, 0.08, 0.12, 0.75), true)
	_t(r.position + Vector2(12, 36), "%s → %s" % [str(s.rw0.id), str(s.rw1.id)], 26)
	_t(r.position + Vector2(215, 38), "%d км" % (float(s.dist) / 1000.0), 32, Color(0.4, 1, 0.55))
	var v := maxf(float(s.v), 60.0); var m := int(float(s.dist) / v / 60.0)
	_t(r.position + Vector2(400, 36), "%d ч %02d мин" % [m / 60, m % 60], 24)

# кабина: подголовник, лобовое, MCP, приборная панель (по фото кабины 737)
func _cockpit():
	var dk := Color(0.09, 0.1, 0.12); var md := Color(0.16, 0.17, 0.2)
	draw_rect(Rect2(0, 0, 1280, 62), md); draw_rect(Rect2(0, 54, 1280, 10), dk)
	for i in range(64):   # верхняя панель: тумблеры и лампы
		var x := 10.0 + i * 19.8
		for j in range(2):
			var on: bool = (i * 7 + j * 3) % 5 == 0
			draw_rect(Rect2(x, 6 + j * 24, 12, 14), Color(0.95, 0.6, 0.15) if on else Color(0.3, 0.32, 0.36))
			draw_circle(Vector2(x + 6, 13 + j * 24), 3, Color(0.85, 0.87, 0.9))
	for x in [0.0, 330.0, 620.0, 930.0, 1276.0]: draw_rect(Rect2(x, 0, 4, 58), dk)
	draw_colored_polygon(PackedVector2Array([Vector2(0, 64), Vector2(95, 64), Vector2(40, 310), Vector2(0, 310)]), dk)
	draw_colored_polygon(PackedVector2Array([Vector2(1280, 64), Vector2(1185, 64), Vector2(1240, 310), Vector2(1280, 310)]), dk)
	draw_rect(Rect2(626, 64, 28, 250), dk)
	draw_rect(Rect2(0, 300, 1280, 340), Color(0.11, 0.12, 0.14)); draw_rect(Rect2(0, 300, 1280, 36), Color(0.05, 0.06, 0.07))
	draw_rect(Rect2(330, 305, 620, 26), Color(0.02, 0.02, 0.03))   # MCP
	var vals := [["СК", "%d" % (float(s.ias) * 3.6)], ["КУРС", "%03d" % float(s.hdg)], ["ВЫС", "%d" % float(s.c.apAlt)], ["В/С", "%+d" % float(s.vs)], ["М", "%.2f" % float(s.mach)]]
	for i in range(5):
		_t(Vector2(346 + i * 120, 324), "%s %s" % [vals[i][0], vals[i][1]], 16, Color(0.4, 1, 0.5))
	_pfd(Vector2(200, 340), 70.0); _pfd(Vector2(950, 340), 70.0)
	_radar(Vector2(468, 408), 56.0); _radar(Vector2(812, 408), 56.0)
	_eicas(Vector2(560, 345))
	for sx in [26.0, 1254.0]:
		draw_rect(Rect2(sx - 14, 470, 28, 170), Color(0.05, 0.05, 0.06)); draw_circle(Vector2(sx, 470), 28, Color(0.07, 0.07, 0.08))

func _eicas(o: Vector2):
	draw_rect(Rect2(o, Vector2(160, 130)), Color(0, 0, 0, 0.85))
	var thr := float(s.thr)
	for i in range(2):
		var on: bool = int(s.eng[i]) == 1
		var n1 := (22.0 + 78.0 * thr) if on else 0.0
		var c := o + Vector2(42 + i * 76, 48)
		draw_arc(c, 28, deg_to_rad(150), deg_to_rad(390), 24, Color(0.35, 0.35, 0.4), 4.0)
		draw_arc(c, 28, deg_to_rad(150), deg_to_rad(150 + 240 * n1 / 100.0), 24, Color(0.3, 1, 0.45) if on else Color(0.8, 0.2, 0.2), 4.0)
		_t(c + Vector2(-17, 6), "%d" % n1, 16); _t(c + Vector2(-14, 44), "EGT %d" % ((350.0 + 480.0 * thr) if on else 30.0), 11, Color(0.8, 0.9, 1))
	_t(o + Vector2(8, 100), "ТОПЛ %d" % float(s.fuel), 14, Color(0.4, 1, 0.5)); _t(o + Vector2(8, 120), "ЗАКР %s  ШАСС %s" % [str(s.flapName), "▼" if float(s.gear) > 0.98 else "▲"], 13)

func _pfd(o: Vector2, r: float):
	var c := o + Vector2(r, r)
	var pitch := rad_to_deg(float(s.theta)); var roll := float(s.phi)
	var circ := PackedVector2Array()
	for i in range(48): circ.append(c + Vector2(r * 0.72, 0).rotated(TAU * i / 48))
	draw_colored_polygon(circ, Color(0.25, 0.5, 0.85))
	var off := pitch * 3.2
	var g := PackedVector2Array([Vector2(-3 * r, off), Vector2(3 * r, off), Vector2(3 * r, off + 3 * r), Vector2(-3 * r, off + 3 * r)])
	var gp := PackedVector2Array(); for p in g: gp.append(c + p.rotated(-roll))
	for poly in Geometry2D.intersect_polygons(circ, gp): draw_colored_polygon(poly, Color(0.45, 0.32, 0.18))
	for d in [-10, -5, 5, 10]:
		var y: float = off - d * 3.2; var hw := 18.0 if abs(d) == 5 else 30.0
		draw_line(c + Vector2(-hw, y).rotated(-roll), c + Vector2(hw, y).rotated(-roll), Color(1, 1, 1, 0.8), 2.0)
	draw_line(c + Vector2(-34, 0), c + Vector2(-10, 0), Color(1, 0.85, 0.1), 4.0); draw_line(c + Vector2(10, 0), c + Vector2(34, 0), Color(1, 0.85, 0.1), 4.0); draw_circle(c, 3, Color(1, 0.85, 0.1))
	draw_arc(c, r * 0.72, 0, TAU, 48, Color(0.9, 0.95, 1), 2.0)
	# лента скорости (км/ч) слева
	var spd := float(s.ias) * 3.6
	var rc := r * 0.72; var top := c.y - rc - 10.0; var bot := c.y + rc + 10.0
	var bx := c.x - rc - 8.0
	draw_rect(Rect2(bx - 52, top, 60, bot - top), Color(0, 0, 0, 0.5))
	for k in range(-6, 7):
		var v := roundf(spd / 20.0) * 20.0 + k * 20.0
		var y := c.y - (v - spd) * 1.3
		if y > top + 8 and y < bot - 8 and v >= 0: draw_line(Vector2(bx, y), Vector2(bx + 8, y), Color.WHITE, 2.0); _t(Vector2(bx - 46, y + 6), "%d" % v, 15)
	draw_rect(Rect2(bx - 52, c.y - 12, 60, 24), Color(0, 0, 0, 0.9)); _t(Vector2(bx - 46, c.y + 7), "%d" % spd, 20, Color(0.5, 1, 0.6))
	# лента высоты (м) справа
	var alt := float(s.alt); var ax := c.x + rc + 8.0
	draw_rect(Rect2(ax, top, 66, bot - top), Color(0, 0, 0, 0.5))
	for k in range(-6, 7):
		var v := roundf(alt / 50.0) * 50.0 + k * 50.0
		var y := c.y - (v - alt) * 0.8
		if y > top + 8 and y < bot - 8: draw_line(Vector2(ax, y), Vector2(ax - 8, y), Color.WHITE, 2.0); _t(Vector2(ax + 4, y + 6), "%d" % v, 15)
	draw_rect(Rect2(ax, c.y - 12, 66, 24), Color(0, 0, 0, 0.9)); _t(Vector2(ax + 4, c.y + 7), "%d" % alt, 20, Color(0.5, 1, 0.6))
	if s.c.apOn: _t(Vector2(ax, top - 4), "ЦЕЛЬ %d" % float(s.c.apAlt), 15, Color(1, 0.4, 1))
	if cockpit: return
	_t(Vector2(c.x - 110, bot + 24), "КУРС %03d°   В/С %+d" % [float(s.hdg), float(s.vs)], 20)
	_t(Vector2(c.x - 110, bot + 48), "V1 %d  Vr %d  V2 %d" % [float(s.v1) * 3.6, float(s.vr) * 3.6, float(s.v2) * 3.6], 15, Color(0.7, 0.85, 1))

func _eng(o: Vector2):
	draw_rect(Rect2(o - Vector2(10, 10), Vector2(260, 330)), Color(0, 0, 0, 0.55), true)
	var thr := float(s.thr)
	for i in range(2):
		var on: bool = int(s.eng[i]) == 1
		var n1 := (22.0 + 78.0 * thr) if on else 0.0
		var x := o.x + i * 125.0
		_t(Vector2(x, o.y + 16), "ДВ %d" % (i + 1), 18, Color(0.7, 0.85, 1))
		draw_rect(Rect2(x, o.y + 26, 100, 14), Color(0.2, 0.2, 0.25)); draw_rect(Rect2(x, o.y + 26, n1, 14), Color(0.3, 0.9, 0.4) if on else Color(0.8, 0.2, 0.2))
		_t(Vector2(x, o.y + 62), "N1 %d%%" % n1, 17)
		_t(Vector2(x, o.y + 84), "EGT %d°" % ((350.0 + 480.0 * thr) if on else 30.0), 17)
		_t(Vector2(x, o.y + 106), "N2 %d%%" % ((55.0 + 45.0 * thr) if on else 0.0), 17)
	var fl := float(s.fuel)
	_t(o + Vector2(0, 140), "ТОПЛИВО %d кг" % fl, 18); _t(o + Vector2(0, 164), "МАССА %d кг" % float(s.mass), 17)
	_t(o + Vector2(0, 190), "ЗАКРЫЛКИ %s" % str(s.flapName), 17)
	var gr := float(s.gear)
	_t(o + Vector2(0, 214), "ШАССИ " + ("ВЫПУЩЕНО" if gr > 0.98 else ("УБРАНО" if gr < 0.02 else "в движении")), 17, Color(0.4, 1, 0.5) if gr > 0.98 else Color.WHITE)
	_t(o + Vector2(0, 238), "А/П %s   А/Т %s   ЗАХОД %s" % ["ВКЛ" if s.c.apOn else "—", "ВКЛ" if s.c.atOn else "—", "ВКЛ" if s.c.appr else "—"], 16)
	_t(o + Vector2(0, 262), "Ветер %d°/%d м/с  QNH %d" % [float(s.wx.dir), float(s.wx.spd), float(s.wx.qnh)], 16)
	_t(o + Vector2(0, 286), "Темп. %d°C  Число М %.2f" % [float(s.wx.temp), float(s.mach)], 16)
	_t(o + Vector2(0, 310), "Тормоз %s  Реверс %s" % ["ДА" if s.c.brake else "нет", "ДА" if s.c.rev else "нет"], 16)

var rng := 40000.0
var sweep := 0.0
func radar_rect() -> Rect2: return Rect2(730, 96, 250, 250) if not cockpit else Rect2(412, 352, 112, 112)

func _radar(c: Vector2, R: float):
	var r := Rect2(c - Vector2(R, R), Vector2(R, R) * 2.0)
	sweep = fmod(sweep + 0.06, TAU)
	draw_circle(c, R + 8, Color(0, 0, 0, 0.6)); draw_circle(c, R, Color(0.02, 0.12, 0.06, 0.85))
	for q in [0.33, 0.66, 1.0]: draw_arc(c, R * q, 0, TAU, 48, Color(0.2, 0.7, 0.35, 0.6), 1.5)
	draw_line(c + Vector2(0, -R), c + Vector2(0, R), Color(0.2, 0.7, 0.35, 0.35), 1.0); draw_line(c + Vector2(-R, 0), c + Vector2(R, 0), Color(0.2, 0.7, 0.35, 0.35), 1.0)
	draw_line(c, c + Vector2(0, -R).rotated(sweep), Color(0.5, 1, 0.6, 0.8), 2.0)
	var k := R / rng; var psi := float(s.psi); var cs := cos(psi); var sn := sin(psi)
	var px := float(s.x); var pz := float(s.y)
	var a := _rp(c, k, 0.0, 0.0, px, pz, cs, sn); var b := _rp(c, k, float(s.D), 0.0, px, pz, cs, sn)
	draw_line(a.clamp(c - Vector2(R, R), c + Vector2(R, R)), b.clamp(c - Vector2(R, R), c + Vector2(R, R)), Color(1, 0.4, 1, 0.8), 2.0)
	if b.distance_to(c) < R: draw_circle(b, 5, Color(1, 0.7, 0.3)); _t(b + Vector2(6, -6), str(s.rw1.id), 13, Color(1, 0.7, 0.3))
	if a.distance_to(c) < R: draw_circle(a, 4, Color(0.5, 1, 0.6)); _t(a + Vector2(6, -6), str(s.rw0.id), 13, Color(0.5, 1, 0.6))
	for t in s.get("trf", []):
		var p := _rp(c, k, float(t[0]), float(t[1]), px, pz, cs, sn)
		if p.distance_to(c) < R:
			var dh := float(t[2]) - float(s.alt)
			var col := Color(1, 0.3, 0.3) if absf(dh) < 600.0 else Color(0.4, 0.8, 1)
			draw_rect(Rect2(p - Vector2(4, 4), Vector2(8, 8)), col); _t(p + Vector2(7, 4), "%+d" % (dh / 100.0), 13, col)
	draw_colored_polygon(PackedVector2Array([c + Vector2(0, -9), c + Vector2(6, 7), c + Vector2(-6, 7)]), Color.WHITE)
	_t(r.position + Vector2(R * 0.55, R * 1.95), "%d км" % (rng / 1000.0), 13, Color(0.6, 1, 0.7))
	# подсказка курса к аэродрому назначения
	var tb := _rp(c, 1.0, float(s.D), 0.0, px, pz, cs, sn)
	var ang := rad_to_deg(atan2(tb.x - c.x, -(tb.y - c.y)))
	if absf(ang) > 2.0: _t(r.position + Vector2(R * 0.45, 18), "%s %d°" % ["ВПРАВО" if ang > 0 else "ВЛЕВО", int(absf(ang))], 15 if R > 80 else 11, Color(1, 0.8, 0.3))

func _rp(c: Vector2, k: float, tx: float, tz: float, px: float, pz: float, cs: float, sn: float) -> Vector2:
	var dx := tx - px; var dz := tz - pz
	return c + Vector2(-dx * sn + dz * cs, -(dx * cs + dz * sn)) * k

func cycle_range():
	var rs := [10000.0, 20000.0, 40000.0, 80000.0, 160000.0]
	rng = rs[(rs.find(rng) + 1) % 5]
