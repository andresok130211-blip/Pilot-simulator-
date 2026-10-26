extends Node
# Спутниковые снимки (Sentinel-2 cloudless, EOX, CC BY-NC 4.0): подгружаются плитками и кешируются на устройстве.
const URL := "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/%d/%d/%d.jpg"
const LEVELS := [9, 12]       # дальний и ближний слой
const GRID := 3
var enabled := true
var imgs := {}                # "z/x/y" -> Image
var pending := {}
var comp := []                # Image на уровень
var tex := []                 # ImageTexture
var org := []                 # Vector2 (меркатор 0..1) левого верхнего угла
var cen := [Vector2i(-1, -1), Vector2i(-1, -1)]
var dirty := [true, true]
var queue := []
var active := 0
var t_acc := 0.0
var mat: ShaderMaterial

func setup(m: ShaderMaterial):
	mat = m
	DirAccess.make_dir_recursive_absolute("user://tiles")
	for i in range(2):
		var im := Image.create(256 * GRID, 256 * GRID, false, Image.FORMAT_RGBA8); im.fill(Color(0, 0, 0, 0))
		comp.append(im); tex.append(ImageTexture.create_from_image(im)); org.append(Vector2.ZERO)
	m.set_shader_parameter("sat_mid", tex[0]); m.set_shader_parameter("sat_near", tex[1])
	m.set_shader_parameter("sat_on", 1.0 if enabled else 0.0)

func set_enabled(v: bool):
	enabled = v
	if mat: mat.set_shader_parameter("sat_on", 1.0 if v else 0.0)

static func merc(lon: float, lat: float) -> Vector2:
	var la := deg_to_rad(clampf(lat, -85.0, 85.0))
	return Vector2((lon + 180.0) / 360.0, 0.5 - log(tan(PI / 4.0 + la / 2.0)) / (2.0 * PI))

func _process(dt: float):
	if not enabled or mat == null: return
	t_acc += dt
	_pump()
	for i in range(dirty.size()):
		if dirty[i] and t_acc > 0.0:
			dirty[i] = false; _compose(i)

func update_pos(lon: float, lat: float):
	if not enabled or mat == null: return
	var m := merc(lon, lat)
	for i in range(LEVELS.size()):
		var z: int = LEVELS[i]; var n := 1 << z
		var c := Vector2i(int(floor(m.x * n)), int(floor(m.y * n)))
		if c != cen[i]:
			cen[i] = c; dirty[i] = true
			for dx in range(-1, 2):
				for dy in range(-1, 2):
					_want(z, c.x + dx, c.y + dy)

func _key(z: int, x: int, y: int) -> String: return "%d/%d/%d" % [z, x, y]

func _want(z: int, x: int, y: int):
	var n := 1 << z
	if y < 0 or y >= n: return
	x = posmod(x, n)
	var k := _key(z, x, y)
	if imgs.has(k) or pending.has(k): return
	var path := "user://tiles/%d_%d_%d.jpg" % [z, x, y]
	if FileAccess.file_exists(path):
		var im := Image.load_from_file(path)
		if im: _store(k, im); return
	pending[k] = true
	queue.push_front([z, x, y])      # свежие запросы — первыми

func _store(k: String, im: Image):
	im.convert(Image.FORMAT_RGBA8)
	imgs[k] = im
	dirty[0] = true; dirty[1] = true

func _pump():
	while active < 4 and not queue.is_empty():
		var q = queue.pop_front()
		var k := _key(q[0], q[1], q[2])
		# запрос ушёл из окна — пропускаем
		var lv := LEVELS.find(q[0])
		var c: Vector2i = cen[lv]
		if absi(q[1] - c.x) > 2 or absi(q[2] - c.y) > 2:
			pending.erase(k); continue
		if OS.has_environment("SATTEST"):
			var im := Image.create(256, 256, false, Image.FORMAT_RGB8)
			var base := Color.from_hsv(fmod(q[1] * 0.37 + q[2] * 0.61, 1.0), 0.6, 0.8)
			im.fill(base)
			for a in range(256):
				im.set_pixel(a, 0, Color.BLACK); im.set_pixel(0, a, Color.BLACK)
				im.set_pixel(a, 128, Color.WHITE); im.set_pixel(128, a, Color.WHITE)
			pending.erase(k); _store(k, im); continue
		var h := HTTPRequest.new(); add_child(h); active += 1
		h.timeout = 15.0
		h.request_completed.connect(func(res, code, _hd, body):
			active -= 1
			pending.erase(k)
			if res == HTTPRequest.RESULT_SUCCESS and code == 200:
				var im := Image.new()
				if im.load_jpg_from_buffer(body) == OK:
					var f := FileAccess.open("user://tiles/%d_%d_%d.jpg" % [q[0], q[1], q[2]], FileAccess.WRITE)
					if f: f.store_buffer(body)
					_store(k, im)
			h.queue_free())
		if h.request(URL % [q[0], q[2], q[1]]) != OK:
			active -= 1; pending.erase(k); h.queue_free()

func _compose(i: int):
	var z: int = LEVELS[i]; var n := 1 << z
	var c: Vector2i = cen[i]
	if c.x < 0: return
	var im: Image = comp[i]
	im.fill(Color(0, 0, 0, 0))
	for dx in range(-1, 2):
		for dy in range(-1, 2):
			var x := posmod(c.x + dx, n); var y := c.y + dy
			var k := _key(z, x, y)
			if imgs.has(k): im.blit_rect(imgs[k], Rect2i(0, 0, 256, 256), Vector2i((dx + 1) * 256, (dy + 1) * 256))
	org[i] = Vector2(float(c.x - 1) / n, float(c.y - 1) / n)
	tex[i].update(im)
	var key := "sat_mid" if i == 0 else "sat_near"
	mat.set_shader_parameter(key + "_org", org[i]); mat.set_shader_parameter(key + "_size", float(GRID) / n)
