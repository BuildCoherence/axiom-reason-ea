import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("binary_size", Path(__file__).with_name("check-binary-size.py"))
binary_size = importlib.util.module_from_spec(spec)
spec.loader.exec_module(binary_size)


class BinarySizeTest(unittest.TestCase):
    def test_exclusive_limit(self):
        for delta in (-1, 0, 1):
            with self.subTest(delta=delta), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with (root / "axm").open("wb") as binary:
                    binary.truncate(binary_size.MAX_EXECUTABLE_BYTES + delta)
                if delta < 0:
                    binary_size.check_sizes(root, 1)
                else:
                    with self.assertRaisesRegex(ValueError, "exclusive"):
                        binary_size.check_sizes(root, 1)

    def test_missing_platform_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "expected 6"):
                binary_size.check_sizes(Path(directory), 6)
