import bpy
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, '..', 'client', 'public', 'models'))
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_mat(name, color, metallic=0.6, roughness=0.35, emission=None, emission_strength=2.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission is not None:
        if 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = emission
        elif 'Emission' in bsdf.inputs:
            bsdf.inputs['Emission'].default_value = emission
        if 'Emission Strength' in bsdf.inputs:
            bsdf.inputs['Emission Strength'].default_value = emission_strength
    return mat


def add_box(name, size, loc, rot=(0, 0, 0), mat=None, bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        mod = obj.modifiers.new(name='Bevel', type='BEVEL')
        mod.width = bevel
        mod.segments = 2
    if mat:
        obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def build_highway_gantry():
    """Photorealistic Japanese Wangan / F1 Steel Truss Highway Gantry with overhead LED floodlights."""
    clear_scene()
    steel = make_mat('GalvanizedSteel', (0.22, 0.24, 0.27, 1.0), metallic=0.82, roughness=0.38)
    dark_steel = make_mat('DarkSteel', (0.09, 0.10, 0.12, 1.0), metallic=0.75, roughness=0.45)
    warm_led = make_mat('HighwayFloodLED', (1.0, 0.94, 0.84, 1.0), emission=(1.0, 0.94, 0.84, 1.0), emission_strength=4.5)
    amber_marker = make_mat('AmberMarker', (1.0, 0.55, 0.05, 1.0), emission=(1.0, 0.55, 0.05, 1.0), emission_strength=3.0)

    half_span = 14.4
    height = 9.8

    for side in (-1, 1):
        # Twin vertical steel truss columns per side
        for dy in (-0.6, 0.6):
            add_box(f'Col_{side}_{dy}', (0.45, 0.45, height), (side * half_span, dy, height * 0.5), mat=steel, bevel=0.03)
        # Concrete plinth base
        add_box(f'Plinth_{side}', (1.3, 2.2, 1.4), (side * half_span, 0, 0.7), mat=dark_steel, bevel=0.05)
        # Cross braces
        for hz in (2.5, 5.0, 7.5):
            add_box(f'Brace_{side}_{hz}', (0.35, 1.4, 0.22), (side * half_span, 0, hz), mat=steel, bevel=0.02)

    # Upper & lower horizontal truss chords spanning the circuit
    span = half_span * 2.0 + 1.0
    add_box('TopChord', (span, 1.4, 0.38), (0, 0, height), mat=steel, bevel=0.03)
    add_box('BotChord', (span, 1.4, 0.34), (0, 0, height - 1.35), mat=steel, bevel=0.03)

    # Diagonal truss struts across the bridge
    for x in range(-12, 14, 4):
        add_box(f'Strut_{x}', (0.18, 1.3, 1.65), (x, 0, height - 0.68), rot=(0, 0.55, 0), mat=steel, bevel=0.01)

    # Overhead warm-white LED highway light pods + amber lane markers
    for lx in (-9.0, -3.0, 3.0, 9.0):
        add_box(f'LightHousing_{lx}', (1.8, 0.75, 0.22), (lx, 0, height - 1.55), mat=dark_steel, bevel=0.02)
        add_box(f'LightLens_{lx}', (1.55, 0.55, 0.08), (lx, 0, height - 1.66), mat=warm_led, bevel=0.01)

    for side in (-1, 1):
        add_box(f'Amber_{side}', (0.25, 0.25, 0.9), (side * (half_span - 0.5), 0.75, 3.6), mat=amber_marker, bevel=0.02)

    out_path = os.path.join(OUT_DIR, 'cyber-arch.glb')
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_apply=True, export_yup=True)
    print(f'[Blender] Exported realistic highway gantry {out_path}')


build_highway_gantry()
