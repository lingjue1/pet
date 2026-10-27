extends Node

## Read-only probe + command loop for the Coopanion bridge.
## Writes: user://bridge/meta.json, heartbeat.json, snapshot_XX.json, result.json
## Reads:  user://bridge/cmd.json  (commands: ping / state / dump)

const OUT_DIR := "user://bridge"
const LOG_NAME := "Coopanion-TinyPastureBridge:Probe"
const MAX_NODES := 6000
const MAX_PROPS := 200
const MAX_ITEMS := 60
const MAX_DEPTH := 3

var _elapsed := 0.0
var _next_beat := 0.0
var _dump_at := [4.0, 12.0, 30.0]
var _dump_i := 0
var _auto_start_done := false
var _cursor_saved := false
var _cursor_pos := Vector2i.ZERO
var _restore_enabled := false

func _ready() -> void:
	# The open menu pauses the scene tree; keep the bridge alive so it can
	# press the start button.
	process_mode = Node.PROCESS_MODE_ALWAYS
	var dir := ProjectSettings.globalize_path(OUT_DIR)
	var err := DirAccess.make_dir_recursive_absolute(dir)
	if err != OK and err != ERR_ALREADY_EXISTS:
		ModLoaderLog.error("cannot create %s (%s)" % [dir, err], LOG_NAME)
	_write_json("meta.json", {
		"mod": "Coopanion-TinyPastureBridge",
		"version": "0.1.0",
		"godot": Engine.get_version_info(),
		"game": String(ProjectSettings.get_setting("application/config/name", "")),
		"user_dir": dir,
		"screen": DisplayServer.screen_get_size(),
		"window": DisplayServer.window_get_size(),
	})
	ModLoaderLog.info("probe ready, writing to %s" % dir, LOG_NAME)

func _process(delta: float) -> void:
	_elapsed += delta
	if _elapsed >= _next_beat:
		_next_beat = _elapsed + 2.0
		_write_heartbeat()
	if _dump_i < _dump_at.size() and _elapsed >= float(_dump_at[_dump_i]):
		var at: float = float(_dump_at[_dump_i])
		_dump_i += 1
		_dump("snapshot_%02d.json" % int(at))
	if not _auto_start_done and _elapsed >= 2.0:
		var started := _start_game()
		if started.get("pressed", false):
			_auto_start_done = true
			ModLoaderLog.info("auto-pressed start game", LOG_NAME)
	_poll_command()

# ---------------------------------------------------------------- heartbeat

func _write_heartbeat() -> void:
	var tree := get_tree()
	if tree == null:
		return
	_write_json("heartbeat.json", {
		"ts": Time.get_datetime_string_from_system(false, true),
		"unix": Time.get_unix_time_from_system(),
		"window": DisplayServer.window_get_size(),
		"root_children": tree.root.get_child_count(),
	})

# ---------------------------------------------------------------- dumps

func _dump(file_name: String) -> void:
	var data := {
		"ts": Time.get_datetime_string_from_system(false, true),
		"nodes": _dump_nodes(),
		"autoloads": _dump_autoloads(),
	}
	_write_json(file_name, data)
	ModLoaderLog.info("wrote %s" % file_name, LOG_NAME)

func _dump_nodes() -> Array:
	var out: Array = []
	var tree := get_tree()
	if tree == null:
		return out
	var stack: Array = [tree.root]
	while stack.size() > 0 and out.size() < MAX_NODES:
		var n: Node = stack.pop_back()
		out.append(_node_info(n))
		var kids := n.get_children()
		for i in range(kids.size() - 1, -1, -1):
			stack.append(kids[i])
	return out

func _node_info(n: Node) -> Dictionary:
	var info := {
		"path": String(n.get_path()),
		"name": String(n.name),
		"class": n.get_class(),
	}
	var scr: Script = n.get_script()
	if scr != null:
		info["script"] = String(scr.resource_path)
	if n is Control:
		info["visible"] = n.is_visible_in_tree()
		info["rect"] = [n.global_position.x, n.global_position.y, n.size.x, n.size.y]
		if n is Button or n is Label or n is RichTextLabel or n is LineEdit:
			info["text"] = String(n.text)
	if n is CanvasItem:
		info["canvas_visible"] = n.visible
		info["visible_in_tree"] = n.is_visible_in_tree()
	return info

