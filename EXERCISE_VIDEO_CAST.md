# Exercise Video Cast — Trainer Bible

Canonical character descriptions for the exercise demo videos (`exercise-videos`
Supabase bucket, `global/` prefix). Use these verbatim as the identity anchor when
generating new clips so they match the existing library. Filenames encode which
trainer performs each movement (`male_*`, `black_male_*`, `blonde_*`,
`black_haired_*` / `black_hair_female_*`).

## Trainers

### 1. Male (original) — `male_*`
Male trainer in his late 20s to early 30s, athletic/muscular build, clean
professional gym look, short dark hair shaved on the sides, light stubble, **gray
ribbed wifebeater (sleeveless tank top)**, black shorts, white sneakers, confident
but approachable expression.

### 2. Black male — `black_male_*`
Black male trainer in his late 20s to mid 30s, strong athletic/muscular build, short
clean haircut or close fade, **maroon/burgundy short-sleeve athletic t-shirt, black
shorts, dark sneakers**, professional coach presence, confident and friendly.

### 3. Blonde female — `blonde_female_*` / `blonde_trainer_*`
Female trainer in her mid to late 20s, athletic/toned build, blonde hair tied back
in a ponytail, fitted athletic top, leggings, clean premium gym style, friendly but
focused coach energy.

### 4. Black-haired female — `black_haired_trainer_*` / `black_hair_female_*`
Female trainer in her mid to late 20s, athletic/toned build, long black or dark hair
tied back, fitted athletic top, leggings, professional trainer look, confident and
approachable.

## Muscle-group → trainer convention (from existing library)
- **Chest, Back, most barbell/dumbbell/cable/machine push-pull** → Male
- **Legs, Glutes, posterior chain, rows** → Black male (+ Blonde female on some)
- **Shoulders, Biceps, isolation** → Blonde female
- **Core, triceps, back extensions, carries** → Black-haired female

## Kling prompt formula (proven)
Structure every clip prompt the same way:
1. `Photorealistic wide static shot of a [trainer] doing [exercise] in a modern gym.`
2. Setup line: stance + how/where the weight is held + arm position.
3. **Motion line, verb-forward** — name the movement and describe the actual mechanic
   ("he shrugs his shoulders: elevating both shoulders toward his ears, then lowering
   them"). State what stays still ("arms hang straight and motionless").
4. Trainer appearance (late 20s, hair, outfit, sneakers).
5. Camera: `Fixed tripod camera far back, full body head-to-toe, trainer centered, no
   camera movement.` + gym/lighting + `4K, sharp`.

RULES:
- Do NOT name wrong exercises in the main prompt, even to forbid them — that primes
  the model. Put all "don'ts" (curl, press, row, bending elbows, zoom, crop…) in the
  **negative prompt only**.
- Keep it tight; lead with the action.
- Settings: 5s · Pro · sound off.
- Drift fixes: use "light [weight]" wording (heavy primes a grind/pull), and reroll
  the same prompt — Kling motion is seed-sensitive.

## Shared style notes
Clean modern commercial gym, neutral/charcoal walls, equipment softly blurred
behind. Even, slightly cinematic lighting. Static locked-off (tripod) camera, mostly
side-on or slight three-quarter front, full body or full movement in frame. One
slow controlled repetition, smooth seamless loop. Photorealistic, sharp, natural
skin + fabric texture, ~4K, premium instructional look. White/neutral sneakers.
