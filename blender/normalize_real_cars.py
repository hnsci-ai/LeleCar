import bpy
import math
import os
from mathutils import Vector, Euler, Matrix

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, 'raw'))
OUT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, '..', 'client', 'public', 'models'))
os.makedirs(OUT_DIR, exist_ok=True)

CAR_JOBS = [
    {
        'id': 'ferrari-458',
        'src': os.path.join(RAW_DIR, 'ferrari.glb'),
        'rot_z_deg': 180.0,     # Ferrari front is +Y -> rotate 180° to -Y (Three.js +Z)
        'target_len': 4.53,
        'wheel_spin_keys': ['wheel', 'tire', 'rim_fl', 'rim_fr', 'rim_rl', 'rim_rr', 'centre', 'nuts'],
        'wheel_caliper_keys': ['brake'],  # Note: exclude 'brakes' (rear brake light!)
        'wheel_exclude_keys': ['steering', 'brakes', 'trim', 'body'],
        'paint_mats': ['Body_Color'],
        'paint_color': (0.72, 0.015, 0.025, 1.0),  # Ferrari Rosso Corsa
        'paint_metallic': 0.72,
        'paint_roughness': 0.13,
        'brake_mats': ['Taillight_Glass'],
        'headlight_mats': ['Projector_Glass'],
    },
    {
        'id': 'lamborghini-aventador',
        'src': os.path.join(RAW_DIR, 'aventador.glb'),
        'rot_z_deg': 90.0,      # Aventador front is -X -> rotate +90° Z to -Y (Three.js +Z)
        'target_len': 4.68,
        'wheel_spin_keys': ['rim_t0', 'tyre_', 'discrotor_', 'wheelhub_'],
        'wheel_caliper_keys': ['caliper_'],
        'wheel_exclude_keys': ['steering', 'bumper', 'body'],
        'paint_mats': ['Mt_Body', 'Mt_MirrorCover'],
        'paint_color': (0.015, 0.42, 0.88, 1.0),   # Lamborghini Blu Cepheus
        'paint_metallic': 0.78,
        'paint_roughness': 0.12,
        'brake_mats': ['Mt_Light_Emissive', 'Mt_Reflector_RL', 'Mt_Reflector_BL'],
        'headlight_mats': [],
    },
    {
        'id': 'porsche-911-gt3rs',
        'src': os.path.join(RAW_DIR, 'porsche_gt3_rs', 'scene.gltf'),
        'rot_z_deg': 0.0,       # Porsche 992 GT3 RS front is already -Y
        'target_len': 4.57,
        'wheel_spin_keys': ['object_4', 'style_1_chrome_wheels', 'amdb11_brake'],
        'wheel_caliper_keys': ['amdb11_caliper', 'amdb11_misc'],
        'wheel_exclude_keys': ['body', 'door', 'hood', 'wing', 'fender', 'bumper', 'pedal', 'line'],
        'paint_mats': ['TwiXeR_992_carPaint.003', 'TwiXeR_992_carPaint.008'],
        'paint_color': (0.95, 0.68, 0.01, 1.0),    # Porsche Racing Yellow
        'paint_metallic': 0.55,
        'paint_roughness': 0.13,
        'brake_mats': ['TwiXeR_992_brakelight_1.002', 'TwiXeR_992_taillight_running.001'],
        'headlight_mats': ['TwiXeR_992_headlight.001'],
    },
    {
        'id': 'mclaren-senna',
        'src': os.path.join(RAW_DIR, 'mclaren_senna.glb'),
        'rot_z_deg': 0.0,       # McLaren Senna front is already -Y
        'target_len': 4.64,
        'wheel_spin_keys': ['object_4', 'wheel1paint', 'hub_spindle', 'amdb11_brake'],
        'wheel_caliper_keys': ['amdb11_caliper', 'amdb11_misc'],
        'wheel_exclude_keys': ['body', 'fender', 'flank', 'bumper', 'door', 'subframe'],
        'paint_mats': ['sennapaint', 'sennapaintmain'],
        'paint_color': (0.94, 0.30, 0.01, 1.0),    # McLaren Papaya Orange
        'paint_metallic': 0.78,
        'paint_roughness': 0.12,
        'brake_mats': ['euansenna_taillight', 'a_red'],
        'headlight_mats': ['euansenna_headlight'],
    },
]


