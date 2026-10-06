"""Check critical rear-cover features in exported STL, not source text."""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent


def triangles(path):
    raw = path.read_bytes()
    count = int.from_bytes(raw[80:84], 'little')
    if len(raw) != 84 + 50 * count:
        raise ValueError('Expected binary STL: ' + str(path))
    return np.frombuffer(raw, offset=84, dtype=np.dtype([
        ('normal', '<f4', 3), ('vertices', '<f4', (3, 3)),
        ('attr', '<u2')]))['vertices'].astype(float)


def material_at(mesh, point, surface_z=0):
    faces = mesh[np.all(np.abs(mesh[:, :, 2] - surface_z) < 1e-5, axis=1), :, :2]
    cross = []
    for i in range(3):
        a, b = faces[:, i], faces[:, (i + 1) % 3]
        cross.append((b[:, 0] - a[:, 0]) * (point[1] - a[:, 1])
                     - (b[:, 1] - a[:, 1]) * (point[0] - a[:, 0]))
    cross = np.array(cross)
    return bool(np.any(np.all(cross >= -1e-7, axis=0)
                       | np.all(cross <= 1e-7, axis=0)))


def audit():
    rear = triangles(ROOT / 'common/rear-panel.stl')
    screen = triangles(ROOT / 'common/screen-rear-v3.stl')
    cover = triangles(ROOT / 'common/ac-cable-cover.stl')
    checks = {}
    # Rear print Y = 43.3 - installed Z. Test the former thin top bridge.
    checks['touch_notch_open_at_top'] = all(
        not material_at(rear, (x, y))
        for x in np.linspace(207.1, 218.9, 40)
        for y in np.linspace(0.05, 8.2, 20))
    checks['solid_3mm_bridge_below_touch_notch'] = all(
        material_at(rear, (x, y))
        for x in np.linspace(204.1, 221.9, 50)
        for y in np.linspace(8.4, 11.2, 12))
    checks['rear_holes_and_side_ligaments'] = all(
        not material_at(rear, (x, 43.3-z))
        and material_at(rear, (edge_x, 43.3-z))
        for x, edge_x in [(10, 6.5), (226, 229.5)] for z in [10, 37])
    checks['six_clearance_holes'] = all(
        not material_at(rear, (x, 43.3-z))
        for x in [10, 94, 226] for z in [10, 37])
    checks['six_countersunk_seats'] = all(
        material_at(rear, (x+2.4, 43.3-z))
        and not material_at(rear, (x+2.4, 43.3-z), 2.8)
        for x in [10, 94, 226] for z in [10, 37])
    checks['matching_service_cover_holes'] = all(
        not material_at(rear, (x, 43.3-z))
        and not material_at(cover, (x, 43-z))
        for x in [16, 81] for z in [6, 40])
    checks['screen_usb_opening_continuous_and_shifted'] = (
        all(not material_at(screen, (-40, y)) for y in np.linspace(5.79, 31.16, 200))
        and material_at(screen, (-40, 5.5))
        and material_at(screen, (-40, 31.5)))
    points = screen[np.all(np.abs(screen[:, :, 0]+34.455) < 0.001, axis=1)]
    checks['screen_usb_opening_length_25_39mm'] = np.allclose(
        [points[:, :, 1].min(), points[:, :, 1].max()], [5.78, 31.17], atol=0.001)
    report = {'scope': 'Exported rear-panel and screen-lid feature geometry',
              'checks': {k: bool(v) for k, v in checks.items()},
              'passed': bool(all(checks.values())), 'physical_fit_verified': False}
    (ROOT / 'validation/rear-features.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return report


if __name__ == '__main__':
    result = audit()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['passed'] else 1)
