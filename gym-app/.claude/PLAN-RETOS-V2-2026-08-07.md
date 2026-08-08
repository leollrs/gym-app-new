# Plan · Retos v2 — formato, asistencia y rutinas

**08-07-2026.** ✅ **IMPLEMENTADO** en la misma sesión, salvo lo marcado abajo. Las decisiones
del founder quedaron: (1) formato primero, (2) premio escogible con puntos por defecto,
(3) reparto automático + celebración, (4) el día varía según el reto, (5) arreglar Reanudar
**y** construir la pausa de verdad.

## Estado

| Bloque | Estado |
|---|---|
| A · Formato competitivo/cumplimiento | ✅ mig **0707** + formulario + socio |
| Reparto automático + celebración | ✅ trigger en **0707** + `ChallengePrizeCelebration` |
| C0 · Los cuatro arreglos previos | ✅ mig **0708** + `Workouts.jsx` + `DayStrip.jsx` |
| B · Asistencia | ✅ migs **0709** + **0710** (trigger sobre `check_ins`) |
| C1/C2 · Rutina en el reto | ✅ columnas en **0708** + `ChallengeRoutineCTA` |
| Pausa de programa | ✅ mig **0711** + tarjeta de pausa/reanudar |
| Día suelto (una sola fecha) | ✅ mig **0712** + `lib/scheduleOverrides.js` + 3 lectores |
| Entrar al programa del reto | ✅ `?program=` en Entrenos + selector en el formulario |

## Ronda de revisión adversarial (08-08)

Cinco equipos de agentes revisaron todo esto: **33 hallazgos confirmados**, 4 refutados. Todos
arreglados. Lo que había que saber:

| Lo que estaba mal | Arreglado en |
|---|---|
| `REVOKE … FROM PUBLIC` **no cierra** una función en Supabase (el grant a `authenticated` es directo). Cualquier socio podía adjudicarse el podio el día 2 y dejar el reto cerrado para siempre. | 0707 — revoke a `PUBLIC, anon, authenticated` + `end_date <= now()` dentro |
| Un **entrenador** podía acuñar puntos sin tope (`challenges_manage_admin` incluye `trainer`) | 0707 — trigger `guard_challenge_money_fields` |
| Los puntos se acreditaban **antes** del insert del premio → doble abono en una carrera | 0707 — premio primero, puntos solo si insertó |
| El reparto de cumplimiento no tenía techo: 100.000 × N socios | 0707 — cortacircuitos de 500.000 y `milestone_target > 0` en el CHECK |
| El botón «Premiar» decía «¡Repartidos!» sobre cero filas | 0707 — lanza si el reparto sale vacío |
| El reto de asistencia **solo puntuaba si quien fichaba era admin** (choque con `guard_challenge_score_update`, tragado por el EXCEPTION) | 0710 — la GUC + `RAISE WARNING` en vez de silencio |
| `<>` con `auth.uid()` NULL da NULL, no TRUE: una petición sin sesión podía pausar el programa de otro | 0711 — `IS DISTINCT FROM` + revoke |
| Un programa pausado avisaba «tu programa terminó» en mitad de la pausa | 0711 + `Workouts.jsx` |
| Enganchar una rutina a un reto la **publicaba a todo el gimnasio**, aunque fuera personal de un socio | 0708 — solo rutinas de staff o públicas |
| El enlace de equipo dejaba entrar a gente de **otro gimnasio**, y el aforo vivía solo en el navegador | **0713** (nueva) |
| Un tirón de cobertura borraba las fotos de clase **toda la sesión** en nueve pantallas | `ClassImage.jsx` — solo se marca muerta tras confirmar 400/403/404, con caducidad |
| «Ven 12 veces» salía como «**12 lbs**» | `Challenges.jsx` — `ClubLeaderboard` usa `metricUnit()` |
| Un reto solo con programa pintaba el selector de días y escribía `routine_id: null` → error crudo | `ChallengeRoutineCTA.jsx` |
| 11 claves de equipos no existían en ningún idioma (8 con español cableado) | ambos locales |
| El «+» del DayStrip salía en días **pasados** y creaba una asignación semanal | `DayStrip.jsx` — fuera de la píldora, solo de hoy en adelante |
| La tira de días contradecía a la tarjeta en un día con excepción | `DayStrip` recibe `dayOverrides` |
| Abrir el lápiz cambiaba la duración de la **clase entera**, y Cancelar no la devolvía | `ClassSchedulePlanner.jsx` — duración en estado local |
| Pasar un horario de 3 días a «un solo día» solo reescribía uno | `ClassSchedulePlanner.jsx` |
| Un error del select de retos escribía `[]` en un estado persistido | `Challenges.jsx` |

