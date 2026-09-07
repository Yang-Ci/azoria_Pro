Import("env")

from pathlib import Path


version_path = Path(env.subst("$PROJECT_DIR")) / "version.txt"
version = version_path.read_text().strip()
env.Append(CPPDEFINES=[("AZORIA_FIRMWARE_VERSION", f'\\"{version}\\"')])