func _dump_autoloads() -> Dictionary:
	var out := {}
	for autoload_name in ["GState", "FarmDB", "GSave", "GSteam", "GSound"]:
		var node := get_node_or_null("/root/%s" % autoload_name)
		if node == null:
			continue
		var entry := _object_vars(node, 0)
		var scr: Script = node.get_script()
		if scr != null:
			entry["__script"] = String(scr.resource_path)
		out[autoload_name] = entry
	return out

# ---------------------------------------------------------------- sanitize

func _object_vars(obj: Object, depth: int) -> Dictionary:
	var out := {}
	if obj == null or not is_instance_valid(obj):
		return out
	if depth > MAX_DEPTH:
		return {"__class": obj.get_class()}
	var count := 0
	for prop in obj.get_property_list():
		var usage: int = int(prop.get("usage", 0))
		if (usage & PROPERTY_USAGE_SCRIPT_VARIABLE) == 0:
			continue
		if count >= MAX_PROPS:
			out["__truncated"] = true
			break
		var key := String(prop.get("name", ""))
		var value = obj.get(key)
		out[key] = _san(value, depth + 1)
		count += 1
	return out

func _san(value, depth: int):
	var t := typeof(value)
	match t:
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT, TYPE_STRING:
			return value
		TYPE_STRING_NAME, TYPE_NODE_PATH:
			return String(value)
		TYPE_VECTOR2, TYPE_VECTOR2I:
			return [value.x, value.y]
		TYPE_VECTOR3, TYPE_VECTOR3I:
			return [value.x, value.y, value.z]
		TYPE_VECTOR4, TYPE_VECTOR4I:
			return [value.x, value.y, value.z, value.w]
		TYPE_COLOR:
			return [value.r, value.g, value.b, value.a]
		TYPE_ARRAY, TYPE_PACKED_STRING_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_INT64_ARRAY, TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_FLOAT64_ARRAY:
			var arr: Array = []
			var limit: int = mini(value.size(), MAX_ITEMS)
			for i in range(limit):
				arr.append(_san(value[i], depth + 1))
			if value.size() > limit:
				arr.append("<%d more>" % (value.size() - limit))
			return arr
		TYPE_DICTIONARY:
			var d := {}
			var i := 0
			for k in value:
				if i >= MAX_ITEMS:
					d["__truncated"] = true
					break
				d[str(k)] = _san(value[k], depth + 1)
				i += 1
			return d
		TYPE_OBJECT:
			if value == null or not is_instance_valid(value):
				return null
			if depth > MAX_DEPTH:
				return "<%s>" % value.get_class()
			return _object_vars(value, depth + 1)
		_:
			return String(value)

# ---------------------------------------------------------------- commands