**Las SIETE migraciones (0707–0713) están SIN APLICAR.** Hasta que se apliquen: el formato cae
a `competitive` por defecto, el tipo asistencia no se puede guardar, la rutina de clase sigue
rota y pausar da error. Nada de lo ya existente se rompe por no aplicarlas.

**Cambio de comportamiento a tener presente:** el reparto competitivo ahora **exige puntuación
mayor que cero**. Antes repartía el podio aunque la tabla estuviera en ceros — que es
exactamente lo que pasaba con los retos que nunca puntuaban.

## El día suelto: qué lee la excepción y qué no

`workout_schedule_overrides` (fecha real, gana sobre la semana). **Todo el que pinte un día
debe pasar por `lib/scheduleOverrides.js`** o dirá una cosa distinta a la de al lado.

Enchufados: **Panel** (el día seleccionado y «¿hay algo programado?»), **/record** (la rutina
de hoy) y el **aviso de día equivocado** de la sesión — que si no, regañaría al socio por hacer
justo lo que pidió.

⬜ **NO enchufados, a sabiendas:** `GymWOD`, `CoachingInsights`, `programAdaptation`,
la protección de racha por día de descanso en `achievements.js`, y la función de recordatorios.
Todos son analítica o avisos: leen la semana recurrente y verán la rutina de siempre en un día
con excepción. Nada de eso rompe, pero conviene saberlo antes de sacar conclusiones de esos
números.

---

Plan original abajo. Cada bloque dice qué se toca, qué cuesta y qué había que decidir.

---

## Antes de nada: tres realidades del modelo que condicionan todo

**1 · El calendario del socio es RECURRENTE, no tiene fechas.**
`workout_schedule` es `(profile_id, day_of_week, routine_id)` con `UNIQUE (profile_id,
day_of_week)`. **No hay ninguna columna de fecha en ninguna tabla del sistema de entrenos.**
Poner una rutina «en mi día» significa ponerla en **todos los miércoles**, para siempre.
«Solo hoy» no existe como forma de dato.

**2 · Instalar un programa BORRA la semana entera.**
Las cinco rutas que instalan programa (`enrollInTemplate`, adoptar plan de coach, generar,
regenerar, constructor propio) hacen `DELETE FROM workout_schedule WHERE profile_id = yo` y
vuelven a sembrar. Cualquier día que el socio haya puesto a mano —incluida una rutina de reto—
**desaparece sin aviso en la siguiente instalación**.

**3 · Aplazar un programa no existe.** Ni en el socio, ni en el entrenador, ni en el admin, ni
en el esquema. Cero resultados para «pause», «postpone», «paused_at» o «on_hold» sobre
programas. Lo más parecido es *salir* y luego *Reanudar*, que no reanuda: **crea un programa
nuevo** con la fecha de inicio retrasada para que la píldora diga «Semana 5 de 13».

Ironía: la tabla `user_enrolled_programs` (migración `0001`) **sí tiene** `current_week`,
`started_at`, `completed_at`, `is_active`. Es el modelo de ciclo de vida más completo del
esquema y **el frontend no la toca ni una vez**.

---

## 🔴 Fallo en producción encontrado de camino

**Las rutinas de clase no le funcionan a ningún socio.**

- La rutina de una clase se crea con `created_by: <id del staff>, is_public: false`
  (`ClassRoutineBuilderModal.jsx:113`).
- La única política de lectura es `routines_select_own`:
  `created_by = auth.uid() OR (gym_id = … AND is_public = TRUE)` (`0002:187`).
  Un socio **no cumple ninguna de las dos**. Y `is_public` no se pone a `true` en ningún sitio
  del código.
- `ActiveSession.jsx:1641-1652` lee la rutina con `.single()` y hace
  `if (routineErr || !routine) { setDataLoading(false); return; }` — **abandono en silencio**.

O sea: el socio marca asistencia a una clase con rutina, pulsa «empezar a registrar», y entra
a una sesión **vacía**, sin error y sin explicación. Verificado leyendo las políticas y el
código; no es una suposición del mapeo.

