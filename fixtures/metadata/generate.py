# /// script
# requires-python = ">=3.11"
# dependencies = ["mutagen==1.47.0"]
# ///
"""Regenerate tiny silent audio fixtures without Lofty or metadata-engine.

Run: uv run fixtures/metadata/generate.py (requires ffmpeg on PATH).
The committed files are the test inputs; neither tool is needed to run tests.
"""

import base64
import json
from pathlib import Path
import shutil
import subprocess

import mutagen
from mutagen import id3
from mutagen.apev2 import APEv2, APEExtValue, APEBinaryValue
from mutagen.flac import Picture
from mutagen.mp4 import MP4Cover, MP4FreeForm

ROOT = Path(__file__).parent
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)
FIELDS = {
    "title": "Invocación Del Cielo",
    "artist": "Vardae",
    "albumTitle": "BNJ Serie, Vol. 1",
    "albumArtist": "Various Artists",
    "genre": "Electronic",
    "track": 3,
    "comment": "First line\nSecond line",
    "lyrics": "Words\nMore words",
    "musicalKey": "Am",
    "bpm": 127.5,
    "catalogNumber": "BNJS001",
    "label": "Blue Night Jungle",
}
CASES = []


def audio(name, codec):
    path = ROOT / name
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
         "anullsrc=r=44100:cl=stereo", "-t", "0.12", "-c:a", codec,
         "-map_metadata", "-1", str(path)], check=True,
    )
    return path


def case(name, expected, **kwargs):
    CASES.append({"file": name, "expected": expected, **kwargs})


def id3_tags(tags):
    for frame, field in [(id3.TIT2, "title"), (id3.TPE1, "artist"),
                         (id3.TALB, "albumTitle"), (id3.TPE2, "albumArtist"),
                         (id3.TCON, "genre"), (id3.TKEY, "musicalKey"),
                         (id3.TPUB, "label")]:
        tags.add(frame(encoding=3, text=[FIELDS[field]]))
    tags.add(id3.TRCK(encoding=3, text=["03/12"]))
    tags.add(id3.COMM(encoding=3, lang="eng", desc="", text=[FIELDS["comment"]]))
    tags.add(id3.USLT(encoding=3, lang="eng", desc="", text=FIELDS["lyrics"]))
    for key, value in [("BPM", "127.5"), ("CATALOGNUMBER", "BNJS001"),
                       ("EnergyLevel", "7"), ("X-MAESTRO", "keep me")]:
        tags.add(id3.TXXX(encoding=3, desc=key, text=[value]))
    tags.add(id3.APIC(encoding=3, mime="image/png", type=3, desc="cover", data=PNG))
    tags.add(id3.PRIV(owner="test.example", data=b"\x00\x01opaque\xff"))


for ext, codec in [("mp3", "libmp3lame"), ("wav", "pcm_s16le"), ("aiff", "pcm_s16be")]:
    name = f"vardae-invocacion-del-cielo.{ext}"
    path = audio(name, codec)
    file = mutagen.File(path)
    if file.tags is None:
        file.add_tags()
    file.tags.clear()
    id3_tags(file.tags)
    file.save()
    case(name, {**FIELDS, "energy": "7"}, artwork=True,
         extras=[["Custom: X-MAESTRO", "keep me"]], writable=True)

for ext, codec in [("flac", "flac"), ("ogg", "libvorbis"), ("opus", "libopus"), ("wv", "wavpack")]:
    name = f"vardae-invocacion-del-cielo.{ext}"
    path = audio(name, codec)
    file = mutagen.File(path)
    if file.tags is None:
        file.add_tags()
    file.tags.clear()
    for key, field in [("TITLE", "title"), ("ARTIST", "artist"), ("ALBUM", "albumTitle"),
                       ("ALBUMARTIST", "albumArtist"), ("GENRE", "genre"),
                       ("COMMENT", "comment"), ("LYRICS", "lyrics"), ("INITIALKEY", "musicalKey"),
                       ("LABEL", "label"), ("CATALOGNUMBER", "catalogNumber")]:
        file[key] = FIELDS[field]
    for key, value in [("TRACKNUMBER", "3"), ("BPM", "127.5"), ("EnergyLevel", "7"),
                       ("X-MAESTRO", "keep me")]:
        file[key] = value
    # APE uses Track, Publisher and Catalog; aliases remain explicit fixture cases below.
    if ext == "wv":
        file["Track"] = "3/12"
        file["Publisher"] = FIELDS["label"]
        file["Catalog"] = FIELDS["catalogNumber"]
    if ext == "flac":
        picture = Picture()
        picture.type, picture.mime, picture.data = 3, "image/png", PNG
        file.add_picture(picture)
    file.save()
    case(name, {**FIELDS, "energy": "7"}, artwork=ext == "flac",
         extras=[["Custom: X-MAESTRO", "keep me"]], writable=True)

