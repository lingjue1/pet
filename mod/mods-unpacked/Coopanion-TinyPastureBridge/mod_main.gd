extends Node

const BRIDGE_MOD_DIR := "Coopanion-TinyPastureBridge"
const LOG_NAME := "Coopanion-TinyPastureBridge:Main"

## The ModLoader calls _init() on this script. The probe node is added on the
## next idle frame so the scene tree (autoloads included) already exists.
func _init() -> void:
	ModLoaderLog.info("bridge mod loaded", LOG_NAME)
	call_deferred("_start_probe")

func _start_probe() -> void:
	var path := "res://mods-unpacked/%s/probe.gd" % BRIDGE_MOD_DIR
	if not ResourceLoader.exists(path):
		ModLoaderLog.error("probe.gd missing at %s" % path, LOG_NAME)
		return
	var script: Script = load(path)
	if script == null:
		ModLoaderLog.error("probe.gd failed to load", LOG_NAME)
		return
	var probe: Node = script.new()
	probe.name = "CoopanionBridgeProbe"
	get_tree().root.add_child(probe)
	ModLoaderLog.info("probe attached", LOG_NAME)
