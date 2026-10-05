"""Verify the default five-section 2D export, independently of the .NET renderer.

uv run --no-project --with pymupdf --with pillow python scripts/verify-frameweb-exports.py <client-output> [--render]
"""
import argparse
import hashlib
import json
from pathlib import Path

import pymupdf


def verify(directory: Path, render: bool) -> dict:
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["ok"] and manifest["executionStatus"] == "success"
    for artifact in manifest["artifacts"]:
        assert artifact["name"] in {"result.json", "pickup.pik", "report.pdf", "pickup-displacement.csv", "pickup-reaction.csv"}
        data = (directory / artifact["name"]).read_bytes()
        assert len(data) == artifact["bytes"]
        assert hashlib.sha256(data).hexdigest() == artifact["sha256"]
    result = json.loads((directory / "result.json").read_text(encoding="utf-8"))
    topology = result["analysisResultSet"]["topology"]
    members = {member["member_id"]: member for member in topology["members"]}
    selections = {}
    for pickup in result["derived"]["pickups"]:
        for mode, rows in pickup["sectionForces"].items():
            selections[pickup["id"], mode] = {(row["entityId"], row["stationId"]): row for row in rows}

    rows = (directory / "pickup.pik").read_text(encoding="utf-8").splitlines()[1:]
    seen = set()
    for line in rows:
        assert len(line) == 100, f"Unexpected PIK row length: {len(line)}"
        pickup, focus, member, max_case, min_case, point = [line[i:i + 5].strip() for i in range(0, 30, 5)]
        stations = members[member]["stations"]
        index = 0 if point == "ITAN" else len(stations) - 1 if point == "JTAN" else int(point)
        station = stations[index]
        mode = {"M": "mz", "S": "fy", "N": "fx"}[focus]
        identity = pickup, mode, member, station["station_id"]
        assert identity not in seen, f"Duplicate PIK row: {identity}"
        seen.add(identity)
        assert abs(float(line[30:40]) - station["position"]) <= 0.000501
        for side, source_case, start in [("max", max_case, 40), ("min", min_case, 70)]:
            selected = selections[pickup, mode + "_" + side][member, station["station_id"]]
            assert selected["sourceCaseId"] == source_case
            for component, offset in zip(["mz", "fy", "fx"], range(start, start + 30, 10)):
                assert abs(float(line[offset:offset + 10]) - selected["components"][component]) <= 0.005001
    expected = {(pickup, mode[:-4], member, station) for (pickup, mode), selection in selections.items()
                if mode.endswith("_max") for member, station in selection}
    assert seen == expected, "PIK rows do not cover the selected engineering envelopes"

    doc = pymupdf.open(directory / "report.pdf")
    headings = {
        "input": "格点データ", "displacement": "変位量データ", "section_force": "断面力データ",
        "pickup_displacement": "Pickup変位量", "pickup_section_force": "Pickup断面力",
    }
    texts = [page.get_text() for page in doc]
    assert all(text.strip() for text in texts), "Blank PDF page"
    pages_by_section = {key: [i + 1 for i, text in enumerate(texts) if title in text]
                        for key, title in headings.items()}
    assert all(pages_by_section.values()), "Missing PDF section"
    # Long internal IDs previously clipped off the page although text bbox checks passed.
    generated_ids = {node["node_id"] for node in topology["nodes"] if node["node_id"].startswith("generated:")}
    for key in ["displacement", "pickup_displacement"]:
        text = "\n".join(texts[page - 1] for page in pages_by_section[key])
        assert all(node_id in text for node_id in generated_ids), f"Clipped/missing generated node IDs in {key}"
    for page in doc:
        for x0, y0, x1, y1, *_ in page.get_text("blocks"):
            assert x0 >= -1 and y0 >= -1 and x1 <= page.rect.width + 1 and y1 <= page.rect.height + 1

    if render:
        from PIL import Image, ImageDraw
        qa = directory / "qa"
        qa.mkdir(exist_ok=True)
        samples = {pages[0] for pages in pages_by_section.values()} | {len(doc)}
        for index, page in enumerate(doc):
            if index % 20 == 0:
                contact = Image.new("RGB", (920, 1700), "#bbbbbb")
            pix = page.get_pixmap(matrix=pymupdf.Matrix(0.45, 0.45))
            thumb = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            thumb.thumbnail((220, 312))
            x, y = index % 4 * 230, index % 20 // 4 * 340
            contact.paste(thumb, (x, y + 20))
            ImageDraw.Draw(contact).text((x + 5, y + 3), str(index + 1), fill="black")
            if index % 20 == 19 or index == len(doc) - 1:
                contact.save(qa / f"contact-{index // 20 + 1}.png")
            if index + 1 in samples:
                page.get_pixmap(matrix=pymupdf.Matrix(1.4, 1.4)).save(qa / f"page-{index + 1}.png")
    return {"pages": len(doc), "pikRows": len(rows), "sections": pages_by_section,
            "generatedNodeIds": len(generated_ids), "artifactsVerified": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--render", action="store_true")
    args = parser.parse_args()
    print(json.dumps(verify(args.directory, args.render)))
