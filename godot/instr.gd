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
	if cockpit:
		var w := Color(0.06, 0.07, 0.09)
		draw_colored_polygon(PackedVector2Array([Vector2(0, 0), Vector2(1280, 0), Vector2(1280, 40), Vector2(0, 40)]), w)
		draw_colored_polygon(PackedVector2Array([Vector2(0, 40), Vector2(70, 40), Vector2(0, 470)]), w)
		draw_colored_polygon(PackedVector2Array([Vector2(1280, 40), Vector2(1210, 40), Vector2(1280, 470)]), w)
		draw_colored_polygon(PackedVector2Array([Vector2(0, 470), Vector2(1280, 470), Vector2(1280, 720), Vector2(0, 720)]), Color(0.1, 0.11, 0.13))
		draw_rect(Rect2(0, 462, 1280, 10), Color(0.18, 0.19, 0.22))
	if mode == 0 and not cockpit: return
	_pfd(Vector2(80, 100), 135.0)
	if mode == 2: _eng(Vector2(1000, 100))

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