Y esto importa para el plan: **el patrón «la clase lleva una rutina» era el que iba a copiar
para «el reto lleva una rutina».** Hay que arreglarlo primero o construir sobre arena.

---

## Bloque A · Competitivo vs cumplimiento

### El modelo
`type` mezcla hoy dos preguntas. Se separan en dos ejes:

- **Qué se mide** (`type`): entrenos · volumen · PRs · un levantamiento · equipo · suma de récords
- **Cómo se gana** (`format`, NUEVO): `competitive` (podio, 3 premios) · `completion` (una meta,
  gana todo el que llegue)

La misma métrica da retos distintos: asistencia + competitivo = «quién viene más»;
asistencia + cumplimiento = «ven 12 veces». Y el club deja de ser un tipo: pasa a ser
*(métrica: suma de récords) + (formato: cumplimiento)*, lo que libera gratis su versión
competitiva.

El esquema ya lo insinuaba: `milestone_target` viene comentada desde `0261` como
*«club threshold (e.g. 500, 1000). NULL = pure competitive»*.

### Migración (una)
1. `challenges.format TEXT NOT NULL DEFAULT 'competitive' CHECK (format IN ('competitive','completion'))`
2. `CHECK (format <> 'completion' OR milestone_target IS NOT NULL)` — se **reutiliza** esa
   columna como «la meta», que es para lo que nació
3. `challenge_prizes.placement` → `DROP NOT NULL`
4. Partir el único índice de podio en dos parciales:
   - `(challenge_id, placement) WHERE placement IS NOT NULL` — competitivo, **idéntico a hoy**
   - `(challenge_id, profile_id) WHERE placement IS NULL` — cumplimiento, uno por persona
5. RPC `award_challenge_completion(p_challenge_id)` — copia de la existente sin `LIMIT 3` y con
   `WHERE cp.score >= milestone_target`

### Cliente
- `lib/admin/challengeConfig.js` — `format` como eje; `missingConfig` exige meta si cumplimiento
- `ChallengeModal` — el formato es la **primera** pregunta (dos tarjetas); la sección de premios
  cambia de forma: un premio único en vez de tres puestos
- `AdminChallenges` — el botón de repartir bifurca por formato
- Socio — la tarjeta enseña **barra hacia la meta**, no posición

### ⚠️ Decidir antes de empezar
- **Premio físico en cumplimiento = pasivo sin techo.** Si completan 30 y hay 6 camisetas,
  quedas mal con 24. Propuesta: por defecto **solo puntos**; si escoge producto, aviso con el
  stock delante.
- **¿Reparto automático o manual?** Hoy el cron pone «completado» cada 15 min y **nadie
  reparte**: no hay trigger, solo el botón del admin. Con cumplimiento pesa más.

---

## Bloque B · Asistencia

### Dos migraciones, no una
1. `ALTER TYPE challenge_type ADD VALUE 'check_in'` **sola en su fichero**. Un valor nuevo de
   enum no se puede *usar* en la misma transacción que lo crea.
2. Trigger `AFTER INSERT ON check_ins`, calcado de `trg_rollup_checkin_activity` (`0434:59`),
   con su mismo blindaje `EXCEPTION WHEN OTHERS THEN NULL` — **un fallo del reto no puede
   impedir que alguien entre al gimnasio**. Deduplicado por día local (se puede fichar por QR
   en la puerta y por GPS el mismo día).

### Por qué importa
Sería **la primera puntuación del lado del servidor** de toda la app. Hoy todo se cuenta en
`SessionSummary.jsx`, o sea solo cuando alguien termina un entreno **dentro de la app**. El
socio que viene y no registra nada no suma — y ese es justo el grupo del que menos sabes.

---

## Bloque C · Rutinas y programas en el reto

### C0 · Arreglos previos (sin ellos, lo demás no se sostiene)