path = audio("vardae-invocacion-del-cielo.m4a", "aac")
file = mutagen.File(path)
file.tags.clear()
for key, field in [("\xa9nam", "title"), ("\xa9ART", "artist"), ("\xa9alb", "albumTitle"),
                   ("aART", "albumArtist"), ("\xa9gen", "genre"), ("\xa9cmt", "comment"),
                   ("\xa9lyr", "lyrics")]:
    file[key] = [FIELDS[field]]
file["trkn"] = [(3, 12)]
file["tmpo"] = [128]
for key, value in [("KEY", "Am"), ("LABEL", "Blue Night Jungle"), ("CATALOGNUMBER", "BNJS001"),
                   ("X-MAESTRO", "keep me")]:
    file[f"----:com.apple.iTunes:{key}"] = [MP4FreeForm(value.encode())]
file["covr"] = [MP4Cover(PNG, imageformat=MP4Cover.FORMAT_PNG)]
file.save()
case("vardae-invocacion-del-cielo.m4a", {**FIELDS, "bpm": 128, "energy": None}, artwork=True,
     extras=[["Custom: ----:com.apple.iTunes:X-MAESTRO", "keep me"]], writable=True)

# Each legacy custom-field spelling is independently written as ID3 TXXX.
aliases = {
    "energy": ["ENERGY", "ENERGYLEVEL", "Energylevel", "EnergyLevel"],
    "bpm": ["BPM", "TBPM", "Bpm", "bpm"],
    "musicalKey": ["KEY", "TKEY", "INITIALKEY", "INITIAL KEY", "Initial key"],
    "comment": ["COMMENT", "Comment", "comment"],
    "catalogNumber": ["CATALOGUENUMBER", "CATALOGID", "CATALOG", "Catalog", "CATALOG NUMBER",
                      "Catalog ID", "CATALOG #", "Catalog #", "CAT#"],
    "lyrics": ["LYRICS"],
}
bare = audio("spunoff-el-sueno-untagged.mp3", "libmp3lame")
id3.delete(bare)
case(bare.name, {"title": bare.name, "artist": None, "track": None, "energy": None, "bpm": None})
for field, keys in aliases.items():
    for i, key in enumerate(keys):
        name = f"alias-{field}-{i}.mp3"
        path = ROOT / name
        shutil.copyfile(bare, path)
        value = {"energy": "7", "bpm": "127.5"}.get(field, FIELDS.get(field))
        tags = id3.ID3()
        tags.add(id3.TXXX(encoding=3, desc=key, text=[value]))
        tags.save(path, v2_version=3 if i % 2 else 4)
        case(name, {field: 127.5 if field == "bpm" else value}, aliasField=field)

for name, bpm in [("invalid-bpm", "not a number"), ("negative-bpm", "-5"), ("nan-bpm", "NaN")]:
    path = ROOT / f"{name}.mp3"
    shutil.copyfile(bare, path)
    tags = id3.ID3()
    tags.add(id3.TXXX(encoding=3, desc="BPM", text=[bpm]))
    tags.save(path)
    case(path.name, {"bpm": None})

path = ROOT / "dj-swagger-stvol.mp3"
shutil.copyfile(bare, path)
tags = id3.ID3()
tags.add(id3.TIT2(encoding=1, text=["Ствол"]))
tags.add(id3.TPE1(encoding=1, text=["DJ Swagger & DJ Ædidias"]))
tags.add(id3.TALB(encoding=1, text=["Ствол EP"]))
tags.save(path, v2_version=3)
case(path.name, {"title": "Ствол", "artist": "DJ Swagger & DJ Ædidias", "albumTitle": "Ствол EP"})

path = ROOT / "repeated-id3.mp3"
shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.mp3", path)
tags = id3.ID3(path)
tags.add(id3.TXXX(encoding=3, desc="X-MAESTRO", text=["first", "second"]))
tags.save(path)
case(path.name, FIELDS, extras=[["Custom: X-MAESTRO", "first"], ["Custom: X-MAESTRO", "second"]], writable=True)

path = ROOT / "opaque-energy.mp3"
shutil.copyfile(bare, path)
tags = id3.ID3()
opaque_energy = "eyJlbmVyZ3lMZXZlbCI6N30="
tags.add(id3.TXXX(encoding=3, desc="ENERGY", text=[opaque_energy]))
tags.add(id3.TXXX(encoding=3, desc="fBPM", text=["126.76999"]))
tags.add(id3.GEOB(encoding=0, mime="application/json", desc="Energy", data=b'{"energyLevel":7}'))
tags.save(path)
case(path.name, {"energy": opaque_energy, "bpm": None}, extras=[["Custom: fBPM", "126.76999"]])

