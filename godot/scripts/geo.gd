extends Node
# Реальная география: суша/вода, рельеф (ETOPO1), биомы. Порт src/js/geo.js.
# Мировая система: начало — аэропорт вылета, X — на пункт назначения, Z — вправо, метры.
const R_EARTH := 6371000.0
const GEO_RES := 0.025
const GEO_W := 14400
const GEO_H := 7200
const DEM_W := 2160
const DEM_H := 1081
const DEM_UNIT := 35.0
const BIO_RES := 0.1
const BIO_W := 3600
const BIO_H := 1800

var _land_off: PackedInt32Array
var _land_runs: PackedInt32Array
var _dem: PackedByteArray
var _bio: PackedByteArray
var ready_ok := false

# рамка маршрута
var la1 := 0.0
var lo1 := 0.0
var b0 := 0.0
var sla := 0.0
var cla := 1.0

func _ready() -> void:
	_load_land()
	_dem = FileAccess.get_file_as_bytes("res://data/dem.bin")
	_load_bio()
	ready_ok = true

func _varint(a: PackedByteArray, p: Array) -> int:
	var v := 0
	var sh := 0
	while true:
		var b: int = a[p[0]]
		p[0] += 1
		v |= (b & 127) << sh
		sh += 7
		if (b & 128) == 0:
			break
	return v

func _load_land() -> void:
	var a := FileAccess.get_file_as_bytes("res://data/land.bin")
	var p := [0]
	_land_off = PackedInt32Array()
	_land_off.resize(GEO_H + 1)
	var tmp := PackedInt32Array()
	for r in GEO_H:
		_land_off[r] = tmp.size()
		var n := _varint(a, p)
		var c := 0
		for i in n:
			c += _varint(a, p)
			tmp.append(c)
	_land_off[GEO_H] = tmp.size()
	_land_runs = tmp

func _load_bio() -> void:
	var a := FileAccess.get_file_as_bytes("res://data/bio.bin")
	var p := [0]
	_bio = PackedByteArray()
	_bio.resize(BIO_W * BIO_H)
	for r in BIO_H:
		var n := _varint(a, p)
		var c := r * BIO_W
		for i in n:
			var ln := _varint(a, p)
			var v := _varint(a, p)
			if v != 0:
				for k in ln:
					_bio[c + k] = v
			c += ln

func _cell(col: int, row: int) -> int:
	if row < 0:
		row = 0
	elif row >= GEO_H:
		row = GEO_H - 1
	col = ((col % GEO_W) + GEO_W) % GEO_W
	var lo := _land_off[row]
	var hi := _land_off[row + 1]
	var s := lo
	while lo < hi:
		var m := (lo + hi) >> 1
		if _land_runs[m] <= col:
			lo = m + 1
		else:
			hi = m
	return (lo - s) & 1

# 1 — суша, 0 — вода, плавно по 4 ячейкам
func land_f(lon: float, lat: float) -> float:
	var x := (lon + 180.0) / GEO_RES - 0.5
	var y := (90.0 - lat) / GEO_RES - 0.5
	var c := int(floor(x))
	var r := int(floor(y))
	var fx := x - c
	var fy := y - r
	var a := _cell(c, r)
	var b := _cell(c + 1, r)
	var d := _cell(c, r + 1)
	var e := _cell(c + 1, r + 1)
	return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy

func _dg(c: int, r: int) -> int:
	r = clampi(r, 0, DEM_H - 1)
	c = ((c % DEM_W) + DEM_W) % DEM_W
	return _dem[r * DEM_W + c]

# высота над уровнем моря, м (билинейно)
func dem_f(lon: float, lat: float) -> float:
	var x := (lon + 180.0) * 6.0
	var y := (90.0 - lat) * 6.0
	var c := int(floor(x))
	var r := int(floor(y))
	var fx := x - c
	var fy := y - r
	var v := (_dg(c, r) * (1 - fx) + _dg(c + 1, r) * fx) * (1 - fy) + (_dg(c, r + 1) * (1 - fx) + _dg(c + 1, r + 1) * fx) * fy
	return v * DEM_UNIT

func bio_f(lon: float, lat: float) -> int:
	var col := clampi(int(floor((lon + 180.0) / BIO_RES)), 0, BIO_W - 1)
	var row := clampi(int(floor((90.0 - lat) / BIO_RES)), 0, BIO_H - 1)
	return _bio[row * BIO_W + col]

# ---- мировая рамка ----
func set_frame(from_lat: float, from_lon: float, brg_deg: float) -> void:
	la1 = deg_to_rad(from_lat)
	lo1 = deg_to_rad(from_lon)
	b0 = deg_to_rad(brg_deg)
	sla = sin(la1)
	cla = cos(la1)

# мировая точка -> Vector2(lat, lon) градусы
func ll(wx: float, wz: float) -> Vector2:
	var d := sqrt(wx * wx + wz * wz) / R_EARTH
	var th := b0 + atan2(wz, wx)
	var sd := sin(d)
	var cd := cos(d)
	var la2 := asin(sla * cd + cla * sd * cos(th))
	var lo2 := lo1 + atan2(sin(th) * sd * cla, cd - sla * sin(la2))
	return Vector2(rad_to_deg(la2), fposmod(rad_to_deg(lo2) + 540.0, 360.0) - 180.0)

# широта/долгота -> мировая точка (x, z)
func xy(lon: float, lat: float) -> Vector2:
	var la := deg_to_rad(lat)
	var dl := deg_to_rad(lon) - lo1
	var sdla := sin((la - la1) / 2.0)
	var sdlo := sin(dl / 2.0)
	var h := sdla * sdla + cla * cos(la) * sdlo * sdlo
	var d := 2.0 * R_EARTH * asin(minf(1.0, sqrt(h)))
	var y := sin(dl) * cos(la)
	var x := cla * sin(la) - sla * cos(la) * cos(dl)
	var th := atan2(y, x) - b0
	return Vector2(d * cos(th), d * sin(th))

func bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
	var f1 := deg_to_rad(lat1)
	var f2 := deg_to_rad(lat2)
	var dl := deg_to_rad(lon2 - lon1)
	var y := sin(dl) * cos(f2)
	var x := cos(f1) * sin(f2) - sin(f1) * cos(f2) * cos(dl)
	return fposmod(rad_to_deg(atan2(y, x)), 360.0)

func dist_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
	var f1 := deg_to_rad(lat1)
	var f2 := deg_to_rad(lat2)
	var dla := f2 - f1
	var dlo := deg_to_rad(lon2 - lon1)
	var h := sin(dla / 2) * sin(dla / 2) + cos(f1) * cos(f2) * sin(dlo / 2) * sin(dlo / 2)
	return 2.0 * R_EARTH * asin(minf(1.0, sqrt(h)))
