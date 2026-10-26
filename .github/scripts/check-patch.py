"""Validate artifact patch paths before applying in a fresh job."""
import subprocess
import sys
from pathlib import PurePosixPath
patch = sys.argv[1]
output = subprocess.check_output(['git', 'apply', '--numstat', '-z', patch])
if not output:
    raise SystemExit('Agent produced no code changes.')
for record in output.split(b'\0'):
    if not record:
        continue
    parts = record.split(b'\t', 2)
    if len(parts) != 3:
        raise SystemExit('Unsupported rename or patch record.')
    name = parts[2].decode('utf-8')
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or path.parts[0] not in {'frontend', 'backend', 'docs'}:
        raise SystemExit('Patch contains a disallowed path.')
    if any(part in {'.git', 'node_modules', 'bin', 'obj', 'data'} for part in path.parts):
        raise SystemExit('Patch contains generated or private data.')
subprocess.run(['git', 'apply', '--check', patch], check=True)
