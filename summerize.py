import os
import argparse
import sys
from pathlib import Path

# Default skip folders/files
DEFAULT_SKIP = {
    ".git",
    "__pycache__",
    "node_modules",
    "venv",
    "collect_files.py",
    "package-lock.json",
    "pipeline.log",
    "summary.txt",
    "token.json",
    "assets",
    "summerize.py",
    ".env",
    ".next",
    ".cache",
    ".vscode",
    "credentials.json",
    "ig_session.json"
}

# Binary detection (simple heuristic)
def is_binary(file_path, chunk_size=1024):
    try:
        with open(file_path, 'rb') as f:
            chunk = f.read(chunk_size)
            return b'\0' in chunk
    except:
        return True


def should_skip(path, skip_set):
    return any(part in skip_set for part in Path(path).parts)


def collect_files(root_dir, skip_set, extensions=None, max_size=None):
    root_dir = Path(root_dir)

    for path in root_dir.rglob("*"):
        if not path.is_file():
            continue

        if should_skip(path, skip_set):
            continue

        if extensions and path.suffix not in extensions:
            continue

        if max_size and path.stat().st_size > max_size:
            continue

        yield path


def format_size(size):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024:
            return f"{size:.2f} {unit}"
        size /= 1024


def write_summary(files, output_file, include_tree=False):

    with open(output_file, "w", encoding="utf-8") as out:
        for file_path in files:
            print(f"Processing: {file_path}")

            try:
                if is_binary(file_path):
                    out.write("\n" + "="*80 + "\n")
                    out.write(f"FILE: {file_path} (binary skipped)\n")
                    continue

                size = file_path.stat().st_size
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()

                out.write("\n" + "="*80 + "\n")
                out.write(f"FILE: {file_path} ({format_size(size)})\n")
                out.write("="*80 + "\n")
                out.write(content + "\n")

            except Exception as e:
                out.write("\n" + "="*80 + "\n")
                out.write(f"FILE: {file_path}\nERROR: {e}\n")


def parse_args():
    parser = argparse.ArgumentParser(description="File Collector & Summarizer")

    parser.add_argument("-d", "--dir", default=".", help="Root directory")
    parser.add_argument("-o", "--output", default="summary.txt", help="Output file")
    parser.add_argument("-e", "--ext", nargs="*", help="Filter by extensions (.py .txt)")
    parser.add_argument("-s", "--skip", nargs="*", help="Additional folders/files to skip")
    parser.add_argument("-m", "--max-size", type=int, help="Max file size in KB")

    return parser.parse_args()


def main():
    args = parse_args()

    skip_set = DEFAULT_SKIP.union(set(args.skip or []))
    extensions = set(args.ext) if args.ext else None
    max_size = args.max_size * 1024 if args.max_size else None

    files = list(collect_files(args.dir, skip_set, extensions, max_size))

    if not files:
        print("No files found.")
        sys.exit(0)

    print(f"Found {len(files)} files. Starting processing...\n")

    write_summary(files, args.output)

    print(f"\nSummary written to {args.output}")


if __name__ == "__main__":
    main()