func _poll_command() -> void:
	var path := OUT_DIR.path_join("cmd.json")
	if not FileAccess.file_exists(path):
		return
	var raw := FileAccess.get_file_as_string(path)
	# Consume before parsing so a bad command cannot spin forever.
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	var parsed = JSON.parse_string(raw)
	if typeof(parsed) != TYPE_DICTIONARY:
		_write_json("result.json", {"ok": false, "error": "cmd.json is not an object"})
		return
	var cmd := String(parsed.get("cmd", ""))
	var request_id := String(parsed.get("id", ""))
	var res := {"id": request_id, "ok": false, "error": "unknown cmd: %s" % cmd}
	match cmd:
		"ping":
			res = {"id": request_id, "ok": true, "pong": Time.get_unix_time_from_system(), "ts": Time.get_datetime_string_from_system(false, true)}
		"state":
			res = {"id": request_id, "ok": true, "state": _dump_autoloads()}
		"dump":
			_dump("cmd_dump.json")
			res = {"id": request_id, "ok": true, "file": "cmd_dump.json"}
		"animals":
			res = {"id": request_id, "ok": true, "animals": _dump_animals()}
		"node":
			res = _node_detail(String(parsed.get("path", "")))
			res["id"] = request_id
		"press":
			res = _press_node(String(parsed.get("path", "")))
			res["id"] = request_id
		"keys":
			res = _dump_keys(String(parsed.get("node", "")), String(parsed.get("prop", "")))
			res["id"] = request_id
		"methods":
			res = _dump_methods(String(parsed.get("path", "")))
			res["id"] = request_id
		"call":
			res = _call_method(String(parsed.get("path", "")), String(parsed.get("method", "")), parsed.get("args", []))
			res["id"] = request_id
		"click":
			res = _click_node(String(parsed.get("path", "")))
			res["id"] = request_id
		"click_at":
			res = _click_at(float(parsed.get("x", 0.0)), float(parsed.get("y", 0.0)))
			res["id"] = request_id
		"shop_close":
			res = _shop_close()
			res["id"] = request_id
		"open_animal":
			res = _open_animal(String(parsed.get("path", "")))
			res["id"] = request_id
		"farm_cards":
			res = _farm_cards()
			res["id"] = request_id
		"farm_detail":
			res = _farm_detail()
			res["id"] = request_id
		"farm_sell":
			res = _farm_sell()
			res["id"] = request_id
		"farm_confirm":
			res = _farm_confirm()
			res["id"] = request_id
		"farm_close":
			res = _farm_close()
			res["id"] = request_id
		"collect_coin":
			res = _collect_coin()
			res["id"] = request_id
		"clean_poop":
			res = _clean_poop()
			res["id"] = request_id
		"depot_info":
			res = _depot_info()
			res["id"] = request_id
		"farm_new":
			res = _farm_new()
			res["id"] = request_id
		"farm_new_confirm":
			res = _farm_new_confirm()
			res["id"] = request_id
		"summary":
			res = _summary()
			res["id"] = request_id
		"cards":
			res = _cards()
			res["id"] = request_id
		"shop_open":
			res = _shop_open(String(parsed.get("page", "animals")))
			res["id"] = request_id
		"shop_catalog":
			res = _shop_catalog(String(parsed.get("page", "animals")))
			res["id"] = request_id
		"select_item":
			res = _select_item(String(parsed.get("path", "")))
			res["id"] = request_id
		"unfold":
			res = _unfold()
			res["id"] = request_id
		"pet":
			res = _pet(int(parsed.get("index", -1)))
			res["id"] = request_id
		"feed_pick":
			res = _feed_pick(int(parsed.get("food_id", 0)), bool(parsed.get("restore_cursor", false)))
			res["id"] = request_id
		"feed_drop":
			res = _feed_drop(float(parsed.get("x", 0.0)), float(parsed.get("y", 0.0)))
			res["id"] = request_id
		"accept":
			res = _accept()
			res["id"] = request_id
		"buy_one":
			res = _buy_one()
			res["id"] = request_id
		"start_game":
			res = _start_game()
			res["id"] = request_id
	_write_json("result.json", res)

func _save_cursor() -> void:
	if not _cursor_saved:
		var out: Array = []
		var code := OS.execute("powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; Write-Output ($p.X.ToString() + ',' + $p.Y.ToString())",
		], out, true)
		if code == 0 and out.size() > 0:
			var parts := String(out[0]).strip_edges().split(",")
			if parts.size() == 2:
				_cursor_pos = Vector2i(int(parts[0]), int(parts[1]))
			else:
				_cursor_pos = DisplayServer.mouse_get_position()
		else:
			_cursor_pos = DisplayServer.mouse_get_position()
		_cursor_saved = true

func _restore_cursor() -> void:
	if _cursor_saved:
		var p := _cursor_pos
		OS.execute("powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-WindowStyle",
			"Hidden",
			"-Command",
			"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(%d,%d)" % [p.x, p.y],
		])
		_cursor_saved = false

func _click_at(x: float, y: float) -> Dictionary:
	var pos := Vector2(x, y)
	_save_cursor()
	Input.warp_mouse(pos)
	var motion := InputEventMouseMotion.new()
	motion.position = pos
	motion.global_position = pos
	Input.parse_input_event(motion)
	for pressed in [true, false]:
		var ev := InputEventMouseButton.new()
		ev.button_index = MOUSE_BUTTON_LEFT
		ev.pressed = pressed
		ev.position = pos
		ev.global_position = pos
		Input.parse_input_event(ev)
	_restore_cursor()
	return {"ok": true, "x": x, "y": y}

