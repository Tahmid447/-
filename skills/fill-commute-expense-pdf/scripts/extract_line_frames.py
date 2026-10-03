#!/usr/bin/env python3
"""Extract ordered, timestamped PNG frames from one or more screen recordings."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


SKILL_DIR = Path(__file__).resolve().parents[1]
SWIFT_HELPER = SKILL_DIR / "scripts" / "extract_video_frames.swift"


class IntakeError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_fresh_directory(path: Path) -> None:
    if path.exists() and any(path.iterdir()):
        raise IntakeError(f"Use a fresh empty output directory: {path}")
    path.mkdir(parents=True, exist_ok=True)


def run_checked(command: list[str]) -> subprocess.CompletedProcess[str]:
    process = subprocess.run(command, capture_output=True, text=True, check=False)
    if process.returncode != 0:
        message = process.stderr.strip() or process.stdout.strip()
        raise IntakeError(f"Video extraction failed: {message}")
    return process


def extract_with_swift(
    source: Path, destination: Path, interval: float, max_frames: int
) -> dict[str, Any]:
    swiftc = shutil.which("swiftc")
    if not swiftc or not SWIFT_HELPER.is_file():
        raise IntakeError("The macOS Swift video helper is unavailable")
    with tempfile.TemporaryDirectory(prefix="commute-video-extractor-") as directory:
        executable = Path(directory) / "extract-video-frames"
        run_checked(
            [
                swiftc,
                "-parse-as-library",
                str(SWIFT_HELPER),
                "-o",
                str(executable),
            ]
        )
        run_checked(
            [
                str(executable),
                str(source),
                str(destination),
                str(interval),
                str(max_frames),
            ]
        )
    manifest_path = destination / "manifest.json"
    if not manifest_path.is_file():
        raise IntakeError("Swift helper did not create a manifest")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def extract_with_ffmpeg(
    source: Path, destination: Path, interval: float, max_frames: int
) -> dict[str, Any]:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise IntakeError("FFmpeg and ffprobe are required outside macOS")
    probe = run_checked(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(source),
        ]
    )
    try:
        duration = float(json.loads(probe.stdout)["format"]["duration"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise IntakeError(f"Could not read video duration: {source}") from exc
    estimated = int(math.floor(duration / interval)) + 1
    if estimated > max_frames:
        raise IntakeError(
            f"Video would create about {estimated} frames; increase --interval or --max-frames"
        )
    run_checked(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            str(source),
            "-vf",
            f"fps=1/{interval}",
            "-vsync",
            "vfr",
            str(destination / "frame-%06d.png"),
        ]
    )
    frame_paths = sorted(destination.glob("frame-*.png"))
    if not frame_paths:
        raise IntakeError(f"No frames were extracted from {source}")
    frames = [
        {
            "file": path.name,
            "requested_seconds": round(index * interval, 3),
            "actual_seconds": None,
        }
        for index, path in enumerate(frame_paths)
    ]
    manifest = {
        "source_video": str(source),
        "source_sha256": sha256_file(source),
        "duration_seconds": duration,
        "interval_seconds": interval,
        "frame_count": len(frames),
        "frames": frames,
        "extractor": "ffmpeg",
    }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def extract_one(
    source: Path, destination: Path, interval: float, max_frames: int
) -> dict[str, Any]:
    destination.mkdir(parents=True, exist_ok=False)
    if sys.platform == "darwin" and shutil.which("swiftc"):
        return extract_with_swift(source, destination, interval, max_frames)
    return extract_with_ffmpeg(source, destination, interval, max_frames)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract timestamped PNG frames from LINE screen recordings"
    )
    parser.add_argument(
        "--input-video", action="append", required=True, type=Path,
        help="Input video; repeat for multiple recordings",
    )
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--max-frames", type=int, default=1800)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.interval <= 0:
            raise IntakeError("--interval must be greater than zero")
        if args.max_frames < 1:
            raise IntakeError("--max-frames must be positive")
        output_dir = args.output_dir.expanduser().resolve()
        ensure_fresh_directory(output_dir)
        videos = []
        for index, input_path in enumerate(args.input_video, start=1):
            source = input_path.expanduser().resolve()
            if not source.is_file():
                raise IntakeError(f"Video not found: {source}")
            destination = output_dir / f"video-{index:02d}"
            videos.append(extract_one(source, destination, args.interval, args.max_frames))
        root_manifest = {
            "status": "frames_extracted",
            "video_count": len(videos),
            "total_frames": sum(video["frame_count"] for video in videos),
            "videos": videos,
        }
        (output_dir / "manifest.json").write_text(
            json.dumps(root_manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (IntakeError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(
        json.dumps(
            {
                "status": root_manifest["status"],
                "video_count": root_manifest["video_count"],
                "total_frames": root_manifest["total_frames"],
                "output_dir": str(output_dir),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
