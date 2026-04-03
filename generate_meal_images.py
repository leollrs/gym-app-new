"""
Batch generate all 298 meal images via ComfyUI + Flux Dev.
Style: white plate/bowl centered on white background, overhead shot, realistic.
Same style as food images.
"""
import json, time, requests, re, os, sys

COMFY = "http://127.0.0.1:8188"
OUTPUT_DIR = "c:/Users/leoll/gyn-app-new/gym-app-new/gym-app/public/meals"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Extract meal titles and image filenames from all meal data files
MEAL_FILES = [
    "c:/Users/leoll/gyn-app-new/gym-app-new/gym-app/src/data/meals_fat_loss.js",
    "c:/Users/leoll/gyn-app-new/gym-app-new/gym-app/src/data/meals_high_protein.js",
    "c:/Users/leoll/gyn-app-new/gym-app-new/gym-app/src/data/meals_mass_gain.js",
    "c:/Users/leoll/gyn-app-new/gym-app-new/gym-app/src/data/meals_lean_bulk.js",
    "c:/Users/leoll/gyn-app-new/gym-app-new/gym-app/src/data/meals_quick_budget.js",
    "c:/Users/leoll/gyn-app-new/gym-app-new/gym-app/src/data/meals_breakfast_postworkout.js",
]

meals = {}  # filename -> title
for f in MEAL_FILES:
    with open(f) as fh:
        content = fh.read()
    titles = re.findall(r"title: '([^']+)'", content)
    images = re.findall(r"image: '([^']+)'", content)
    ingredients_list = re.findall(r"ingredients: \[([^\]]+)\]", content)
    steps_list = re.findall(r"steps: \[([^\]]+)\]", content)
    for i, (t, img) in enumerate(zip(titles, images)):
        fname = img.split("/")[-1].replace(".png", "")
        # Get ingredients for better prompt
        ingr = ""
        if i < len(ingredients_list):
            ingr_raw = ingredients_list[i]
            ingr = ", ".join(re.findall(r"'([^']+)'", ingr_raw))
        meals[fname] = {"title": t, "ingredients": ingr}

print(f"Total unique meals: {len(meals)}")


def get_prompt(filename, info):
    """Generate the full Flux Dev prompt for a meal."""
    title = info["title"]
    ingredients = info["ingredients"]

    # Detect if it's a drink/smoothie/shake
    drink_keywords = ["smoothie", "shake", "latte", "coffee", "juice", "tea"]
    is_drink = any(kw in title.lower() for kw in drink_keywords)

    # Detect if it's a bowl
    bowl_keywords = ["bowl", "soup", "oatmeal", "oats", "chili", "stew", "yogurt", "parfait", "acai"]
    is_bowl = any(kw in title.lower() for kw in bowl_keywords)

    if is_drink:
        return f"RAW photo, {title}, a freshly made {title.lower()} in a clear glass, made with {ingredients}, centered on a clean white surface, pure white background, soft diffused natural daylight, overhead shot slightly angled, product photography for a food delivery app, photorealistic, shot on Canon EOS R5 50mm f2.8"
    elif is_bowl:
        return f"RAW photo, {title}, a freshly prepared {title.lower()} in a round white ceramic bowl, made with {ingredients}, appetizing and colorful, centered on a clean white surface, pure white background, soft diffused natural daylight from above, overhead top-down shot, no harsh shadows, product photography for a food delivery app, photorealistic, shot on Canon EOS R5 50mm f2.8"
    else:
        return f"RAW photo, {title}, a freshly prepared {title.lower()} plated beautifully, made with {ingredients}, appetizing and colorful, on a round white ceramic plate centered on a clean white surface, pure white background, soft diffused natural daylight from above, overhead top-down shot, no harsh shadows, the food looks real and appetizing not artificial, product photography for a food delivery app, photorealistic, shot on Canon EOS R5 50mm f2.8"


def queue_prompt(prompt_text, filename, seed):
    """Send a generation job to ComfyUI."""
    workflow = {
        "prompt": {
            "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": "flux1-dev-Q8_0.gguf"}},
            "2": {"class_type": "DualCLIPLoaderGGUF", "inputs": {"clip_name1": "clip_l.safetensors", "clip_name2": "t5-v1_1-xxl-encoder-Q8_0.gguf", "type": "flux"}},
            "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt_text, "clip": ["2", 0]}},
            "5": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["2", 0]}},
            "50": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["4", 0], "guidance": 3.0}},
            "6": {"class_type": "EmptyLatentImage", "inputs": {"width": 768, "height": 768, "batch_size": 1}},
            "7": {"class_type": "KSampler", "inputs": {
                "model": ["1", 0], "positive": ["50", 0], "negative": ["5", 0],
                "latent_image": ["6", 0], "seed": seed, "steps": 25, "cfg": 1.0,
                "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0
            }},
            "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
            "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": f"meal_{filename}", "images": ["8", 0]}}
        }
    }
    r = requests.post(f"{COMFY}/prompt", json=workflow)
    return r.json()["prompt_id"]


def wait_for_result(prompt_id, filename, timeout=300):
    """Wait for ComfyUI to finish and save the result."""
    start = time.time()
    while time.time() - start < timeout:
        time.sleep(3)
        try:
            r = requests.get(f"{COMFY}/history/{prompt_id}")
            data = r.json()
            if prompt_id in data:
                out = data[prompt_id].get("outputs", {}).get("9", {}).get("images", [])
                if out:
                    fname = out[0]["filename"]
                    img_data = requests.get(f"{COMFY}/view?filename={fname}&type=output").content
                    out_path = os.path.join(OUTPUT_DIR, f"{filename}.png")
                    with open(out_path, "wb") as f:
                        f.write(img_data)
                    return out_path
        except:
            pass
    return None


def main():
    # Check which images already exist
    existing = set()
    for f in os.listdir(OUTPUT_DIR):
        if f.endswith(".png"):
            existing.add(f.replace(".png", ""))

    sorted_meals = sorted(meals.items())
    remaining = [(k, v) for k, v in sorted_meals if k not in existing]
    total = len(remaining)

    print(f"Already generated: {len(existing)}")
    print(f"Remaining to generate: {total}")
    print(f"Estimated time: {total * 45 / 3600:.1f} hours")
    print("=" * 60)

    if "--dry-run" in sys.argv:
        for i, (fname, info) in enumerate(remaining[:10]):
            print(f"  [{i+1}] {fname}: {get_prompt(fname, info)[:100]}...")
        return

    for i, (fname, info) in enumerate(remaining):
        seed = hash(fname) % 999999 + 10000
        prompt_text = get_prompt(fname, info)

        print(f"[{i+1}/{total}] Generating: {fname} ({info['title']})")
        print(f"  Prompt: {prompt_text[:120]}...")

        try:
            pid = queue_prompt(prompt_text, fname, seed)
            result = wait_for_result(pid, fname)
            if result:
                print(f"  OK Saved: {result}")
            else:
                print(f"  FAIL TIMEOUT: {fname}")
        except Exception as e:
            print(f"  FAIL ERROR: {e}")

        time.sleep(1)

    print("\n" + "=" * 60)
    print("DONE! All meal images generated.")


if __name__ == "__main__":
    main()