| # | Qué | Dónde |
|---|---|---|
| **C0.1** | **Que el socio pueda LEER la rutina de una clase o de un reto.** Una política nueva sobre `routines`: legible si pertenece a su gimnasio Y está enganchada a una clase o a un reto. Arregla la clase rota **y** habilita el reto. | migración + `0002` |
| **C0.2** | `enrollInTemplate` no escribe `routine_ids` en `schedule_map`. Escribirlo arregla **dos** cosas de golpe: salir de un programa de gimnasio (hoy cae en el borrado a lo bruto) y Reanudar (hoy muere con `no_routines_linked`). | `Workouts.jsx:2172-2185` |
| **C0.3** | Al salir, `.eq('program_id', target.template_id)` mete `gym_<uuid>` en una columna UUID → error `22P02` siempre, solo logueado. La matrícula asignada por el entrenador **sobrevive** a que el socio se salga. El recortador ya existe en `Workouts.jsx:1276`. | `Workouts.jsx:1732` |
| **C0.4** | `DayStrip` recibe `onAssignDay` y **nunca lo llama** — prop muerta desde siempre. Si «añadir a mi día» va a existir, este es su sitio natural. | `DayStrip.jsx:15` |

### C1 · El reto lleva rutina y/o programa
- `challenges.workout_template_id` → `routines(id) ON DELETE SET NULL` (igual que `gym_classes`)
- `challenges.program_id` → `gym_programs(id) ON DELETE SET NULL`
- En el formulario de reto: reusar `RoutineSelector`, que ya existe

### C2 · Las tres salidas del socio

Un bloque «Rutina del reto» en la tarjeta, compartido por las tres variantes
(`FeaturedHeroCard`, `ChallengeCard`, `DiscoverCard`):

**1 · Entrenarla ahora** — lanza `ActiveSession` contra la rutina. **Cero escrituras.**
Es el patrón de la clase, que funcionará en cuanto esté C0.1.

**2 · Ponerla en mi semana** — escoge día, `upsert onConflict (profile_id, day_of_week)`.
Si ese día ya tiene rutina, se dice **cuál** y se pide confirmación. Y se dice la verdad
incómoda: **es todos los miércoles**, no solo este.

**3 · Entrar al programa del reto** — instalación completa, reusando el flujo de cambio de
programa de dos pasos que ya existe (`Workouts.jsx:4288-4345`).

### ⚠️ Decidir antes de empezar

**D1 · «Añadir a mi día»: ¿recurrente o de un solo día?**
- *Recurrente* — existe hoy, una línea de código, pero pisa el miércoles del socio para siempre
  y **se lo borra la siguiente instalación de programa** (realidad 2).
- *Un solo día* — es lo que la gente espera al leer «añádelo a tu día», pero **no existe la
  forma de dato**: haría falta una tabla `workout_schedule_overrides (profile_id, date,
  routine_id)` y que los ~10 lectores del calendario la consulten.
- *Recomendación:* empezar con **«Entrenarla ahora» + «Ponerla en mi semana»** (ambas existen),
  y dejar el día suelto para cuando haya demanda real. Dos botones honestos valen más que uno
  ambiguo.

**D2 · «Aplazar el programa»: ¿arreglar Reanudar o construir pausa de verdad?**
- *Arreglar Reanudar* (C0.2) — barato, y **ya es funcionalmente aplazar**: sales, entras al
  programa del reto, y al terminar reanudas por la semana 5. Hoy no funciona para programas de
  gimnasio; con `routine_ids` sí.
- *Pausa real* — `paused_at` en `generated_programs` + reanudar de verdad + que la racha y la
  adherencia sepan del hueco. Es lo correcto y es caro.
- *Recomendación:* **arreglar Reanudar primero.** Si después de usarlo sigue faltando algo,
  entonces pausa real.

---

## Orden propuesto

1. **A** — formato competitivo/cumplimiento. Es lo que pediste y desbloquea el resto.
2. **C0** — los cuatro arreglos previos. C0.1 arregla un fallo vivo de las clases; C0.2 arregla
   dos cosas de una.
3. **B** — asistencia. Llega a quien hoy no llegas.
4. **C1 + C2** — el reto lleva rutina y el socio la toma.

A y C0 son independientes: se pueden hacer a la vez.

---

## Lo que NO propongo tocar

- `user_enrolled_programs` / `program_templates` / `program_week_days` — el modelo huérfano.
  Revivirlo es un proyecto, no un arreglo.
- `ProgramModal` + `handleEnroll` en `Workouts.jsx:107` — **código muerto**, nunca se monta
  (`setSelectedProgram` solo se llama con `null`). Borrarlo es limpieza, no plan.
- `challenge_score_events` — tabla completa que nadie ha escrito jamás.
