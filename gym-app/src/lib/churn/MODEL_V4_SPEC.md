# Modelo de churn v4 — cada socio contra sí mismo

**Estado:** construido 2026-08-07. Cliente + edge function + 13 pruebas.
Depende de la migración **0705** (`model_version`, `churn_outcomes.source`,
`label_churn_lapses`, `holdout_pct`). **Sustituye a v3** (`MODEL_V3_SPEC.md`).

---

## 0. Por qué v4

v3 anclaba a todo el mundo a 3×/semana y luego pegaba parches que se
contradecían entre sí. Cuatro consecuencias, todas verificadas contra el código:

| Socio | v3 | Por qué |
|---|---|---|
| Venía 5×/sem, ahora 2×/sem, vino anteayer | **20 · Bajo** | la media de 4 semanas arrastraba las semanas buenas y la recencia decía «vino hace nada» |
| Viene a diario, 12 días desaparecido | **30 · Medio** | y saltaba a 95 el día 30, cuando ya no hay nada que intervenir |
| Viene 1×/3 semanas, 30 días sin venir | **95 · Crítico** | override de dormancia; ese señor no ha faltado a nada |
| Veterano de 12 meses, apagado del todo | **tope 69** | ×0,85 sobre un máximo real de 81: Crítico era **imposible** |

Además, dos señales (racha 10 pts, recompensas 4 pts) estaban **cableadas a
cero** en cliente y servidor: el modelo repartía 100 puntos de los que 14 no
existían, y las bandas se habían corrido solas sin que nadie lo decidiera.

**La idea de v4:** no hay ideal. La vara la pone cada socio. De ahí salen gratis
dos cosas que v3 necesitaba calibrar a mano — un box de CrossFit salta a los ~9
días y un estudio boutique a los ~42 con la misma fórmula, y el veterano se
vuelve **más** sensible porque un año de historia le da un ritmo estrechísimo.

---

## 1. Qué cuenta como visita

`check_ins ∪ workout_sessions`, **deduplicado por día natural (UTC)**. Ventana
de 90 días. v3 los contaba por separado, así que a quien registraba sus entrenos
se le inflaba la frecuencia y, con ella, todo lo derivado.

---

## 2. Estados (en este orden)

| Orden | Estado | Condición | En la cola |
|---|---|---|---|
| 1 | Pausa | `frozen` o `churn_pause_until` futuro | No |
| 2 | **Perdido** | ≥60 días sin visita **o** nunca vino y cuenta ≥60 días | No |
| 3 | Nunca activó | 0 visitas jamás, cuenta 21–59 días → `55 + 3/semana`, tope 75 | Sí |
| 4 | Sin datos | cuenta <21 días, o 0 visitas | No |

El orden importa: en v3 «nunca activó» iba **antes** que «perdido», así que
quien se apuntó hace tres años y no pisó el gimnasio se quedaba en 78 Alto para
siempre, ordenando por encima de gente recuperable.

«Dormido» (≥30 días) sobrevive solo como **etiqueta** para ordenar; ya no fija
la puntuación.

---

## 3. El ritmo (`rhythm.js`)

```
g90 = clamp(percentil90(intervalos entre visitas), 3, 21)
```

Recorte por los dos lados: abajo, quien vino 8 días seguidos tendría g90 = 1 y
le sonaría la alarma a las 48 h; arriba, más de 3 semanas de ritmo normal ya no
es un ritmo, y de eso se encarga el suelo absoluto.

| Clase | Condición | Vara | Confianza |
|---|---|---|---|
| **A** | ≥8 visitas y ≥42 días de recorrido | p90 de sus intervalos | alta |
| **B** | ≥3 intervalos | el intervalo **más largo** visto | media |
| **C** | menos | curva genérica | baja |

La clase B existe porque sin ella el socio de 1×/3 semanas caía a la curva
genérica y salía Crítico a los 30 días. Lo cazó una prueba.

---

## 4. Señales

Cada una devuelve una fracción 0..1 con techo propio.

### Estable (clase A o B)

| Señal | Techo | Fórmula |
|---|---|---|
| **Brecha** | 0.85 | `clamp((días/g90 − 1) / 3)` |
| **Caída** | 0.45 | `clamp((caída − 0.15) / 0.55)` |
| **Suelo** | 0.30 | `clamp((2 − visitas/semana) / 2)` |

**La brecha satura a 4× su ritmo, no a 3×.** Con /2 el socio regular de
1×/semana llegaba al máximo a los 21 días —dos visitas perdidas— y salía
Crítico. Es el precio de premiar la regularidad: cuanto más constante, más
estrecha su vara, así que la curva tiene que ser más indulgente para todos.

**La caída se mide HASTA SU ÚLTIMA VISITA, no hasta hoy.** Midiéndola hasta hoy,
el hueco actual se come la ventana reciente y la caída dispara por la misma
razón que la brecha — dos términos leyendo el mismo hecho, que es el pecado de
v3. Separadas: la brecha dice «no está viniendo AHORA», la caída dice «ya venía
menos ANTES de irse». Un socio puede tener una sin la otra, y esa distinción
decide qué le dices cuando lo llamas.

**La caída solo existe con base ≥1 visita/semana.** Por debajo, una ventana de
21 días espera menos de 3 visitas y el ratio es ruido: al de 1×/mes le salía
caída del 100% por saltarse UNA visita.

El **suelo** es donde vive el ancla de Hormozi (<2×/semana es frágil), pequeña y
sin amortiguador. En v3 era la señal principal y luego se multiplicaba por 0,55
cuando el socio era estable — el ancla y su parche se contradecían sobre
exactamente la población que el ancla existía para cazar.

### Novato (cuenta < 75 días)

