import importlib.util
import json
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('premium_web_build', ROOT / 'tools/premium-web-build.py')
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class PremiumWebBuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / 'index.html').read_text(encoding='utf-8')

    def test_separates_levels_demos_and_practice(self):
        public, private, names = BUILD.split_premium(self.source)
        public_js = re.search(r'<script>\s*("use strict";.*?)</script>', public, re.S)[1]
        for script in (public_js, private):
            subprocess.run(['node', '--check'], input=script, text=True, check=True)

        names = json.loads(names)
        _, _, original_levels = BUILD.read_entries(self.source, 'LEVELS', '[', BUILD.LEVEL_ENTRY)
        self.assertEqual(names, [match['name'] for match, _ in original_levels[10:]])
        self.assertEqual(public_js.count('"premiumStub":true'), len(names))
        self.assertIn('В такой карман заходят в два приёма', private)
        self.assertIn('Полный выворот: след задних колёс', private)
        self.assertIn('Регулируемые перекрёстки общего города', private)
        self.assertNotIn('В такой карман заходят в два приёма', public)
        self.assertNotIn('Полный выворот: след задних колёс', public)
        self.assertNotIn('Регулируемые перекрёстки общего города', public)
        self.assertIn('Длинный ровный откат проще разворота', public)
        self.assertNotIn('Длинный ровный откат проще разворота', private)
        self.assertIn('"practice":{"title":"светофоры"}', public)
        self.assertIn('"examRoute":true', public)

    def test_rejects_unclassified_entry_before_paid_boundary(self):
        source = self.source.replace(
            "{ name:'11 ·",
            "makeLevel('платное содержимое'),\n{ name:'11 ·",
            1,
        )
        with self.assertRaisesRegex(ValueError, 'неожиданная запись LEVELS'):
            BUILD.split_premium(source)

    def test_rejects_changed_paywall_boundary(self):
        with self.assertRaisesRegex(ValueError, 'PAYWALL.from'):
            BUILD.split_premium(self.source.replace("product:'premium', from:10", "product:'premium', from:11", 1))


if __name__ == '__main__':
    unittest.main()