func _open_animal(path: String) -> Dictionary:
	var animal := get_node_or_null(path)
	if animal == null:
		return {"ok": false, "error": "animal not found: %s" % path}
	var ui := get_node_or_null("/root/Main/MainUI")
	if ui == null or not ui.has_method("_on_open_animal_info"):
		return {"ok": false, "error": "animal info handler not found"}
	ui.call("_on_open_animal_info", animal)
	return {"ok": true, "path": path}

func _farm_node() -> Node:
	var ui := get_node_or_null("/root/Main/MainUI")
	if ui == null:
		return null
	return ui.find_child("UI_Farm", true, false)

func _farm_cards() -> Dictionary:
	var farm := _farm_node()
	if farm == null:
		return {"ok": false, "error": "farm is closed"}
	var box := farm.get_node_or_null("FarmAnimals/ScrollContainer/Box")
	if box == null:
		return {"ok": false, "error": "farm animal list not found"}
	var out: Array = []
	var index := 0
	for child in box.get_children():
		var btn := child.get_node_or_null("BT_Click")
		if btn is BaseButton:
			out.append({"path": String(btn.get_path()), "index": index})
		index += 1
	return {"ok": true, "cards": out}

func _farm_detail() -> Dictionary:
	var farm := _farm_node()
	if farm == null:
		return {"ok": false, "error": "farm is closed"}
	var detail := farm.get_node_or_null("AnimalDetail/Box_Detail")
	if detail == null:
		return {"ok": false, "error": "animal detail not found"}
	var stars := 0
	for i in range(5):
		var star := detail.get_node_or_null("BOX_Rare/Star_%d" % i)
		if star is TextureRect and star.visible:
			stars += 1
	var sell := detail.get_node_or_null("卖出价格/BT_Sell")
	return {
		"ok": true,
		"name": _label_text(detail, "HBoxContainer/TXT_AnimalName"),
		"stars": stars,
		"sell_visible": sell is BaseButton and sell.visible,
	}

func _farm_sell() -> Dictionary:
	var farm := _farm_node()
	var sell := farm.get_node_or_null("AnimalDetail/Box_Detail/卖出价格/BT_Sell") if farm != null else null
	if sell is BaseButton:
		sell.emit_signal("pressed")
		return {"ok": true, "pressed": true}
	return {"ok": false, "error": "sell button not found"}

func _farm_confirm() -> Dictionary:
	var farm := _farm_node()
	var btn := farm.get_node_or_null("UISellRareCheck/OptionPage/VBoxContainer/底排按钮/BT_SellConfirm") if farm != null else null
	if btn is BaseButton:
		btn.emit_signal("pressed")
		return {"ok": true, "pressed": true}
	return {"ok": false, "error": "sell confirm not found"}

func _farm_new() -> Dictionary:
	var farm := _farm_node()
	if farm == null:
		return {"ok": false, "error": "farm is closed"}
	var btn := farm.get_node_or_null("牧场列表/BT_NewDepot")
	if btn is BaseButton:
		btn.emit_signal("pressed")
		return {"ok": true, "opened": true}
	return {"ok": false, "error": "new depot button not found"}

func _farm_new_confirm() -> Dictionary:
	var farm := _farm_node()
	if farm == null:
		return {"ok": false, "error": "farm is closed"}
	var btn := farm.get_node_or_null("UIBuyNewDepot/OptionPage/VBoxContainer/底排按钮/BT_DepotBuyConfirm")
	if btn is BaseButton:
		btn.emit_signal("pressed")
		return {"ok": true, "pressed": true}
	return {"ok": false, "error": "new depot confirm not found"}

func _farm_close() -> Dictionary:
	var farm := _farm_node()
	var btn := farm.get_node_or_null("BT_Close") if farm != null else null
	if btn is BaseButton:
		btn.emit_signal("pressed")
		return {"ok": true, "closed": true}
	return {"ok": true, "closed": false}

