"""Build the Generational round table scene from scratch and export it as
assets/models/table.glb.

Run inside Blender (Scripting workspace, or via the Blender MCP):

    exec(open(r"...\\generational\\blender\\build_table.py").read())

Everything is procedural so the asset is reproducible from this file alone.
Object names matter: js/table3d.js looks for Whiteboard_Face (it paints the
next session title onto it at runtime) and Seat_01 (to read the seat ring
radius). Seats themselves stay procedural in Three.js so the ring re-spaces
for any member count. Camera and lights are not exported.

Target: under 30k triangles, no image textures, one GLB well under 1 MB.
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
GOLD_DARK = (0.72, 0.54, 0.18, 1.0)
WALNUT = (0.165, 0.102, 0.063, 1.0)
DARK = (0.086, 0.102, 0.149, 1.0)
FLOOR = (0.043, 0.059, 0.11, 1.0)
WALL = (0.05, 0.07, 0.125, 1.0)
BOARD = (0.02, 0.025, 0.045, 1.0)

SEAT_RADIUS = 2.05
SEAT_COUNT = 12


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_homefile(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.types, "SceneEEVEE") and "BLENDER_EEVEE_NEXT" in {
        i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE"
    return scene


def material(name, color, metallic=0.0, roughness=0.5, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def mesh_object(name, bm, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    if mat:
        me.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return link(obj)


def cylinder(name, r_top, r_bottom, depth, segments, z, mat, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r_bottom, radius2=r_top, depth=depth)
    obj = mesh_object(name, bm, mat)
    obj.location.z = z
    if bevel:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
    return obj


def torus(name, major, minor, seg_major, seg_minor, z, mat):
    bm = bmesh.new()
    bmesh.ops.create_torus if hasattr(bmesh.ops, "create_torus") else None
    # bmesh has no torus primitive in every version; build it by hand.
    verts = []
    for i in range(seg_major):
        a = 2 * math.pi * i / seg_major
        ring = []
        for j in range(seg_minor):
            b = 2 * math.pi * j / seg_minor
            x = (major + minor * math.cos(b)) * math.cos(a)
            y = (major + minor * math.cos(b)) * math.sin(a)
            zz = minor * math.sin(b)
            ring.append(bm.verts.new((x, y, zz)))
        verts.append(ring)
    for i in range(seg_major):
        for j in range(seg_minor):
            v1 = verts[i][j]
            v2 = verts[(i + 1) % seg_major][j]
            v3 = verts[(i + 1) % seg_major][(j + 1) % seg_minor]
            v4 = verts[i][(j + 1) % seg_minor]
            bm.faces.new((v1, v2, v3, v4))
    obj = mesh_object(name, bm, mat)
    obj.location.z = z
    return obj


def plane(name, w, h, mat, location, rotation=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
    for v in bm.verts:
        v.co.x *= w / 2
        v.co.y *= h / 2
    obj = mesh_object(name, bm, mat, smooth=False)
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def box(name, w, h, d, mat, location):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z *= h
    obj = mesh_object(name, bm, mat, smooth=False)
    obj.location = location
    return obj


def curved_wall(name, radius, height, arc_deg, segments, mat):
    """Open cylinder section behind the table (the moody back wall)."""
    bm = bmesh.new()
    a0 = math.radians(90 + arc_deg / 2)
    a1 = math.radians(90 - arc_deg / 2)
    bottom, top = [], []
    for i in range(segments + 1):
        a = a0 + (a1 - a0) * i / segments
        x, y = radius * math.cos(a), radius * math.sin(a)
        bottom.append(bm.verts.new((x, y, 0)))
        top.append(bm.verts.new((x, y, height)))
    for i in range(segments):
        bm.faces.new((bottom[i], bottom[i + 1], top[i + 1], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, mat)


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def build():
    scene = reset_scene()

    m_wood = material("Walnut", WALNUT, metallic=0.05, roughness=0.32)
    m_gold = material("Gold", GOLD, metallic=1.0, roughness=0.28)
    m_dark = material("DarkMetal", DARK, metallic=0.35, roughness=0.5)
    m_floor = material("Floor", FLOOR, metallic=0.25, roughness=0.55)
    m_wall = material("Wall", WALL, metallic=0.0, roughness=0.9)
    m_board = material("BoardFace", BOARD, metallic=0.0, roughness=0.4)

    # Table (Three.js coordinates are Y-up; the exporter converts Z-up for us)
    cylinder("Table_Top", 1.5, 1.5, 0.09, 96, 0.78, m_wood, bevel=0.02)
    torus("Table_Rim", 1.5, 0.03, 128, 12, 0.825, m_gold)
    torus("Table_Inlay", 0.55, 0.012, 96, 8, 0.826, m_gold)
    cylinder("Table_Stem", 0.3, 0.42, 0.7, 48, 0.38, m_dark)
    cylinder("Table_Foot", 0.75, 0.8, 0.06, 64, 0.03, m_dark, bevel=0.015)
    torus("Table_FootRim", 0.78, 0.012, 96, 8, 0.065, m_gold)

    # Room
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, cap_tris=False, segments=64, radius=6.0)
    floor = mesh_object("Floor", bm, m_floor, smooth=False)
    floor.location.z = 0.0
    curved_wall("Wall_Back", 6.0, 3.2, 120, 24, m_wall)

    # Whiteboard behind the table. The face is left plain; the app paints a
    # canvas texture onto it at runtime. Y is "back" here (Z-up world).
    box("Whiteboard_Frame", 2.5, 1.45, 0.06, m_gold, (0, 2.85, 1.65))
    plane("Whiteboard_Face", 2.4, 1.35, m_board, (0, 2.81, 1.65), rotation=(math.radians(90), 0, 0))

    # Seat ring as empties, plus a hidden master marker disc.
    for i in range(SEAT_COUNT):
        a = math.pi + (i / SEAT_COUNT) * 2 * math.pi
        e = bpy.data.objects.new("Seat_%02d" % (i + 1), None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 0.2
        # Three.js: x = sin(a) * r, z = cos(a) * r. Blender Z-up: y = -z.
        e.location = (math.sin(a) * SEAT_RADIUS, -math.cos(a) * SEAT_RADIUS, 0.0)
        e["seat_index"] = i + 1
        link(e)
    marker = cylinder("Marker_Disc", 0.2, 0.18, 0.05, 32, 0.46, m_dark)
    marker.hide_render = True
    marker.hide_set(True)

    # Preview camera and light (not exported)
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 40
    cam = link(bpy.data.objects.new("PreviewCam", cam_data))
    cam.location = (0, -6.6, 4.2)
    cam.rotation_euler = (math.radians(58), 0, 0)
    scene.camera = cam
    spot_data = bpy.data.lights.new("KeySpot", "SPOT")
    spot_data.energy = 900
    spot_data.spot_size = math.radians(60)
    spot_data.spot_blend = 0.7
    spot_data.color = (1.0, 0.94, 0.82)
    spot = link(bpy.data.objects.new("KeySpot", spot_data))
    spot.location = (0, 0.6, 5.5)
    spot.rotation_euler = (0, 0, 0)
    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.02, 0.03, 0.06, 1)
        bg.inputs[1].default_value = 0.6

    tri_count = sum(
        sum(len(p.vertices) - 2 for p in o.data.polygons)
        for o in scene.objects if o.type == "MESH")
    return tri_count


def export():
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kwargs = dict(filepath=OUT_GLB, export_format="GLB", export_apply=True,
                  export_yup=True, export_cameras=False, export_lights=False,
                  export_extras=True, export_animations=False)
    # Option names drift between Blender versions; only pass the ones that exist.
    kwargs = {k: v for k, v in kwargs.items() if k in props or k == "filepath"}
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(**kwargs)
    return os.path.getsize(OUT_GLB)


def preview():
    scene = bpy.context.scene
    os.makedirs(os.path.dirname(PREVIEW), exist_ok=True)
    scene.render.resolution_x = 960
    scene.render.resolution_y = 600
    scene.render.resolution_percentage = 100
    scene.render.filepath = PREVIEW
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    return PREVIEW


if __name__ == "__main__" or True:
    tris = build()
    size = export()
    out = {"triangles": tris, "glb_bytes": size, "glb": OUT_GLB}
    if RENDER_PREVIEW:
        try:
            out["preview"] = preview()
        except Exception as exc:  # preview is optional
            out["preview_error"] = str(exc)
    result = out
    print(result)
