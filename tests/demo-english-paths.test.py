"""English demo vault: paths, embedded media, diagram sources and relative links."""
import base64
import json
from pathlib import Path
import re
import urllib.parse
import xml.etree.ElementTree as ET
import zlib

ROOT=Path(__file__).resolve().parent.parent
demo=ROOT/'demo-wiki'
assert demo.is_dir()
notes=sorted(demo.rglob('*.md'))
assert len(notes)>=55,len(notes)
samples=list((demo/'Tree-Test'/'02-Long-list').glob('*-Sample-note.md'))
assert len(samples)==45,len(samples)
assert (demo/'Programming'/'Python.md').is_file()
assert (demo/'Diagrams'/'Music.md').is_file()
assert (demo/'Diagrams'/'UML.md').is_file()
assert (demo/'Obsidian-formats.md').is_file()
assert (demo/'Diagrams-and-music.md').is_file()
assert (demo/'images'/'schema.png').is_file()
assert (demo/'Attachments'/'Bases-Record-Done.md').is_file()
assert (demo/'Attachments'/'Bases-Record-Planned.md').is_file()
assert not (demo/'Programovani').exists()
assert not (demo/'Diagramy').exists()
assert not (demo/'obrazky').exists()
for file in notes:
    name=file.relative_to(demo).as_posix()
    assert name.isascii(),name
    text=file.read_text(encoding='utf-8')
    assert not re.search(r'[ěščřžýáíéúůďťňĚŠČŘŽÝÁÍÉÚŮĎŤŇ]',text),name
    for m in re.finditer(r'(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)',text):
        url=m.group(1).strip('<>')
        if url.startswith(('#','http:','https:','mailto:')):continue
        dest=urllib.parse.unquote(url.split('#')[0])
        target=(file.parent/dest).resolve()
        assert target.is_relative_to(demo) and target.is_file(),(name,url,target)
    # Ensure any explicit relative Obsidian attachment path was also renamed.
    for match in re.finditer(r'!?\[\[([^\]\n]+)\]\]',text):
        val=match.group(1).split('|')[0].split('#')[0]
        if '/' in val and not val.startswith('#'):
            # Markdown source-code examples also have literal links, so
            # check only file-like paths and skip escaped placeholder notation.
            if val=='...':continue
            candidate=(demo/val).resolve()
            if candidate.is_file():continue
            if val.endswith(('.md','.png','.base','.canvas','.drawio')):
                assert (file.parent/val).is_file(),(name,val)
canvas=json.loads((demo/'Attachments'/'example.canvas').read_text(encoding='utf-8'))
for n in canvas['nodes']:
    if n['type']=='file':
        assert (demo/n['file']).is_file(),n
    if n['type']=='text':
        assert not re.search(r'[ěščřžýáíéúůďťň]',n['text']),n
xml=ET.parse(demo/'Attachments'/'example.drawio').getroot()
diagrams=xml.findall('diagram')
assert len(diagrams)==2
assert diagrams[0].get('name')=='Workflow'
assert diagrams[1].get('name')=='Architecture (compressed)'
compressed=diagrams[1].text.strip()
unpacked=urllib.parse.unquote(zlib.decompress(base64.b64decode(compressed),-15).decode('utf-8'))
assert ET.fromstring(unpacked).tag=='mxGraphModel', 'Compressed second page must contain valid XML'
assert 'Database' in unpacked and 'Web application' in unpacked
assert 'Databáze' not in unpacked
assert 'Prepare notes' in ET.tostring(diagrams[0],encoding='unicode')
print('PASS: translated demo with 45 tree samples, all renamed path links, JSON Canvas and compressed draw.io page')