path = ROOT / "multiple.flac"
shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.flac", path)
file = mutagen.File(path)
file["X-MAESTRO"] = ["first", "second"]
file["DATE"] = "2024-02-03"
file["TRACKNUMBER"] = "65536"
file.save()
case(path.name, {"date": "2024-02-03", "track": None},
     extras=[["Custom: X-MAESTRO", "first"], ["Custom: X-MAESTRO", "second"]])

path = ROOT / "namespaced.m4a"
shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.m4a", path)
file = mutagen.File(path)
file["----:com.apple.iTunes:initialkey"] = [MP4FreeForm(b"Fm")]
file["----:com.apple.iTunes:ENERGY"] = [MP4FreeForm(b"6")]
file["----:org.example:ENERGY"] = [MP4FreeForm(b"unrelated")]
file["----:org.example:VALUES"] = [MP4FreeForm(b"first"), MP4FreeForm(b"second")]
file.save()
case(path.name, {"musicalKey": "Fm", "energy": "6"}, extras=[
    ["Custom: ----:org.example:ENERGY", "unrelated"],
    ["Custom: ----:org.example:VALUES", "first"],
    ["Custom: ----:org.example:VALUES", "second"],
], writable=True)

for name, primary in [("id3v1-only.mp3", False), ("id3-priority.mp3", True)]:
    path = ROOT / name
    shutil.copyfile(bare, path)
    if primary:
        tags = id3.ID3()
        tags.add(id3.TIT2(encoding=1, text=["Gökotta"]))
        tags.add(id3.TDRC(encoding=1, text=["2020-06-07"]))
        tags.save(path, v2_version=3)
    # ID3v1.1 footer, authored directly. No dependence on a tag reader's mapping.
    with path.open("ab") as stream:
        stream.write(b"TAG" + "El sueño".encode("latin1").ljust(30, b"\0") + b"SpunOff".ljust(30, b"\0")
                     + b"El Ritmo del Alba".ljust(30, b"\0") + b"1999"
                     + b"Legacy comment".ljust(28, b"\0") + b"\0\x05\x0c")
    case(name, {"title": "Gökotta" if primary else "El sueño",
                "artist": None if primary else "SpunOff",
                "track": None if primary else 5})

for ext, codec in [("wav", "pcm_s16le"), ("aiff", "pcm_s16be"), ("wv", "wavpack")]:
    path = audio(f"spunoff-el-sueno-untagged.{ext}", codec)
    file = mutagen.File(path)
    if file.tags:
        file.delete()
    case(path.name, {"title": path.name, "track": None}, createTag=True)

# URL-valued tags use different native variants from ordinary text fields.
for field, key in [("energy", "ENERGY"), ("comment", "COMMENT"), ("lyrics", "LYRICS")]:
    path = ROOT / f"url-alias-{field}.mp3"
    shutil.copyfile(bare, path)
    tags = id3.ID3()
    tags.add(id3.WXXX(encoding=3, desc=key, url="https://example.com/value"))
    tags.save(path)
    case(path.name, {field: "https://example.com/value"}, aliasField=field)

path = ROOT / "external-reference.wv"
shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.wv", path)
file = mutagen.File(path)
file["X-URL"] = APEExtValue("https://example.com/track")
file.save()
case(path.name, FIELDS, extras=[["Custom: X-URL", "https://example.com/track"]], writable=True)

path = ROOT / "musicbrainz-recording.mp3"
shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.mp3", path)
tags = id3.ID3(path)
recording_id = "d74c6c09-74de-49b3-a931-e0e67e2040e5"
tags.add(id3.UFID(owner="http://musicbrainz.org", data=recording_id.encode("ascii")))
tags.save(path)
case(path.name, FIELDS, extras=[["MusicBrainzRecordingId", recording_id]], writable=True)

path = ROOT / "mixed-data.m4a"
shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.m4a", path)
file = mutagen.File(path)
for name, values in {
    "TEXT-BINARY": [(b"visible", 1), (b"opaque-after-text", 0)],
    "BINARY-TEXT": [(b"opaque-before-text", 0), (b"visible", 1)],
    "BINARY-BINARY": [(b"opaque-first", 0), (b"opaque-second", 0)],
    "TEXT-INTEGER": [(b"visible", 1), ((42).to_bytes(4, "big"), 21)],
    "TEXT-UNSIGNED": [(b"visible", 1), ((42).to_bytes(4, "big"), 22)],
    "TEXT-UTF16": [(b"visible", 1), ("Gökotta".encode("utf-16-be"), 2)],
}.items():
    file[f"----:org.example:{name}"] = [MP4FreeForm(value, dataformat=kind) for value, kind in values]
