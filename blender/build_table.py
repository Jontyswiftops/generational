"""Build the Generational round table room from scratch and export it as
assets/models/table.glb.

Run inside Blender (Scripting workspace, or headless):

    blender-launcher.exe -b --python blender/build_table.py

Everything is procedural so the asset is reproducible from this file alone.
Object names matter to js/table3d.js:
  Whiteboard_Face   the app paints the next session title onto it
  Seat_01           its distance from the centre sets the seat ring radius
  Marker_Chair      hidden master chair; the app clones one per member
  Sconce_NN         small wall lights the app flickers
  Lamp_Bulb         the pendant bulb the app pulses
  Table_* / Chair   cast shadows;  Floor / Rug receive them
Camera and lights are for the preview render only and are not exported.

Target: under 40k triangles, no image textures, one GLB well under 1 MB.
"""
import math
import os

import bpy
import bmesh

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO = os.environ.get("GEN_REPO") or r"C:\Users\jdela\OneDrive\Documents\CLAUDE CODE CREATIONS\generational"
OUT_GLB = os.path.join(REPO, "assets", "models", "table.glb")
PREVIEW = os.path.join(REPO, "blender", "previews", "table.png")
RENDER_PREVIEW = True

GOLD = (0.831, 0.659, 0.294, 1.0)
GOLD_DIM = (0.45, 0.34, 0.14, 1.0)
WALNUT = (0.165, 0.102, 0.063, 1.0)
WALNUT_DARK = (0.10, 0.06, 0.035, 1.0)
DARK = (0.086, 0.102, 0.149, 1.0)
MARBLE = (0.035, 0.045, 0.085, 1.0)
RUG = (0.07, 0.085, 0.17, 1.0)
WALL = (0.055, 0.07, 0.125, 1.0)
PANEL = (0.075, 0.09, 0.15, 1.0)
STONE = (0.13, 0.15, 0.21, 1.0)
LEATHER = (0.09, 0.095, 0.13, 1.0)
BOARD = (0.02, 0.025, 0.045, 1.0)
WARM = (1.0, 0.85, 0.6, 1.0)

