#!/usr/bin/env python3
"""Check release executables against the 1.x extractor's compatibility limit."""

import argparse
from pathlib import Path

MAX_EXECUTABLE_BYTES = 50 * 1024 * 1024
EXECUTABLE_NAMES = {"axm", "axm.exe", "axm-staging", "axm-staging.exe"}


def check_sizes(root: Path, expected: int) -> None:
    binaries = sorted(p for p in root.rglob("*") if p.is_file() and p.name in EXECUTABLE_NAMES)
    if len(binaries) != expected:
        raise ValueError(f"expected {expected} executables under {root}, found {len(binaries)}")
    for binary in binaries:
        size = binary.stat().st_size
        if size >= MAX_EXECUTABLE_BYTES:
            raise ValueError(f"{binary}: {size} bytes exceeds the exclusive {MAX_EXECUTABLE_BYTES}-byte limit")
        print(f"{binary}: {size} bytes < {MAX_EXECUTABLE_BYTES}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--expected", type=int, default=6)
    args = parser.parse_args()
    try:
        check_sizes(args.root, args.expected)
    except ValueError as error:
        parser.exit(1, f"{error}\n")
