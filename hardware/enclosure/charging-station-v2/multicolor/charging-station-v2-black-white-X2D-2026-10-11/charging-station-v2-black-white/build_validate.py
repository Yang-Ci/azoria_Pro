"""Export prototype parts and audit their STL topology (Python + numpy).

Run: python build_validate.py --openscad <path to openscad.com or openscad>
No claim of physical, electrical, strength, or thermal validation.
"""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess
import sys

import numpy as np
from audit_rear import audit as audit_rear_features

ROOT = pathlib.Path(__file__).resolve().parent
PARTS = {
    'body': ('common/base.stl', 1),
    'rear': ('common/rear-panel.stl', 1),
    'ac_cover': ('common/ac-cable-cover.stl', 1),
    'retainer': ('common/reel-retainer.stl', 1),
    'screen_rear': ('common/screen-rear-v3.stl', 1),
    'lid_hinge': ('adjustable/top-hinge.stl', 1),
    'carrier': ('adjustable/screen-carrier.stl', 1),
    'charger_gauge': ('fit-first/charger-gauge.stl', 1),
    'reel_gauge': ('fit-first/reel-gauge.stl', 1),
    'hinge_gauge': ('fit-first/hinge-gauge.stl', 2),
    'screen_gauge': ('fit-first/screen-fit-v3.stl', 1),
}


def mesh_audit(path, expected_components):
    raw = path.read_bytes()
    count = int.from_bytes(raw[80:84], 'little')
    if len(raw) != 84 + count * 50:
        raise ValueError('Expected a binary STL')
    records = np.frombuffer(raw, offset=84, dtype=np.dtype([
        ('normal', '<f4', (3,)), ('vertices', '<f4', (3, 3)), ('attr', '<u2')]))
    triangles = records['vertices'].astype(np.float64)
    # STL stores float32 shared vertices; preserve exact values. Tolerance welding
    # can collapse legitimate CGAL sliver edges and incorrectly report nonmanifold.
    verts, indices = np.unique(triangles.reshape(-1, 3), axis=0, return_inverse=True)
    faces = indices.reshape(-1, 3)
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    unique_edges, edge_ids, edge_counts = np.unique(np.sort(edges, axis=1), axis=0,
                                                   return_inverse=True, return_counts=True)
    signs = np.where(edges[:, 0] < edges[:, 1], 1, -1)
    edge_direction_sum = np.bincount(edge_ids, weights=signs)
    parents = list(range(len(verts)))

    def find(a):
        while parents[a] != a:
            parents[a] = parents[parents[a]]
            a = parents[a]
        return a

    for a, b in unique_edges:
        a, b = find(int(a)), find(int(b))
        if a != b:
            parents[b] = a
    components = len({find(i) for i in range(len(verts))})
    cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    degenerate = int(np.sum(np.linalg.norm(cross, axis=1) == 0))
    volume = float(np.einsum('ij,ij->i', triangles[:, 0],
                            np.cross(triangles[:, 1], triangles[:, 2])).sum() / 6)
    minimum, maximum = verts.min(axis=0), verts.max(axis=0)
    boundary = int(np.sum(edge_counts == 1))
    nonmanifold = int(np.sum(edge_counts > 2))
    winding_errors = int(np.sum(edge_direction_sum != 0))
    passed = (boundary == nonmanifold == winding_errors == degenerate == 0
              and components == expected_components and volume > 0
              and minimum[2] >= -0.001 and np.isfinite(triangles).all())
    return {
        'file': str(path.relative_to(ROOT)), 'triangles': count,
        'bounds_mm': [minimum.tolist(), maximum.tolist()],
        'size_mm': (maximum - minimum).round(3).tolist(),
        'volume_mm3': round(volume, 3), 'components': components,
        'expected_components': expected_components, 'boundary_edges': boundary,
        'nonmanifold_edges': nonmanifold, 'inconsistent_edges': winding_errors,
        'degenerate_triangles': degenerate, 'sha256': hashlib.sha256(raw).hexdigest(),
        'passed': bool(passed),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--openscad', required=True)
    parser.add_argument('--workers', type=int, default=2)
    args = parser.parse_args()
    logdir = ROOT / 'validation'
    logdir.mkdir(exist_ok=True)

    def run_job(part, relpath, definitions=None):
        target = ROOT / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        # An empty OpenSCAD intersection does not overwrite an old file.
        if part in ('collision', 'movement_collision') and target.exists():
            target.unlink()
        command = [args.openscad, '--hardwarnings', '--export-format', 'binstl',
                   '-o', str(target), '-D', 'part="%s"' % part]
        for name, value in (definitions or {}).items():
            command += ['-D', '%s=%s' % (name, json.dumps(value))]
        command += [str(ROOT / ('screen-fit.scad' if part == 'screen_gauge' else 'workstation.scad'))]
        result = subprocess.run(command, capture_output=True, text=True, timeout=300)
        log = result.stdout + result.stderr
        (logdir / (target.stem + '.log')).write_text(log, encoding='utf-8')
        return target, result.returncode, log

    def export(part):
        relpath, expected = PARTS[part]
        path, code, log = run_job(part, relpath)
        if code != 0:
            raise RuntimeError('%s failed: %s' % (part, log))
        audit = mesh_audit(path, expected)
        print(json.dumps({'part': part, 'passed': audit['passed'],
                          'size': audit['size_mm'], 'components': audit['components']}), flush=True)
        return audit

    audits = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for audit in pool.map(export, PARTS):
            audits.append(audit)
    checks = []
    jobs = [('collision', 'hinge', a) for a in [0, 60, 75]]
    jobs += [('movement_collision', 'hinge', a) for a in [0, 15, 30, 45, 60, 75]]

    def check(job):
        mode, version, angle = job
        name = '%s-%s-%d' % (mode, version, angle)
        path, code, log = run_job(mode, 'validation/%s.stl' % name,
                                  {'version': version, 'angle': angle})
        empty = ('Current top level object is empty.' in log
                 and 'WARNING:' not in log and 'ERROR:' not in log
                 and code == 1 and not path.exists())
        result = {'check': name, 'no_intersection': empty, 'exit_code': code}
        print(json.dumps(result), flush=True)
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        checks = list(pool.map(check, jobs))
    rear_features = audit_rear_features()
    sources = ['workstation.scad', 'azoria-touch-v3-source.scad', 'screen-fit.scad',
               'build_validate.py', 'audit_rear.py']
    report = {'scope': 'Digital mesh topology, rear-cover features and nominal component envelope only',
              'units': 'mm', 'parts': audits, 'intersections': checks,
              'source_sha256': hashlib.sha256((ROOT/'workstation.scad').read_bytes()).hexdigest(),
              'source_hashes': {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
                                for name in sources},
              'rear_features': rear_features,
              'physical_fit_verified': False, 'thermal_verified': False,
              'hinge_strength_verified': False,
              'passed': all(a['passed'] for a in audits)
                        and all(c['no_intersection'] for c in checks)
                        and rear_features['passed']}
    (logdir / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                        encoding='utf-8')
    print('ALL DIGITAL CHECKS PASSED' if report['passed'] else 'CHECKS NEED REPAIR', flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
