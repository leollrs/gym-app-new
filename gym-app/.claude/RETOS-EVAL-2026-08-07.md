# Retos: qué funciona, qué no, y por qué aburren

**08-07-2026.** Auditoría completa del subsistema de retos (admin + socio + base + puntuación).
Lo marcado ✅ ya está arreglado en el árbol sin commitear. Lo marcado ⬜ está pendiente y sin decidir.

---

## 1 · Lo que estaba roto

### ✅ `specific_lift` no puntuaba NUNCA — y repartía premios igual

El formulario ofrecía «Levantamiento específico» pero **nunca escribía `exercise_id`**.
El que puntúa (`SessionSummary.jsx:359`) tiene esta guarda:

```js
} else if (type === 'specific_lift' && c.exercise_id) {
```

Con `exercise_id` siempre NULL, la rama no entraba jamás. Un reto de dos semanas corría con
la tabla en cero de principio a fin. Y al terminar, `award_challenge_prizes` reparte los tres
premios ordenando por `score DESC` sobre una tabla de ceros — o sea, **a quien tocara**.

Nadie se enteraba de que el reto no funcionaba. Solo de que la tabla estaba vacía.

**Arreglado:** `lib/admin/challengeConfig.js` declara qué necesita cada tipo, el formulario lo
pide, y no deja crear el reto sin ello (19 pruebas).

### ✅ `milestone` («club») existía entero y no se podía crear

Tenía tipo en el enum, puntuación en `SessionSummary`, tabla propia en el socio
(`ClubLeaderboard`), traducciones, icono y hasta una rama en el sugeridor de IA — pero **no
estaba en la lista de tipos del formulario**. Solo se podía crear metiendo SQL a mano.

**Arreglado:** es el sexto tipo, con selector de levantamientos y meta.

### ✅ `team` funcionaba a medias

- `scoring_metric` nunca se escribía → todo reto por equipos puntuaba como consistencia
  (1 punto por entreno), diera igual lo que dijera el nombre.