file["covr"] = [MP4Cover(PNG, imageformat=MP4Cover.FORMAT_PNG),
                MP4Cover(PNG, imageformat=MP4Cover.FORMAT_PNG)]
file.save()
case(path.name, FIELDS | {"bpm": 128}, writable=True)

path = ROOT / "repeated-ape.wv"
shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.wv", path)
file = mutagen.File(path)
file["X-MAESTRO"] = ["first", "second"]
file.save()
case(path.name, FIELDS, extras=[["Custom: X-MAESTRO", "first\0second"]], writable=True)

for fixture, name in [("editable-mixed.m4a", "ENERGY"), ("editable-alias.m4a", "ENERGYLEVEL")]:
    path = ROOT / fixture
    shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.m4a", path)
    file = mutagen.File(path)
    file[f"----:com.apple.iTunes:{name}"] = [MP4FreeForm(b"7"), MP4FreeForm(b"keep-energy", dataformat=0), MP4FreeForm(b"keep-energy", dataformat=0)]
    file.save()
    case(path.name, {"energy": "7"})

path = ROOT / "editable-aliases.m4a"
shutil.copyfile(ROOT / "editable-mixed.m4a", path)
file = mutagen.File(path)
file["----:com.apple.iTunes:ENERGYLEVEL"] = [MP4FreeForm(b"7"), MP4FreeForm(b"keep-energy", dataformat=0), MP4FreeForm(b"keep-energy", dataformat=0)]
file.save()
case(path.name, {"energy": "7"})

path = ROOT / "riff-aliases.wav"
shutil.copyfile(ROOT / "spunoff-el-sueno-untagged.wav", path)
content = bytearray(path.read_bytes())
info = bytearray(b"INFO")
for name, value in [(b"TBPM", b"127.5"), (b"TKEY", b"Am"), (b"XTRA", b"keep me")]:
    value += b"\0"
    info += name + len(value).to_bytes(4, "little") + value + (b"\0" if len(value) % 2 else b"")
offset = 12
while offset < len(content):
    size = int.from_bytes(content[offset + 4:offset + 8], "little")
    if content[offset:offset + 4] == b"LIST" and content[offset + 8:offset + 12] == b"INFO":
        del content[offset:offset + 8 + size + size % 2]
        break
    offset += 8 + size + size % 2
content += b"LIST" + len(info).to_bytes(4, "little") + info
content[4:8] = (len(content) - 8).to_bytes(4, "little")
path.write_bytes(content)
case(path.name, {"bpm": 127.5, "musicalKey": "Am"}, extras=[["Custom: XTRA", "keep me"]])

path = ROOT / "secondary-ape.mp3"
shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.mp3", path)
ape = APEv2()
ape["X-URL"] = APEExtValue("https://example.com/secondary")
ape["X-BLOB"] = APEBinaryValue(b"maestro-opaque-ape-payload")
ape.save(path)
case(path.name, FIELDS, extras=[["Custom: X-URL", "https://example.com/secondary"],
                               ["Custom: X-BLOB", ""]], writable=True,
     binaryMarker="maestro-opaque-ape-payload")

path = ROOT / "secondary-riff.wav"
shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.wav", path)
content = bytearray(path.read_bytes())
value = b"keep the RIFF field\0"
extra = b"XTRA" + len(value).to_bytes(4, "little") + value
if len(value) % 2:
    extra += b"\0"
offset = 12
while offset < len(content):
    size = int.from_bytes(content[offset + 4:offset + 8], "little")
    if content[offset:offset + 4] == b"LIST" and content[offset + 8:offset + 12] == b"INFO":
        end = offset + 8 + size
        content[end:end] = extra
        content[offset + 4:offset + 8] = (size + len(extra)).to_bytes(4, "little")
        break
    offset += 8 + size + size % 2
else:
    raise AssertionError("WAV fixture must contain an INFO list")
content[4:8] = (len(content) - 8).to_bytes(4, "little")
path.write_bytes(content)
case(path.name, FIELDS, extras=[["Custom: XTRA", "keep the RIFF field"]], writable=True)

path = ROOT / "year.wv"
shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.wv", path)
file = mutagen.File(path)
file["Year"] = "2024"
file.save()
case(path.name, {**FIELDS, "year": 2024, "date": None}, writable=True)

path = ROOT / "recording-date.wv"
shutil.copyfile(ROOT / "vardae-invocacion-del-cielo.wv", path)
file = mutagen.File(path)
file["Year"] = "2026-02-03"
file.save()
case(path.name, {**FIELDS, "year": None, "date": "2026-02-03"}, writable=True)

(ROOT / "cover.png").write_bytes(PNG)
(ROOT / "cases.json").write_text(json.dumps(CASES, indent=4, ensure_ascii=False) + "\n")