func _collect_coin() -> Dictionary:
	var mgr := get_node_or_null("/root/Main/Managers/DropItemM")
	if mgr == null:
		return {"ok": false, "error": "drop manager not found"}
	var count := 0
	for child in mgr.get_children():
		if not String(child.name).to_lower().contains("coin"):
			continue
		var det := child.find_child("Detecter", true, false) as Control
		var pos: Vector2 = child.global_position if child is Node2D else Vector2.ZERO
		if det != null:
			pos = det.global_position + det.size * 0.5
		_click_at(pos.x, pos.y)
		count += 1
	return {"ok": true, "coins": count}

func _clean_poop() -> Dictionary:
	var mgr := get_node_or_null("/root/Main/Managers/DropItemM")
	if mgr == null:
		return {"ok": false, "error": "drop manager not found"}
	var cleaner := get_node_or_null("/root/Main/Managers/BuildingM/BD_AutoClean")
	if cleaner != null and cleaner.has_method("search_clean_target"):
		cleaner.call("search_clean_target")
	var count := 0
	for child in mgr.get_children():
		if not String(child.name).to_lower().contains("poop"):
			continue
		var det := child.find_child("Detecter", true, false) as Control
		var pos: Vector2 = child.global_position if child is Node2D else Vector2.ZERO
		if det != null:
			pos = det.global_position + det.size * 0.5
		_click_at(pos.x, pos.y)
		count += 1
	return {"ok": true, "poops": count, "has_cleaner": cleaner != null}

func _depot_info() -> Dictionary:
	var gsave := get_node_or_null("/root/GSave")
	if gsave == null:
		return {"ok": false, "error": "GSave not found"}
	var player = gsave.get("player_save")
	return {
		"ok": true,
		"coin": player.get("coin") if player else 0,
		"unlocked_depot": player.get("unlocked_depot") if player else 0,
		"depot_cost": _san(player.get("depot_cost") if player else {}, 0),
	}

func _shop_node() -> Node:
	var ui := get_node_or_null("/root/Main/MainUI")
	if ui == null:
		return null
	return ui.find_child("UIShop", true, false)

func _pack_node() -> Node:
	var ui := get_node_or_null("/root/Main/MainUI")
	if ui == null:
		return null
	return ui.find_child("OpenedPack", true, false)

func _shop_close() -> Dictionary:
	var shop := _shop_node()
	var btn := shop.get_node_or_null("BT_Close") if shop != null else null
	if btn is BaseButton:
		btn.emit_signal("pressed")
		return {"ok": true, "closed": true}
	return {"ok": true, "closed": false}

func _buy_one() -> Dictionary:
	var pack := _pack_node()
	if pack == null:
		return {"ok": false, "error": "no opened pack"}
	var btn := pack.find_child("BT_BuyOne", true, false)
	if btn is BaseButton:
		btn.emit_signal("pressed")
		return {"ok": true}
	return {"ok": false, "error": "buy-one button not found"}

func _summary() -> Dictionary:
	var gsave := get_node_or_null("/root/GSave")
	if gsave == null:
		return {"ok": false, "error": "GSave not found"}
	var player = gsave.get("player_save")
	var farms = gsave.get("farm_saves")
	var farm = null
	if typeof(farms) == TYPE_DICTIONARY and farms.size() > 0:
		farm = farms.values()[0]
	var out := {
		"ok": true,
		"coin": player.get("coin") if player else 0,
		"history_coin": player.get("history_coin") if player else 0,
		"farm_name": farm.get("farm_name") if farm else "",
		"animal_slot": farm.get("animal_slot") if farm else 0,
		"animals": [],
	}
	var mgr := get_node_or_null("/root/Main/Managers/AnimalM")
	if mgr != null:
		for child in mgr.get_children():
			var save = child.get("animal_save")
			var data = child.get("animal_data")
			if save == null or data == null:
				continue
			var det := child.get_node_or_null("Detecter")
			var rect := [0, 0, 0, 0]
			if det is Control:
				rect = [det.global_position.x, det.global_position.y, det.size.x, det.size.y]
			out["animals"].append({
				"node": String(child.get_path()),
				"type_id": save.get("type_id"),
				"code_name": data.get("code_name"),
				"name": data.get("name"),
				"hunger": save.get("hunger_point"),
				"health": save.get("health_point"),
				"is_sick": save.get("is_sick"),
				"rare": save.get("rare_rank"),
				"stored_coin": save.get("stored_coin"),
				"is_adult": save.get("is_adult"),
				"rect": rect,
			})
	return out