def world_bbox(objs):
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH' or len(o.data.vertices) == 0:
            continue
        mw = o.matrix_world
        for v in o.bound_box:
            w = mw @ Vector(v)
            mins.x = min(mins.x, w.x); mins.y = min(mins.y, w.y); mins.z = min(mins.z, w.z)
            maxs.x = max(maxs.x, w.x); maxs.y = max(maxs.y, w.y); maxs.z = max(maxs.z, w.z)
    return mins, maxs


def obj_center(o):
    mw = o.matrix_world
    return sum((mw @ Vector(v) for v in o.bound_box), Vector()) / 8.0


def detach_and_bake_world(o):
    """Unparent object while keeping exact world transform."""
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw


def reparent_keep_world(o, new_parent):
    mw = o.matrix_world.copy()
    o.parent = new_parent
    o.matrix_parent_inverse = new_parent.matrix_world.inverted()
    o.matrix_world = mw


def set_bsdf_input(bsdf, names, value):
    for n in names:
        if n in bsdf.inputs:
            bsdf.inputs[n].default_value = value
            return


def polish_materials(job):
    for mat in bpy.data.materials:
        if not mat.use_nodes or not mat.node_tree:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue

        # 1. Automotive Metallic Clearcoat Paint
        if any(pm.lower() in mat.name.lower() for pm in job['paint_mats']):
            # Disconnect base color texture only if solid paint override is desired
            bc = bsdf.inputs.get('Base Color')
            if bc and not bc.is_linked:
                bc.default_value = job['paint_color']
            elif bc and job['id'] in ('ferrari-458', 'lamborghini-aventador', 'porsche-911-gt3rs', 'mclaren-senna'):
                for link in list(bc.links):
                    mat.node_tree.links.remove(link)
                bc.default_value = job['paint_color']
            set_bsdf_input(bsdf, ['Metallic'], job['paint_metallic'])
            set_bsdf_input(bsdf, ['Roughness'], job['paint_roughness'])
            set_bsdf_input(bsdf, ['Coat Weight', 'Clearcoat'], 1.0)
            set_bsdf_input(bsdf, ['Coat Roughness', 'Clearcoat Roughness'], 0.03)

        # 2. Glowing Brake / Taillight materials (tagged with 'BrakeLight_' prefix for Three.js!)
        if any(bm.lower() in mat.name.lower() for bm in job['brake_mats']):
            if not mat.name.startswith('BrakeLight_'):
                mat.name = f'BrakeLight_{mat.name}'
            set_bsdf_input(bsdf, ['Base Color'], (0.85, 0.02, 0.03, 1.0))
            set_bsdf_input(bsdf, ['Emission Color', 'Emission'], (1.0, 0.03, 0.05, 1.0))
            set_bsdf_input(bsdf, ['Emission Strength'], 2.4)

        # 3. Crisp LED Headlights
        if any(hm.lower() in mat.name.lower() for hm in job['headlight_mats']):
            set_bsdf_input(bsdf, ['Emission Color', 'Emission'], (0.95, 0.98, 1.0, 1.0))
            set_bsdf_input(bsdf, ['Emission Strength'], 4.5)

        # 4. Real Tinted Translucent Windshield Glass on Ferrari 458
        if job['id'] == 'ferrari-458' and mat.name == 'Glass_Gray':
            set_bsdf_input(bsdf, ['Base Color'], (0.04, 0.06, 0.09, 1.0))
            set_bsdf_input(bsdf, ['Metallic'], 0.12)
            set_bsdf_input(bsdf, ['Roughness'], 0.04)
            set_bsdf_input(bsdf, ['Coat Weight', 'Clearcoat'], 1.0)
            set_bsdf_input(bsdf, ['Alpha'], 0.42)
            mat.blend_method = 'BLEND'


