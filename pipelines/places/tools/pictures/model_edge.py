"""The paper edge laid over a boss's 3D model, so the model's frame fades into the page.

A model cannot be masked like a picture, so a copy of the page's own parchment is laid on top of it
instead (TextView:PaintModelEdge), shown through one of these masks: solid round the border and
clear in the middle, the border frayed the way the pictures' masks are. The parchment comes from the
page, so the edge is the page's colour wherever the model sits.

The game stretches a mask over the whole frame, so its pixel size is not the frame's. It is drawn on a
5:4 canvas, the model's frame, and shipped at 512x256 (a power of two) by stretching that sideways.
The model's flat cut lies EDGE_OVER (6 UI units) in from the frame's border, which is up to HOLD px
of the canvas on the smallest frame (about 136x109) and fewer on larger ones. HOLD is the solid band
the paper keeps round the border, so the cut is covered on every frame size.

    python model_edge.py                  writes addons/Spoken/Textures/ModelEdge1..4.blp (white DXT5, 512x256)
    python model_edge.py --preview [PNG]  also writes a preview of the edges at the game's size
                                          (default: model_edge_preview.png in the temp folder)
"""
import argparse
import os
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import prepare as P  # noqa: E402

ROOT = P.ROOT
OUT = os.path.join(ROOT, "addons/Spoken/Textures")
COUNT = 4
DESIGN_W, DESIGN_H = 320, 256
W, H = 512, 256
HOLD = 14
# The places' generator makes a frame's edge from a seed. Of the twenty tried (400 to 419, the left side as
# deep as the others, as there is no text to line up with) these four, with a HOLD band round them, cover
# the model's cut on frames from 136x109 to 275x220 with no run of alpha under 0.9.
SEEDS = (408, 415, 413, 414)
# The model's cut, in UI units in from the frame's border (EDGE_OVER in TextView.lua), and the model's
# size at the largest frame: the preview's stand-in.
CUT = 6
PREVIEW_MODEL = (275, 220)


def edge(index):
    """Alpha, 0..1, H rows by W columns: 1 where the paper covers the model, 0 where the model shows. The mask
    is the pictures' own (prepare.make_mask, inside the solid HOLD band) and the paper thins over it the way
    their paint does, so a boss's frame is frayed by the same rules as a place's picture."""
    inner = P.make_mask(SEEDS[index - 1], (DESIGN_W - 2 * HOLD, DESIGN_H - 2 * HOLD), 0.0)
    mask = np.pad(inner, HOLD)
    alpha = 1 - mask * (1 - P.paint_thinning(mask, 3))
    wide = Image.fromarray(alpha.astype(np.float32)).resize((W, H), Image.BICUBIC)
    return np.clip(np.asarray(wide), 0, 1)


def preview(path, model=PREVIEW_MODEL):
    """Each edge over a stand-in page and a stand-in model, at the size the game draws the frame. The model is
    a brown backing with a figure that reaches the frame's sides, cut flat CUT in from the border."""
    mw, mh = model
    fw, fh = mw + 2 * CUT, mh + 2 * CUT
    tiles = []
    for i in range(1, COUNT + 1):
        rng = P.seeded("page")
        page = np.tile([0.80, 0.64, 0.42], (fh, fw, 1)) * (1 - 0.06 * (P.noise(rng, fh, fw, 4, 8) - 0.5) * 2)[..., None]
        yy, xx = np.mgrid[0:fh, 0:fw].astype(np.float64)
        inside = ((xx >= CUT) & (xx < fw - CUT) & (yy >= CUT) & (yy < fh - CUT))[..., None]
        figure = ((np.abs(xx - fw / 2) < 0.35 * fw + 0.1 * fw * (yy / fh))).astype(np.float64)[..., None]
        shade = (0.25 + 0.35 * P.noise(P.seeded("fig"), fh, fw, 4, 4))[..., None]
        backing = np.array([0x66, 0x29, 0x0A]) / 255 * 0.2 + page * 0.8
        model_px = backing * (1 - figure) + np.concatenate([shade * 0.9, shade, shade * 0.8], axis=-1) * figure
        scene = np.where(inside, model_px, page)
        a = np.asarray(Image.fromarray(edge(i).astype(np.float32)).resize((fw, fh), Image.BILINEAR))[..., None]
        tiles.append(np.clip(scene * (1 - a) + page * a, 0, 1))
    Image.fromarray((np.concatenate(tiles, axis=1) * 255).astype(np.uint8)).save(path)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", nargs="?", const=os.path.join(tempfile.gettempdir(), "model_edge_preview.png"))
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    for i in range(1, COUNT + 1):
        P.save_blp(Image.fromarray((edge(i) * 255).astype(np.uint8), "L"), os.path.join(OUT, f"ModelEdge{i}.blp"), alpha=True)
    print("wrote", COUNT, "textures to", OUT)
    if args.preview:
        preview(args.preview)
        print("wrote preview to", args.preview)