| Señal | Techo | Se enciende |
|---|---|---|
| Hábito | 0.60 | por debajo de la rampa de 3/semana hacia 12 visitas en 6 semanas |
| Recencia | 0.55 | `clamp(días / 14)` — lineal, más dura |
| **Activación** | 0.40 | menos de **3 visitas al gimnasio** en 21 días, desde el día 21 |

Activación = pisar el gimnasio. En v3 era «registró su primer entreno en la
app», que le quitaba 12 puntos a quien entrenaba a diario y no tocaba el móvil.

### Lente de app — techo 0.10, y solo con base

`baseline ≥ 6` eventos en días 30–90. Solo cuenta una caída **>40%**. Sin base
el término **no existe** — no vale cero, desaparece. Con esto sobra la compuerta
de asistencia de v3 (`si Layer A ≤ 18, tope 54`), que era un tope artificial
para contener una señal mal acotada.

---

## 5. Composición

```
riesgo    = 1 − Π(1 − señalᵢ)          ← OR-ruidoso
score     = 100 × riesgo × (1 − protección)
protección= reto 5% + refirió 5% + PR 3% + social 2%, tope 15%
```

**OR-ruidoso y no suma normalizada.** Fue mi primer intento y lo tumbó una
prueba: dividiendo entre la suma de máximos, el socio con asistencia **perfecta**
que de pronto desaparece tenía una sola señal encendida y las demás a cero, así
que su techo quedaba en 40/90 = 44 y **no podía ser Crítico**. Es el mismo error
que el multiplicador de antigüedad de v3, por otra puerta.

Con el OR-ruidoso ninguna señal diluye a otra, una sola señal fuerte basta, y una
señal que no se puede calcular aporta factor 1 y no participa — sin denominadores
que cuadrar y sin el fallo silencioso de las señales muertas.

**La protección es proporcional, no puntos planos.** v3 restaba hasta 20: sobre
un score de 25 lo dejaba en 5 y sobre uno de 90 no se notaba, al revés de lo que
hace falta. Estar en un reto no hace que tres semanas sin aparecer estén bien.

---

## 6. Bandas · **≥70 Crítico · ≥45 Alto · ≥25 Medio · <25 Bajo**

Más bajas que las de v3 (80/55/30) porque el número ya es porcentaje del riesgo
alcanzable, y **alcanzable por cualquiera**: no hay techo por antigüedad.

---

## 7. Fuera del score, a propósito

- **Antigüedad** → valor en riesgo (cuota × meses esperados) y la explicación.
  El multiplicador de v3 era una tasa base *incondicional* multiplicando una
  probabilidad ya condicionada a la conducta, y su único efecto real era hundir
  a los veteranos: multiplicar a todo un tramo por la misma constante no cambia
  el orden *dentro* del tramo.
- **Confianza** (alta/media/baja) → chip aparte. Un 62 sacado de tres visitas y
  un 62 sacado de un año no son lo mismo.

---

## 8. Cómo se comporta (pruebas en `src/lib/__tests__/churnScoringV4.test.js`)

| Caso | v3 | v4 |
|---|---|---|
| 3×/sem constante, vino ayer | 2 · Bajo | 0 · Bajo |
| 5×/sem → 2×/sem, vino anteayer | **20 · Bajo** | ≥25 · Medio+ |
| 4×/sem, 12 días sin venir | **30 · Medio** | ≥45 · Alto+ |
| 1×/3 semanas, 30 días sin venir | **95 · Crítico** | <70 |
| Veterano 12 meses, apagado | **tope 69** | Crítico |
| Viene a diario, nunca abre la app | penalizado | 0 · Bajo |
| Fantasma de 3 años | **78 Alto eterno** | Perdido, fuera de la cola |

---

## 9. Validación

**No hay ninguna todavía, y hay que decirlo.** Los techos (0.85 / 0.45 / 0.30)
están razonados, no medidos. Mientras no haya desenlaces etiquetados —≈200, o
sea meses— **la comprobabilidad ES la validación**: «no suele pasar de 5 días y
lleva 14» el dueño lo verifica de memoria; «riesgo 62» no se verifica de ninguna
forma. Por eso la frase es obligatoria y por eso cada término es una oración.

El objetivo real lo etiqueta `label_churn_lapses()` (mig 0705) por pg_cron:
*¿vino este socio entre el día 31 y el 90?*, **solo sobre socios que estaban
vivos el día de la puntuación** — sin esa condición un socio ya desaparecido
saldría etiquetado «baja» por definición y volveríamos a entrenar el modelo con
su propia entrada. Primeros datos utilizables: ~90 días desde que la migración
esté aplicada.

`calibrate-churn-weights` queda **apagada tras `CHURN_CALIBRATION_ENABLED`**. Era
inerte por casualidad —los nombres de columna que escribe no coinciden con los
que lee v4— y esa casualidad la deshace cualquier cambio de esquema.

**Calibración por gimnasio: descartada.** 200 etiquetas a ~15/mes son trece
meses, y sobreajustaría. La diferencia entre gimnasios ya entra por el g90 de
cada socio. Si algún día se calibra, será agrupando gimnasios.

---

## 10. Perillas

| Parámetro | Valor | Nota |
|---|---|---|
| `g90` = percentil | 0.90 | **la perilla principal**: p75 avisa antes y molesta a más gente de vacaciones |
| `g90` recorte | 3 … 21 días | |
| Brecha, saturación | 4× su ritmo | |
| Caída, zona muerta / saturación | 15% / 70% | |
| Caída, base mínima | 1 visita/semana | |
| Clase A | ≥8 visitas, ≥42 días | |
| Gracia | cuenta <21 días | |
| Perdido / dormido | 60 / 30 días | solo etiqueta |
| Bandas | 70 / 45 / 25 | |
