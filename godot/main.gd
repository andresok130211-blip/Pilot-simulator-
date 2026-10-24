extends Node3D
# Прототип 3D-мира: реальный рельеф и биомы, самолёт, камера. Аргументы: -- lat lon alt hdg [pitch] [shot.png]

var lon := 37.4146
var lat := 55.9726
var alt := 3000.0
var hdg := 0.0   # курс, градусы от севера
var pitch := 0.0
var speed := 200.0
var terrain: MeshInstance3D
var mat: ShaderMaterial
var plane: Node3D
var cam: Camera3D
var shot := ""
var t := 0.0

func _ready():
	var args := OS.get_cmdline_user_args()
	if args.size() >= 4:
		lat = float(args[0]); lon = float(args[1]); alt = float(args[2]); hdg = float(args[3])
		if args.size() >= 5: pitch = float(args[4])
		if args.size() >= 6: shot = args[5]
	_build_env()
	_build_terrain()
	_build_plane()
	cam = Camera3D.new(); cam.far = 600000.0; cam.near = 2.0; cam.fov = 62
	add_child(cam)
	var cl := CanvasLayer.new(); add_child(cl); hud = Label.new(); hud.position = Vector2(20, 14); hud.add_theme_font_size_override("font_size", 22); hud.add_theme_color_override("font_color", Color(1,1,1)); hud.add_theme_color_override("font_outline_color", Color(0,0,0)); hud.add_theme_constant_override("outline_size", 6); cl.add_child(hud)
	_update()
	if shot != "":
		await get_tree().create_timer(0.8).timeout
		get_viewport().get_texture().get_image().save_png(shot)
		get_tree().quit()

func _build_env():
	var we := WorldEnvironment.new(); var e := Environment.new()
	e.background_mode = Environment.BG_SKY
	var sky := Sky.new(); var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.20, 0.42, 0.78); sm.sky_horizon_color = Color(0.68, 0.80, 0.92)
	sm.ground_horizon_color = Color(0.68, 0.80, 0.92); sm.ground_bottom_color = Color(0.5, 0.62, 0.75)
	sky.sky_material = sm; e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY; e.ambient_light_energy = 0.9
	e.fog_enabled = true; e.fog_light_color = Color(0.70, 0.81, 0.92); e.fog_density = 0.000008
	e.fog_sky_affect = 0.0
	we.environment = e; add_child(we)
	var sun := DirectionalLight3D.new(); sun.rotation_degrees = Vector3(-48, 35, 0); sun.light_energy = 1.25
	add_child(sun)

func _build_terrain():
	var rings := 330; var segs := 256
	var verts := PackedVector3Array(); var idx := PackedInt32Array()
	var r := 30.0
	for i in range(rings + 1):
		for j in range(segs):
			var a := TAU * j / segs
			verts.append(Vector3(cos(a) * r, 0, sin(a) * r))
		r *= 1.0306
	for i in range(rings):
		for j in range(segs):
			var a := i * segs + j; var b := i * segs + (j + 1) % segs
			var c := (i + 1) * segs + j; var d := (i + 1) * segs + (j + 1) % segs
			idx.append_array([a, c, b, b, c, d])
	var arr := []; arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts; arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new(); m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	m.custom_aabb = AABB(Vector3(-700000, -2000, -700000), Vector3(1400000, 20000, 1400000))
	terrain = MeshInstance3D.new(); terrain.mesh = m; terrain.extra_cull_margin = 16384.0
	mat = ShaderMaterial.new(); mat.shader = load("res://terrain.gdshader")
	mat.set_shader_parameter("dem", load("res://assets/dem.png"))
	mat.set_shader_parameter("bio", load("res://assets/bio.png"))
	mat.set_shader_parameter("coast", load("res://assets/coast.png"))
	terrain.material_override = mat; add_child(terrain)

func _mk(mesh: Mesh, col: Color, pos: Vector3, rot := Vector3.ZERO, scl := Vector3.ONE) -> MeshInstance3D:
	var mi := MeshInstance3D.new(); mi.mesh = mesh
	var sm := StandardMaterial3D.new(); sm.albedo_color = col; sm.roughness = 0.5; mi.material_override = sm
	mi.position = pos; mi.rotation_degrees = rot; mi.scale = scl; return mi

