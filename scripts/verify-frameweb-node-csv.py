"""Verify downloaded node PICKUP CSVs against the same job's derived selections.

uv run --project FEMPython/FrameWeb --locked python scripts/verify-frameweb-node-csv.py <client-output>
Uses only the Python standard library and never modifies the supplied directory.
"""
import argparse
import csv
import hashlib
import io
import json
import math
import re
import sys
from pathlib import Path


QUANTITIES = {
    "displacement": ("pickup-displacement.csv", "displacements", ("dx", "dy", "dz", "rx", "ry", "rz")),
    "reaction": ("pickup-reaction.csv", "reactions", ("fx", "fy", "fz", "mx", "my", "mz")),
}
NUMERIC_CELL = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
# Match .NET Char.IsWhiteSpace, used by the formatter's TrimStart before CSV neutralization.
DOTNET_WHITESPACE = "\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def csv_text(value: str) -> str:
    require(isinstance(value, str), "Result identifier must be a string")
    trimmed = value.lstrip(DOTNET_WHITESPACE)
    return "'" + value if trimmed and trimmed[0] in "=+-@" else value


def finite_number(value: object, label: str) -> float:
    require(type(value) in (int, float), f"{label}: expected a numeric result")
    number = float(value)
    require(math.isfinite(number), f"{label}: nonfinite result")
    return number


def verify_csv(data: bytes, result: dict, quantity: str) -> int:
    """Check transport and ordered rows, without recalculating extrema or combinations."""
    filename, family, components = QUANTITIES[quantity]
    require(not data.startswith(b"\xef\xbb\xbf"), f"{filename}: UTF-8 BOM is not allowed")
    rows = list(csv.reader(io.StringIO(data.decode("utf-8", errors="strict"), newline=""), strict=True))
    require(len(rows) > 1, f"{filename}: no data rows")
    dimension = result["dimension"]
    require(type(dimension) is int and dimension in (2, 3), "Invalid result dimension")
    analysis = result["analysisResultSet"]
    length, force = analysis["units"]["length"], analysis["units"]["force"]
    require(isinstance(length, str) and isinstance(force, str), "Result units must be strings")
    units = [length] * 3 + ["rad"] * 3 if quantity == "displacement" else [force] * 3 + [force + "*" + length] * 3
    header = ["pickup_id", "focus_component", "node_id", "max_combine_id", "min_combine_id"]
    header += [f"{side}_{component} ({unit})" for side in ("max", "min") for component, unit in zip(components, units)]
    require(rows[0] == header, f"{filename}: 17-column header/order/units mismatch")

    node_order = [node["node_id"] for node in analysis["topology"]["nodes"]]
    require(all(isinstance(node, str) for node in node_order), "Topology node IDs must be strings")
    known_nodes = set(node_order)
    require(len(known_nodes) == len(node_order), "Duplicate topology node IDs")
    eligible_nodes = known_nodes if quantity == "displacement" else {
        row["node_id"] for item in analysis["results"] if item["state"]["kind"] == "static"
        for row in item["support_reactions"]
    }
    require(eligible_nodes <= known_nodes, "Support reactions reference unknown topology nodes")
    combine_ids = [item["id"] for item in result["derived"]["combines"]]
    require(all(isinstance(case, str) for case in combine_ids), "COMBINE IDs must be strings")
    known_combinations = set(combine_ids)
    require(len(known_combinations) == len(combine_ids), "Duplicate COMBINE IDs")
    pickups = result["derived"]["pickups"]
    require(bool(pickups), "No authoritative PICKUP selections")
    pickup_ids = [item["id"] for item in pickups]
    require(len(set(pickup_ids)) == len(pickup_ids), "Duplicate PICKUP IDs")
    focus = (components[0], components[1], components[5]) if dimension == 2 else components
    expected_rows = []
    for pickup in pickups:
        reaction_nodes = None
        for component in focus:
            selected = []
            for side in ("max", "min"):
                mode = component + "_" + side
                by_node = {}
                for row in pickup[family][mode]:
                    node = row["entityId"]
                    label = f"PICKUP {pickup['id']} {mode} node {node}"
                    require(node in eligible_nodes and node not in by_node, f"{label}: unknown/ineligible/duplicate node")
                    require(row.get("stationId") is None, f"{label}: node result has a station ID")
                    require(row["sourceCaseId"] in known_combinations, f"{label}: unknown source COMBINE ID")
                    for name in components:
                        finite_number(row["components"][name], f"{label} {name}")
                    by_node[node] = row
                selected.append(by_node)
            maxima, minima = selected
            nodes = set(maxima)
            require(nodes and nodes == set(minima), f"PICKUP {pickup['id']} {component}: incomplete max/min pairs")
            if quantity == "displacement":
                require(nodes == known_nodes, f"PICKUP {pickup['id']} {component}: displacement topology mismatch")
            elif reaction_nodes is None:
                reaction_nodes = nodes
            else:
                require(nodes == reaction_nodes, f"PICKUP {pickup['id']}: inconsistent reaction node subset")
            for node in node_order:
                if node not in nodes:
                    continue
                maximum, minimum = maxima[node], minima[node]
                identities = [pickup["id"], component, node, maximum["sourceCaseId"], minimum["sourceCaseId"]]
                values = [finite_number(row["components"][name], name) for row in (maximum, minimum) for name in components]
                expected_rows.append(([csv_text(value) for value in identities], values))

    require(len(rows) - 1 == len(expected_rows), f"{filename}: expected {len(expected_rows)} data rows, got {len(rows) - 1}")
    for index, (actual, (identities, values)) in enumerate(zip(rows[1:], expected_rows), start=2):
        label = f"{filename} row {index}"
        require(len(actual) == 17, f"{label}: expected 17 columns")
        require(actual[:5] == identities, f"{label}: PICKUP/focus/node order or source COMBINE mismatch")
        for column, (cell, expected) in enumerate(zip(actual[5:], values), start=5):
            require(NUMERIC_CELL.fullmatch(cell) is not None, f"{label} {header[column]}: invalid numeric cell")
            value = float(cell)
            require(math.isfinite(value), f"{label} {header[column]}: nonfinite number")
            # G17 round-trips binary64 exactly; tolerances would hide rounding/unit conversion.
            require(value == expected, f"{label} {header[column]}: raw correlated value mismatch")
    return len(expected_rows)


