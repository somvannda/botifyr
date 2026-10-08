"""
Render the Botifyr office with Blender Cycles — using the app's REAL assets.

Usage (Blender installed — https://blender.org):

    blender -b -P scripts/blender/office_render.py -- \
        office-scene.json office-render.png apps/portal/public/office3d

Positional args:
    1. scene json        (from `npx tsx scripts/export-office-scene.ts`)
    2. output png
    3. asset base dir    (default: apps/portal/public/office3d)

It imports the compressed CC0 furniture GLBs (chair, desk, sofa, plant, …) and
the Poly Haven HDRI, places them from the layout JSON, sets a near-orthographic
top-down camera, and renders with Cycles. Falls back to primitives if a model is
missing, so it always produces something.
"""

import json
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
scene_path = argv[0] if argv else "office-scene.json"
out_path = argv[1] if len(argv) > 1 else "office-render.png"
assets = argv[2] if len(argv) > 2 else "apps/portal/public/office3d"

with open(scene_path, "r", encoding="utf-8") as handle:
    scene = json.load(handle)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, roughness=0.8, metallic=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND"
    return mat


def box(name, size, location, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    obj.data.materials.append(mat)
    return obj


def place_glb(name, location, rotation_z=0.0, scale=1.0):
    """Import a .glb and drop its root at `location` (Blender is Z-up)."""
    path = os.path.join(assets, name)
    if not os.path.exists(path):
        return False
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    for obj in bpy.context.selected_objects:
        if obj not in before and obj.parent is None:
            obj.location = (location[0], location[1], location[2])
            obj.rotation_euler = (0, 0, rotation_z)
            obj.scale = (obj.scale.x * scale, obj.scale.y * scale, obj.scale.z * scale)
    return True


WOOD = material("wood", (0.78, 0.68, 0.52), 0.6)
TILE = material("tile", (0.78, 0.79, 0.81), 0.7)
WALL = material("wall", (0.93, 0.94, 0.96), 0.85)
GLASS = material("glass", (0.75, 0.85, 0.92), 0.05, 0.0, 0.25)

clear()

width = scene["width"]
depth = scene["depth"]

# Floor plate + glass curtain wall.
box("floor", (width, depth, 0.2), (0, 0, -0.1), TILE)
for (sx, sy, lx, ly) in [
    (width, 0.1, 0, -depth / 2),
    (width, 0.1, 0, depth / 2),
    (0.1, depth, -width / 2, 0),
    (0.1, depth, width / 2, 0),
]:
    box("curtain", (sx, sy, 2.9), (lx, ly, 1.45), GLASS)

# Rooms: wood floor + three walls.
for room in scene["rooms"]:
    box(f"roomfloor:{room['key']}", (room["width"], room["depth"], 0.22), (room["x"], room["z"], -0.09), WOOD)
    for (dx, dz, w, d) in [
        (0, -room["depth"] / 2, room["width"], 0.12),
        (-room["width"] / 2, 0, 0.12, room["depth"]),
        (room["width"] / 2, 0, 0.12, room["depth"]),
    ]:
        box(f"wall:{room['key']}", (w, d, 2.6), (room["x"] + dx, room["z"] + dz, 1.3), WALL)

# Desks + chairs + people (real GLBs with primitive fallback).
for desk in scene["desks"]:
    if not place_glb("metal_office_desk.glb", (desk["x"], desk["z"], 0)):
        box("desk", (1.5, 0.85, 0.74), (desk["x"], desk["z"], 0.37), WOOD)
    place_glb("WoodenChair_01.glb", (desk["x"], desk["z"] + 0.9, 0), rotation_z=math.pi)
    place_glb("xbot.glb", (desk["x"], desk["z"] + 1.2, 0), rotation_z=math.pi)

# Open-plan benches.
for bench in scene.get("benches", []):
    box("bench", (bench["width"], 1.5, 0.74), (bench["x"], bench["z"], 0.37), WOOD)

# Planters (real model with fallback).
for planter in scene.get("planters", []):
    if not place_glb("planter_box_01.glb", (planter["x"], planter["z"], 0)):
        box("planter", (1.6, 1.6, 0.6), (planter["x"], planter["z"], 0.3), material("plant", (0.24, 0.55, 0.3), 0.9))

# Near-orthographic top-down camera.
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = max(width, depth) * 1.15
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (width * 0.05, depth * 0.9, depth * 1.25)
cam.rotation_euler = (math.radians(58), 0, math.radians(4))
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

# World: the real CC0 HDRI for image-based lighting (falls back to a flat sky).
world = bpy.data.worlds.new("world")
bpy.context.scene.world = world
world.use_nodes = True
nodes = world.node_tree
bg = nodes.nodes["Background"]
bg.inputs[1].default_value = 1.0
hdri_candidates = [
    os.path.join(assets, "studio_small_08.hdr"),
    os.path.normpath(
        os.path.join(
            assets, "..", "..", "..", "..", "packages", "ui", "src", "office3d", "assets",
            "studio_small_08.hdr",
        )
    ),
    "packages/ui/src/office3d/assets/studio_small_08.hdr",
]
hdri = next((path for path in hdri_candidates if os.path.exists(path)), None)
if hdri:
    env = nodes.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(hdri)
    nodes.links.new(env.outputs["Color"], bg.inputs["Color"])
else:
    bg.inputs[0].default_value = (0.9, 0.93, 0.97, 1)
    bg.inputs[1].default_value = 0.6

# A soft key light on top of the HDRI.
sun = bpy.data.lights.new("sun", type="SUN")
sun.energy = 2.5
sun.angle = math.radians(8)
sun_obj = bpy.data.objects.new("sun", sun)
sun_obj.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
bpy.context.scene.collection.objects.link(sun_obj)

# Cycles settings.
prefs = bpy.context.scene
prefs.render.engine = "CYCLES"
prefs.cycles.samples = 256
prefs.cycles.use_denoising = True
prefs.render.resolution_x = 2400
prefs.render.resolution_y = 1600
prefs.render.filepath = out_path
bpy.ops.render.render(write_still=True)
print(f"rendered {out_path}")