SEAT_RADIUS = 2.15
SEAT_COUNT = 12
WALL_RADIUS = 6.6


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_homefile(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    engines = {i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    return scene


def material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def finish(name, bm, mats, smooth=True, location=(0, 0, 0), rotation=(0, 0, 0), bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
        me.materials.append(m)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    obj.location = location
    obj.rotation_euler = rotation
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
    return link(obj)


def cylinder(name, r_top, r_bottom, depth, segments, z, mat, bevel=0.0, x=0.0, y=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r_bottom, radius2=r_top, depth=depth)
    return finish(name, bm, mat, location=(x, y, z), bevel=bevel)


def torus_bm(bm, major, minor, seg_major, seg_minor, mat_index=0, z=0.0):
    rings = []
    for i in range(seg_major):
        a = 2 * math.pi * i / seg_major
        ring = []
        for j in range(seg_minor):
            b = 2 * math.pi * j / seg_minor
            x = (major + minor * math.cos(b)) * math.cos(a)
            y = (major + minor * math.cos(b)) * math.sin(a)
            ring.append(bm.verts.new((x, y, z + minor * math.sin(b))))
        rings.append(ring)
    for i in range(seg_major):
        for j in range(seg_minor):
            f = bm.faces.new((rings[i][j], rings[(i + 1) % seg_major][j],
                              rings[(i + 1) % seg_major][(j + 1) % seg_minor], rings[i][(j + 1) % seg_minor]))
            f.material_index = mat_index


def torus(name, major, minor, seg_major, seg_minor, z, mat):
    bm = bmesh.new()
    torus_bm(bm, major, minor, seg_major, seg_minor)
    return finish(name, bm, mat, location=(0, 0, z))


def box_bm(bm, w, d, h, center, mat_index=0):
    x, y, z = center
    vs = [bm.verts.new((x + sx * w / 2, y + sy * d / 2, z + sz * h / 2))
          for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    # vs index: sz*4 + sy*2 + sx (0/1)
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    for f in faces:
        bf = bm.faces.new([vs[i] for i in f])
        bf.material_index = mat_index


def box(name, w, d, h, mat, location, bevel=0.0, rotation=(0, 0, 0)):
    bm = bmesh.new()
    box_bm(bm, w, d, h, (0, 0, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, mat, smooth=False, location=location, rotation=rotation, bevel=bevel)


def plane(name, w, h, mat, location, rotation=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for v in bm.verts:
        v.co.x *= w / 2
        v.co.y *= h / 2
    for f in bm.faces:
        for loop in f.loops:
            loop[uv_layer].uv = (loop.vert.co.x / w + 0.5, loop.vert.co.y / h + 0.5)
    return finish(name, bm, mat, smooth=False, location=location, rotation=rotation)


def arc_band(name, radius, z0, z1, arc_deg, segments, mat, centre_deg=90):
    """Open cylinder section: the curved back wall and its trims."""
    bm = bmesh.new()
    a0 = math.radians(centre_deg + arc_deg / 2)
    a1 = math.radians(centre_deg - arc_deg / 2)
    bottom, top = [], []
    for i in range(segments + 1):
        a = a0 + (a1 - a0) * i / segments
        x, y = radius * math.cos(a), radius * math.sin(a)
        bottom.append(bm.verts.new((x, y, z0)))
        top.append(bm.verts.new((x, y, z1)))
    for i in range(segments):
        bm.faces.new((bottom[i], top[i], top[i + 1], bottom[i + 1]))
    return finish(name, bm, mat)


def sphere(name, r, segments, rings, location, mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=r)
    return finish(name, bm, mat, location=location)


# ---------------------------------------------------------------------------
# Pieces
# ---------------------------------------------------------------------------

def build_table(m_wood, m_wood_dark, m_gold, m_dark):
    cylinder("Table_Top", 1.5, 1.5, 0.1, 128, 0.78, m_wood, bevel=0.025)
    torus("Table_Rim", 1.5, 0.032, 160, 12, 0.83, m_gold)
    torus("Table_Inlay", 0.9, 0.012, 128, 8, 0.832, m_gold)
    torus("Table_Inlay2", 0.55, 0.012, 96, 8, 0.832, m_gold)
    cylinder("Table_Centre", 0.55, 0.55, 0.004, 96, 0.832, m_wood_dark)
    torus("Table_Collar", 0.42, 0.03, 64, 10, 0.72, m_gold)
    cylinder("Table_Stem", 0.28, 0.4, 0.62, 64, 0.40, m_dark)
    # fluting: 16 thin ribs around the stem
    bm = bmesh.new()
    for i in range(16):
        a = 2 * math.pi * i / 16
        before = set(bm.verts)
        box_bm(bm, 0.045, 0.02, 0.5, (0, 0.33, 0))
        for v in bm.verts:
            if v in before:
                continue
            x, y = v.co.x, v.co.y
            v.co.x, v.co.y = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    finish("Table_Fluting", bm, m_gold, smooth=False, location=(0, 0, 0.40))
    cylinder("Table_Foot", 0.78, 0.86, 0.07, 96, 0.035, m_dark, bevel=0.02)
    torus("Table_FootRim", 0.82, 0.014, 128, 8, 0.075, m_gold)


def build_chair(m_leather, m_frame, m_gold):
    """Master chair at the origin, facing +Y (toward the table once placed)."""
    bm = bmesh.new()
    # seat cushion
    box_bm(bm, 0.54, 0.54, 0.10, (0, 0, 0.47), 0)
    # backrest, slightly reclined
    seat_verts = set(bm.verts)
    box_bm(bm, 0.54, 0.07, 0.62, (0, -0.25, 0.83), 0)
    for v in bm.verts:
        if v not in seat_verts and v.co.z > 0.6:
            v.co.y -= (v.co.z - 0.55) * 0.12
    # armrests
    box_bm(bm, 0.06, 0.46, 0.05, (-0.25, -0.02, 0.66), 1)
    box_bm(bm, 0.06, 0.46, 0.05, (0.25, -0.02, 0.66), 1)
    box_bm(bm, 0.05, 0.05, 0.22, (-0.25, 0.18, 0.55), 1)
    box_bm(bm, 0.05, 0.05, 0.22, (0.25, 0.18, 0.55), 1)
    # frame under the seat and legs
    box_bm(bm, 0.5, 0.5, 0.05, (0, 0, 0.405), 1)
    for sx in (-0.22, 0.22):
        for sy in (-0.22, 0.22):
            box_bm(bm, 0.04, 0.04, 0.39, (sx, sy, 0.195), 1)
    # gold piping along the top of the backrest
    box_bm(bm, 0.56, 0.05, 0.02, (0, -0.28, 1.13), 2)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    chair = finish("Marker_Chair", bm, [m_leather, m_frame, m_gold], smooth=False, bevel=0.012)
    chair.hide_render = True
    chair.hide_set(True)
    return chair


def build_room(m_marble, m_rug, m_rug_trim, m_wall, m_panel, m_stone, m_gold_dim, m_sconce):
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, cap_tris=False, segments=96, radius=WALL_RADIUS + 0.4)
    finish("Floor", bm, m_marble, smooth=False)
    cylinder("Rug", 3.6, 3.6, 0.02, 128, 0.01, m_rug)
    torus("Rug_Trim", 3.45, 0.02, 160, 6, 0.024, m_rug_trim)
    torus("Rug_Trim2", 3.2, 0.012, 160, 6, 0.024, m_rug_trim)

    arc_band("Wall_Back", WALL_RADIUS, 0.0, 3.6, 170, 40, m_wall)
    arc_band("Wall_Wainscot", WALL_RADIUS - 0.05, 0.0, 1.05, 170, 40, m_panel)
    arc_band("Wall_Chair_Rail", WALL_RADIUS - 0.08, 1.05, 1.12, 170, 40, m_gold_dim)
    arc_band("Wall_Cornice", WALL_RADIUS - 0.08, 3.45, 3.6, 170, 40, m_gold_dim)
    # raised panels on the wainscot
    for i in range(-5, 6):
        a = math.radians(90 + i * 15)
        if abs(i) <= 1:
            continue
        r = WALL_RADIUS - 0.1
        box("Wall_Panel_%02d" % (i + 6), 0.9, 0.04, 0.7, m_wall,
            (r * math.cos(a), r * math.sin(a), 0.55), rotation=(0, 0, a + math.pi / 2))

    # pillars framing the whiteboard and the sides
    for k, deg in enumerate((60, 120, 25, 155)):
        a = math.radians(deg)
        r = WALL_RADIUS - 0.35
        cylinder("Pillar_%02d" % (k + 1), 0.2, 0.22, 3.6, 32, 1.8, m_stone, x=r * math.cos(a), y=r * math.sin(a))
        cylinder("Pillar_Cap_%02d" % (k + 1), 0.28, 0.24, 0.12, 32, 3.54, m_gold_dim, x=r * math.cos(a), y=r * math.sin(a))
        cylinder("Pillar_Base_%02d" % (k + 1), 0.26, 0.3, 0.12, 32, 0.06, m_gold_dim, x=r * math.cos(a), y=r * math.sin(a))

    # wall sconces between the pillars
    for k, deg in enumerate((42, 90, 138, 10, 170)):
        a = math.radians(deg)
        r = WALL_RADIUS - 0.22
        x, y = r * math.cos(a), r * math.sin(a)
        box("Sconce_Back_%02d" % (k + 1), 0.18, 0.04, 0.3, m_gold_dim, (x, y, 2.3), rotation=(0, 0, a + math.pi / 2))
        sphere("Sconce_%02d" % (k + 1), 0.055, 16, 10, (x - 0.1 * math.cos(a), y - 0.1 * math.sin(a), 2.42), m_sconce)


def build_whiteboard(m_gold, m_board):
    y = WALL_RADIUS - 0.16
    box("Whiteboard_Frame", 3.7, 0.08, 2.1, m_gold, (0, y, 2.3), bevel=0.01)
    plane("Whiteboard_Face", 3.55, 1.95, m_board, (0, y - 0.045, 2.3), rotation=(math.radians(90), 0, 0))
    # a small gold ledge under the board
    box("Whiteboard_Ledge", 1.6, 0.14, 0.04, m_gold, (0, y - 0.09, 1.23))


def build_lamp(m_dark, m_gold, m_bulb):
    cylinder("Lamp_Cord", 0.012, 0.012, 1.6, 8, 3.3, m_dark)
    cylinder("Lamp_Shade", 0.14, 0.7, 0.4, 64, 2.32, m_dark)
    cylinder("Lamp_Shade_Inner", 0.13, 0.67, 0.38, 64, 2.32, m_gold)
    torus("Lamp_Rim", 0.7, 0.018, 96, 8, 2.12, m_gold)
    sphere("Lamp_Bulb", 0.075, 20, 12, (0, 0, 2.2), m_bulb)


def build_seats():
    for i in range(SEAT_COUNT):
        a = math.pi + (i / SEAT_COUNT) * 2 * math.pi
        e = bpy.data.objects.new("Seat_%02d" % (i + 1), None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.2
        # Three.js: x = sin(a) * r, z = cos(a) * r. Blender Z-up: y = -z.
        e.location = (math.sin(a) * SEAT_RADIUS, -math.cos(a) * SEAT_RADIUS, 0.0)
        e["seat_index"] = i + 1
        link(e)


def build_preview_rig(scene):
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 38
    cam = link(bpy.data.objects.new("PreviewCam", cam_data))
    cam.location = (0, -7.2, 4.6)
    cam.rotation_euler = (math.radians(57), 0, 0)
    scene.camera = cam
    spot_data = bpy.data.lights.new("KeySpot", "SPOT")
    spot_data.energy = 1400
    spot_data.spot_size = math.radians(70)
    spot_data.spot_blend = 0.6
    spot_data.color = (1.0, 0.92, 0.78)
    spot_data.use_shadow = True
    spot = link(bpy.data.objects.new("KeySpot", spot_data))
    spot.location = (0, 0, 2.5)
    fill_data = bpy.data.lights.new("Fill", "AREA")
    fill_data.energy = 150
    fill_data.size = 6
    fill_data.color = (0.55, 0.65, 1.0)
    fill = link(bpy.data.objects.new("Fill", fill_data))
    fill.location = (-5, -4, 5)
    fill.rotation_euler = (math.radians(50), 0, math.radians(-50))
    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.02, 0.03, 0.06, 1)
        bg.inputs[1].default_value = 0.5


def build():
    scene = reset_scene()
    m_wood = material("Walnut", WALNUT, metallic=0.05, roughness=0.28)
    m_wood_dark = material("WalnutDark", WALNUT_DARK, metallic=0.05, roughness=0.3)
    m_gold = material("Gold", GOLD, metallic=1.0, roughness=0.26)
    m_gold_dim = material("GoldDim", GOLD_DIM, metallic=0.9, roughness=0.45)
    m_dark = material("DarkMetal", DARK, metallic=0.4, roughness=0.45)
    m_marble = material("Marble", MARBLE, metallic=0.15, roughness=0.12)
    m_rug = material("Rug", RUG, metallic=0.0, roughness=0.95)
    m_rug_trim = material("RugTrim", GOLD_DIM, metallic=0.3, roughness=0.8)
    m_wall = material("Wall", WALL, metallic=0.0, roughness=0.9)
    m_panel = material("Panel", PANEL, metallic=0.0, roughness=0.8)
    m_stone = material("Stone", STONE, metallic=0.0, roughness=0.55)
    m_leather = material("Leather", LEATHER, metallic=0.0, roughness=0.42)
    m_board = material("BoardFace", BOARD, metallic=0.0, roughness=0.4)
    m_sconce = material("SconceGlow", WARM, emission=WARM, strength=6.0)
    m_bulb = material("BulbGlow", WARM, emission=WARM, strength=12.0)

    build_table(m_wood, m_wood_dark, m_gold, m_dark)
    build_chair(m_leather, m_dark, m_gold)
    build_room(m_marble, m_rug, m_rug_trim, m_wall, m_panel, m_stone, m_gold_dim, m_sconce)
    build_whiteboard(m_gold, m_board)
    build_lamp(m_dark, m_gold, m_bulb)
    build_seats()
    build_preview_rig(scene)

    tri_count = sum(sum(len(p.vertices) - 2 for p in o.data.polygons)
                    for o in scene.objects if o.type == "MESH")
    return tri_count


def export():
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kwargs = dict(filepath=OUT_GLB, export_format="GLB", export_apply=True,
                  export_yup=True, export_cameras=False, export_lights=False,
                  export_extras=True, export_animations=False)
    kwargs = {k: v for k, v in kwargs.items() if k in props or k == "filepath"}
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**kwargs)
    return os.path.getsize(OUT_GLB)


def preview():
    scene = bpy.context.scene
    os.makedirs(os.path.dirname(PREVIEW), exist_ok=True)
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.filepath = PREVIEW
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    return PREVIEW


tris = build()
size = export()
result = {"triangles": tris, "glb_bytes": size, "glb": OUT_GLB}
if RENDER_PREVIEW:
    try:
        result["preview"] = preview()
    except Exception as exc:  # preview is optional
        result["preview_error"] = str(exc)
print(result)
