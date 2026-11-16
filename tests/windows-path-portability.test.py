#!/usr/bin/env python3
"""Keep tracked paths portable on Git for Windows without core.longpaths.

The full Windows path also contains the checkout directory. Reserving at least
80 characters for that prefix prevents a repeat of the oversized demo file.
"""
import subprocess

LIMIT = 175  # repo-relative UTF-16 code units; leaves >=80 for clone path
result = subprocess.run(['git', 'ls-files', '-z'], check=True, capture_output=True)
paths = [p.decode('utf-8') for p in result.stdout.split(b'\x00') if p]
# Encoding above must split by real NUL; guard against accidentally skipping.
assert paths, 'No tracked files found'
long = [(len(p.encode('utf-16-le')) // 2, p) for p in paths]
too_long = [(size, path) for size, path in long if size > LIMIT]
assert not too_long, 'Paths exceed Windows-safe limit: ' + repr(too_long)
print('PASS: all', len(paths), 'tracked paths under', LIMIT, 'UTF-16 code units')
