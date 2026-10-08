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


clear()

WOOD = material("wood", (0.78, 0.68, 0.52), 0.6)
TILE = material("tile", (0.78, 0.79, 0.81), 0.7)
WALL = material("wall", (0.93, 0.94, 0.96), 0.85)
GLASS = material("glass", (0.75, 0.85, 0.92), 0.05, 0.0, 0.25)
MONITOR = material("monitor", (0.05, 0.06, 0.08), 0.3, 0.2)
PING = material("pingpong", (0.12, 0.37, 0.62), 0.4)
GREY = material("grey", (0.55, 0.58, 0.63), 0.6)
CAP = material("cap", (0.28, 0.30, 0.34), 0.5, 0.3)

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
    box("curtain-cap", (sx, sy, 0.08), (lx, ly, 2.94), CAP)

# Rooms: wood floor + three walls.
for room in scene["rooms"]:
    box(f"roomfloor:{room['key']}", (room["width"], room["depth"], 0.22), (room["x"], room["z"], -0.09), WOOD)
    for (dx, dz, w, d) in [
        (0, -room["depth"] / 2, room["width"], 0.12),
        (-room["width"] / 2, 0, 0.12, room["depth"]),
        (room["width"] / 2, 0, 0.12, room["depth"]),
    ]:
        box(f"wall:{room['key']}", (w, d, 2.6), (room["x"] + dx, room["z"] + dz, 1.3), WALL)
        box(f"cap:{room['key']}", (w + 0.03, d + 0.03, 0.08), (room["x"] + dx, room["z"] + dz, 2.64), CAP)

# Desks + chairs + people (real GLBs with primitive fallback).
for desk in scene["desks"]:
    if not place_glb("metal_office_desk.glb", (desk["x"], desk["z"], 0)):
        box("desk", (1.5, 0.85, 0.74), (desk["x"], desk["z"], 0.37), WOOD)
    place_glb("WoodenChair_01.glb", (desk["x"], desk["z"] + 0.9, 0), rotation_z=math.pi)
    place_glb("xbot.glb", (desk["x"], desk["z"] + 1.2, 0), rotation_z=math.pi)

# Open-plan benches: table + monitors on both sides + chairs.
for bench in scene.get("benches", []):
    box("bench", (bench["width"], 1.5, 0.74), (bench["x"], bench["z"], 0.37), WOOD)
    count = max(2, int(bench["width"] // 1.8))
    for index in range(count):
        x = bench["x"] - bench["width"] / 2 + (bench["width"] / (count + 1)) * (index + 1)
        box("monitor", (0.6, 0.05, 0.4), (x, bench["z"] - 0.3, 1.0), MONITOR)
        box("monitor", (0.6, 0.05, 0.4), (x, bench["z"] + 0.3, 1.0), MONITOR)
        box("benchchair", (0.5, 0.5, 0.9), (x, bench["z"] - 0.85, 0.45), GREY)
        box("benchchair", (0.5, 0.5, 0.9), (x, bench["z"] + 0.85, 0.45), GREY)

# Ping-pong tables (recreation, open area).
for table in scene.get("gameTables", []):
    box("pingpong", (2.74, 1.52, 0.06), (table["x"], table["z"], 0.76), PING)

# Planters (real model with fallback).
for planter in scene.get("planters", []):
    if not place_glb("planter_box_01.glb", (planter["x"], planter["z"], 0)):
        box("planter", (1.6, 1.6, 0.6), (planter["x"], planter["z"], 0.3), material("plant", (0.24, 0.55, 0.3), 0.9))

# Camera + lights aimed at the centre via a Track-To target.
target = bpy.data.objects.new("target", None)
target.location = (0, 0, 0)
bpy.context.scene.collection.objects.link(target)


def aim(obj):
    con = obj.constraints.new(type="TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"


def add_sun(name, location, energy, color, angle_deg=6.0):
    data = bpy.data.lights.new(name, type="SUN")
    data.energy = energy
    data.color = color
    data.angle = math.radians(angle_deg)
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    aim(obj)
    return obj


# Perspective camera, 3/4 architectural view.
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 55
cam = bpy.data.objects.new("cam", cam_data)
cam.location = (width * 0.2, -depth * 1.7, depth * 1.15)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
aim(cam)

# World: soft HDRI ambient (low strength so the 3-point setup reads).
world = bpy.data.worlds.new("world")
bpy.context.scene.world = world
world.use_nodes = True
nodes = world.node_tree
bg = nodes.nodes["Background"]
bg.inputs[1].default_value = 0.35
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

# Three-point lighting: warm key, cool fill, warm rim.
add_sun("key", (width * 0.7, -depth * 0.9, width * 1.0), 3.4, (1.0, 0.95, 0.85), 4)
add_sun("fill", (-width * 0.9, depth * 0.5, width * 0.6), 1.1, (0.85, 0.90, 1.0), 25)
add_sun("rim", (0, depth * 1.1, width * 0.5), 1.4, (1.0, 0.90, 0.80), 6)

# Cycles settings (overridable for quick previews).
prefs = bpy.context.scene
prefs.render.engine = "CYCLES"
prefs.cycles.samples = int(os.environ.get("BOTIFYR_RENDER_SAMPLES", "128"))
prefs.cycles.use_denoising = True
prefs.render.resolution_x = int(os.environ.get("BOTIFYR_RENDER_X", "2000"))
prefs.render.resolution_y = int(os.environ.get("BOTIFYR_RENDER_Y", "1400"))
prefs.render.filepath = out_path
print(f"objects: {len(bpy.data.objects)} | camera {tuple(round(v, 1) for v in cam.location)} ortho {round(cam_data.ortho_scale, 1)}")
bpy.ops.render.render(write_still=True)
print(f"rendered {out_path}")