func _cards() -> Dictionary:
	var shop := _shop_node()
	if shop == null:
		return {"ok": false, "error": "shop is closed"}
	var box := shop.get_node_or_null("Pages/Animals/ScrollContainer/VBoxContainer/Box")
	if box == null:
		return {"ok": false, "error": "animal page not found"}
	var out: Array = []
	for child in box.get_children():
		if not (child is BaseButton):
			continue
		var pd = child.get("pack_data")
		if pd == null:
			continue
		var locked := false
		var lock_label := child.get_node_or_null("VBoxContainer/TXT_LockedPrice")
		if lock_label is Label:
			locked = lock_label.visible
		out.append({
			"path": String(child.get_path()),
			"type_id": pd.get("type_id"),
			"price": pd.get("price"),
			"name": pd.get("name"),
			"locked": locked,
		})
	return {"ok": true, "cards": out}

func _shop_open(page: String) -> Dictionary:
	_unfold()
	var clicked := false
	var shop := _shop_node()
	if shop == null or not shop.visible:
		var open_btn := get_node_or_null("/root/Main/MainUI/BG/BT_Shop")
		if open_btn is BaseButton:
			open_btn.emit_signal("pressed")
			clicked = true
	shop = _shop_node()
	var pages := ["animals", "items", "facility", "decoration"]
	if not (page in pages):
		page = "animals"
	var tab := shop.get_node_or_null("PageButtons/VBoxContainer/BT_" + page.capitalize()) if shop != null else null
	if tab is BaseButton:
		tab.emit_signal("pressed")
	return {"ok": shop != null or clicked, "page": page, "open": shop != null and shop.visible}

func _shop_catalog(page: String) -> Dictionary:
	var shop := _shop_node()
	if shop == null:
		return {"ok": false, "error": "shop is closed"}
	match page:
		"items":
			return {"ok": true, "page": page, "items": _catalog_items(shop)}
		"animals":
			var cards := _cards()
			return {"ok": cards.get("ok", false), "page": page, "items": cards.get("cards", [])}
		"decoration":
			return {"ok": true, "page": page, "items": _catalog_decoration(shop)}
		_:
			return {"ok": false, "error": "catalog for page not supported: %s" % page}

func _select_item(path: String) -> Dictionary:
	return _press_node(path)

func _catalog_items(shop: Node) -> Array:
	var out: Array = []
	for pair in [["food", "Pages/Items/ScrollContainer/VBoxContainer/FoodBox"], ["hp", "Pages/Items/ScrollContainer/VBoxContainer/HPBox"]]:
		var box := shop.get_node_or_null(pair[1])
		if box == null:
			continue
		for child in box.get_children():
			if not (child is BaseButton):
				continue
			var name := _label_text(child, "VBoxContainer/ItemName")
			var price_text := _label_text(child, "VBoxContainer/PriceBox/TXT_Price")
			var locked := false
			var lock_label := child.get_node_or_null("VBoxContainer/TXT_Locked")
			if lock_label is Label:
				locked = lock_label.visible
			out.append({
				"path": String(child.get_path()),
				"name": name,
				"price": price_text.to_int(),
				"kind": pair[0],
				"locked": locked,
			})
	return out

