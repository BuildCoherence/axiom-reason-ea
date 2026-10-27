import sys
from pathlib import Path


def check(paths):
    for path in paths:
        data = path.read_bytes()
        if any(byte > 127 for byte in data):
            raise ValueError(f"{path}: installer must be ASCII without a BOM")


if __name__ == "__main__":
    paths = [Path(arg) for arg in sys.argv[1:]] or [
        Path(__file__).with_name("install.sh"),
        Path(__file__).with_name("install.ps1"),
    ]
    check(paths)
    print("Installer scripts are ASCII without a BOM.")
