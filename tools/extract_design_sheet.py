"""Extract ordered desktop-pet poses without semantic image understanding.

The script uses only pixel thresholds, projection runs, flood-fill and the
left-to-right/top-to-bottom ordering of the supplied movement sheet.
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


EXPECTED_COLUMNS = (6, 5, 6)
LABEL_BAND_RATIOS = ((0.292, 0.343), (0.600, 0.650), (0.905, 0.958))
ROW_TOP_RATIOS = (0.0, 0.344, 0.652)

# Source-space boxes reviewed after the initial no-vision extraction.  They
# prevent props or decoration near a column boundary from being assigned to
# the neighbouring pose. Coordinates target the 1536x1024 source and scale
# proportionally if the same sheet is resized.
VISION_REVIEWED_SOURCE_BOXES = (
    (1, 1, 35, 8, 270, 300),
    (1, 2, 275, 8, 485, 300),
    (1, 3, 515, 8, 740, 300),
    (1, 4, 770, 5, 1084, 300),
    (1, 5, 1085, 48, 1275, 300),
    (1, 6, 1295, 45, 1528, 300),
    (2, 1, 30, 370, 310, 610),
    (2, 2, 320, 365, 575, 610),
    (2, 3, 605, 370, 820, 610),
    (2, 4, 855, 365, 1080, 610),
    (2, 5, 1125, 360, 1475, 610),
    (3, 1, 45, 660, 280, 930),
    (3, 2, 290, 665, 475, 930),
    (3, 3, 455, 655, 720, 930),
    (3, 4, 740, 665, 990, 930),
    (3, 5, 1045, 660, 1280, 930),
    (3, 6, 1285, 665, 1480, 930),
)


def projection_runs(values: np.ndarray, gap: int = 8) -> list[tuple[int, int]]:
    indices = np.flatnonzero(values > 1)
    if not len(indices):
        return []
    runs: list[tuple[int, int]] = []
    start = previous = int(indices[0])
    for raw_index in indices[1:]:
        index = int(raw_index)
        if index > previous + gap:
            runs.append((start, previous))
            start = index
        previous = index
    runs.append((start, previous))
    return runs


def merge_label_fragments(runs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    wide = [run for run in runs if run[1] - run[0] > 15]
    merged: list[list[int]] = []
    for start, end in wide:
        if merged and start - merged[-1][1] <= 32:
            merged[-1][1] = end
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def connected_edge_background(rgb: np.ndarray) -> np.ndarray:
    height, width = rgb.shape[:2]
    lightest = rgb.max(axis=2)
    darkest = rgb.min(axis=2)
    near_white = (darkest >= 220) & ((lightest - darkest) <= 34)
    background = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    def add(y: int, x: int) -> None:
        if near_white[y, x] and not background[y, x]:
            background[y, x] = True
            queue.append((y, x))

    for x in range(width):
        add(0, x)
        add(height - 1, x)
    for y in range(height):
        add(y, 0)
        add(y, width - 1)

    while queue:
        y, x = queue.popleft()
        if y > 0:
            add(y - 1, x)
        if y + 1 < height:
            add(y + 1, x)
        if x > 0:
            add(y, x - 1)
        if x + 1 < width:
            add(y, x + 1)

    alpha = np.where(background, 0, 255).astype(np.uint8)
    adjacent_to_background = np.zeros_like(background)
    adjacent_to_background[1:, :] |= background[:-1, :]
    adjacent_to_background[:-1, :] |= background[1:, :]
    adjacent_to_background[:, 1:] |= background[:, :-1]
    adjacent_to_background[:, :-1] |= background[:, 1:]
    edge = (~background) & adjacent_to_background
    color_alpha = np.clip((255 - darkest.astype(np.int16)) * (255 / 35), 0, 255).astype(np.uint8)
    alpha[edge] = np.minimum(alpha[edge], color_alpha[edge])
    return alpha


def remove_white_matte(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    clean = rgb.astype(np.float32)
    opacity = alpha.astype(np.float32) / 255
    partial = (alpha > 0) & (alpha < 255)
    if np.any(partial):
        a = opacity[partial, None]
        clean[partial] = (clean[partial] - 255 * (1 - a)) / np.maximum(a, 1 / 255)
    clean = np.clip(clean, 0, 255).astype(np.uint8)
    clean[alpha == 0] = 0
    return clean


def content_bbox(rgb: np.ndarray) -> tuple[int, int, int, int]:
    foreground = np.any(rgb < 247, axis=2)
    ys, xs = np.nonzero(foreground)
    if not len(xs):
        raise ValueError("A detected action slot contains no foreground pixels")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def extract_blue_palette(source: Path) -> list[dict[str, object]]:
    pixels = np.asarray(Image.open(source).convert("RGB")).reshape(-1, 3)
    blue = (
        (pixels[:, 2] > pixels[:, 0] * 1.10)
        & (pixels[:, 2] > pixels[:, 1] * 1.02)
        & (pixels[:, 2] > 70)
    )
    quantized = (pixels[blue] // 16) * 16 + 8
    colors, counts = np.unique(quantized, axis=0, return_counts=True)
    order = np.argsort(counts)[-12:][::-1]
    return [
        {
            "hex": "#{:02X}{:02X}{:02X}".format(*colors[index]),
            "pixels": int(counts[index]),
        }
        for index in order
    ]


def main() -> None:
    if len(sys.argv) not in (3, 4):
        raise SystemExit(
            "Usage: extract_design_sheet.py MOVEMENT_SHEET OUTPUT_DIRECTORY [CHARACTER_SHEET]"
        )

    source = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    character_sheet = Path(sys.argv[3]).resolve() if len(sys.argv) == 4 else None
    output.mkdir(parents=True, exist_ok=True)

    image = Image.open(source).convert("RGB")
    pixels = np.asarray(image)
    height, width = pixels.shape[:2]
    red, green, blue = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2]
    blue_pixels = (blue > 120) & (blue > red * 1.18) & (blue > green * 1.05)

    label_bands: list[tuple[int, int]] = []
    groups_by_row: list[list[tuple[int, int]]] = []
    for row_index, (start_ratio, end_ratio) in enumerate(LABEL_BAND_RATIOS):
        y0, y1 = round(height * start_ratio), round(height * end_ratio)
        label_bands.append((y0, y1))
        projection = blue_pixels[y0:y1].sum(axis=0)
        groups = merge_label_fragments(projection_runs(projection))
        if len(groups) != EXPECTED_COLUMNS[row_index]:
            raise ValueError(
                f"Row {row_index + 1}: detected {len(groups)} action labels; "
                f"expected {EXPECTED_COLUMNS[row_index]}"
            )
        groups_by_row.append(groups)

    extracted: list[dict[str, object]] = []
    rgba_frames: list[Image.Image] = []
    scale_x = width / 1536
    scale_y = height / 1024
    for pose_number, reviewed_box in enumerate(VISION_REVIEWED_SOURCE_BOXES, start=1):
        row, column, raw_x0, raw_y0, raw_x1, raw_y1 = reviewed_box
        slot_x0, y0 = round(raw_x0 * scale_x), round(raw_y0 * scale_y)
        slot_x1, y1 = round(raw_x1 * scale_x), round(raw_y1 * scale_y)
        slot = pixels[y0:y1, slot_x0:slot_x1]
        box = content_bbox(slot)
        x0, local_y0, x1, local_y1 = box
        padding = 7
        x0 = max(0, x0 - padding)
        local_y0 = max(0, local_y0 - padding)
        x1 = min(slot.shape[1], x1 + padding)
        local_y1 = min(slot.shape[0], local_y1 + padding)
        crop = slot[local_y0:local_y1, x0:x1].copy()
        alpha = connected_edge_background(crop)
        if pose_number == 14:
            # The star effects begin left of the character and overlap the
            # previous cell's blue hair. Keep warm sparkle pixels, discard
            # unrelated blue fragments in that overlap strip.
            source_x = slot_x0 + x0 + np.arange(crop.shape[1])
            overlap = source_x < round(490 * scale_x)
            warm = (
                (crop[:, :, 0] > 170)
                & (crop[:, :, 1] > 80)
                & (crop[:, :, 0] > crop[:, :, 2] * 1.20)
            )
            alpha[:, overlap] = np.where(warm[:, overlap], alpha[:, overlap], 0)
        crop = remove_white_matte(crop, alpha)
        crop[alpha == 0] = 0
        rgba = np.dstack((crop, alpha))
        frame = Image.fromarray(rgba, "RGBA")
        rgba_frames.append(frame)
        extracted.append({
            "pose": pose_number,
            "row": row,
            "column": column,
            "label_bounds": list(groups_by_row[row - 1][column - 1]),
            "reviewed_slot_bounds": [slot_x0, y0, slot_x1, y1],
            "source_bounds": [slot_x0 + x0, y0 + local_y0, slot_x0 + x1, y0 + local_y1],
            "opaque_pixels": int(np.count_nonzero(alpha > 127)),
            "frame_size": list(frame.size),
        })

    canvas_width = max(frame.width for frame in rgba_frames) + 24
    canvas_height = max(frame.height for frame in rgba_frames) + 24
    canvas_frames: list[Image.Image] = []
    for index, frame in enumerate(rgba_frames, start=1):
        canvas = Image.new("RGBA", (canvas_width, canvas_height), (0, 0, 0, 0))
        x = (canvas_width - frame.width) // 2
        y = canvas_height - frame.height - 12
        canvas.alpha_composite(frame, (x, y))
        canvas_frames.append(canvas.copy())
        canvas.save(
            output / f"pose-{index:02d}.webp",
            "WEBP",
            lossless=True,
            method=6,
            exact=True,
        )

    sample_indices = (0, 2, 9, 14)
    backgrounds = (
        (0, 112, 235, 255),
        (255, 0, 170, 255),
        (18, 24, 44, 255),
        (255, 255, 255, 255),
    )
    qa = Image.new("RGBA", (canvas_width * 4, canvas_height * len(sample_indices)))
    for row, frame_index in enumerate(sample_indices):
        for column, color in enumerate(backgrounds):
            background = Image.new("RGBA", (canvas_width, canvas_height), color)
            background.alpha_composite(canvas_frames[frame_index])
            qa.alpha_composite(background, (column * canvas_width, row * canvas_height))
    qa.convert("RGB").save(output / "cutout-qa.png")

    report = {
        "method": "pixel-projection-validation-plus-vision-reviewed-boxes-and-edge-flood-fill",
        "visual_review": "v3: preserve original white headpiece and lace details; drag debris is cleaned only in the drag pipeline",
        "source": source.name,
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "source_size": [width, height],
        "label_bands": [list(band) for band in label_bands],
        "detected_columns": [len(groups) for groups in groups_by_row],
        "canvas_size": [canvas_width, canvas_height],
        "frames": extracted,
    }
    if character_sheet:
        report["character_sheet"] = character_sheet.name
        report["character_sheet_sha256"] = hashlib.sha256(character_sheet.read_bytes()).hexdigest()
        report["character_sheet_blue_palette"] = extract_blue_palette(character_sheet)
    (output / "extraction-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "source_size": report["source_size"],
        "detected_columns": report["detected_columns"],
        "frames": len(extracted),
        "canvas_size": report["canvas_size"],
        "output": str(output),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
