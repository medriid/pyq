import os
from pathlib import Path
from typing import List, Tuple
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from tqdm import tqdm
from PIL import Image
import numpy as np

# Globals for multiprocessing
WM_VALUES = None
WM_TOLERANCE = None
WM_BACKUP = None
WM_OUTPUT_SUFFIX = None


def _init_worker(wm_values: np.ndarray, tolerance: int, backup: bool, output_suffix: str) -> None:
    global WM_VALUES, WM_TOLERANCE, WM_BACKUP, WM_OUTPUT_SUFFIX
    WM_VALUES = wm_values
    WM_TOLERANCE = tolerance
    WM_BACKUP = backup
    WM_OUTPUT_SUFFIX = output_suffix


def _pack_rgb(img_array: np.ndarray) -> np.ndarray:
    r = img_array[:, :, 0].astype(np.uint32)
    g = img_array[:, :, 1].astype(np.uint32)
    b = img_array[:, :, 2].astype(np.uint32)
    return (r << 16) | (g << 8) | b


def _build_watermark_values(colors: List[Tuple[int, int, int]], tolerance: int) -> np.ndarray:
    values = set()
    for r, g, b in colors:
        for dr in range(-tolerance, tolerance + 1):
            rr = min(255, max(0, r + dr))
            for dg in range(-tolerance, tolerance + 1):
                gg = min(255, max(0, g + dg))
                for db in range(-tolerance, tolerance + 1):
                    bb = min(255, max(0, b + db))
                    values.add((rr << 16) | (gg << 8) | bb)
    return np.fromiter(values, dtype=np.uint32)


def _detect_mask_fast(img_array: np.ndarray) -> np.ndarray:
    # Convert to RGB if needed
    if len(img_array.shape) == 2:
        img_array = np.stack([img_array] * 3, axis=-1)
    elif img_array.shape[2] == 4:
        img_array = img_array[:, :, :3]

    packed = _pack_rgb(img_array)
    mask = np.isin(packed, WM_VALUES)

    # Additional light grayish watermark variants
    r = img_array[:, :, 0].astype(np.int16)
    g = img_array[:, :, 1].astype(np.int16)
    b = img_array[:, :, 2].astype(np.int16)
    brightness = (r.astype(np.int32) + g.astype(np.int32) + b.astype(np.int32)) / 3
    color_variance = np.maximum(np.maximum(np.abs(r - g), np.abs(g - b)), np.abs(r - b))
    additional = (brightness > 238) & (brightness < 250) & (color_variance < 12)
    mask = mask | additional

    # Exclude dark pixels
    mask = mask & (brightness >= 180)

    return mask


def _process_image(image_path: str) -> bool:
    try:
        image = Image.open(image_path)
        original_mode = image.mode

        if image.mode not in ['RGB', 'L']:
            image = image.convert('RGB')
        elif image.mode == 'L':
            image = image.convert('RGB')

        img_array = np.array(image)
        mask = _detect_mask_fast(img_array)

        img_array[mask] = [255, 255, 255]

        result = Image.fromarray(img_array)
        if original_mode in ['P', 'PA']:
            result = result.convert('RGB')
        elif original_mode == 'L':
            result = result.convert('L')

        if WM_OUTPUT_SUFFIX:
            path = Path(image_path)
            output_path = str(path.parent / f"{path.stem}{WM_OUTPUT_SUFFIX}{path.suffix}")
        else:
            if WM_BACKUP:
                backup_path = image_path + ".backup"
                if not os.path.exists(backup_path):
                    import shutil
                    shutil.copy2(image_path, backup_path)
            output_path = image_path

        if image_path.lower().endswith('.jpg') or image_path.lower().endswith('.jpeg'):
            result.save(output_path, 'JPEG', quality=90, optimize=False)
        elif image_path.lower().endswith('.png'):
            result.save(output_path, 'PNG', optimize=False, compress_level=1)
        else:
            result.save(output_path)

        return True
    except Exception as e:
        print(f"Error processing {image_path}: {str(e)}")
        return False


