"""Package only validated current print files, sources, docs and previews."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
TARGET = ROOT.parent / 'cuktech-desktop-station-v2-2026-10-06.zip'
PREFIX = 'cuktech-workstation-compact-v2'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    report = json.loads((ROOT / 'validation/report.json').read_text(encoding='utf-8'))
    assert report['passed'], 'CAD validation has not passed'
    for name, expected in report['source_hashes'].items():
        assert digest(ROOT / name) == expected, 'Rebuild changed source: ' + name
    for part in report['parts']:
        assert digest(ROOT / part['file']) == part['sha256'], 'Rebuild changed STL: ' + part['file']
    files = sorted(p for p in ROOT.rglob('*') if p.is_file()
                   and p.suffix in {'.md', '.scad', '.py', '.stl', '.png', '.json'}
                   and '__pycache__' not in p.parts and p.name != 'manifest.json')
    manifest = {'package': PREFIX, 'revision': '2026-10-06',
                'units': 'mm', 'physical_fit_verified': False,
                'files': {p.relative_to(ROOT).as_posix(): digest(p) for p in files}}
    manifest_path = ROOT / 'validation/manifest.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    files.append(manifest_path)
    with zipfile.ZipFile(TARGET, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, PREFIX + '/' + path.relative_to(ROOT).as_posix())
    with zipfile.ZipFile(TARGET) as archive:
        assert archive.testzip() is None
        for path in files:
            name = PREFIX + '/' + path.relative_to(ROOT).as_posix()
            assert hashlib.sha256(archive.read(name)).hexdigest() == digest(path)
        stls = [name for name in archive.namelist() if name.endswith('.stl')]
        assert len(stls) == 11, stls
    print(json.dumps({'zip': str(TARGET), 'stl_count': len(stls),
                      'files': len(files), 'sha256': digest(TARGET)}, indent=2))


if __name__ == '__main__':
    main()