func _build_plane():
	plane = Node3D.new(); add_child(plane)
	var fus := CapsuleMesh.new(); fus.radius = 1.9; fus.height = 38.0
	plane.add_child(_mk(fus, Color(0.96, 0.96, 0.98), Vector3.ZERO, Vector3(90, 0, 0)))
	var wing := BoxMesh.new(); wing.size = Vector3(34, 0.35, 5.2)
	plane.add_child(_mk(wing, Color(0.86, 0.88, 0.92), Vector3(0, -0.6, 1.5), Vector3(0, 0, 0)))
	var tail := BoxMesh.new(); tail.size = Vector3(12, 0.3, 3.2)
	plane.add_child(_mk(tail, Color(0.86, 0.88, 0.92), Vector3(0, 0.6, 16)))
	var fin := BoxMesh.new(); fin.size = Vector3(0.3, 6.0, 4.0)
	plane.add_child(_mk(fin, Color(0.12, 0.35, 0.78), Vector3(0, 3.8, 16)))
	var eng := CylinderMesh.new(); eng.top_radius = 1.0; eng.bottom_radius = 1.0; eng.height = 4.2
	for s in [-1, 1]: plane.add_child(_mk(eng, Color(0.7, 0.72, 0.76), Vector3(s * 7.0, -1.9, -1.0), Vector3(90, 0, 0)))

var roll := 0.0
var thr := 0.7
var stick := Vector2.ZERO
var touch_id := -1
var touch_o := Vector2.ZERO
var hud: Label

func _input(e):
	if e is InputEventScreenTouch or e is InputEventMouseButton:
		var p: Vector2 = e.position
		var pressed: bool = e.pressed
		if pressed and p.x > get_viewport().get_visible_rect().size.x * 0.45:
			touch_o = p; touch_id = 0
		elif not pressed: touch_id = -1; stick = Vector2.ZERO
		elif pressed: thr = clamp(1.0 - p.y / get_viewport().get_visible_rect().size.y, 0.0, 1.0)
	elif (e is InputEventScreenDrag or e is InputEventMouseMotion) and touch_id == 0:
		var d: Vector2 = (e.position - touch_o) / 120.0
		stick = Vector2(clamp(d.x, -1, 1), clamp(d.y, -1, 1))

func _flight(dt: float):
	var kx := Input.get_axis("ui_left", "ui_right"); var ky := Input.get_axis("ui_up", "ui_down")
	var sx := stick.x if touch_id == 0 else kx; var sy := stick.y if touch_id == 0 else ky
	if Input.is_key_pressed(KEY_W): thr = min(1.0, thr + dt * 0.4)
	if Input.is_key_pressed(KEY_S): thr = max(0.0, thr - dt * 0.4)
	roll = lerp(roll, sx * 35.0, dt * 1.5)
	pitch = lerp(pitch, clamp(-sy * 14.0, -20, 20), dt * 1.5)
	hdg = fmod(hdg + tan(deg_to_rad(roll)) * 9.81 / max(speed, 60.0) * dt * 57.3 + 360.0, 360.0)
	speed = lerp(speed, 120.0 + thr * 160.0, dt * 0.3)
	var v := speed * dt
	var h := deg_to_rad(hdg)
	lat += cos(h) * cos(deg_to_rad(pitch)) * v / 110574.0
	lon += sin(h) * cos(deg_to_rad(pitch)) * v / (111320.0 * cos(deg_to_rad(lat)))
	alt = max(10.0, alt + sin(deg_to_rad(pitch)) * v)

func _update():
	plane.position = Vector3(0, alt, 0)
	plane.rotation_degrees = Vector3(pitch, -hdg, -roll)
	var back := Vector3(0, 0, 1).rotated(Vector3.UP, deg_to_rad(-hdg))
	cam.position = plane.position + back * 70.0 + Vector3(0, 14, 0)
	cam.look_at(plane.position - back * 30.0, Vector3.UP)
	mat.set_shader_parameter("center_ll", Vector2(lon, lat))
	if hud:
		hud.text = "СКОР %d км/ч   ВЫС %d м   КУРС %03d°   ТЯГА %d%%\nЛЕВ: тяга (касание), ПРАВ: перетаскивание — штурвал" % [speed * 3.6, alt, hdg, thr * 100]

func _process(dt: float):
	if shot != "": return
	t += dt
	_flight(dt)
	_update()