class WatermarkRemover:
    """Class to handle watermark detection and removal from images."""

    def __init__(self, backup: bool = False, output_suffix: str = ""):
        self.backup = backup
        self.output_suffix = output_suffix
    
    def find_all_images(self, root_dir: str, years: tuple = (2024, 2025)) -> List[str]:
        """
        Find all image files in the directory tree for specific years.
        
        Args:
            root_dir: Root directory to search
            years: Tuple of years to include (default: (2024, 2025))
        
        Returns:
            List of image file paths
        """
        image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'}
        image_files = []
        
        for root, dirs, files in os.walk(root_dir):
            # Check if year is in path
            if not any(f"/{year}/" in root for year in years):
                continue
            
            for file in files:
                if Path(file).suffix.lower() in image_extensions:
                    # Skip backup files
                    if file.endswith('.backup'):
                        continue
                    # Skip already processed files (only if suffix is not empty)
                    if self.output_suffix and self.output_suffix in file:
                        continue
                    image_files.append(os.path.join(root, file))
        
        return image_files
    
    def process_directory(self, directory: str, 
                         region: str = "bottom",
                         threshold: int = 200,
                         max_workers: int = 4,
                         years: tuple = (2024, 2025)) -> Tuple[int, int]:
        """
        Process all images in a directory for specific years.
        
        Args:
            directory: Directory containing images
            region: Watermark region
            threshold: Brightness threshold
            max_workers: Number of parallel workers
            years: Tuple of years to include (default: (2024, 2025))
        
        Returns:
            Tuple of (successful_count, total_count)
        """
        print(f"Scanning for images in {directory} (years: {years})...")
        image_files = self.find_all_images(directory, years=years)
        total = len(image_files)
        
        print(f"Found {total} images to process")
        
        if total == 0:
            return 0, 0
        
        successful = 0
        
        # Define watermark colors (MARKS branding colors detected from analysis)
        watermark_colors = [
            (237, 237, 238),
            (237, 246, 254),
            (236, 236, 237),
            (236, 245, 253),
            (254, 254, 254),
            (240, 247, 253),
            (241, 248, 254),
            (252, 253, 254),
            (253, 254, 255),
            (238, 246, 254),
            (235, 244, 252),
            (231, 231, 233),
            (231, 243, 253),
            (230, 242, 252),
            (228, 228, 230),
            (230, 230, 232),
            (229, 241, 251),
            (229, 229, 231),
        ]

        wm_values = _build_watermark_values(watermark_colors, threshold)

        # Process images with multiprocessing for speed
        with ProcessPoolExecutor(
            max_workers=max_workers,
            initializer=_init_worker,
            initargs=(wm_values, threshold, self.backup, self.output_suffix),
        ) as executor:
            with tqdm(total=total, desc="Processing images") as pbar:
                for ok in executor.map(_process_image, image_files, chunksize=32):
                    if ok:
                        successful += 1
                    pbar.update(1)
        
        return successful, total


def main():
    """Main function to run the watermark remover."""
    parser = argparse.ArgumentParser(
        description="Remove watermarks from images by replacing with white (#FFFFFF)"
    )
    parser.add_argument(
        "--directory",
        "-d",
        default="pyq_export",
        help="Root directory containing images (default: pyq_export)"
    )
    parser.add_argument(
        "--region",
        "-r",
        choices=["center", "full", "auto"],
        default="center",
        help="Watermark region (default: center - scans entire image)"
    )
    parser.add_argument(
        "--threshold",
        "-t",
        type=int,
        default=1,
        help="Color tolerance for watermark color matching (default: 1, decrease for speed)"
    )
    parser.add_argument(
        "--backup",
        "-b",
        action="store_true",
        help="Create .backup files of originals before overwriting (default: no backup)"
    )
    parser.add_argument(
        "--keep-originals",
        "-k",
        action="store_true",
        help="Create new files with _nowm suffix instead of overwriting"
    )
    parser.add_argument(
        "--years",
        "-y",
        nargs="+",
        type=int,
        default=[2024, 2025],
        help="Years to process (default: 2024 2025)"
    )
    parser.add_argument(
        "--workers",
        "-w",
        type=int,
        default=os.cpu_count() or 4,
        help="Number of parallel workers (default: CPU count)"
    )
    
    args = parser.parse_args()
    
    # Validate directory
    if not os.path.exists(args.directory):
        print(f"Error: Directory '{args.directory}' does not exist")
        return 1
    
    # Create remover instance
    output_suffix = "_nowm" if args.keep_originals else ""
    remover = WatermarkRemover(backup=args.backup, output_suffix=output_suffix)
    
    # Process directory
    print("\n" + "="*60)
    print("Watermark Removal Tool - Color Replacement Method")
    print("="*60)
    print(f"Directory: {args.directory}")
    print(f"Years: {args.years}")
    print(f"Region: {args.region}")
    print(f"Threshold: {args.threshold}")
    print(f"Mode: {'Keep originals (_nowm suffix)' if args.keep_originals else 'OVERWRITE originals'}")
    print(f"Backup: {'Yes (.backup files)' if args.backup else 'No'}")
    print(f"Workers: {args.workers}")
    print("="*60 + "\n")
    
    successful, total = remover.process_directory(
        args.directory,
        region=args.region,
        threshold=args.threshold,
        max_workers=args.workers,
        years=tuple(args.years)
    )
    
    # Print summary
    print("\n" + "="*60)
    print(f"Processing complete!")
    print(f"Successfully processed: {successful}/{total} images")
    if successful < total:
        print(f"Failed: {total - successful} images")
    print("="*60)
    
    return 0 if successful == total else 1


if __name__ == "__main__":
    exit(main())