def verify(directory: Path) -> dict:
    directory = directory.resolve(strict=True)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    require(manifest["ok"] is True and manifest["executionStatus"] == "success", "Calculation did not succeed")
    require(manifest["engine"] == "fempython", "Expected a FEMPython job")
    permitted = {"result.json", "pickup.pik", "report.pdf", *(spec[0] for spec in QUANTITIES.values())}
    artifacts = {}
    for artifact in manifest["artifacts"]:
        name = artifact["name"]
        require(name in permitted and name not in artifacts, f"Unexpected/duplicate artifact: {name}")
        path = (directory / name).resolve(strict=True)
        require(path.parent == directory, f"Artifact escaped the client directory: {name}")
        require(type(artifact["bytes"]) is int and artifact["bytes"] > 0, f"{name}: invalid manifest byte count")
        require(path.stat().st_size == artifact["bytes"], f"{name}: manifest size mismatch")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        require(digest == artifact["sha256"], f"{name}: manifest SHA-256 mismatch")
        artifacts[name] = path
    require("result.json" in artifacts, "result.json must be a registered artifact")
    selected = [quantity for quantity, spec in QUANTITIES.items() if spec[0] in artifacts]
    require(bool(selected), "At least one node PICKUP CSV is required")
    for filename, _, _ in QUANTITIES.values():
        require(not (directory / filename).exists() or filename in artifacts, f"Unregistered CSV: {filename}")
    result = json.loads(artifacts["result.json"].read_text(encoding="utf-8"))
    require(result["schemaVersion"] == 1 and result["kind"] == "frameweb_analysis", "Unexpected result.json contract")
    counts = {quantity + "Rows": verify_csv(artifacts[QUANTITIES[quantity][0]].read_bytes(), result, quantity)
              for quantity in selected}
    return {"ok": True, "dimension": result["dimension"], "pickups": len(result["derived"]["pickups"]),
            **counts, "artifactsVerified": len(artifacts)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.directory)))
    except (ValueError, KeyError, TypeError, OSError, csv.Error, OverflowError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
