"""
Render the Botifyr office with Blender Cycles.

Usage (Blender must be installed — https://blender.org):

    blender -b -P scripts/blender/office_render.py -- office-scene.json out.png

Reads the scene JSON emitted by `scripts/export-office-scene.ts` and builds a
simple, clean architectural view: wood-floored rooms around a grey-tile floor
plate, glass partitions, desks, planter boxes, and a low-poly person per desk.
Output is a near-orthographic top-down render (Cycles).

This is the OFFLINE (photoreal-leaning) path. For true photorealism, replace the
primitive furniture/people with scanned assets (e.g. Renderpeople GLB) — the
scene skeleton and camera are already set up here.
"""

import json
import sys
import math
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
scene_path = argv[0] if argv else "office-scene.json"
out_path = argv[1] if len(argv) > 1 else "office-render.png"

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


def box(name, size, location, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    obj.data.materials.append(mat)
    return obj


WOOD = material("wood", (0.78, 0.68, 0.52), 0.6)
TILE = material("tile", (0.78, 0.79, 0.81), 0.7)
WALL = material("wall", (0.93, 0.94, 0.96), 0.85)
GLASS = material("glass", (0.75, 0.85, 0.92), 0.05, 0.0, 0.25)
DESK = material("desk", (0.9, 0.87, 0.8), 0.5)
PERSON = material("person", (0.2, 0.35, 0.7), 0.8)
PLANT = material("plant", (0.24, 0.55, 0.3), 0.9)

clear()

width = scene["width"]
depth = scene["depth"]

# Floor plate (grey tile) + glass curtain wall.
box("floor", (width, depth, 0.2), (0, 0, -0.1), TILE)
for (sx, sy, lx, ly) in [
    (width, 0.1, 0, -depth / 2),
    (width, 0.1, 0, depth / 2),
    (0.1, depth, -width / 2, 0),
    (0.1, depth, width / 2, 0),
]:
    box("curtain", (sx, sy, 2.9), (lx, ly, 1.45), GLASS)

# Rooms: wood floor + three walls + a low-poly person per desk.
for room in scene["rooms"]:
    box(f"roomfloor:{room['key']}", (room["width"], room["depth"], 0.22), (room["x"], room["z"], -0.09), WOOD)
    for (dx, dz, w, d) in [
        (0, -room["depth"] / 2, room["width"], 0.12),
        (-room["width"] / 2, 0, 0.12, room["depth"]),
        (room["width"] / 2, 0, 0.12, room["depth"]),
    ]:
        box(f"wall:{room['key']}", (w, d, 2.6), (room["x"] + dx, room["z"] + dz, 1.3), WALL)

for desk in scene["desks"]:
    box("desk", (1.5, 0.85, 0.74), (desk["x"], desk["z"], 0.37), DESK)
    bpy.ops.mesh.primitive_capsule_add(radius=0.22, depth=1.0, location=(desk["x"], desk["z"] + 0.9, 0.75))
    bpy.context.active_object.data.materials.append(PERSON)

for bench in scene.get("benches", []):
    box("bench", (bench["width"], 1.5, 0.74), (bench["x"], bench["z"], 0.37), DESK)

for planter in scene.get("planters", []):
    box("planter", (1.6, 1.6, 0.6), (planter["x"], planter["z"], 0.3), PLANT)

# Near-orthographic top-down camera.
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = max(width, depth) * 1.15
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (width * 0.05, depth * 0.9, depth * 1.25)
cam.rotation_euler = (math.radians(58), 0, math.radians(4))
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

# Lighting: sky + a soft key.
world = bpy.data.worlds.new("world")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.93, 0.97, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6

sun = bpy.data.lights.new("sun", type="SUN")
sun.energy = 3.0
sun_obj = bpy.data.objects.new("sun", sun)
sun_obj.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
bpy.context.scene.collection.objects.link(sun_obj)

# Render settings.
prefs = bpy.context.scene
prefs.render.engine = "CYCLES"
prefs.cycles.samples = 128
prefs.render.resolution_x = 2000
prefs.render.resolution_y = 1400
prefs.render.filepath = out_path
bpy.ops.render.render(write_still=True)
print(f"rendered {out_path}")
