"""Optional Blender pass — validates glTF export (run via build_world --blender)."""

import sys

import bpy

argv = sys.argv
args = argv[argv.index("--") + 1 :] if "--" in argv else []
if not args:
    raise SystemExit("Usage: blender --background --python blender_export_world.py -- world.glb")

path = args[0]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")
print(f"Blender re-exported {path}")
