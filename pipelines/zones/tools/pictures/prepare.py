#!/usr/bin/env python3
"""Prepares the reviewed zone pictures for the lore pages.

Only pictures that have been chosen by hand and reviewed ship. They live in the choices folder,
laid out as Lore of Azeroth is (Azeroth/<continent>/<zone>[/<area>]): each place's chosen
picture, enhanced, is "<place> - new.png", and its original "<place> - old.<ext>". A place with
no "- new" yet has no picture in the game.

Each picture is cropped to a 2:1 banner, tinted a touch toward the parchment it sits on, thinned
to the paper toward its edges and written as a DXT1 BLP to addons/Spoken_Zones/Textures/Pictures/.
The edges themselves, where the paint fails in dry-brush streaks, specks and spatters, are mask
textures (Mask1.blp...) the game cuts each picture with, so a picture costs no alpha. Writes
Data/Pictures.lua (which picture and mask each place has) and CREDITS.md (each picture's wiki
source file, found by matching the original against the downloads in cache/pictures, or
named in sources.json for a picture added by hand).

Usage: python tools/pictures/prepare.py [--choices DIR] [--force]
  --choices  the choices folder (default: ~/Desktop/Zone picture choices)
  --force    write pictures again that are already there
"""

import argparse
import hashlib
import json
import os
import re
import struct
import sys
import zlib

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
CACHE = os.path.join(ROOT, "pipelines/zones/tools/cache/pictures")
DATA = os.path.join(ROOT, "addons/Spoken_Zones/Data/enUS")
CHOICES = os.path.expanduser(os.path.join("~", "Desktop", "Zone picture choices"))
OUT = os.path.join(ROOT, "addons/Spoken_Zones/Textures/Pictures")
LUA = os.path.join(ROOT, "addons/Spoken_Zones/Data/Pictures.lua")

# Shipped at twice the size the frame draws them (about 320 wide), so the game shrinks a picture
# rather than stretching it: stretched, a 256-wide picture looked soft.
W, H = 512, 256
# The edge masks, at the size of the pictures; there are MASKS of them, shared out so the places
# of one zone each have a different edge.
MASK_W, MASK_H = 512, 256
MASKS = 32
# The page under the picture, as the game draws it (sampled from a screenshot of the panel), and
# how far the picture is tinted toward it.
PARCHMENT = np.array([0.88, 0.68, 0.41])
WARMTH = 0.12
# The paper's grain over the picture: how strong, and how big a grain is in the shipped picture's
# pixels (the game draws it at about two thirds of its size, so a grain of one pixel vanished);
# then how much shallower the left edge's fraying is.
GRAIN, GRAIN_SIZE, LEFT_SHALLOWER = 0.08, 1.5, 0.5
# Where the band with the most detail is not the place: the band to keep instead, "top" or
# "bottom" of a picture taller than 2:1 ("left" or "right" of a wider one). Cragpool Lake's middle
# is bare cliff; its bottom has the shore and the fish.
CROPS = {"1442-cragpool-lake": "bottom"}


def seeded(name):
    return np.random.default_rng(zlib.crc32(name.encode()))


