import argparse
import os
import random
from pathlib import Path

from remove_watermarks import WatermarkRemover


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Test watermark removal on a sample of images and keep outputs"
    )
    parser.add_argument(
        "--directory",
        "-d",
        default="pyq_export",
        help="Root directory containing images (default: pyq_export)"
    )
    parser.add_argument(
        "--years",
        "-y",
        nargs="+",
        type=int,
        default=[2026],
        help="Years to process (default: 2026)"
    )
    parser.add_argument(
        "--exam",
        "-e",
        default="jee_main__",
        help="Exam filter substring (default: jee_main__)"
    )
    parser.add_argument(
        "--sample",
        "-s",
        type=int,
        default=50,
        help="Number of images to sample (default: 50)"
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for sampling (default: 42)"
    )
    parser.add_argument(
        "--threshold",
        "-t",
        type=int,
        default=1,
        help="Color tolerance for watermark color matching (default: 1)"
    )
    parser.add_argument(
        "--workers",
        "-w",
        type=int,
        default=min(64, (os.cpu_count() or 4) * 4),
        help="Number of parallel workers (default: 4x CPU count, capped at 64)"
    )
    parser.add_argument(
        "--output-suffix",
        default="_testnowm",
        help="Suffix for output images (default: _testnowm)"
    )

    args = parser.parse_args()

    if not os.path.exists(args.directory):
        print(f"Error: Directory '{args.directory}' does not exist")
        return 1

    remover = WatermarkRemover(backup=False, output_suffix=args.output_suffix)

    all_images = remover.find_all_images(
        args.directory,
        years=None if args.years is None else tuple(args.years),
        exam_filter=args.exam or None,
    )
    total = len(all_images)
    if total == 0:
        print("No images found to test.")
        return 1

    sample_count = min(args.sample, total)
    random.seed(args.seed)
    sample_images = random.sample(all_images, sample_count)

    print(f"Sampling {sample_count}/{total} images for testing")
    for path in sample_images:
        print(path)

    successful, total_processed = remover.process_images(
        sample_images,
        threshold=args.threshold,
        max_workers=args.workers,
    )

    report_path = Path("test_outputs_report.txt")
    with report_path.open("w", encoding="utf-8") as f:
        f.write("Test watermark removal report\n")
        f.write(f"Total sampled: {total_processed}\n")
        f.write(f"Successful: {successful}\n\n")
        f.write("Outputs:\n")
        for path in sample_images:
            p = Path(path)
            output_path = p.parent / f"{p.stem}{args.output_suffix}{p.suffix}"
            f.write(f"{path} -> {output_path}\n")

    print(f"Report written to {report_path}")
    return 0 if successful == total_processed else 1


if __name__ == "__main__":
    raise SystemExit(main())
