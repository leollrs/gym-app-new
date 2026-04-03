import requests, time, os, sys
from PIL import Image
from io import BytesIO

COMFY = 'http://127.0.0.1:8188'
OUT_DIR = 'gym-app/public/foods'
MISSING_FILE = 'missing_foods.txt'

os.makedirs(OUT_DIR, exist_ok=True)

with open(MISSING_FILE, 'r', encoding='utf-8') as f:
    lines = [l.strip() for l in f if l.strip()]

items = []
for line in lines:
    parts = line.split('|')
    if len(parts) == 2:
        food_name = parts[0].strip()
        filename = parts[1].strip()
        items.append((food_name, filename))

print(f"Total missing: {len(items)}")

skipped = 0
for idx, (food_name, filename) in enumerate(items):
    out_path = os.path.join(OUT_DIR, f"{filename}.jpg")
    if os.path.exists(out_path) and os.path.getsize(out_path) > 1000:
        skipped += 1
        continue

    seed = hash(filename) % 999999 + 10000
    prompt_text = f"RAW photo, overhead top-down shot of {food_name} on a round white ceramic plate, the plate is centered in the frame on a clean white surface, pure white background seamlessly blending with the white table surface, the food looks real and appetizing not styled or artificial, soft diffused natural daylight from above, no harsh shadows, shot on Canon EOS R5 with 50mm lens f2.8, product photography for a food delivery app, clean minimal composition, photorealistic"

    print(f"[{idx+1}/{len(items)}] Generating: {filename} ({food_name})")
    sys.stdout.flush()

    workflow = {
        'prompt': {
            '1': {'class_type': 'UnetLoaderGGUF', 'inputs': {'unet_name': 'flux1-dev-Q8_0.gguf'}},
            '2': {'class_type': 'DualCLIPLoaderGGUF', 'inputs': {'clip_name1': 'clip_l.safetensors', 'clip_name2': 't5-v1_1-xxl-encoder-Q8_0.gguf', 'type': 'flux'}},
            '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'ae.safetensors'}},
            '4': {'class_type': 'CLIPTextEncode', 'inputs': {'text': prompt_text, 'clip': ['2', 0]}},
            '5': {'class_type': 'CLIPTextEncode', 'inputs': {'text': '', 'clip': ['2', 0]}},
            '50': {'class_type': 'FluxGuidance', 'inputs': {'conditioning': ['4', 0], 'guidance': 3.0}},
            '6': {'class_type': 'EmptyLatentImage', 'inputs': {'width': 768, 'height': 768, 'batch_size': 1}},
            '7': {'class_type': 'KSampler', 'inputs': {
                'model': ['1', 0], 'positive': ['50', 0], 'negative': ['5', 0],
                'latent_image': ['6', 0], 'seed': seed, 'steps': 25, 'cfg': 1.0,
                'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': 1.0
            }},
            '8': {'class_type': 'VAEDecode', 'inputs': {'samples': ['7', 0], 'vae': ['3', 0]}},
            '9': {'class_type': 'SaveImage', 'inputs': {'filename_prefix': f'mf_{filename}', 'images': ['8', 0]}}
        }
    }

    try:
        r = requests.post(f'{COMFY}/prompt', json=workflow)
        pid = r.json()['prompt_id']
    except Exception as e:
        print(f"  ERROR submitting: {e}")
        continue

    start = time.time()
    while time.time() - start < 300:
        time.sleep(3)
        try:
            h = requests.get(f'{COMFY}/history/{pid}').json()
            if pid in h:
                img_info = h[pid]['outputs']['9']['images'][0]
                img_data = requests.get(f'{COMFY}/view?filename={img_info["filename"]}&type=output').content

                # Convert to compressed JPEG
                img = Image.open(BytesIO(img_data)).convert('RGB')
                img.thumbnail((512, 512), Image.LANCZOS)
                img.save(out_path, 'JPEG', quality=80, optimize=True)
                size_kb = os.path.getsize(out_path) // 1024
                print(f"  OK ({size_kb}KB)")
                sys.stdout.flush()
                break
        except:
            pass
    else:
        print(f"  TIMEOUT")
    time.sleep(0.5)

if skipped:
    print(f"Skipped {skipped} already existing")
print("DONE")