- `team_size` nunca se escribía → `TeamFormationModal` cerraba los equipos en **2** por
  defecto y la ficha del equipo enseñaba «3/**?**».

**Arreglado:** ambos se escriben, y la plantilla rápida «Trae un amigo» siembra 4.

### ✅ No se podía entrar a un equipo si no eras amigo del capitán

La lista de equipos con sitio **se cargaba y no se pintaba en ningún sitio**
(`existingTeams`, cargado en el `useEffect` y jamás renderizado). La única puerta de entrada
era una invitación nominal de un amigo aceptado.

O sea: el reto por equipos no se podía llenar con la gente del gimnasio a la que uno le
escribe por WhatsApp — que es exactamente cómo se arman los equipos en un gimnasio.

**Arreglado:** lista visible + enlace compartible (§2).

### ✅ Seis peticiones 400 por una foto que no existe

`ClassImage` ya tenía `onError` para no enseñar el icono de imagen rota, pero el navegador
**igual pedía el fichero**. Una clase que sale seis veces en el horario del mes pedía seis
veces el mismo objeto muerto. Ahora la ruta muerta se anota en `sessionStorage` y nadie más
la pide: de seis errores a uno.

### ✅ El calendario marcaba MAÑANA como hoy

`fmtISO` usaba `toISOString()`, que convierte a UTC antes de cortar. En Puerto Rico (UTC−4),
a partir de las 8 de la noche devolvía el día siguiente. Todas las noches.

---

## 2 · Enlaces de equipo (lo que pediste)

```
https://tugympr.com/challenge/<retoId>?team=<equipoId>
```

- **Cero migraciones.** `App.jsx` ya traduce `/challenge/:id` a `/challenges?challenge=…`
  arrastrando el resto de la query, así que `?team=` viaja solo. Sin ruta nueva, sin App Link
  nuevo, sin tocar el manifiesto de Android.
- **El RLS ya lo permitía.** `challenge_participants_insert_own` solo exige
  `profile_id = auth.uid()` y el gimnasio correcto; `challenge_teams_select` deja ver los
  equipos del gimnasio. La restricción de «solo amigos» era una convención de la interfaz,
  nunca una regla del servidor. El enlace no abre nada que estuviera cerrado.
- **Dónde sale:** al crear el equipo (el momento en que quieres mandarlo) y en la lista de
  equipos con sitio.
- **Quien lo abre** cae en el modal con ese equipo señalado arriba y un botón «Unirme».
  Se respeta el aforo (`team_size`) y no se ofrece si el reto ya terminó o si ya participas.

⬜ **Falta:** volver a sacar el enlace días después, cuando ya tienes equipo. Hoy solo aparece
justo al crearlo o desde la lista. Lo natural sería un botón en tu fila de la tabla de equipos.

---

## 3 · Por qué aburren (tenías razón)

**Se ofrecen 6 tipos. Cinco son la misma cosa: una tabla global donde gana quien más acumula.**

El problema no es la variedad de métricas. Es que **el resultado se sabe el día 2**. El socio
más fuerte del gimnasio gana el reto de volumen; el que ya entrena 6 días gana el de
consistencia. Todos los demás miran una tabla en la que no van a subir y dejan de abrirla.
Un reto que solo puede ganar el que ya iba a entrenar igual **no cambia el comportamiento de
nadie** — que es lo único por lo que el gimnasio nos paga.

Tres huecos, por orden de lo que arreglaría más con menos:

### ⬜ A · No hay ningún reto de ASISTENCIA

La métrica que de verdad predice la baja es **venir al gimnasio**, no el volumen levantado.
`check_ins` está lleno de datos y **ningún tipo de reto lo mira**. Un reto de «ven 12 veces
este mes» toca a todo el mundo, incluido el que no registra entrenos en la app — que es
justamente el grupo del que menos sabemos y el que más se va.

Hay hasta claves de i18n huérfanas de un `checkin` que nunca existió
(`admin.challengeTypes.checkin`), señal de que ya se pensó y se quedó a medias.

**Coste:** un tipo nuevo + delta en el flujo de check-in. Sin migración: el enum
`challenge_type` sí necesita un valor nuevo → **una migración de una línea**.

### ⬜ B · Nadie compite contra sí mismo

Todo se mide en términos absolutos. La alternativa que cambia quién puede ganar es
**medir la mejora contra la línea base de cada uno**: «+20 % sobre tu propio promedio de
las 4 semanas anteriores». El principiante puede ganarle al veterano, y el veterano tiene que
esforzarse de verdad para defenderlo.

Es exactamente la misma idea que el modelo de churn v4 (cada socio contra su propio ritmo),
así que la lógica de línea base ya está escrita en `lib/churn/rhythm.js`.

Hay una columna `scoring_normalized BOOLEAN` desde la migración `0001` con el comentario
«normalize by bodyweight/level». **Nadie la lee. Nunca.** Está esperando esto desde el día uno.

### ⬜ C · El «club» todavía no se anuncia como lo que es

El tipo club (§1) ya arregla lo peor: **no es una carrera, entra todo el que llegue**. Pero
el reparto de premios sigue siendo de podio (`award_challenge_prizes` va con `LIMIT 3`), así
que un club con 30 personas dentro solo premia a 3 — y quien llega el cuarto se queda igual
que si no hubiera entrado.

Para que el club tenga sentido hace falta **premiar por llegar, no por llegar primero**. Eso
es tocar `award_challenge_prizes` y `challenge_prizes` (que tiene `UNIQUE (challenge_id,
placement)`, o sea, está construida para un podio y nada más).

**Coste:** una migración de verdad. Es la más cara de las tres y la que menos urge.

---

## 4 · Lo que NO implementé del diseño, y por qué

`Nuevo Reto Restyle.html` traía cuatro controles que **no se pueden cumplir hoy**. Un
interruptor que no hace nada es peor que no tenerlo, así que quedaron fuera:

| Control del diseño | Por qué no está |
|---|---|
| «Duración mínima del entreno para que cuente» | No hay columna ni gate en la puntuación. |
| «Máximo 1 entreno por día» | Hoy 5 entrenos en un día suman 5. Sería mentira escribirlo. |
| «Promedio por miembro vs suma total» del equipo | `get_team_leaderboard` solo hace `SUM`. |
| «Añadir 4º puesto» y «premiar a todo el que termine» | `award_challenge_prizes` va con `LIMIT 3`. |

Los cuatro son arreglables; los cuatro necesitan servidor. Ninguno es un bloqueo para lo que
sí quedó implementado.

---

## 5 · Restos muertos que encontré (sin tocar)

- `challenge_score_events` — tabla completa, con RLS y con borrado en cascada en cinco RPCs.
  **Nada inserta jamás una fila.** Existe desde `0001`.
- `admin.challengeTypes.streak` y `.checkin` (+ sus `_desc`) — claves de i18n de dos tipos que
  no están en el enum ni se ofrecen en ningún sitio.
- `challenge_progress` — mencionada en un comentario de `0514`, nunca creada.
- La puntuación de retos vive **entera en el cliente** (`SessionSummary.jsx`). `complete_workout`
  no toca retos y no hay ninguna función de servidor que puntúe. Si alguien termina un entreno
  con la app cerrada a mitad, el punto se pierde en silencio.
- **Los premios NO se reparten solos.** El cron `run_challenge_lifecycle` (cada 15 min) pone el
  reto en `completed` y su comentario dice que eso «dispara `award_challenge_prizes`» — pero
  **no hay ningún trigger sobre `challenges`** que lo llame. El único sitio que lo invoca es el
  botón del admin (`AdminChallenges.jsx:297`). O sea: el reto termina, cambia de estado, avisa
  a todo el mundo… y nadie cobra hasta que el dueño se acuerda de pulsar el botón.
