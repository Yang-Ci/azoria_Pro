"""Export and check the two-material V2 derivative; package unsliced geometry.

Python 3 + NumPy + manifold3d + OpenSCAD. No printer profile or G-code is generated.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
from build_validate import mesh_audit

NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
ET.register_namespace("", NS)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mesh(path):
    raw = path.read_bytes()
    records = np.frombuffer(raw, offset=84, dtype=np.dtype([
        ('normal', '<f4', (3,)), ('vertices', '<f4', (3, 3)), ('attr', '<u2')]))
    vertices, ids = np.unique(records['vertices'].reshape(-1, 3), axis=0, return_inverse=True)
    return vertices, ids.reshape(-1, 3)


def retriangulate(path):
    """Remove CGAL collinear triangles without changing the float32 vertices."""
    import manifold3d
    vertices, faces = mesh(path)
    solid = manifold3d.Manifold(manifold3d.Mesh(vertices.astype(np.float32), faces.astype(np.uint32)))
    assert solid.status() == manifold3d.Error.NoError
    result = solid.to_mesh()
    repaired_vertices = result.vert_properties[:, :3]
    assert np.array_equal(np.unique(vertices, axis=0), np.unique(repaired_vertices, axis=0))
    triangles = repaired_vertices[result.tri_verts]
    records = np.zeros(len(triangles), dtype=np.dtype([
        ('normal', '<f4', (3,)), ('vertices', '<f4', (3, 3)), ('attr', '<u2')]))
    records['vertices'] = triangles
    normals = np.cross(triangles[:, 1].astype(float)-triangles[:, 0],
                       triangles[:, 2].astype(float)-triangles[:, 0])
    length = np.linalg.norm(normals, axis=1)
    assert (length > 0).all()
    records['normal'] = normals / length[:, None]
    path.write_bytes(b'AZORIA collinear-face retriangulation'.ljust(80, b' ') +
                     len(triangles).to_bytes(4, 'little') + records.tobytes())


def actual_overlap(black, white):
    import manifold3d
    def solid(path):
        vertices, faces = mesh(path)
        result = manifold3d.Manifold(manifold3d.Mesh(vertices.astype(np.float32), faces.astype(np.uint32)))
        assert result.status() == manifold3d.Error.NoError
        return result
    result = solid(black) ^ solid(white)
    assert result.status() == manifold3d.Error.NoError
    # Independent STL float32 rounding can create zero-thickness contact faces
    # or submicron overlaps; reject any overlap exceeding 0.001 mm^3.
    assert abs(result.volume()) < 0.001
    return {'check': black.stem+'_actual_stl_overlap', 'method': 'Manifold solid intersection',
            'overlap_volume_mm3': max(0.0, result.volume()),
            'float32_volume_tolerance_mm3': 0.001, 'passed': True}


def make_3mf(path, black, white, rotate=False):
    def sub(parent, tag, **attrs):
        return ET.SubElement(parent, '{%s}%s' % (NS, tag), {k: str(v) for k, v in attrs.items()})
    model = ET.Element('{%s}model' % NS, {'unit': 'millimeter', '{http://www.w3.org/XML/1998/namespace}lang': 'en-US'})
    sub(model, 'metadata', name='Title').text = path.stem
    sub(model, 'metadata', name='BambuStudio:3mfVersion').text = '1'
    resources = sub(model, 'resources')
    materials = sub(resources, 'basematerials', id=4)
    sub(materials, 'base', name='Black shell', displaycolor='#101216FF')
    sub(materials, 'base', name='White lettering', displaycolor='#F5F5F0FF')
    for oid, source, color_id in [(1, black, 0), (2, white, 1)]:
        obj = sub(resources, 'object', id=oid, type='model', name=source.stem, pid=4, pindex=color_id)
        vertices, faces = mesh(source)
        m = sub(obj, 'mesh')
        v = sub(m, 'vertices')
        for x, y, z in vertices:
            sub(v, 'vertex', x=format(float(x), '.9g'), y=format(float(y), '.9g'), z=format(float(z), '.9g'))
        t = sub(m, 'triangles')
        for a, b, c in faces:
            sub(t, 'triangle', v1=a, v2=b, v3=c)
    group = sub(resources, 'object', id=3, type='model', name=path.stem)
    components = sub(group, 'components')
    sub(components, 'component', objectid=1)
    sub(components, 'component', objectid=2)
    build = sub(model, 'build')
    # 236 mm dimension runs along Y: dual-nozzle X limit is 235.5 mm.
    transform = '0 1 0 -1 0 0 0 0 1 188 10 0' if rotate else '1 0 0 0 1 0 0 0 1 20 20 0'
    sub(build, 'item', objectid=3, transform=transform)
    config = ET.Element('config')
    obj = ET.SubElement(config, 'object', id='3')
    ET.SubElement(obj, 'metadata', key='name', value=path.stem)
    ET.SubElement(obj, 'metadata', key='extruder', value='1')
    for oid, name, extruder in [(1, 'Black shell', 1), (2, 'White lettering', 2)]:
        part = ET.SubElement(obj, 'part', id=str(oid), subtype='normal_part')
        ET.SubElement(part, 'metadata', key='name', value=name)
        ET.SubElement(part, 'metadata', key='extruder', value=str(extruder))
    content_types = '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
<Default Extension="config" ContentType="application/xml"/></Types>'''
    rels = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rel0" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>'''
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', content_types)
        archive.writestr('_rels/.rels', rels)
        archive.writestr('3D/3dmodel.model', ET.tostring(model, encoding='utf-8', xml_declaration=True))
        archive.writestr('Metadata/model_settings.config', ET.tostring(config, encoding='utf-8', xml_declaration=True))
    # Read it back: keep both parts aligned, preserve exact meshes and assignments.
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        readback = ET.fromstring(archive.read('3D/3dmodel.model'))
        q = lambda name: '{%s}%s' % (NS, name)
        objects = readback.find(q('resources')).findall(q('object'))
        for obj, source in zip(objects[:2], [black, white]):
            vertices, faces = mesh(source)
            m = obj.find(q('mesh'))
            actual_v = np.array([[float(p.attrib[k]) for k in ('x', 'y', 'z')] for p in m.find(q('vertices'))])
            actual_f = np.array([[int(p.attrib[k]) for k in ('v1', 'v2', 'v3')] for p in m.find(q('triangles'))])
            assert np.allclose(actual_v, vertices, atol=0.000001, rtol=0)
            assert np.array_equal(actual_f, faces)
        assert [c.attrib['objectid'] for c in objects[2].find(q('components'))] == ['1', '2']
        item = readback.find(q('build'))[0]
        values = np.array([float(v) for v in item.attrib['transform'].split()])
        v, _ = mesh(black)
        positioned = v @ values[:9].reshape(3, 3) + values[9:]
        minimum, maximum = positioned.min(0), positioned.max(0)
        assert (minimum >= -0.001).all()
        assert (maximum <= [235.5, 256, 256]).all()
        meta = ET.fromstring(archive.read('Metadata/model_settings.config'))
        assert [p.find("metadata[@key='extruder']").attrib['value'] for p in meta.findall('object/part')] == ['1', '2']
    return {'file': path.name, 'part_count': 2, 'rotated_90_degrees': rotate,
            'positioned_bounds_mm': [minimum.tolist(), maximum.tolist()], 'passed': True, 'sha256': sha(path)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--openscad', required=True)
    args = parser.parse_args()
    logdir = HERE / 'validation'
    logdir.mkdir(exist_ok=True)

    def run(part, target):
        target.unlink(missing_ok=True)
        result = subprocess.run([args.openscad, '--hardwarnings', '--export-format', 'binstl',
                                 '-o', str(target), '-D', 'part="%s"' % part,
                                 str(HERE/'black-white.scad')], capture_output=True, text=True, timeout=300)
        log = result.stdout + result.stderr
        (logdir/(part+'.log')).write_text(log)
        return result.returncode, log

    jobs = [('black', 'base-black.stl', 1), ('white', 'base-white-text.stl', 14),
            ('coupon_black', 'coupon-black.stl', 1), ('coupon_white', 'coupon-white.stl', 14)]
    def export(job):
        part, name, count = job
        path = HERE/name
        code, log = run(part, path)
        if code:
            raise RuntimeError(log)
        audit = mesh_audit(path, count)
        if audit['degenerate_triangles']:
            before = audit
            retriangulate(path)
            audit = mesh_audit(path, count)
            assert abs(audit['volume_mm3']-before['volume_mm3']) < 0.001
            audit['retriangulation'] = {'removed_zero_area_triangles': before['degenerate_triangles'],
                                       'identical_vertex_set': True, 'volume_preserved': True}
        print(json.dumps({'part': part, 'passed': audit['passed'], 'components': audit['components']}), flush=True)
        assert audit['passed'], audit
        return audit
    with ThreadPoolExecutor(max_workers=2) as pool:
        audits = list(pool.map(export, jobs))
    def empty_check(part):
        path = logdir/(part+'.stl')
        code, log = run(part, path)
        passed = code == 1 and 'Current top level object is empty.' in log and 'WARNING:' not in log and 'ERROR:' not in log and not path.exists()
        print(json.dumps({'check': part, 'passed': passed}), flush=True)
        assert passed, log
        return {'check': part, 'passed': passed}
    with ThreadPoolExecutor(max_workers=2) as pool:
        checks = list(pool.map(empty_check, ['overlap', 'missing', 'outside',
                                            'coupon_missing', 'coupon_outside']))
    checks += [actual_overlap(HERE/'base-black.stl', HERE/'base-white-text.stl'),
               actual_overlap(HERE/'coupon-black.stl', HERE/'coupon-white.stl')]
    models = [make_3mf(HERE/'base-black-white-X2D.3mf', HERE/'base-black.stl', HERE/'base-white-text.stl', True),
              make_3mf(HERE/'lettering-test.3mf', HERE/'coupon-black.stl', HERE/'coupon-white.stl')]
    # Verify the unchanged pieces against the existing V2 digital report.
    original = json.loads((ROOT/'validation/report.json').read_text())
    reused = []
    assert original['passed']
    for record in original['parts']:
        relative = record['file'].replace('\\', '/')
        source = ROOT/relative
        assert sha(source) == record['sha256'], source
        if relative != 'common/base.stl':
            reused.append(relative)
    report = {'revision': '2026-10-11', 'units': 'mm', 'parts': audits, 'partition_checks': checks,
              'models_3mf': models, 'reused_validated_parts': reused,
              'source_hashes': {str(p.relative_to(ROOT)): sha(p) for p in
                                [HERE/'black-white.scad', HERE/'build_black_white.py', ROOT/'workstation.scad', ROOT/'azoria-touch-v3-source.scad']},
              'slicer_verified': False, 'physical_print_verified': False, 'passed': True}
    (logdir/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    # Render the actual exported two-material meshes to avoid OpenCSG face artifacts.
    preview = '''use <../workstation.scad>
color([0.085,0.09,0.10]) import("base-black.stl");
// Visual-only offset avoids OpenCSG z-buffer artifacts on flush materials.
// Exported STL / 3MF coordinates remain flush and unmodified.
color([0.96,0.96,0.94]) translate([0,-0.03,0]) import("base-white-text.stl");
color([0.085,0.09,0.10]) {
 translate([0,0,43.6]) hinged_deck();
 rear_panel(); ac_cover(); module_retainer();
 screen_pose(60) { carrier_up(); screen_cover_up(); }
}
proxy_components();
'''
    (HERE/'preview.scad').write_text(preview)
    result = subprocess.run([args.openscad, '-o', str(HERE/'black-white-preview.png'),
                             '--imgsize=1400,900', '--viewall', '--autocenter',
                             '--camera=0,0,0,68,0,25,500', str(HERE/'preview.scad')], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr
    target = HERE/'charging-station-v2-black-white-X2D-2026-10-11.zip'
    sources = ['workstation.scad', 'azoria-touch-v3-source.scad', 'screen-fit.scad', 'README.md',
               'build_validate.py', 'audit_rear.py', 'validation/report.json',
               'preview/cad-60.png', 'preview/concept.png', 'preview/rear-review-2026-10-06.png']
    local = ['black-white.scad', 'build_black_white.py', 'preview.scad', 'README.md',
             'base-black-white-X2D.3mf', 'lettering-test.3mf', 'base-black.stl', 'base-white-text.stl',
             'coupon-black.stl', 'coupon-white.stl', 'black-white-preview.png', 'validation/report.json']
    paths = [ROOT/p for p in reused+sources] + [HERE/p for p in local]
    manifest = {str(p.relative_to(ROOT)): sha(p) for p in paths}
    (logdir/'manifest.json').write_text(json.dumps(manifest, indent=2))
    paths.append(logdir/'manifest.json')
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in paths:
            archive.write(path, 'charging-station-v2-black-white/'+str(path.relative_to(ROOT)))
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        for path in paths:
            assert hashlib.sha256(archive.read('charging-station-v2-black-white/'+str(path.relative_to(ROOT)))).hexdigest() == sha(path)
    print('VALIDATED AND PACKAGED: '+str(target), flush=True)


if __name__ == '__main__':
    main()