def process_car(job):
    print(f"\n[Normalize] Processing {job['id']} from {job['src']}...")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=job['src'])

    # Delete any baked shadow planes or lights/cameras imported from raw scenes
    for o in list(bpy.data.objects):
        nl = o.name.lower()
        if o.type in ('CAMERA', 'LIGHT') or 'shadow' in nl:
            bpy.data.objects.remove(o, do_unlink=True)

    # Flatten hierarchy onto world transforms for clean normalization
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in meshes:
        detach_and_bake_world(o)
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)

    # Create temporary transform root to rotate, scale, center, and ground all meshes cleanly
    norm_root = bpy.data.objects.new('NormRoot', None)
    bpy.context.collection.objects.link(norm_root)
    for o in meshes:
        o.parent = norm_root

    # 1. Rotate around Z so car faces -Y (Three.js +Z)
    norm_root.rotation_euler = Euler((0.0, 0.0, math.radians(job['rot_z_deg'])), 'XYZ')
    bpy.context.view_layer.update()

    # 2. Measure & scale uniformly to real-world target length along Y
    mins, maxs = world_bbox(meshes)
    cur_len = maxs.y - mins.y
    scale = job['target_len'] / max(0.001, cur_len)
    norm_root.scale = (scale, scale, scale)
    bpy.context.view_layer.update()

    # 3. Center X/Y at 0 and ground min Z = 0.0
    mins, maxs = world_bbox(meshes)
    cx = (mins.x + maxs.x) * 0.5
    cy = (mins.y + maxs.y) * 0.5
    norm_root.location = (-cx, -cy, -mins.z)
    bpy.context.view_layer.update()

    # Detach meshes keeping normalized world transforms & remove norm_root
    for o in meshes:
        detach_and_bake_world(o)
    bpy.data.objects.remove(norm_root, do_unlink=True)

    # 4. Rig 4 independent wheels (Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR) + BodyRoot
    body_root = bpy.data.objects.new('BodyRoot', None)
    bpy.context.collection.objects.link(body_root)

    spin_groups = {'FL': [], 'FR': [], 'RL': [], 'RR': []}
    caliper_groups = {'FL': [], 'FR': [], 'RL': [], 'RR': []}
    assigned = set()

    for o in meshes:
        nl = o.name.lower()
        if any(ex in nl for ex in job['wheel_exclude_keys']):
            continue
        is_spin = any(k in nl for k in job['wheel_spin_keys'])
        is_cal = (not is_spin) and any(k in nl for k in job['wheel_caliper_keys'])
        if not (is_spin or is_cal):
            continue

        c = obj_center(o)
        # Ensure mesh actually sits inside a wheel well quadrant (not a center chassis part)
        if abs(c.x) < 0.52 or abs(c.y) < 0.70 or c.z > 0.65:
            continue
        # Remember: Front is -Y, Left is -X (looking toward -Y: wait, in Three.js +Z forward, +X is LEFT, -X is RIGHT!
        # Either way both front wheels steer identically by +steer*0.42 around Y, so FL/FR just need y < 0!)
        quad = ('F' if c.y < 0 else 'R') + ('L' if c.x < 0 else 'R')
        if is_spin:
            spin_groups[quad].append(o)
        else:
            caliper_groups[quad].append(o)
        assigned.add(o)

    for quad in ('FL', 'FR', 'RL', 'RR'):
        s_objs = spin_groups[quad]
        c_objs = caliper_groups[quad]
        if not s_objs:
            print(f"  [WARN] No spinning wheel meshes matched for {job['id']} Wheel_{quad}")
            continue
        # Compute exact wheel center from the spinning tire/rim meshes
        w_min, w_max = world_bbox(s_objs)
        w_center = (w_min + w_max) * 0.5

        pivot = bpy.data.objects.new(f'Wheel_{quad}', None)
        pivot.location = w_center
        bpy.context.collection.objects.link(pivot)

        spin = bpy.data.objects.new(f'Wheel_{quad}_Spin', None)
        spin.parent = pivot
        bpy.context.collection.objects.link(spin)
        bpy.context.view_layer.update()

        for o in s_objs:
            reparent_keep_world(o, spin)
        for o in c_objs:
            reparent_keep_world(o, pivot)
        print(f"  Rigged Wheel_{quad} at ({w_center.x:.2f},{w_center.y:.2f},{w_center.z:.2f}) spin={len(s_objs)} cal={len(c_objs)}")

    # Parent all non-wheel meshes to BodyRoot (for smooth suspension pitch/roll)
    for o in meshes:
        if o not in assigned:
            reparent_keep_world(o, body_root)

    # 5. Polish PBR materials (clearcoat paint, emissive brake/headlights)
    polish_materials(job)

    # 6. Export Draco-compressed GLB for ultra-fast LAN loading!
    out_path = os.path.join(OUT_DIR, f"{job['id']}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,
        export_materials='EXPORT',
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
    )
    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"  [OK] Exported {out_path} ({size_mb:.2f} MB)")


for job in CAR_JOBS:
    process_car(job)
print("\n[Normalize] All 4 real supercars normalized & Draco-compressed successfully!")
