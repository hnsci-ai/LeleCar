import bpy
import bmesh
import math
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, '..', 'client', 'public', 'models'))
os.makedirs(OUT_DIR, exist_ok=True)

CAR_SPECS = [
    {
        'id': 'apex-gtr',
        'color': (0.74, 0.022, 0.04, 1.0),    # Rosso Corsa Metallic
        'accent': (0.06, 0.065, 0.075, 1.0),
        'caliper': (0.98, 0.74, 0.02, 1.0),   # Brembo Yellow
        'wing_h': 1.15,
        'wing_w': 1.94,
        'nose_drop': -0.02,
        'cabin_back': 0.0,
    },
    {
        'id': 'valkyrie-x',
        'color': (0.015, 0.30, 0.66, 1.0),    # Sapphire Blue Metallic
        'accent': (0.85, 0.88, 0.94, 1.0),
        'caliper': (0.0, 0.85, 1.0, 1.0),
        'wing_h': 1.06,
        'wing_w': 1.86,
        'nose_drop': -0.05,
        'cabin_back': 0.08,
    },
    {
        'id': 'phantom-rs',
        'color': (0.94, 0.52, 0.01, 1.0),     # McLaren Papaya Spark
        'accent': (0.05, 0.05, 0.06, 1.0),
        'caliper': (0.92, 0.05, 0.07, 1.0),
        'wing_h': 1.24,
        'wing_w': 2.04,
        'nose_drop': -0.03,
        'cabin_back': -0.02,
    },
    {
        'id': 'spectre-v12',
        'color': (0.16, 0.18, 0.22, 1.0),     # Grigio Titanio Metallic
        'accent': (0.0, 0.88, 0.65, 1.0),
        'caliper': (0.0, 0.92, 0.55, 1.0),
        'wing_h': 1.12,
        'wing_w': 1.92,
        'nose_drop': -0.06,
        'cabin_back': 0.06,
    },
]


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_pbr_mat(name, color, metallic=0.0, roughness=0.4, clearcoat=0.0, emission=None, emission_strength=1.0, alpha=1.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if 'Coat Weight' in bsdf.inputs:
        bsdf.inputs['Coat Weight'].default_value = clearcoat
        bsdf.inputs['Coat Roughness'].default_value = 0.03
    elif 'Clearcoat' in bsdf.inputs:
        bsdf.inputs['Clearcoat'].default_value = clearcoat
    if emission is not None:
        if 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = emission
        elif 'Emission' in bsdf.inputs:
            bsdf.inputs['Emission'].default_value = emission
        if 'Emission Strength' in bsdf.inputs:
            bsdf.inputs['Emission Strength'].default_value = emission_strength
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        mat.blend_method = 'BLEND'
    return mat


def set_smooth(obj):
    if obj.type != 'MESH':
        return
    for p in obj.data.polygons:
        p.use_smooth = True


def add_box(name, size, loc, rot=(0, 0, 0), mat=None, bevel=0.02, parent=None):
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
    set_smooth(obj)
    if parent:
        obj.parent = parent
    return obj


def create_tapered_splitter(name, mat, parent):
    """Curved tapered carbon front aerodynamic splitter hugging the lower nose."""
    mesh = bpy.data.meshes.new(f'{name}Mesh')
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()

    pts_top = [
        (-0.96, -1.78, 0.215),
        (-0.92, -2.06, 0.215),
        (-0.62, -2.26, 0.215),
        ( 0.00, -2.33, 0.215),
        ( 0.62, -2.26, 0.215),
        ( 0.92, -2.06, 0.215),
        ( 0.96, -1.78, 0.215),
    ]
    pts_bot = [(x, y, z - 0.045) for (x, y, z) in pts_top]
    vt = [bm.verts.new(p) for p in pts_top]
    vb = [bm.verts.new(p) for p in pts_bot]
    n = len(vt)
    bm.faces.new(vt)
    bm.faces.new(list(reversed(vb)))
    for i in range(n):
        inext = (i + 1) % n
        bm.faces.new((vt[i], vb[i], vb[inext], vt[inext]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj.data.materials.append(mat)
    mod = obj.modifiers.new(name='Bevel', type='BEVEL')
    mod.width = 0.012
    mod.segments = 2
    set_smooth(obj)
    obj.parent = parent
    return obj


def create_airfoil_wing(name, width, chord, loc, mat, parent):
    mesh = bpy.data.meshes.new(f'{name}Mesh')
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()

    profile = [
        (-0.50,  0.00),
        (-0.30,  0.042),
        ( 0.05,  0.036),
        ( 0.48, -0.025),
        ( 0.50, -0.042),
        ( 0.05, -0.015),
        (-0.30, -0.022),
    ]
    n_span = 9
    rings = []
    for s in range(n_span):
        u = (s / (n_span - 1)) * 2.0 - 1.0
        x = u * (width * 0.5)
        y_sweep = abs(u) * 0.08
        z_arch = (1.0 - u * u) * 0.032
        ring = [bm.verts.new((x, py * chord + y_sweep, pz * chord + z_arch)) for (py, pz) in profile]
        rings.append(ring)

    np = len(profile)
    for i in range(n_span - 1):
        for j in range(np):
            jn = (j + 1) % np
            bm.faces.new((rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj.location = loc
    obj.data.materials.append(mat)
    sub = obj.modifiers.new(name='Subsurf', type='SUBSURF')
    sub.levels = 1
    sub.render_levels = 1
    set_smooth(obj)
    obj.parent = parent
    return obj


def create_gt_body(spec, paint_mat):
    """High-resolution Level-3 Catmull-Clark GT3 widebody monocoque with sculpted nose & rear fenders."""
    mesh = bpy.data.meshes.new('GTBodyMesh')
    obj = bpy.data.objects.new('CarBody', mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    nd = spec['nose_drop']
    cb = spec['cabin_back']

    # Extra tight stations near front bumper & rear tail so Subsurf keeps crisp GT3 edges!
    stations = [
        (-2.38, 0.66, 0.21, 0.78, 0.34 + nd, 0.72, 0.44 + nd, 0.46, 0.46 + nd),
        (-2.22, 0.84, 0.20, 0.96, 0.42 + nd, 0.90, 0.56 + nd, 0.60, 0.58 + nd),
        (-1.86, 0.94, 0.20, 1.05, 0.50 + nd, 0.98, 0.69 + nd, 0.66, 0.69 + nd),
        (-1.35, 0.98, 0.20, 1.09, 0.56,      1.00, 0.81,      0.68, 0.76),
        (-0.78, 0.90, 0.20, 0.97, 0.50,      0.94, 0.78,      0.70, 0.80),
        (-0.08 + cb, 0.88, 0.20, 0.94, 0.50, 0.94, 0.81,      0.70, 0.84),
        ( 0.64 + cb, 0.95, 0.21, 1.07, 0.57, 1.03, 0.89,      0.74, 0.89),
        ( 1.36, 1.01, 0.22, 1.13, 0.61,      1.07, 0.93,      0.78, 0.91),
        ( 2.02, 0.95, 0.27, 1.06, 0.63,      1.01, 0.90,      0.75, 0.88),
        ( 2.26, 0.88, 0.33, 0.98, 0.64,      0.94, 0.85,      0.72, 0.84),
    ]

    rings = []
    for (y, ws, zs, wa, za, wsh, zsh, wd, zd) in stations:
        pts = [
            (-ws,  y, zs),
            ( ws,  y, zs),
            ( wa,  y, za),
            ( wsh, y, zsh),
            ( wd,  y, zd),
            ( 0.0, y, zd + 0.015),
            (-wd,  y, zd),
            (-wsh, y, zsh),
            (-wa,  y, za),
        ]
        rings.append([bm.verts.new(p) for p in pts])

    n = len(rings[0])
    for i in range(len(rings) - 1):
        r1, r2 = rings[i], rings[i + 1]
        for j in range(n):
            jn = (j + 1) % n
            bm.faces.new((r1[j], r1[jn], r2[jn], r2[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    obj.data.materials.append(paint_mat)
    sub = obj.modifiers.new(name='Subsurf', type='SUBSURF')
    sub.levels = 3
    sub.render_levels = 3
    set_smooth(obj)
    return obj


def create_seamless_canopy(spec, glass_mat, paint_mat, interior_mat, parent):
    """
    Single seamless Level-3 subdivided coupe greenhouse where the top roof arch
    uses BodyPaint material (slot 1) and the sloped windshield & side windows
    use tinted Glass material (slot 0) — ZERO floating roof box!
    """
    cb = spec['cabin_back']
    mesh = bpy.data.meshes.new('CanopyMesh')
    obj = bpy.data.objects.new('Canopy', mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(glass_mat)   # slot 0
    obj.data.materials.append(paint_mat)   # slot 1

    bm = bmesh.new()
    stations = [
        (-1.12 + cb, 0.68, 0.74, 0.54, 0.80),  # windshield base
        (-0.52 + cb, 0.72, 0.80, 0.56, 1.15),  # windshield top / roof front
        ( 0.22 + cb, 0.70, 0.83, 0.54, 1.19),  # roof peak / B-pillar
        ( 0.88 + cb, 0.64, 0.85, 0.44, 1.08),  # rear fastback C-pillar
        ( 1.56 + cb, 0.52, 0.84, 0.34, 0.89),  # engine deck tail
    ]
    rings = []
    for (y, wb, zb, wt, zt) in stations:
        pts = [(-wb, y, zb), (wb, y, zb), (wt, y, zt), (0.0, y, zt + 0.035), (-wt, y, zt)]
        rings.append([bm.verts.new(p) for p in pts])

    n = len(rings[0])
    for i in range(len(rings) - 1):
        for j in range(n):
            jn = (j + 1) % n
            f = bm.faces.new((rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j]))
            # Top roof panels (indices 2 and 3 in the ring) on stations 1..2 -> painted body roof!
            if i in (1, 2) and j in (2, 3):
                f.material_index = 1
            else:
                f.material_index = 0
    bm.faces.new(list(reversed(rings[0]))).material_index = 0
    bm.faces.new(rings[-1]).material_index = 0

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    sub = obj.modifiers.new(name='Subsurf', type='SUBSURF')
    sub.levels = 3
    sub.render_levels = 3
    set_smooth(obj)
    obj.parent = parent

    # Subtle interior racing bucket seats visible through tinted windshield
    for side in (-0.27, 0.27):
        add_box(f'Seat_{side}', (0.32, 0.14, 0.44), (side, 0.18 + cb, 0.86), rot=(0.24, 0, 0), mat=interior_mat, bevel=0.03, parent=parent)

    # Rear engine bay carbon louvers flush along the fastback deck
    for i in range(5):
        ly = 0.98 + cb + i * 0.17
        lz = 0.97 - i * 0.026
        add_box(f'Louver_{i}', (0.76 - i * 0.04, 0.10, 0.024), (0, ly, lz), rot=(-0.22, 0, 0), mat=interior_mat, bevel=0.006, parent=parent)


def create_hollow_wheel(name, loc, radius, width, tire_mat, rim_mat, lip_mat, rotor_mat, caliper_mat, is_right):
    """
    Photorealistic hollow forged GT3 wheel:
    Open hollow rim lip -> visible 10-spoke Y-forged star -> visible cross-drilled brake rotor & Brembo caliper!
    """
    pivot = bpy.data.objects.new(name, None)
    pivot.location = loc
    bpy.context.collection.objects.link(pivot)

    spin = bpy.data.objects.new(f'{name}_Spin', None)
    spin.parent = pivot
    bpy.context.collection.objects.link(spin)

    out_sign = 1 if is_right else -1

    # 1. Hollow Tire (Outer rubber sidewall torus + tread band, NO solid end-cap hiding the rim!)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=width, end_fill_type='NOTHING', location=(0, 0, 0), rotation=(0, math.pi / 2, 0))
    tread = bpy.context.active_object
    tread.name = f'{name}_Tread'
    sol = tread.modifiers.new(name='Solidify', type='SOLIDIFY')
    sol.thickness = radius * 0.28
    sol.offset = -1.0
    bev = tread.modifiers.new(name='Bevel', type='BEVEL')
    bev.width = 0.035
    bev.segments = 2
    tread.data.materials.append(tire_mat)
    set_smooth(tread)
    tread.parent = spin

    # 2. Hollow Deep-Dish Forged Rim Barrel (open outer face so spokes & brake rotor are clearly visible!)
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=radius * 0.73, depth=width * 0.92, end_fill_type='NOTHING', location=(0, 0, 0), rotation=(0, math.pi / 2, 0))
    barrel = bpy.context.active_object
    barrel.name = f'{name}_Barrel'
    bsol = barrel.modifiers.new(name='Solidify', type='SOLIDIFY')
    bsol.thickness = 0.03
    barrel.data.materials.append(rim_mat)
    set_smooth(barrel)
    barrel.parent = spin

    # Inner dark wheel backing disc pushed DEEP inside the barrel (behind brake rotor)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius * 0.71, depth=0.03, location=(-out_sign * width * 0.34, 0, 0), rotation=(0, math.pi / 2, 0))
    back_plate = bpy.context.active_object
    back_plate.name = f'{name}_BackPlate'
    back_plate.data.materials.append(rim_mat)
    back_plate.parent = spin

    # 3. Machined Diamond-Cut Outer Rim Lip Ring
    bpy.ops.mesh.primitive_torus_add(
        major_radius=radius * 0.72,
        minor_radius=0.022,
        major_segments=28,
        minor_segments=10,
        location=(out_sign * width * 0.44, 0, 0),
        rotation=(0, math.pi / 2, 0)
    )
    lip = bpy.context.active_object
    lip.name = f'{name}_Lip'
    lip.data.materials.append(lip_mat)
    set_smooth(lip)
    lip.parent = spin

    # 4. Bright Metallic Cross-Drilled Brake Rotor Disc (clearly visible behind the 10 spokes!)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius * 0.56, depth=0.035, location=(out_sign * width * 0.08, 0, 0), rotation=(0, math.pi / 2, 0))
    rotor = bpy.context.active_object
    rotor.name = f'{name}_Rotor'
    rotor.data.materials.append(rotor_mat)
    set_smooth(rotor)
    rotor.parent = spin

    # 5. Sculpted 10 Y-Forged Spokes (slightly concaved inward toward center lock!)
    out_x = out_sign * (width * 0.34)
    for s in range(5):
        base_ang = (s / 5.0) * math.pi * 2
        for split in (-0.15, 0.15):
            add_box(
                f'{name}_Spoke_{s}_{split}',
                (0.036, 0.030, radius * 1.36),
                (out_x, 0, 0),
                rot=(base_ang + split, 0, 0),
                mat=lip_mat,
                bevel=0.004,
                parent=spin
            )

    # Center-Lock Motorsport Nut
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.072, depth=0.08, location=(out_sign * width * 0.30, 0, 0), rotation=(0, math.pi / 2, 0))
    hub = bpy.context.active_object
    hub.data.materials.append(caliper_mat)
    hub.parent = spin

    # 6. High-Contrast Brembo Brake Caliper (stationary on pivot, visible through spokes!)
    add_box(
        f'{name}_Caliper',
        (0.09, 0.14, 0.24),
        (out_sign * width * 0.16, 0.17, 0.04),
        mat=caliper_mat,
        bevel=0.014,
        parent=pivot
    )
    return pivot


def build_and_export_car(spec):
    clear_scene()

    paint_mat = make_pbr_mat('BodyPaint', spec['color'], metallic=0.88, roughness=0.10, clearcoat=1.0)
    carbon_mat = make_pbr_mat('Carbon', (0.03, 0.032, 0.038, 1.0), metallic=0.28, roughness=0.26, clearcoat=0.8)
    grille_mat = make_pbr_mat('GrilleBlack', (0.012, 0.013, 0.016, 1.0), metallic=0.15, roughness=0.68)
    glass_mat = make_pbr_mat('Glass', (0.02, 0.03, 0.05, 1.0), metallic=0.12, roughness=0.025, clearcoat=1.0, alpha=0.80)
    tire_mat = make_pbr_mat('Tire', (0.024, 0.024, 0.027, 1.0), metallic=0.04, roughness=0.84)
    rim_mat = make_pbr_mat('ForgedGunmetal', (0.14, 0.16, 0.20, 1.0), metallic=0.90, roughness=0.24)
    lip_mat = make_pbr_mat('MachinedAlloy', (0.78, 0.81, 0.86, 1.0), metallic=0.96, roughness=0.14)
    rotor_mat = make_pbr_mat('BrakeRotor', (0.68, 0.70, 0.74, 1.0), metallic=0.95, roughness=0.26)
    caliper_mat = make_pbr_mat('Caliper', spec['caliper'], metallic=0.45, roughness=0.20, clearcoat=0.85)
    exhaust_mat = make_pbr_mat('TitaniumExhaust', (0.68, 0.72, 0.80, 1.0), metallic=0.98, roughness=0.12)
    plate_mat = make_pbr_mat('LicensePlate', (0.86, 0.88, 0.92, 1.0), metallic=0.1, roughness=0.42)

    headlight_mat = make_pbr_mat('HeadlightLED', (0.96, 0.98, 1.0, 1.0), emission=(0.96, 0.98, 1.0, 1.0), emission_strength=6.5)
    brake_mat = make_pbr_mat('BrakeLight', (0.95, 0.02, 0.04, 1.0), emission=(1.0, 0.03, 0.06, 1.0), emission_strength=3.8)

    body_root = bpy.data.objects.new('BodyRoot', None)
    bpy.context.collection.objects.link(body_root)

    # 1. Level-3 Subsurf GT3 Monocoque & Seamless Multi-Material Coupe Canopy
    body = create_gt_body(spec, paint_mat)
    body.parent = body_root
    create_seamless_canopy(spec, glass_mat, paint_mat, carbon_mat, body_root)

    # 2. Tapered Flush Front Splitter, Recessed Air-Dam Grille & Side Aero
    create_tapered_splitter('FrontSplitter', carbon_mat, body_root)
    add_box('FrontGrille', (1.16, 0.14, 0.17), (0, -2.14, 0.29), mat=grille_mat, bevel=0.015, parent=body_root)

    for side in (-1, 1):
        add_box(f'FrontCanard_{side}', (0.13, 0.24, 0.026), (side * 0.94, -1.94, 0.30), rot=(0.14, side * 0.22, -side * 0.18), mat=carbon_mat, bevel=0.005, parent=body_root)
        add_box(f'SideSkirt_{side}', (0.14, 2.18, 0.075), (side * 0.96, 0.0, 0.20), mat=carbon_mat, bevel=0.012, parent=body_root)
        add_box(f'SideIntake_{side}', (0.12, 0.62, 0.32), (side * 0.96, 0.42, 0.56), mat=grille_mat, bevel=0.015, parent=body_root)
        add_box(f'MirrorArm_{side}', (0.14, 0.04, 0.035), (side * 0.78, -0.54, 0.88), rot=(0, -side * 0.24, 0), mat=carbon_mat, bevel=0.008, parent=body_root)
        add_box(f'MirrorCap_{side}', (0.16, 0.11, 0.07), (side * 0.89, -0.52, 0.92), rot=(0, 0, side * 0.22), mat=paint_mat, bevel=0.022, parent=body_root)

    # 3. Flush Angled Matrix LED Headlights integrated cleanly into the sculpted front fenders!
    for side in (-1, 1):
        add_box(
            f'HeadlightHousing_{side}',
            (0.38, 0.26, 0.085),
            (side * 0.64, -1.93, 0.57 + spec['nose_drop']),
            rot=(0.30, side * 0.10, -side * 0.34),
            mat=grille_mat,
            bevel=0.018,
            parent=body_root
        )
        add_box(
            f'HeadlightDRL_{side}',
            (0.34, 0.045, 0.034),
            (side * 0.66, -2.02, 0.55 + spec['nose_drop']),
            rot=(0.24, side * 0.10, -side * 0.34),
            mat=headlight_mat,
            bevel=0.008,
            parent=body_root
        )

    # 4. Recessed Rear Carbon Fascia + Multi-Blade OLED Taillights + FIA Rain Light
    add_box('RearFasciaGrille', (1.66, 0.12, 0.32), (0, 2.22, 0.64), mat=grille_mat, bevel=0.018, parent=body_root)
    add_box('RearPlate', (0.44, 0.04, 0.12), (0, 2.28, 0.54), mat=plate_mat, bevel=0.006, parent=body_root)

    for side in (-1, 1):
        add_box(f'BrakeLight_Outer_{side}', (0.46, 0.07, 0.078), (side * 0.62, 2.26, 0.74), mat=brake_mat, bevel=0.014, parent=body_root)
        add_box(f'BrakeLight_Lower_{side}', (0.35, 0.06, 0.036), (side * 0.60, 2.27, 0.64), mat=brake_mat, bevel=0.008, parent=body_root)
    add_box('BrakeLight_Bridge', (1.40, 0.05, 0.022), (0, 2.26, 0.76), mat=brake_mat, bevel=0.005, parent=body_root)
    add_box('BrakeLight_RainLED', (0.10, 0.06, 0.10), (0, 2.34, 0.28), mat=brake_mat, bevel=0.012, parent=body_root)

    # Rear Diffuser + Quad Titanium Exhausts
    add_box('RearDiffuser', (1.74, 0.40, 0.21), (0, 2.16, 0.27), mat=carbon_mat, bevel=0.014, parent=body_root)
    for fx in (-0.72, -0.45, -0.18, 0.18, 0.45, 0.72):
        add_box(f'DiffuserFin_{fx}', (0.028, 0.43, 0.19), (fx, 2.20, 0.24), mat=carbon_mat, bevel=0.005, parent=body_root)

    for sx in (-0.42, -0.26, 0.26, 0.42):
        bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=0.062, depth=0.22, location=(sx, 2.28, 0.34), rotation=(math.pi / 2, 0, 0))
        pipe = bpy.context.active_object
        pipe.name = f'Exhaust_{sx}'
        pipe.data.materials.append(exhaust_mat)
        set_smooth(pipe)
        pipe.parent = body_root

    # 5. Cambered Airfoil GT3 Wing
    wh = spec['wing_h']
    ww = spec['wing_w']
    create_airfoil_wing('GTWing', ww, 0.36, (0, 2.10, wh), carbon_mat, body_root)
    for side in (-1, 1):
        add_box(f'WingStrut_{side}', (0.04, 0.17, wh - 0.80), (side * 0.44, 2.02, (wh + 0.80) * 0.5), rot=(-0.18, 0, 0), mat=carbon_mat, bevel=0.008, parent=body_root)
        add_box(f'WingEndplate_{side}', (0.032, 0.46, 0.25), (side * (ww * 0.5), 2.14, wh - 0.02), mat=paint_mat, bevel=0.008, parent=body_root)

    # 6. Four Hollow Forged 10-Spoke GT3 Wheels (visible rotors & Brembo calipers!)
    create_hollow_wheel('Wheel_FL', (-0.98, -1.34, 0.39), 0.39, 0.29, tire_mat, rim_mat, lip_mat, rotor_mat, caliper_mat, is_right=False)
    create_hollow_wheel('Wheel_FR', ( 0.98, -1.34, 0.39), 0.39, 0.29, tire_mat, rim_mat, lip_mat, rotor_mat, caliper_mat, is_right=True)
    create_hollow_wheel('Wheel_RL', (-1.02,  1.32, 0.42), 0.42, 0.35, tire_mat, rim_mat, lip_mat, rotor_mat, caliper_mat, is_right=False)
    create_hollow_wheel('Wheel_RR', ( 1.02,  1.32, 0.42), 0.42, 0.35, tire_mat, rim_mat, lip_mat, rotor_mat, caliper_mat, is_right=True)

    out_path = os.path.join(OUT_DIR, f"{spec['id']}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT'
    )
    print(f'[Blender] Exported Perfected Showroom GT3 {out_path}')


for spec in CAR_SPECS:
    build_and_export_car(spec)
print('[Blender] All 4 Perfected GT3 supercars exported!')
