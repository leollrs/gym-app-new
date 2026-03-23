"""
Generate AI food images for all 300 meals in src/data/meals_*.js
Saves PNGs to public/meals/, then patches the JS files to use local paths.
"""

import json
import re
import os
import sys
import time
import urllib.request
import urllib.parse

COMFY_URL = "http://127.0.0.1:8188"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.join(PROJECT_DIR, "public", "meals")
DATA_DIR = os.path.join(PROJECT_DIR, "src", "data")

MEAL_FILES = [
    "meals_high_protein.js",
    "meals_fat_loss.js",
    "meals_lean_bulk.js",
    "meals_mass_gain.js",
    "meals_quick_budget.js",
    "meals_breakfast_postworkout.js",
]

os.makedirs(OUTPUT_DIR, exist_ok=True)


def to_slug(title):
    s = title.lower()
    s = re.sub(r"[&/+]", "_and_", s)
    s = re.sub(r"[^a-z0-9]", "_", s)
    s = re.sub(r"_+", "_", s)
    return s.strip("_") + ".png"


def extract_meals(js_path):
    """Extract (title, unsplash_url) pairs from a JS data file."""
    with open(js_path, encoding="utf-8") as f:
        content = f.read()
    titles = re.findall(r"title:\s*'([^']+)'", content)
    images = re.findall(r"image:\s*'(https?://[^']+)'", content)
    return list(zip(titles, images))


def make_prompt(title):
    return (
        f"professional food photography of {title}, "
        "beautifully plated on a clean surface, restaurant quality, "
        "overhead or 45-degree angle shot, natural warm lighting, "
        "appetizing, sharp focus, dark elegant background"
    )


def build_workflow(prompt_text):
    seed = int(time.time() * 1000) % (2 ** 32)
    return {
        "1": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "flux1-schnell-fp8-e4m3fn.safetensors",
            "weight_dtype": "fp8_e4m3fn"}},
        "2": {"class_type": "DualCLIPLoader", "inputs": {
            "clip_name1": "clip_l.safetensors",
            "clip_name2": "t5xxl_fp8_e4m3fn.safetensors",
            "type": "flux"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "4": {"class_type": "CLIPTextEncodeFlux", "inputs": {
            "clip_l": prompt_text, "t5xxl": prompt_text,
            "guidance": 3.5, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncodeFlux", "inputs": {
            "clip_l": "", "t5xxl": "", "guidance": 3.5, "clip": ["2", 0]}},
        "6": {"class_type": "EmptyLatentImage", "inputs": {
            "width": 512, "height": 512, "batch_size": 1}},
        "7": {"class_type": "KSampler", "inputs": {
            "seed": seed, "steps": 4, "cfg": 1.0,
            "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0,
            "model": ["1", 0], "positive": ["4", 0],
            "negative": ["5", 0], "latent_image": ["6", 0]}},
        "8": {"class_type": "VAEDecode", "inputs": {
            "samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {
            "filename_prefix": "meal_gen", "images": ["8", 0]}}
    }


def queue_prompt(workflow):
    payload = json.dumps({"prompt": workflow}).encode("utf-8")
    req = urllib.request.Request(
        f"{COMFY_URL}/prompt",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())["prompt_id"]


def wait_for_image(prompt_id, timeout=120):
    start = time.time()
    while time.time() - start < timeout:
        resp = urllib.request.urlopen(f"{COMFY_URL}/history/{prompt_id}")
        data = json.loads(resp.read())
        if prompt_id in data:
            outputs = data[prompt_id].get("outputs", {})
            for node_out in outputs.values():
                imgs = node_out.get("images", [])
                if imgs:
                    return imgs[0]
        time.sleep(1)
    return None


def download_image(img_info, dest_path):
    fn = img_info["filename"]
    sf = img_info.get("subfolder", "")
    typ = img_info.get("type", "output")
    url = f"{COMFY_URL}/view?filename={urllib.parse.quote(fn)}&subfolder={urllib.parse.quote(sf)}&type={typ}"
    urllib.request.urlretrieve(url, dest_path)


def patch_js_file(js_path, title_to_slug):
    """Replace Unsplash image URLs with /meals/<slug> paths in a JS file."""
    with open(js_path, encoding="utf-8") as f:
        content = f.read()

    def replace_image(match):
        # match.group(0) is the full line: image: 'https://...',
        # We need to find which title precedes this image entry
        return match.group(0)  # placeholder, handled below

    # Build a map: unsplash_url -> local_path, keyed by title
    # We patch by replacing each image URL that corresponds to a title we have
    for title, slug in title_to_slug.items():
        local_path = f"/meals/{slug}"
        # Find the title in content, then replace the next image: '...' after it
        pattern = re.compile(
            r"(title:\s*'" + re.escape(title) + r"'.*?image:\s*')(https?://[^']+)(')",
            re.DOTALL
        )
        content = pattern.sub(r"\g<1>" + local_path + r"\g<3>", content)

    with open(js_path, "w", encoding="utf-8") as f:
        f.write(content)


def main():
    # Collect all meals from all files
    all_meals = []  # (title, unsplash_url, js_file_path)
    for fname in MEAL_FILES:
        js_path = os.path.join(DATA_DIR, fname)
        pairs = extract_meals(js_path)
        for title, url in pairs:
            all_meals.append((title, url, js_path))

    # Deduplicate by title
    seen = {}
    unique_meals = []
    for title, url, js_path in all_meals:
        if title not in seen:
            seen[title] = js_path
            unique_meals.append((title, js_path))

    total = len(unique_meals)
    already_done = sum(1 for t, _ in unique_meals if os.path.exists(os.path.join(OUTPUT_DIR, to_slug(t))))
    remaining = total - already_done

    print(f"Total: {total} | Already done: {already_done} | Remaining: {remaining}")

    # title -> slug mapping for patching later
    title_to_slug = {}

    count = 0
    for i, (title, js_path) in enumerate(unique_meals):
        slug = to_slug(title)
        dest = os.path.join(OUTPUT_DIR, slug)
        title_to_slug[title] = slug

        if os.path.exists(dest):
            continue

        count += 1
        print(f"[{count}/{remaining}] {slug}")
        prompt = make_prompt(title)
        print(f"         Prompt: {prompt[:80]}...")

        try:
            workflow = build_workflow(prompt)
            pid = queue_prompt(workflow)
            img_info = wait_for_image(pid)
            if img_info:
                download_image(img_info, dest)
                size_kb = os.path.getsize(dest) // 1024
                print(f"         Saved! ({size_kb} KB)")
            else:
                print("         FAILED - no image in output")
        except Exception as e:
            print(f"         ERROR: {e}")

    print(f"\nAll images done. Patching JS files...")

    # Patch each JS file
    for fname in MEAL_FILES:
        js_path = os.path.join(DATA_DIR, fname)
        patch_js_file(js_path, title_to_slug)
        print(f"  Patched {fname}")

    print(f"\nDone! Meal images in: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