func _catalog_decoration(shop: Node) -> Array:
	var out: Array = []
	var normal := shop.get_node_or_null("Pages/Decoration/ScrollContainer/VBoxContainer/NormalBox")
	if normal != null:
		for child in normal.get_children():
			if not (child is BaseButton):
				continue
			var name := _label_text(child, "VBoxContainer/ScrollContainer/ItemName")
			var price_text := _label_text(child, "VBoxContainer/PriceBox/TXT_Price")
			var locked := false
			var lock_label := child.get_node_or_null("LockedTip/TXT_Locked")
			if lock_label is Label:
				locked = lock_label.visible
			out.append({
				"path": String(child.get_path()),
				"name": name,
				"price": price_text.to_int(),
				"kind": "deco",
				"locked": locked,
			})
	var bgs := shop.get_node_or_null("Pages/Decoration/ScrollContainer/VBoxContainer/BGBox")
	if bgs != null:
		for child in bgs.get_children():
			if not (child is BaseButton):
				continue
			out.append({
				"path": String(child.get_path()),
				"name": _label_text(child, "VBoxContainer/ItemName"),
				"price": _label_text(child, "VBoxContainer/PriceBox/TXT_Price").to_int(),
				"kind": "background",
				"locked": false,
			})
	return out

func _label_text(parent: Node, rel: String) -> String:
	var n := parent.get_node_or_null(rel)
	if n is Label:
		return String(n.text)
	return ""

func _unfold() -> Dictionary:
	var btn := get_node_or_null("/root/Main/MainUI/BG/BT_Unfold")
	if btn == null:
		return {"ok": false, "error": "unfold button not found"}
	if btn is BaseButton and btn.visible:
		btn.emit_signal("pressed")
		return {"ok": true, "unfolded": true}
	return {"ok": true, "unfolded": false}

func _pet(index: int) -> Dictionary:
	var animals := _animal_nodes()
	if animals.is_empty():
		return {"ok": false, "error": "no animals"}
	var target: Node = animals[index] if index >= 0 and index < animals.size() else animals[0]
	target.call("play_action", "interact_0", true)
	var save = target.get("animal_save")
	return {
		"ok": true,
		"node": String(target.get_path()),
		"name": save.get("animal_name") if save else "",
		"type_id": save.get("type_id") if save else -1,
	}

func _feed_pick(food_id: int = 0, restore_cursor: bool = false) -> Dictionary:
	var ui := get_node_or_null("/root/Main/MainUI")
	if ui == null:
		return {"ok": false, "error": "MainUI not found"}
	_restore_enabled = restore_cursor
	if _restore_enabled:
		_save_cursor()
	else:
		_cursor_saved = false
	ui.call("_on_food_picked", food_id)
	return {"ok": true, "picked": food_id, "restore_cursor": _restore_enabled}

func _feed_drop(x: float, y: float) -> Dictionary:
	var ui := get_node_or_null("/root/Main/MainUI")
	if ui == null:
		return {"ok": false, "error": "MainUI not found"}
	var size := get_viewport().get_visible_rect().size
	var margin := 220.0
	var px := clampf(x, margin, maxf(margin, size.x - margin))
	var py := clampf(y, 20.0, maxf(20.0, size.y - 20.0))
	if _restore_enabled:
		_save_cursor()
	Input.warp_mouse(Vector2(px, py))
	ui.call("_on_picked_food_released")
	if _restore_enabled:
		# 食物落下后游戏还会再摆一次鼠标，延迟一点再还原，避免被它覆盖。
		get_tree().create_timer(0.4).timeout.connect(_restore_cursor)
	else:
		_cursor_saved = false
	return {"ok": true, "x": px, "y": py}

func _start_game() -> Dictionary:
	var btn := get_node_or_null("/root/Main/OpenMenuWindow/OpenMenu/GridContainer/BT_Continue")
	if btn == null:
		return {"ok": true, "pressed": false, "reason": "no start button"}
	if btn is BaseButton and btn.is_visible_in_tree():
		btn.emit_signal("pressed")
		return {"ok": true, "pressed": true}
	return {"ok": true, "pressed": false, "reason": "start button hidden"}

func _accept() -> Dictionary:
	var pack := _pack_node()
	if pack == null:
		return {"ok": false, "error": "no opened pack"}
	pack.call("_on_bt_accept_pressed")
	return {"ok": true}