def noise(rng, h, w, octaves=5, base=4):
    """Fractal value noise in 0..1."""
    total = np.zeros((h, w))
    amp, weight = 1.0, 0.0
    for o in range(octaves):
        gh, gw = base * 2 ** o, base * 2 ** o * max(1, w // h)
        grid = rng.random((gh + 1, gw + 1)).astype(np.float32)
        layer = np.asarray(Image.fromarray(grid).resize((w, h), Image.BICUBIC))
        total += amp * layer
        weight += amp
        amp *= 0.5
    total /= weight
    return (total - total.min()) / max(1e-6, total.max() - total.min())


def stretched(rng, h, w, along_x, octaves=4):
    """Noise drawn out along one direction: dry-brush streaks."""
    if along_x:
        small = noise(rng, h, max(8, w // 12), octaves, 8)
    else:
        small = noise(rng, max(8, h // 12), w, octaves, 8)
    return np.asarray(Image.fromarray(small.astype(np.float32)).resize((w, h), Image.BICUBIC))


def make_mask(index):
    """Where the paint reaches: solid in the middle, failing toward each edge in dry-brush streaks
    that run along that side, broken into specks, with a few spatters past it."""
    rng = seeded(f"mask{index}")
    pw, ph = MASK_W, MASK_H
    yy, xx = np.mgrid[0:ph, 0:pw].astype(np.float64)
    across = np.minimum(xx, pw - 1 - xx)   # in from the left or right side
    down = np.minimum(yy, ph - 1 - yy)     # in from the top or bottom
    inset = np.minimum(across, down)

    # Streaks along the top and bottom run left to right, along the sides top to bottom.
    along = np.clip((across - down) / 24 + 0.5, 0, 1)
    streak = along * stretched(rng, ph, pw, True) + (1 - along) * stretched(rng, ph, pw, False)
    # How far in the failing reaches, uneven round the edge.
    # Shallower along the left side, which lines up with the text below: there a deep edge read as
    # the picture sitting out of line with the words.
    left = (1 - along) * np.clip((pw / 2 - xx) / 24, 0, 1)
    scale = 1 - LEFT_SHALLOWER * left
    depth = (3 + noise(rng, ph, pw, 3, 2) * 16) * scale
    reach = np.clip((inset - depth + (streak - 0.5) * 26 * scale) / (14 * scale), 0, 1)

    # The dry brush skipping over the paper's tooth: the band broken into specks, the middle whole.
    tooth = noise(rng, ph, pw, 2, 96)
    tooth = 0.6 * tooth + 0.4 * rng.random((ph, pw))
    mask = np.clip((reach - 0.55 * tooth) / 0.45, 0, 1)

    # Spatters flicked past the edge.
    for _ in range(40):
        cx, cy = rng.random() * pw, rng.random() * ph
        if not (reach[int(cy), int(cx)] < 0.4 and inset[int(cy), int(cx)] > 2):
            continue
        r = 0.6 + rng.random() ** 4 * 2.5
        d = np.hypot(xx - cx, yy - cy)
        mask = np.maximum(mask, np.clip(r - d + 0.5, 0, 1) * (0.5 + 0.5 * rng.random()))
    return mask


def save_mask(mask, path):
    """A mask as a DXT5 BLP: white, its alpha the mask. A quarter of the TGA's size."""
    save_blp(Image.fromarray((mask * 255).astype(np.uint8), "L"), path, alpha=True)


def crop(im, place=None):
    """A 2:1 banner, cut where the picture has the most in it: the band with the most detail
    (edges), so a screenshot that is half empty sky is cut lower, around the place. Nudged toward
    the middle, where two bands are near alike. `place` set by hand in CROPS is cut there."""
    w, h = im.size
    side = CROPS.get(place)
    if side:
        if w / h <= 2:
            ch = int(w / 2)
            top = 0 if side == "top" else h - ch
            return im.crop((0, top, w, top + ch))
        cw = int(h * 2)
        left = 0 if side == "left" else w - cw
        return im.crop((left, 0, left + cw, h))
    small = np.asarray(im.convert("L").resize((256, max(1, int(256 * h / w))), Image.BILINEAR)).astype(np.float64)
    detail = np.hypot(ndimage.sobel(small, 0), ndimage.sobel(small, 1))
    tall = w / h <= 2
    profile = detail.mean(axis=1) if tall else detail.mean(axis=0)
    length = len(profile)
    window = int(round(length * ((w / 2) / h if tall else (2 * h) / w)))
    window = max(1, min(length, window))
    if window >= length:
        start = 0
    else:
        sums = np.convolve(profile, np.ones(window), "valid")
        middle = (length - window) / 2
        bias = 1 - 0.15 * np.abs(np.arange(len(sums)) - middle) / max(1, middle)
        start = int(np.argmax(sums * bias))
    if tall:
        ch = int(w / 2)
        top = min(h - ch, int(round(start * h / length)))
        return im.crop((0, top, w, top + ch))
    cw = int(h * 2)
    left = min(w - cw, int(round(start * w / length)))
    return im.crop((left, 0, left + cw, h))


def prepare(im, mask, place=None):
    """The banner at the shipped size, warmed a touch toward the parchment, and thinning to the
    paper where the paint runs out at the edges (the mask's fading band)."""
    img = np.asarray(crop(im, place).resize((W, H), Image.LANCZOS)).astype(np.float64) / 255.0
    img = img * (1 - WARMTH + WARMTH * PARCHMENT / PARCHMENT.max())
    # The paper's grain: fine noise and a coarser mottle under it, as the parchment has.
    rng = seeded("grain")
    speck = rng.random((int(H / GRAIN_SIZE), int(W / GRAIN_SIZE))).astype(np.float32)
    speck = np.asarray(Image.fromarray(speck).resize((W, H), Image.BICUBIC))
    grain = 0.65 * speck + 0.35 * noise(rng, H, W, 3, 16)
    img *= (1 - GRAIN * (grain - 0.5) * 2)[..., None]
    mask = np.asarray(Image.fromarray(mask.astype(np.float32)).resize((W, H), Image.BILINEAR))
    soft = ndimage.gaussian_filter(mask, 3 * W / MASK_W)
    thin = np.clip(1 - soft, 0, 1) ** 0.8
    img = img + (PARCHMENT - img) * (0.75 * thin)[..., None]
    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    return out.filter(ImageFilter.UnsharpMask(radius=1, percent=40, threshold=2))


# --- DXT1 BLP ---------------------------------------------------------------------------------

def to565(c):
    c = np.clip(np.rint(c), 0, 255).astype(np.int32)
    return ((c[..., 0] >> 3) << 11) | ((c[..., 1] >> 2) << 5) | (c[..., 2] >> 3)


def from565(v):
    r = (v >> 11) & 31
    g = (v >> 5) & 63
    b = v & 31
    return np.stack([(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)], axis=-1).astype(np.float64)


def dxt5_alpha(a):
    """DXT5 alpha blocks for an alpha array whose sides are multiples of 4 (or smaller than 4)."""
    h, w = a.shape
    bh, bw = max(1, (h + 3) // 4), max(1, (w + 3) // 4)
    padded = np.pad(a, ((0, bh * 4 - h), (0, bw * 4 - w)), mode="edge").astype(np.float64)
    blocks = padded.reshape(bh, 4, bw, 4).transpose(0, 2, 1, 3).reshape(bh * bw, 16)
    a0, a1 = blocks.max(axis=1), blocks.min(axis=1)
    a0 = np.where(a0 == a1, np.minimum(255, a0 + 1), a0)   # a0 > a1: the eight-step ramp
    a1 = np.where(a0 == a1, np.maximum(0, a1 - 1), a1)
    steps = np.stack([a0, a1] + [((7 - k) * a0 + k * a1) / 7 for k in range(1, 7)], axis=1)
    idx = np.abs(blocks[:, :, None] - steps[:, None, :]).argmin(axis=2).astype(np.uint64)
    bits = (idx << (3 * np.arange(16, dtype=np.uint64))).sum(axis=1)
    out = np.zeros((len(blocks), 8), dtype=np.uint8)
    out[:, 0], out[:, 1] = a0.astype(np.uint8), a1.astype(np.uint8)
    for b in range(6):
        out[:, 2 + b] = ((bits >> np.uint64(8 * b)) & np.uint64(255)).astype(np.uint8)
    return out


def dxt1(rgb):
    """DXT1 blocks for an RGB array whose sides are multiples of 4 (or smaller than 4)."""
    h, w, _ = rgb.shape
    bh, bw = max(1, (h + 3) // 4), max(1, (w + 3) // 4)
    padded = np.pad(rgb, ((0, bh * 4 - h), (0, bw * 4 - w), (0, 0)), mode="edge").astype(np.float64)
    blocks = padded.reshape(bh, 4, bw, 4, 3).transpose(0, 2, 1, 3, 4).reshape(bh * bw, 16, 3)
    mean = blocks.mean(axis=1, keepdims=True)
    centred = blocks - mean
    cov = np.einsum("npi,npj->nij", centred, centred)
    axis = np.ones((len(blocks), 3)) / np.sqrt(3)
    for _ in range(6):
        axis = np.einsum("nij,nj->ni", cov, axis)
        length = np.linalg.norm(axis, axis=1, keepdims=True)
        axis = np.where(length > 1e-9, axis / np.maximum(length, 1e-9), np.ones_like(axis) / np.sqrt(3))
    t = np.einsum("npi,ni->np", centred, axis)
    lo, hi = t.min(axis=1), t.max(axis=1)
    inset = (hi - lo) / 32
    lo, hi = lo + inset, hi - inset
    c0 = mean[:, 0] + hi[:, None] * axis
    c1 = mean[:, 0] + lo[:, None] * axis
    v0, v1 = to565(c0), to565(c1)
    swap = v0 < v1
    v0, v1 = np.where(swap, v1, v0), np.where(swap, v0, v1)
    e0, e1 = from565(v0), from565(v1)
    palette = np.stack([e0, e1, (2 * e0 + e1) / 3, (e0 + 2 * e1) / 3], axis=1)
    dist = ((blocks[:, :, None, :] - palette[:, None, :, :]) ** 2).sum(axis=3)
    idx = dist.argmin(axis=2)
    idx = np.where((v0 == v1)[:, None], 0, idx)
    bits = (idx.astype(np.uint64) << (2 * np.arange(16, dtype=np.uint64))).sum(axis=1)
    out = np.zeros(len(blocks), dtype=[("c0", "<u2"), ("c1", "<u2"), ("bits", "<u4")])
    out["c0"], out["c1"], out["bits"] = v0, v1, bits.astype(np.uint32)
    return out.tobytes()


def save_blp(im, path, alpha=False):
    """A BLP2 of DXT1 blocks, with its smaller sizes for the game to draw it small. With alpha, a
    white DXT5 whose alpha is `im` (a mask)."""
    mips = []
    level = im
    while True:
        if alpha:
            a = np.asarray(level)
            colour = np.frombuffer(dxt1(np.full(a.shape + (3,), 255, dtype=np.uint8)), dtype=np.uint8).reshape(-1, 8)
            mips.append(np.concatenate([dxt5_alpha(a), colour], axis=1).tobytes())
        else:
            mips.append(dxt1(np.asarray(level.convert("RGB"))))
        if level.size == (1, 1) or len(mips) == 16:
            break
        level = level.resize((max(1, level.size[0] // 2), max(1, level.size[1] // 2)), Image.LANCZOS)
    header = 4 + 4 + 4 + 8 + 64 + 64 + 1024
    offsets, sizes, at = [], [], header
    for data in mips:
        offsets.append(at)
        sizes.append(len(data))
        at += len(data)
    offsets += [0] * (16 - len(mips))
    sizes += [0] * (16 - len(mips))
    with open(path, "wb") as f:
        f.write(b"BLP2")
        f.write(struct.pack("<I", 1))
        # DXT; DXT5 with eight bits of alpha, or DXT1 with none; mipmaps.
        f.write(struct.pack("<BBBB", 2, 8, 7, 1) if alpha else struct.pack("<BBBB", 2, 0, 0, 1))
        f.write(struct.pack("<II", *im.size))
        f.write(struct.pack("<16I", *offsets))
        f.write(struct.pack("<16I", *sizes))
        f.write(b"\0" * 1024)
        for data in mips:
            f.write(data)


# --- Lua and credits ----------------------------------------------------------------------------

def lua_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def write_lua(placed):
    by_parent = {}
    for p in placed:
        by_parent.setdefault(p["parent"], []).append(p)
    lines = [
        "-- AUTO-GENERATED by pipelines/zones/tools/pictures/prepare.py. Do not edit by hand.",
        "--",
        "-- A picture of each reviewed place, from its warcraft.wiki.gg page (credits in",
        "-- Textures/Pictures/CREDITS.md). Keyed as the lore is: parent uiMapID, then the normalised",
        "-- subzone name, with \"\" for the zone itself. Each is { texture, mask }: the picture under",
        "-- Textures/Pictures and which of its edge masks (Mask1..Mask%d) cuts it." % MASKS,
        "",
        "local _, SpokenZones = ...",
        "",
        "SpokenZones.pictures = {",
    ]
    for parent in sorted(by_parent):
        lines.append("\t[%d] = {" % parent)
        for p in sorted(by_parent[parent], key=lambda p: p.get("key") or ""):
            lines.append("\t\t[%s] = { %s, %d }," % (lua_string(p.get("key") or ""), lua_string(p["texture"]), p["mask"]))
        lines.append("\t},")
    lines.append("}")
    with open(LUA, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def baked_masks():
    """The mask each texture was last written with, by texture, from the Pictures.lua write_lua made."""
    if not os.path.exists(LUA):
        return {}
    return {t: int(m) for t, m in re.findall(r'\{ "([^"]+)", (\d+) \}', open(LUA, encoding="utf-8").read())}


def deal_masks(places, baked):
    """Each place's mask, by id. Each zone's places take the masks in a shuffled order of their own,
    so no two places in one zone (32 at most share one only past that) have the same edge. A place
    keeps the mask its texture was written with, so adding a place to a zone writes that one
    texture, not the zone's."""
    order = {}
    for p in places:
        order.setdefault(p["parent"], []).append(p["id"])
    mask_of = {}
    for parent, ids in order.items():
        taken = set()
        for pid in sorted(ids):
            # Past MASKS places a zone repeats masks anyway, so a repeat is no clash to undo.
            if baked.get(pid) and (baked[pid] not in taken or len(ids) > MASKS):
                mask_of[pid] = baked[pid]
                taken.add(baked[pid])
        deck = [int(m) for m in seeded("zone%d" % parent).permutation(MASKS) + 1]
        free = [m for m in deck if m not in taken]
        for n, pid in enumerate(sorted(pid for pid in ids if pid not in mask_of)):
            mask_of[pid] = free[n] if n < len(free) else deck[n % MASKS]
    return mask_of


def write_credits(placed):
    lines = [
        "# Zone pictures",
        "",
        "Screenshots of World of Warcraft, (c) Blizzard Entertainment, from these warcraft.wiki.gg",
        "files, each chosen by hand. Each was cleaned up and sharpened with Gemini 3.1 Flash Image",
        "(the same scene, lighting and colours; compression artifacts and interface removed), then",
        "cropped, tinted and edged by `pipelines/zones/tools/pictures/prepare.py`. Each source file's",
        "page gives its uploader and terms.",
        "",
        "| Picture | Place | Source file |",
        "| --- | --- | --- |",
    ]
    cell = lambda s: (s or "").replace("|", "/").replace("\n", " ").strip()
    seen = set()
    for p in sorted(placed, key=lambda p: p["texture"]):
        if p["texture"] in seen:
            continue
        seen.add(p["texture"])
        src = p["source"]
        if not src:
            source = "unknown, added by hand"
        elif src.startswith("http"):
            source = src
        elif src.startswith("own:"):
            source = cell(src[4:].strip())
        else:
            source = "[%s](https://warcraft.wiki.gg/wiki/File:%s)" % (cell(src), src.replace(" ", "_"))
        lines.append("| %s | %s | %s |" % (p["texture"], cell(p["title"]), source))
    with open(os.path.join(OUT, "CREDITS.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def safe(s):
    """A name as the choices folder spells it: safe() in gallery.mjs, which must match."""
    return re.sub(r"\s+", " ", re.sub(r'[<>:"/\\|?*]', "", s)).strip()


def lore_names():
    """Zone ids by folder name, and each zone's area keys by folder name, from the lore data."""
    zones, areas = {}, {}
    text = open(os.path.join(DATA, "Zones.lua"), encoding="utf-8").read()
    # The name is not always the first field (a zone waiting for its story says "pending" first).
    for i, n in re.findall(r'^\t\[(\d+)\] = \{\r?\n(?:\t\t(?!name )[^\n]*\n)*\t\tname = "([^"]+)"', text, re.M):
        zones[safe(n)] = int(i)
    parent = key = None
    for line in open(os.path.join(DATA, "Subzones.lua"), encoding="utf-8").read().splitlines():
        m = re.match(r"^\t\[(\d+)\] = \{", line)
        if m:
            parent = int(m.group(1))
            continue
        m = re.match(r'^\t\t\["([^"]+)"\] = \{', line)
        if m:
            key = m.group(1)
            continue
        m = re.match(r'^\t\t\tname = "([^"]*)"', line)
        if m and parent and key:
            areas.setdefault(parent, {})[safe(m.group(1))] = (key, m.group(1))
    return zones, areas


def source_index():
    """Every downloaded original, by the md5 of its bytes: the wiki file it came from."""
    index = {}
    for sub in ("gallery", "raw"):
        folder = os.path.join(CACHE, sub)
        for f in os.listdir(folder) if os.path.isdir(folder) else []:
            index.setdefault(hashlib.md5(open(os.path.join(folder, f), "rb").read()).hexdigest(), f)
    return index


def reviewed(choices):
    """The reviewed places: { id, parent, key, title, path, old } for each "<place> - new.png"."""
    zones, areas = lore_names()
    world = os.path.join(choices, "Azeroth")
    found, homed = [], set()
    for dp, _, fs in os.walk(world):
        # Azeroth[/<continent>]/<zone>[/<city>][/<area>], the tree Lore of Azeroth shows: a zone such
        # as Zephras Isle sits straight under Azeroth, a city inside the zone around it, and the
        # world and each continent are places too.
        rel = ["Azeroth"] + [p for p in os.path.relpath(dp, world).split(os.sep) if p != "."]
        name = rel[-1]
        zone = len(rel) > 1 and zones.get(rel[-2])
        area = zone if zone and name in areas.get(zone, {}) else None
        if name in zones and not area:
            homed.add(name)
        if name + " - new.png" in fs:
            old = next((f for f in fs if f.startswith(name + " - old")), None)
            found.append((rel, area, {"path": os.path.join(dp, name + " - new.png"), "old": old and os.path.join(dp, old)}))

    # A zone with a folder of its own somewhere (Eastern Kingdoms/Alterac Mountains, Riverglades)
    # makes a folder of that name inside a zone (Hillsbrad Foothills/Alterac Mountains,
    # Riverglades/Riverglades) that zone's area. A city has no such folder: Elwynn Forest/Stormwind
    # City is the city.
    cities = zones.keys() - homed
    out, unknown = [], []
    for rel, area, entry in found:
        name = rel[-1]
        if area and name not in cities:
            key, title = areas[area][name]
            # The manifest id, as fetch.mjs entries() spells it.
            slug = re.sub(r"[^a-z0-9]+", "-", key).strip("-")
            out.append({**entry, "id": "%d-%s" % (area, slug), "parent": area, "key": key, "title": title})
        elif name in zones:
            zid = zones[name]
            out.append({**entry, "id": "zone-%d" % zid, "parent": zid, "key": None, "title": name})
        else:
            unknown.append("/".join(rel))
    return out, unknown


def twins(placed):
    """Places the lore lists twice, given the picture of the one reviewed: a city as an area of the
    zone around it (Elwynn Forest/Stormwind City), Hillsbrad's Alterac Mountains, Ruins of Alterac
    and Uplands, a Forever zone as one of its own areas. They have no folder of their own, so
    without this their rows show no picture."""
    _, areas = lore_names()
    have = {(p["parent"], p.get("key")) for p in placed}
    # By name, a zone's picture before an area's.
    by_name = {}
    for p in sorted(placed, key=lambda p: p.get("key") is not None):
        by_name.setdefault(safe(p["title"]).lower(), p)
    out = []
    for parent, names in areas.items():
        for name, (key, title) in names.items():
            twin = by_name.get(name.lower())
            if twin and (parent, key) not in have:
                out.append({**twin, "id": "%d-%s" % (parent, key), "parent": parent, "key": key, "title": title})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--choices", default=CHOICES)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    places, unknown = reviewed(args.choices)
    sources = source_index()
    by_hand = json.load(open(os.path.join(HERE, "sources.json"), encoding="utf-8"))
    os.makedirs(OUT, exist_ok=True)
    masks = [make_mask(i + 1) for i in range(MASKS)]
    for i, mask in enumerate(masks):
        save_mask(mask, os.path.join(OUT, "Mask%d.blp" % (i + 1)))
    baked = baked_masks()
    mask_of = deal_masks(places, baked)
    placed, written, shared = [], 0, {}
    for p in sorted(places, key=lambda p: p["id"]):
        # One texture for a picture several places share (a subzone listed under two zones):
        # the first place's, its mask and all.
        same = hashlib.md5(open(p["path"], "rb").read()).hexdigest()
        if same in shared:
            chosen = shared[same]
        else:
            chosen = {"texture": p["id"], "mask": mask_of[p["id"]]}
            shared[same] = chosen
            out = os.path.join(OUT, p["id"] + ".blp")
            if args.force or not os.path.exists(out) or baked.get(p["id"]) != chosen["mask"]:
                save_blp(prepare(Image.open(p["path"]).convert("RGB"), masks[chosen["mask"] - 1], p["id"]), out)
                written += 1
        md5 = p["old"] and hashlib.md5(open(p["old"], "rb").read()).hexdigest()
        placed.append({**p, **chosen, "source": by_hand.get(p["id"]) or sources.get(md5)})
        sys.stdout.write("\r  %d placed" % len(placed))
    sys.stdout.write("\n")
    shown_twice = twins(placed)
    placed += shown_twice

    write_lua(placed)
    write_credits(placed)
    # Pictures no reviewed place uses go.
    keep = {pl["texture"] + ".blp" for pl in placed} | {"Mask%d.blp" % (i + 1) for i in range(MASKS)} | {"CREDITS.md"}
    for f in os.listdir(OUT):
        if f not in keep:
            os.remove(os.path.join(OUT, f))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    # A place listed twice is credited under its twin.
    missing = [pl["id"] for pl in placed if not pl["source"] and pl not in shown_twice]
    print("written %d, placed %d (%d listed twice), textures %d, folder %.1f MB"
          % (written, len(placed), len(shown_twice), len(shared), total / 1e6))
    if unknown:
        print("folders not in the lore, skipped:", unknown)
    if missing:
        print("source not found for:", missing)


if __name__ == "__main__":
    main()