func _animal_nodes() -> Array:
	var out: Array = []
	var mgr := get_node_or_null("/root/Main/Managers/AnimalM")
	if mgr == null:
		return out
	for child in mgr.get_children():
		if child.get_script() != null and child.get("animal_save") != null:
			out.append(child)
	out.sort_custom(func(a, b): return float(a.get("animal_save").get("hunger_point")) < float(b.get("animal_save").get("hunger_point")))
	return out

func _dump_animals() -> Array:
	var out: Array = []
	var mgr := get_node_or_null("/root/Main/Managers/AnimalM")
	if mgr == null:
		return out
	for child in mgr.get_children():
		if child.get_script() == null:
			continue
		var info := _object_vars(child, 0)
		info["__node"] = String(child.get_path())
		var det := child.get_node_or_null("Detecter")
		if det is Control:
			info["__rect"] = [det.global_position.x, det.global_position.y, det.size.x, det.size.y]
		out.append(info)
	return out

func _node_detail(path: String) -> Dictionary:
	var n := get_node_or_null(path)
	if n == null:
		return {"ok": false, "error": "node not found: %s" % path}
	var info := _node_info(n)
	info["vars"] = _object_vars(n, 0)
	return {"ok": true, "node": info}

func _press_node(path: String) -> Dictionary:
	var n := get_node_or_null(path)
	if n == null:
		return {"ok": false, "error": "node not found: %s" % path}
	if n is BaseButton:
		n.emit_signal("pressed")
		return {"ok": true, "pressed": path}
	return {"ok": false, "error": "not a BaseButton: %s" % path}

func _dump_keys(node_name: String, prop: String) -> Dictionary:
	var n := get_node_or_null("/root/%s" % node_name)
	if n == null:
		return {"ok": false, "error": "autoload not found: %s" % node_name}
	if not (prop in n):
		return {"ok": false, "error": "property not found: %s" % prop}
	var value = n.get(prop)
	var keys: Array = []
	if typeof(value) == TYPE_DICTIONARY:
		for k in value.keys():
			keys.append({"key": str(k), "key_raw": var_to_str(k), "key_type": typeof(k), "value_type": typeof(value[k])})
	return {"ok": true, "node": node_name, "prop": prop, "type": typeof(value), "size": keys.size(), "keys": keys}

func _dump_methods(path: String) -> Dictionary:
	var n := get_node_or_null(path)
	if n == null:
		return {"ok": false, "error": "node not found: %s" % path}
	var out: Array = []
	var scr: Script = n.get_script()
	if scr != null:
		for m in scr.get_script_method_list():
			out.append({"name": String(m.get("name", "")), "args": Array(m.get("args", [])).size()})
	return {"ok": true, "path": path, "methods": out}

func _call_method(path: String, method: String, args) -> Dictionary:
	var n := get_node_or_null(path)
	if n == null:
		return {"ok": false, "error": "node not found: %s" % path}
	if not n.has_method(method):
		return {"ok": false, "error": "method not found: %s" % method}
	var call_args: Array = args if typeof(args) == TYPE_ARRAY else []
	var result = n.callv(method, call_args)
	return {"ok": true, "path": path, "method": method, "result": _san(result, 0)}

func _click_node(path: String) -> Dictionary:
	var n := get_node_or_null(path)
	if n == null:
		return {"ok": false, "error": "node not found: %s" % path}
	var pos := Vector2.ZERO
	if n is Control:
		pos = n.get_global_rect().get_center()
	elif n is Node2D:
		pos = n.global_position
	else:
		return {"ok": false, "error": "node has no position: %s" % path}
	Input.warp_mouse(pos)
	for pressed in [true, false]:
		var ev := InputEventMouseButton.new()
		ev.button_index = MOUSE_BUTTON_LEFT
		ev.pressed = pressed
		ev.position = pos
		ev.global_position = pos
		Input.parse_input_event(ev)
	return {"ok": true, "clicked": path, "pos": [pos.x, pos.y]}

# ---------------------------------------------------------------- io

func _write_json(name: String, data) -> void:
	var f := FileAccess.open(OUT_DIR.path_join(name), FileAccess.WRITE)
	if f == null:
		ModLoaderLog.error("open for write failed: %s" % name, LOG_NAME)
		return
	f.store_string(JSON.stringify(data, "\t"))
	f.close()
