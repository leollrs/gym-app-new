// TuGymPR Manual — content data
// Pilot: Trainer walkthrough (full) + sample Numbers / Alerts / Glossary entries.
// screenshot = null everywhere: real screenshots come later. Wireframe placeholders
// are generated from `elements` — same coordinates double as annotation anchors.

const MANUAL = {
  sections: [
    { id: 'member',  label: { es: 'Miembro',    en: 'Member' },  count: 30, ready: true },
    { id: 'trainer', label: { es: 'Entrenador', en: 'Trainer' }, count: 15, ready: true },
    { id: 'admin',   label: { es: 'Admin',      en: 'Admin' },   count: 35, ready: true },
  ],

  // Front matter — user's Claude Design (handoff-2). Rendered by dedicated front renderers.
  front: {
    cover: {
      eyebrow: { es: 'TuGymPR · Manual de Implementación', en: 'TuGymPR · Implementation Manual' },
      meta: { es: 'MIEMBRO · ENTRENADOR · ADMIN · DUEÑO', en: 'MEMBER · TRAINER · ADMIN · OWNER' },
      lede: { es: 'El sistema para detectar, contactar y recuperar miembros antes de que cancelen.', en: 'The system to spot, reach, and win back members before they cancel.' },
      version: { es: 'VERSIÓN 1.0 · PUERTO RICO', en: 'VERSION 1.0 · PUERTO RICO' },
    },
    mission: {
      subheadHtml: {
        es: 'No es solo una app.<br>Es un sistema de<br><span class="accent">retención</span>.',
        en: 'It’s not just an app.<br>It’s a<br><span class="accent">retention system</span>.'
      },
      para: [
        { es: 'TuGymPR ayuda a tu gimnasio a ver quién está dejando de venir, actuar a tiempo y mantener a tus miembros conectados al progreso, la comunidad y la marca.',
          en: 'TuGymPR helps your gym see who’s drifting away, act in time, and keep members connected to their progress, the community, and the brand.' },
        { es: 'La mayoría de los gimnasios pierden miembros en silencio: no se dan cuenta hasta que ya cancelaron. Este sistema convierte ese silencio en una señal — y esa señal en una acción.',
          en: 'Most gyms lose members in silence — they don’t notice until the cancellation’s already happened. This system turns that silence into a signal, and that signal into action.' },
      ],
      without: { label: { es: 'Sin sistema', en: 'Without a system' }, items: [
        { es: 'El miembro deja de venir.', en: 'The member stops showing up.' },
        { es: 'Nadie lo nota hasta que cancela.', en: 'Nobody notices until they cancel.' },
        { es: 'El gimnasio pierde el ingreso en silencio.', en: 'The gym loses the revenue in silence.' },
      ]},
      withSystem: { label: { es: 'Con TuGymPR', en: 'With TuGymPR' }, items: [
        { es: 'La app detecta la baja de actividad.', en: 'The app detects the drop in activity.' },
        { es: 'Te llega una alerta con contexto.', en: 'You get an alert with context.' },
        { es: 'Actúas antes de que cancele.', en: 'You act before they cancel.' },
      ]},
    },
    howToUse: {
      lede: { es: 'No tienes que leerlo todo de una vez. Ve a la parte que te toca hoy y vuelve cuando actives algo nuevo.',
              en: 'You don’t have to read it all at once. Go to the part that’s yours today, and come back when you activate something new.' },
      cards: [
        { title: { es: 'Dueño / Admin', en: 'Owner / Admin' }, items: [
          { es: 'Seguimiento y retención', en: 'Tracking & retention' }, { es: 'Campañas y mensajes', en: 'Campaigns & messaging' }, { es: 'Reportes y decisiones', en: 'Reports & decisions' } ] },
        { title: { es: 'Entrenador', en: 'Trainer' }, items: [
          { es: 'Clientes y programas', en: 'Clients & programs' }, { es: 'Sesiones y progreso', en: 'Sessions & progress' }, { es: 'Detectar baja adherencia', en: 'Spotting low adherence' } ] },
        { title: { es: 'Miembro', en: 'Member' }, items: [
          { es: 'Entrenar y cardio', en: 'Training & cardio' }, { es: 'Nutrición y progreso', en: 'Nutrition & progress' }, { es: 'Retos y recompensas', en: 'Challenges & rewards' } ] },
        { title: { es: 'Implementación', en: 'Implementation' }, items: [
          { es: 'Qué hacer la 1.ª semana', en: 'What to do in week 1' }, { es: 'Qué hacer el 1.er mes', en: 'What to do in month 1' }, { es: 'Checklists y rutinas', en: 'Checklists & routines' } ] },
      ],
      tip: { es: 'Usa el índice de la izquierda o los botones Anterior / Siguiente al pie de cada página — nunca pierdes tu lugar.',
             en: 'Use the index on the left or the Previous / Next buttons at the bottom of each page — you never lose your place.' },
    },
    systemLoop: {
      lede: { es: 'Así se conecta todo. El miembro entrena, la app lo registra, tú lo ves, actúas — y el miembro vuelve.',
              en: 'Here’s how it all connects. The member trains, the app logs it, you see it, you act — and the member comes back.' },
      steps: [
        { title: { es: 'Miembro entrena', en: 'Member trains' }, sub: { es: 'Check-ins y progreso', en: 'Check-ins & progress' } },
        { title: { es: 'Datos', en: 'Data' }, sub: { es: 'Actividad y asistencia', en: 'Activity & attendance' } },
        { title: { es: 'Dashboard', en: 'Dashboard' }, sub: { es: 'Retención y riesgo', en: 'Retention & risk' } },
        { title: { es: 'Alerta', en: 'Alert' }, sub: { es: 'Miembro en riesgo', en: 'Member at risk' } },
        { title: { es: 'Contacto', en: 'Contact' }, sub: { es: 'Mensaje o llamada', en: 'Message or call' } },
        { title: { es: 'Regresa', en: 'Returns' }, sub: { es: 'Vuelve al gimnasio', en: 'Comes back to the gym' } },
      ],
      loopNote: { es: 'El ciclo se repite — y el miembro se queda.', en: 'The cycle repeats — and the member stays.' },
      closing: { es: 'Cada pantalla de este manual es una pieza de esta máquina. Cuando entiendes el ciclo completo, entiendes por qué cada número y cada alerta importan.',
                 en: 'Every screen in this manual is a piece of this machine. Once you understand the full cycle, you understand why every number and every alert matters.' },
    },
    roles: {
      lede: { es: 'El sistema funciona cuando cada quien sabe su parte. Esto es quién hace qué.',
              en: 'The system works when everyone knows their part. Here’s who does what.' },
      cards: [
        { title: { es: 'Dueño / Admin', en: 'Owner / Admin' }, items: [
          { es: 'Mira el riesgo de cancelación', en: 'Watches cancellation risk' }, { es: 'Aprueba campañas', en: 'Approves campaigns' }, { es: 'Mide la retención', en: 'Measures retention' }, { es: 'Revisa reportes', en: 'Reviews reports' } ] },
        { title: { es: 'Entrenador', en: 'Trainer' }, items: [
          { es: 'Revisa a sus clientes', en: 'Reviews their clients' }, { es: 'Asigna rutinas', en: 'Assigns routines' }, { es: 'Registra sesiones', en: 'Logs sessions' }, { es: 'Detecta baja adherencia', en: 'Spots low adherence' } ] },
        { title: { es: 'Front desk / Staff', en: 'Front desk / Staff' }, items: [
          { es: 'Ayuda con el QR y la app', en: 'Helps with the QR & app' }, { es: 'Recuerda los retos', en: 'Reminds about challenges' }, { es: 'Confirma el contacto', en: 'Confirms contact info' }, { es: 'Entrega recompensas', en: 'Hands out rewards' } ] },
        { title: { es: 'Miembro', en: 'Member' }, items: [
          { es: 'Entrena', en: 'Trains' }, { es: 'Registra su progreso', en: 'Logs their progress' }, { es: 'Participa en retos', en: 'Joins challenges' }, { es: 'Recibe recompensas', en: 'Receives rewards' } ] },
      ],
    },
  },

  book: [
    { id:'start',      kind:'docs',    label:{ es:'Empezar aquí', en:'Get started' },  items:['mission','how-to-use','contents','system-loop','roles','activar'] },
    { id:'impl',       kind:'docs',    label:{ es:'Implementación', en:'Implementation' }, items:['7dias','30dias','instalacion','rutina-diaria','rutina-semanal'] },
    { id:'retencion',  kind:'docs',    label:{ es:'Retención', en:'Retention' },       items:['dia3','dia7','dia14','cancela','vuelve','senales'] },
    { id:'plantillas', kind:'docs',    label:{ es:'Plantillas', en:'Templates' },      items:['whatsapp','llamada','retos-msg','recompensas-msg'] },
    { id:'member',     kind:'section', label:{ es:'Miembro', en:'Member' } },
    { id:'trainer',    kind:'section', label:{ es:'Entrenador', en:'Trainer' } },
    { id:'admin',      kind:'section', label:{ es:'Admin', en:'Admin' } },
    { id:'owner',      kind:'docs',    label:{ es:'Dueño', en:'Owner' },               items:['o-reportes','o-retencion','o-crecimiento','o-impacto','o-decisiones'] },
    { id:'reference',  kind:'ref',     label:{ es:'Referencia', en:'Reference' } },
    { id:'cierre',     kind:'docs',    label:{ es:'Cierre', en:'Closing' },            items:['soporte','contraportada'] },
  ],

  docs: [
    // Front-matter pages — user's Claude Design. Content lives in MANUAL.front; `front` dispatches the renderer.
    { id:'mission',     front:'mission',    folioMark:'01', eyebrow:{ es:'Empezar aquí', en:'Get started' }, title:{ es:'No es una app. Es un sistema.', en:'It’s not an app. It’s a system.' } },
    { id:'how-to-use',  front:'howToUse',   folioMark:'02', eyebrow:{ es:'Empezar aquí', en:'Get started' }, title:{ es:'Cómo usar este manual', en:'How to use this manual' } },
    { id:'contents',    front:'contents',   folioMark:'03', eyebrow:{ es:'Empezar aquí', en:'Get started' }, title:{ es:'Contenido', en:'Contents' } },
    { id:'system-loop', front:'systemLoop', folioMark:'04', eyebrow:{ es:'Empezar aquí', en:'Get started' }, title:{ es:'El sistema en una página', en:'The system in one page' } },
    { id:'roles',       front:'roles',      folioMark:'05', eyebrow:{ es:'Empezar aquí', en:'Get started' }, title:{ es:'Roles y responsabilidades', en:'Roles & responsibilities' } },
    {
      id:'activar', eyebrow:{ es:'Empezar aquí', en:'Start here' },
      title:{ es:'Qué activar primero', en:'What to turn on first' },
      blocks:[
        { type:'lede', text:{ es:'No enciendas todo el primer día. Actívalo por fases para que tu equipo lo adopte sin abrumarse.', en:'Don’t turn on everything day one. Roll it out in phases so your team adopts it without overwhelm.' } },
        { type:'phases', phases:[
          { tag:{ es:'Fase 1 · Base', en:'Phase 1 · Core' }, title:{ es:'Retención', en:'Retention' }, items:[{ es:'Riesgo de cancelación', en:'Churn risk' },{ es:'Miembros en riesgo', en:'At-risk members' },{ es:'Mensajes', en:'Messages' },{ es:'Dashboard', en:'Dashboard' }] },
          { tag:{ es:'Fase 2 · Enganche', en:'Phase 2 · Engagement' }, title:{ es:'Comunidad', en:'Community' }, items:[{ es:'Retos', en:'Challenges' },{ es:'Recompensas', en:'Rewards' },{ es:'Referidos', en:'Referrals' }] },
          { tag:{ es:'Fase 3 · Escala', en:'Phase 3 · Scale' }, title:{ es:'Avanzado', en:'Advanced' }, items:[{ es:'Programas avanzados', en:'Advanced programs' },{ es:'Reportes y campañas', en:'Reports and campaigns' },{ es:'Pantalla TV', en:'TV display' }] },
        ]},
      ]
    },
    {
      id:'7dias', eyebrow:{ es:'Implementación', en:'Implementation' }, folioMark:'7',
      title:{ es:'Plan de lanzamiento: primeros 7 días', en:'Launch plan: first 7 days' },
      blocks:[
        { type:'lede', text:{ es:'Una semana para pasar de instalado a funcionando. Un enfoque por día.', en:'One week to go from installed to running. One focus per day.' } },
        { type:'timeline', rows:[
          { label:{ es:'Día 1', en:'Day 1' }, title:{ es:'Marca y configuración', en:'Branding and setup' }, text:{ es:'Logo, colores, nombre y datos del gimnasio.', en:'Logo, colors, name, and gym info.' } },
          { label:{ es:'Día 2', en:'Day 2' }, title:{ es:'Entrenar al staff', en:'Train the staff' }, text:{ es:'Cómo usar el panel y contactar miembros.', en:'How to use the dashboard and contact members.' } },
          { label:{ es:'Día 3', en:'Day 3' }, title:{ es:'QR y front desk', en:'QR and front desk' }, text:{ es:'Check-in en la puerta y ayuda con la app.', en:'Door check-in and app help.' } },
          { label:{ es:'Día 4', en:'Day 4' }, title:{ es:'Flujo del entrenador', en:'Trainer workflow' }, text:{ es:'Clientes, rutinas y sesiones.', en:'Clients, routines, and sessions.' } },
          { label:{ es:'Día 5', en:'Day 5' }, title:{ es:'Primera lista de retención', en:'First retention list' }, text:{ es:'Revisa quién está en riesgo.', en:'Review who’s at risk.' } },
          { label:{ es:'Día 6', en:'Day 6' }, title:{ es:'Primera campaña', en:'First campaign' }, text:{ es:'Contacta al primer grupo en riesgo.', en:'Contact the first at-risk group.' } },
          { label:{ es:'Día 7', en:'Day 7' }, title:{ es:'Revisar resultados', en:'Review results' }, text:{ es:'Qué funcionó y qué ajustar.', en:'What worked and what to adjust.' } },
        ]},
      ]
    },
    {
      id:'30dias', eyebrow:{ es:'Implementación', en:'Implementation' }, folioMark:'30',
      title:{ es:'Los primeros 30 días', en:'The first 30 days' },
      blocks:[
        { type:'lede', text:{ es:'El primer mes construye el hábito. Una meta por semana.', en:'The first month builds the habit. One goal per week.' } },
        { type:'timeline', rows:[
          { label:{ es:'Semana 1', en:'Week 1' }, title:{ es:'Setup', en:'Setup' }, text:{ es:'Marca, staff, QR y primeros datos.', en:'Branding, staff, QR, and first data.' } },
          { label:{ es:'Semana 2', en:'Week 2' }, title:{ es:'Adopción', en:'Adoption' }, text:{ es:'Que los miembros usen la app a diario.', en:'Get members using the app daily.' } },
          { label:{ es:'Semana 3', en:'Week 3' }, title:{ es:'Retención', en:'Retention' }, text:{ es:'Contacto sistemático a los en riesgo.', en:'Systematic outreach to at-risk members.' } },
          { label:{ es:'Semana 4', en:'Week 4' }, title:{ es:'Reporte y ajuste', en:'Report and optimize' }, text:{ es:'Mide la retención y decide el próximo mes.', en:'Measure retention and decide next month.' } },
        ]},
      ]
    },
    {
      id:'instalacion', eyebrow:{ es:'Implementación', en:'Implementation' },
      title:{ es:'Checklist de instalación', en:'Installation checklist' },
      blocks:[
        { type:'lede', text:{ es:'Todo lo que debe estar listo antes de invitar a tu primer miembro.', en:'Everything that should be ready before you invite your first member.' } },
        { type:'checklist', items:[
          { es:'Logo subido', en:'Logo uploaded' },{ es:'Colores de marca', en:'Brand colors' },
          { es:'Membresías configuradas', en:'Memberships configured' },{ es:'Entrenadores añadidos', en:'Trainers added' },
          { es:'Programas creados', en:'Programs created' },{ es:'Mensajes / plantillas', en:'Messages / templates' },
          { es:'QR de check-in activo', en:'QR check-in active' },{ es:'Staff entrenado', en:'Staff trained' },
          { es:'Horario y feriados', en:'Hours and holidays' },{ es:'Rutina de revisión del panel', en:'Dashboard review routine' },
        ]},
      ]
    },
    {
      id:'rutina-diaria', eyebrow:{ es:'Implementación', en:'Implementation' },
      title:{ es:'Rutina diaria del administrador', en:'Daily admin routine' },
      blocks:[
        { type:'lede', text:{ es:'Diez minutos al día mantienen el sistema vivo. Este es el recorrido.', en:'Ten minutes a day keeps the system alive. Here’s the round.' } },
        { type:'numlist', items:[
          { es:'Revisar los miembros en riesgo del día', en:'Review today’s at-risk members' },
          { es:'Contactar la prioridad del día', en:'Contact the day’s priority' },
          { es:'Revisar mensajes pendientes', en:'Check pending messages' },
          { es:'Ver la actividad reciente', en:'Scan recent activity' },
          { es:'Revisar recompensas y referidos', en:'Review rewards and referrals' },
          { es:'Cerrar con notas para mañana', en:'Close with notes for tomorrow' },
        ]},
      ]
    },
    {
      id:'rutina-semanal', eyebrow:{ es:'Implementación', en:'Implementation' },
      title:{ es:'Rutina semanal del dueño', en:'Weekly owner routine' },
      blocks:[
        { type:'lede', text:{ es:'Una vez por semana, sube un nivel: del día a día a las decisiones.', en:'Once a week, zoom out: from the day-to-day to the decisions.' } },
        { type:'checklist', items:[
          { es:'Revisar la retención de la semana', en:'Review the week’s retention' },
          { es:'Revisar miembros recuperados', en:'Review recovered members' },
          { es:'Revisar campañas enviadas', en:'Review sent campaigns' },
          { es:'Revisar clases con baja asistencia', en:'Review low-attendance classes' },
          { es:'Revisar actividad de entrenadores', en:'Review trainer activity' },
          { es:'Decidir las acciones de la semana', en:'Decide the week’s actions' },
        ]},
      ]
    },
    {
      id:'dia3', eyebrow:{ es:'Retención · Flujo', en:'Retention · Workflow' }, folioMark:'3',
      title:{ es:'No viene en 3 días', en:'No visit in 3 days' },
      blocks:[
        { type:'lede', text:{ es:'Todavía no es alarma — es el mejor momento para un empujón ligero antes de que se enfríe.', en:'Not an alarm yet — it’s the best moment for a light nudge before they cool off.' } },
        { type:'callout', label:{ es:'Qué hacer', en:'What to do' }, text:{ es:'Un recordatorio suave y humano. Sin presión: recuérdale que lo esperas y que retomar es fácil.', en:'A soft, human reminder. No pressure: remind them you’re expecting them and that getting back is easy.' } },
        { type:'script', scripts:[ { when:{ es:'WhatsApp · 3 días', en:'WhatsApp · 3 days' }, text:{ es:'Hey [Nombre], vi que llevas unos días sin pasar. ¿Todo bien? Esta semana podemos ayudarte a retomar suave.', en:'Hey [Name], I noticed it’s been a few days. All good? This week we can help you ease back in.' } } ] },
      ]
    },
    {
      id:'dia7', eyebrow:{ es:'Retención · Flujo', en:'Retention · Workflow' }, folioMark:'7',
      title:{ es:'No viene en 7 días', en:'No visit in 7 days' },
      blocks:[
        { type:'lede', text:{ es:'Una semana sin venir es una señal real. Toca contacto directo — un mensaje personal o una llamada.', en:'A week away is a real signal. Time for direct contact — a personal message or a call.' } },
        { type:'callout', label:{ es:'Qué hacer', en:'What to do' }, text:{ es:'Ofrece algo concreto: una rutina corta para volver, o separarle un horario. Facilita el regreso, no lo juzgues.', en:'Offer something concrete: a short comeback routine, or hold a time for them. Make the return easy, don’t judge it.' } },
        { type:'script', scripts:[ { when:{ es:'WhatsApp · 7 días', en:'WhatsApp · 7 days' }, text:{ es:'Hey [Nombre], te extrañamos por el gym. ¿Quieres que te separemos una rutina corta para volver esta semana?', en:'Hey [Name], we’ve missed you at the gym. Want us to set up a short routine so you can get back this week?' } } ] },
      ]
    },
    {
      id:'dia14', eyebrow:{ es:'Retención · Flujo', en:'Retention · Workflow' }, folioMark:'14',
      title:{ es:'No viene en 14 días', en:'No visit in 14 days' },
      blocks:[
        { type:'lede', text:{ es:'Aquí se decide si vuelve o se pierde. Es acción de recuperación — directa y con una salida fácil.', en:'This is where they either return or slip away. It’s a win-back — direct, with an easy way back.' } },
        { type:'callout', label:{ es:'Qué hacer', en:'What to do' }, text:{ es:'Contacto personal (mensaje o llamada) con una invitación específica: un día concreto, un incentivo pequeño, cero fricción.', en:'Personal contact (message or call) with a specific invite: a concrete day, a small incentive, zero friction.' } },
        { type:'script', scripts:[ { when:{ es:'WhatsApp · 14 días', en:'WhatsApp · 14 days' }, text:{ es:'Hey [Nombre], antes de que pierdas el ritmo, queremos ayudarte a volver. ¿Qué día se te hace más fácil pasar?', en:'Hey [Name], before you lose your rhythm, we want to help you get back. What day is easiest for you to come by?' } } ] },
      ]
    },
    {
      id:'cancela', eyebrow:{ es:'Retención · Flujo', en:'Retention · Workflow' },
      title:{ es:'Cuando cancela', en:'When they cancel' },
      blocks:[
        { type:'lede', text:{ es:'Una cancelación no es el final — es información. Captúrala y deja la puerta abierta.', en:'A cancellation isn’t the end — it’s information. Capture it and leave the door open.' } },
        { type:'numlist', items:[
          { es:'Pregunta la razón de salida (una línea basta)', en:'Ask the exit reason (one line is enough)' },
          { es:'Registra al miembro para reactivación futura', en:'Tag the member for future reactivation' },
          { es:'Agradece — sin culpa, sin fricción', en:'Thank them — no guilt, no friction' },
          { es:'Programa un mensaje de reactivación en 30–60 días', en:'Schedule a reactivation message in 30–60 days' },
        ]},
      ]
    },
    {
      id:'vuelve', eyebrow:{ es:'Retención · Flujo', en:'Retention · Workflow' },
      title:{ es:'Cuando vuelve', en:'When they return' },
      blocks:[
        { type:'lede', text:{ es:'El regreso es frágil. Celébralo para que la segunda vez se quede.', en:'The return is fragile. Celebrate it so the second time sticks.' } },
        { type:'numlist', items:[
          { es:'Celébralo — reconócelo en persona o por mensaje', en:'Celebrate it — acknowledge them in person or by message' },
          { es:'Dale una recompensa o un reto para reengancharlo', en:'Give a reward or a challenge to re-hook them' },
          { es:'Reconéctalo a su progreso y a la comunidad', en:'Reconnect them to their progress and the community' },
        ]},
      ]
    },
    {
      id:'senales', eyebrow:{ es:'Retención · Flujo', en:'Retention · Workflow' },
      title:{ es:'Señales de baja', en:'Warning signs' },
      blocks:[
        { type:'lede', text:{ es:'La cancelación casi nunca es una sorpresa. Estas son las señales que la anteceden.', en:'Cancellation is almost never a surprise. These are the signs that come before it.' } },
        { type:'list', items:[
          { es:'Menos visitas que su ritmo normal', en:'Fewer visits than their normal rhythm' },
          { es:'Deja de registrar entrenamientos', en:'Stops logging workouts' },
          { es:'No responde a los mensajes', en:'Stops answering messages' },
          { es:'Baja su participación en retos', en:'Drops out of challenges' },
          { es:'No usa sus recompensas', en:'Doesn’t use their rewards' },
          { es:'Cambia su frecuencia habitual', en:'Shifts their usual frequency' },
        ]},
      ]
    },
    {
      id:'whatsapp', eyebrow:{ es:'Plantillas', en:'Templates' },
      title:{ es:'Scripts de WhatsApp', en:'WhatsApp scripts' },
      blocks:[
        { type:'lede', text:{ es:'Copia, pega y personaliza con el nombre. Tono humano, nunca robótico.', en:'Copy, paste, and personalize with the name. Human tone, never robotic.' } },
        { type:'script', scripts:[
          { when:{ es:'3 días sin venir', en:'3 days away' }, text:{ es:'Hey [Nombre], vi que llevas unos días sin pasar. ¿Todo bien? Esta semana podemos ayudarte a retomar suave.', en:'Hey [Name], I noticed it’s been a few days. All good? This week we can help you ease back in.' } },
          { when:{ es:'7 días sin venir', en:'7 days away' }, text:{ es:'Hey [Nombre], te extrañamos por el gym. ¿Quieres que te separemos una rutina corta para volver esta semana?', en:'Hey [Name], we’ve missed you at the gym. Want us to set up a short routine so you can get back this week?' } },
          { when:{ es:'14 días sin venir', en:'14 days away' }, text:{ es:'Hey [Nombre], antes de que pierdas el ritmo, queremos ayudarte a volver. ¿Qué día se te hace más fácil pasar?', en:'Hey [Name], before you lose your rhythm, we want to help you get back. What day is easiest for you to come by?' } },
        ]},
      ]
    },
    {
      id:'llamada', eyebrow:{ es:'Plantillas', en:'Templates' },
      title:{ es:'Scripts de llamada', en:'Call scripts' },
      blocks:[
        { type:'lede', text:{ es:'Cortos y cálidos. El objetivo de la llamada no es vender — es que se sienta esperado.', en:'Short and warm. The goal of the call isn’t to sell — it’s to make them feel expected.' } },
        { type:'script', scripts:[
          { when:{ es:'Apertura', en:'Opening' }, text:{ es:'Hola [Nombre], soy [Tu nombre] de [Gimnasio]. Nada urgente — te llamo porque te hemos echado de menos y quería saber cómo vas.', en:'Hi [Name], this is [Your name] from [Gym]. Nothing urgent — I’m calling because we’ve missed you and wanted to see how you’re doing.' } },
          { when:{ es:'Invitación', en:'The invite' }, text:{ es:'Si quieres, te preparo algo suave para esta semana. ¿Te sirve [día] o prefieres otro?', en:'If you’d like, I can set up something easy for this week. Does [day] work, or would another be better?' } },
        ]},
      ]
    },
    {
      id:'retos-msg', eyebrow:{ es:'Plantillas', en:'Templates' },
      title:{ es:'Mensajes de reto', en:'Challenge messages' },
      blocks:[
        { type:'script', scripts:[
          { when:{ es:'Lanzar reto', en:'Launch' }, text:{ es:'¡Nuevo reto en [Gimnasio]! [Nombre del reto] empieza [fecha]. Únete desde la app y compite por [premio].', en:'New challenge at [Gym]! [Challenge name] starts [date]. Join from the app and compete for [reward].' } },
          { when:{ es:'Recordar reto', en:'Remind' }, text:{ es:'[Nombre], quedan [X] días del reto y estás cerca del top. Un entreno más y subes de posición.', en:'[Name], there are [X] days left in the challenge and you’re close to the top. One more workout moves you up.' } },
          { when:{ es:'Felicitar', en:'Congratulate' }, text:{ es:'¡[Nombre], terminaste el reto! Pasa por [Gimnasio] a reclamar tu recompensa. Orgullosos de ti.', en:'[Name], you finished the challenge! Come by [Gym] to claim your reward. Proud of you.' } },
        ]},
      ]
    },
    {
      id:'recompensas-msg', eyebrow:{ es:'Plantillas', en:'Templates' },
      title:{ es:'Mensajes de recompensas', en:'Reward messages' },
      blocks:[
        { type:'script', scripts:[
          { when:{ es:'Cumpleaños', en:'Birthday' }, text:{ es:'¡Feliz cumpleaños, [Nombre]! Tienes una recompensa esperándote en [Gimnasio] este mes. 🎉', en:'Happy birthday, [Name]! There’s a reward waiting for you at [Gym] this month. 🎉' } },
          { when:{ es:'Meta de asistencia', en:'Attendance milestone' }, text:{ es:'[Nombre], llegaste a [X] visitas. Ganaste [recompensa] — pasa a reclamarla.', en:'[Name], you hit [X] visits. You’ve earned [reward] — come claim it.' } },
          { when:{ es:'Nuevo PR', en:'New PR' }, text:{ es:'¡[Nombre], nuevo récord personal! Eso merece premio. Tienes puntos extra en tu cuenta.', en:'[Name], new personal record! That deserves a prize. Extra points are in your account.' } },
          { when:{ es:'Racha', en:'Streak' }, text:{ es:'[Nombre], [X] días de racha. La constancia se premia — revisa tus recompensas en la app.', en:'[Name], [X]-day streak. Consistency pays — check your rewards in the app.' } },
        ]},
      ]
    },
    {
      id:'o-reportes', eyebrow:{ es:'El lente del dueño', en:'The owner’s lens' },
      title:{ es:'Reportes', en:'Reports' },
      blocks:[
        { type:'lede', text:{ es:'Los reportes convierten la actividad diaria en decisiones. Exporta, presenta, decide.', en:'Reports turn daily activity into decisions. Export, present, decide.' } },
        { type:'list', items:[
          { es:'Miembros: estado, actividad y retención', en:'Members: status, activity, and retention' },
          { es:'Ingresos: sellos y economía de puntos', en:'Revenue: punch cards and points economy' },
          { es:'Asistencia: tráfico y horas pico', en:'Attendance: traffic and peak hours' },
          { es:'Todo exportable a CSV para tu contabilidad o un socio', en:'All exportable to CSV for bookkeeping or a partner' },
        ]},
      ]
    },
    {
      id:'o-retencion', eyebrow:{ es:'El lente del dueño', en:'The owner’s lens' },
      title:{ es:'Retención', en:'Retention' },
      blocks:[
        { type:'lede', text:{ es:'La retención es el único número que compone tu negocio. Míralo por cohorte, no en promedio.', en:'Retention is the one number that compounds your business. Read it by cohort, not on average.' } },
        { type:'list', items:[
          { es:'Baja el churn 5 puntos antes de perseguir miembros nuevos', en:'Cut churn 5 points before chasing new members' },
          { es:'Vigila el mes 3 — ahí es donde más se cae', en:'Watch month 3 — that’s where most fall off' },
          { es:'Mide miembros recuperados, no solo perdidos', en:'Measure recovered members, not just lost ones' },
        ]},
      ]
    },
    {
      id:'o-crecimiento', eyebrow:{ es:'El lente del dueño', en:'The owner’s lens' },
      title:{ es:'Crecimiento', en:'Growth' },
      blocks:[
        { type:'lede', text:{ es:'El crecimiento sano es retención + referidos, no solo publicidad.', en:'Healthy growth is retention + referrals, not just ads.' } },
        { type:'list', items:[
          { es:'Referidos: tu canal más barato — premia ambos lados', en:'Referrals: your cheapest channel — reward both sides' },
          { es:'Un miembro que se queda vale más que tres que prueban', en:'One member who stays is worth more than three who try' },
          { es:'Usa cohortes para ver si el crecimiento se sostiene', en:'Use cohorts to see if growth holds' },
        ]},
      ]
    },
    {
      id:'o-impacto', eyebrow:{ es:'El lente del dueño', en:'The owner’s lens' },
      title:{ es:'Impacto', en:'Impact' },
      blocks:[
        { type:'lede', text:{ es:'Detrás de cada número hay una persona que sigue entrenando. Ese es el impacto real.', en:'Behind every number is a person still training. That’s the real impact.' } },
        { type:'list', items:[
          { es:'Cada recuperación es un miembro que no perdiste', en:'Every win-back is a member you didn’t lose' },
          { es:'La constancia de tus miembros es tu mejor marketing', en:'Your members’ consistency is your best marketing' },
          { es:'Un gimnasio que retiene construye comunidad, no solo ingresos', en:'A gym that retains builds community, not just revenue' },
        ]},
      ]
    },
    {
      id:'o-decisiones', eyebrow:{ es:'El lente del dueño', en:'The owner’s lens' },
      title:{ es:'Decisiones semanales', en:'Weekly decisions' },
      blocks:[
        { type:'lede', text:{ es:'Cada semana, tres decisiones bastan para mover la aguja.', en:'Each week, three decisions are enough to move the needle.' } },
        { type:'numlist', items:[
          { es:'¿A quién recuperamos esta semana?', en:'Who do we win back this week?' },
          { es:'¿Qué reto o campaña lanzamos?', en:'What challenge or campaign do we launch?' },
          { es:'¿Qué clase o entrenador necesita apoyo?', en:'Which class or trainer needs support?' },
        ]},
      ]
    },
    {
      id:'soporte', eyebrow:{ es:'Cierre', en:'Closing' },
      title:{ es:'¿Necesitas ayuda?', en:'Need help?' },
      blocks:[
        { type:'statement', text:{ es:'No se instala y<br>se <em>abandona</em>.', en:'It isn’t installed<br>and <em>abandoned</em>.' } },
        { type:'p', text:{ es:'TuGymPR te acompaña para que el sistema realmente se use. Si algo no está claro o quieres afinar tu retención, escríbenos.', en:'TuGymPR sticks with you so the system actually gets used. If anything’s unclear or you want to fine-tune your retention, reach out.' } },
        { type:'kv', rows:[
          { k:{ es:'Sitio', en:'Web' }, v:{ es:'TuGymPR.com', en:'TuGymPR.com' } },
          { k:{ es:'Correo', en:'Email' }, v:{ es:'hola@tugympr.com', en:'hola@tugympr.com' } },
          { k:{ es:'WhatsApp', en:'WhatsApp' }, v:{ es:'Soporte directo por chat', en:'Direct chat support' } },
        ]},
      ]
    },
    {
      id:'contraportada', kind:'backcover', eyebrow:{ es:'Cierre', en:'Closing' },
      title:{ es:'TuGymPR', en:'TuGymPR' },
      statement:{ es:'Menos bajas.<br>Más vueltas.<br><em>Más miembros que se quedan.</em>', en:'Fewer cancellations.<br>More comebacks.<br><em>More members who stay.</em>' },
      url:{ es:'TuGymPR.com', en:'TuGymPR.com' },
    },
  ],

  member: [
    {
      id: 'login', order: 1, aspect: 'phone',
      title: { es: 'Iniciar Sesión', en: 'Log In' },
      what: { es: 'La puerta de entrada del miembro: correo y contraseña, con recuperación por correo si la olvidó.', en: "The member's front door: email and password, with email recovery if they forget it." },
      usage: { es: 'Si un miembro no puede entrar, casi siempre es la contraseña — desde aquí pide el enlace de recuperación en segundos.', en: "If a member can't get in, it's almost always the password — the recovery link starts here in seconds." },
      elements: [
        { x:20,y:8,w:60,h:12, type:'header', label:{es:'Logo del gimnasio', en:'Gym logo'}, desc:{es:'Tu marca, no la de la app.', en:'Your brand, not the app’s.'} },
        { x:6,y:28,w:88,h:9, type:'input', label:{es:'Correo', en:'Email'}, desc:{es:'Con sugerencia de typo (“¿quisiste decir…?”).', en:'With typo suggestion (“did you mean…?”).'} },
        { x:6,y:41,w:88,h:9, type:'input', label:{es:'Contraseña', en:'Password'}, desc:{es:'Con mostrar/ocultar.', en:'With show/hide.'} },
        { x:6,y:55,w:88,h:9, type:'button', label:{es:'Entrar', en:'Log in'}, desc:{es:'Valida y abre el panel.', en:'Validates and opens the dashboard.'} },
        { x:20,y:68,w:60,h:6, type:'chip-row', label:{es:'¿Olvidaste tu contraseña?', en:'Forgot password?'}, desc:{es:'Envía enlace de recuperación.', en:'Sends the recovery link.'} },
      ]
    },
    {
      id: 'registro', order: 2, aspect: 'phone',
      title: { es: 'Crear Cuenta', en: 'Sign Up' },
      what: { es: 'Registro de un nuevo miembro. Si tu gimnasio exige código de invitación, se valida aquí.', en: 'New-member sign up. If your gym requires an invite code, it’s validated here.' },
      usage: { es: 'Comparte tu código o enlace de invitación para que solo tus miembros entren — evita cuentas de gente ajena al gimnasio.', en: 'Share your invite code or link so only your members join — it keeps out accounts from people outside the gym.' },
      elements: [
        { x:6,y:8,w:88,h:9, type:'input', label:{es:'Nombre', en:'Name'}, desc:{es:'Nombre y apellidos.', en:'First and last name.'} },
        { x:6,y:20,w:88,h:9, type:'input', label:{es:'Correo', en:'Email'}, desc:{es:'Será su usuario.', en:'Becomes their username.'} },
        { x:6,y:32,w:88,h:9, type:'input', label:{es:'Contraseña', en:'Password'}, desc:{es:'Mínimo de seguridad exigido.', en:'Enforces a minimum strength.'} },
        { x:6,y:44,w:88,h:9, type:'input', label:{es:'Código de invitación', en:'Invite code'}, desc:{es:'Solo si tu gimnasio lo exige.', en:'Only if your gym requires it.'} },
        { x:6,y:57,w:88,h:7, type:'toggle', label:{es:'Aceptar términos', en:'Accept terms'}, desc:{es:'Enlaza a privacidad y términos.', en:'Links to privacy and terms.'} },
        { x:6,y:70,w:88,h:9, type:'button', label:{es:'Crear cuenta', en:'Create account'}, desc:{es:'Lleva al onboarding.', en:'Goes to onboarding.'} },
      ]
    },
    {
      id: 'onboarding', order: 3, aspect: 'phone',
      title: { es: 'Configuración Inicial', en: 'Onboarding' },
      what: { es: 'Nueve pasos: idioma, nivel, meta, días, equipo, lesiones, salud y medidas. Con esto la app arma el primer plan.', en: 'Nine steps: language, level, goal, days, equipment, injuries, health, and body metrics. From this the app builds the first plan.' },
      usage: { es: 'Asegúrate de que los miembros nuevos lo completen — un onboarding a medias es la causa #1 de que nunca activen la app.', en: "Make sure new members finish it — a half-done onboarding is the #1 reason someone never activates the app." },
      calculates: { es: 'Las medidas (peso, altura, edad, sexo) alimentan el cálculo de macros y el motor de sobrecarga. El IMC deriva el somatotipo (ecto/meso/endo) que define el estilo de rutina.', en: 'Body metrics (weight, height, age, sex) feed the macro calculator and the overload engine. BMI derives the somatotype (ecto/meso/endo) that shapes the routine style.' },
      elements: [
        { x:6,y:5,w:88,h:5, type:'chip-row', label:{es:'Barra de progreso', en:'Progress bar'}, desc:{es:'Paso 3 de 9.', en:'Step 3 of 9.'} },
        { x:6,y:14,w:88,h:12, type:'header', label:{es:'Pregunta del paso', en:'Step question'}, desc:{es:'Una decisión por pantalla.', en:'One decision per screen.'} },
        { x:6,y:30,w:88,h:40, type:'list', label:{es:'Opciones', en:'Options'}, desc:{es:'Nivel, meta, equipo, etc.', en:'Level, goal, equipment, etc.'} },
        { x:6,y:82,w:40,h:8, type:'button', label:{es:'Salir', en:'Exit'}, desc:{es:'Guarda el borrador y sale.', en:'Saves the draft and exits.'} },
        { x:50,y:82,w:44,h:8, type:'button', label:{es:'Continuar', en:'Continue'}, desc:{es:'Avanza al siguiente paso.', en:'Advances to the next step.'} },
      ]
    },
    {
      id: 'inicio', order: 4, aspect: 'phone',
      title: { es: 'Inicio', en: 'Home' },
      what: { es: 'El centro del miembro: próximo entrenamiento, tira de 7 días, retomar sesión, anuncios del gimnasio y la racha.', en: "The member's hub: next workout, 7-day strip, resume session, gym announcements, and the streak." },
      usage: { es: 'Es lo primero que ven al abrir la app. Tus anuncios aparecen aquí — úsalos para eventos, cambios de horario y retos.', en: "It's the first thing they see. Your announcements surface here — use them for events, hour changes, and challenges." },
      elements: [
        { x:6,y:4,w:60,h:8, type:'header', label:{es:'Saludo y racha', en:'Greeting & streak'}, desc:{es:'La llama muestra los días seguidos.', en:'The flame shows consecutive days.'} },
        { x:70,y:4,w:24,h:8, type:'badge', label:{es:'Rango', en:'Rank'}, desc:{es:'Posición en el leaderboard.', en:'Leaderboard position.'} },
        { x:6,y:15,w:88,h:9, type:'chip-row', label:{es:'Tira de 7 días', en:'7-day strip'}, desc:{es:'Entrenos de la semana, con estado.', en:'The week’s workouts, with status.'} },
        { x:6,y:27,w:88,h:18, type:'card', label:{es:'Próximo entreno', en:'Next workout'}, desc:{es:'Botón para empezar o retomar.', en:'Button to start or resume.'} },
        { x:6,y:48,w:88,h:14, type:'card', label:{es:'Anuncio del gimnasio', en:'Gym announcement'}, desc:{es:'Lo que publicas en Admin.', en:'What you post in Admin.'} },
        { x:6,y:65,w:88,h:20, type:'list', label:{es:'Coaching e insights', en:'Coaching & insights'}, desc:{es:'Recuperación y recomendación del día.', en:'Recovery and the day’s recommendation.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Inicio · Rutinas · Grabar · Progreso · Comunidad.', en:'Home · Workouts · Record · Progress · Community.'} },
      ]
    },
    {
      id: 'grabar', order: 5, aspect: 'phone',
      title: { es: 'Grabar', en: 'Record' },
      what: { es: 'El botón central. Retoma borradores de sesión, ve cardio en curso y lanza rápido: entreno, cardio o nutrición.', en: 'The center button. Resume draft sessions, see cardio in progress, and quick-launch: workout, cardio, or nutrition.' },
      usage: { es: 'Es el atajo para empezar a entrenar en un toque. Si un miembro “perdió” su entreno, casi siempre está aquí como borrador.', en: "It's the one-tap start. If a member “lost” their workout, it's almost always sitting here as a draft." },
      elements: [
        { x:6,y:5,w:88,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'¿Qué quieres registrar?', en:'What do you want to log?'} },
        { x:6,y:16,w:88,h:16, type:'card', label:{es:'Borrador activo', en:'Active draft'}, desc:{es:'Sesión a medias, con “retomar”.', en:'A half-done session, with “resume.”'} },
        { x:6,y:36,w:88,h:12, type:'button', label:{es:'Empezar entreno', en:'Start workout'}, desc:{es:'Abre el selector de rutina.', en:'Opens the routine picker.'} },
        { x:6,y:51,w:88,h:12, type:'button', label:{es:'Empezar cardio', en:'Start cardio'}, desc:{es:'Cronómetro por fases.', en:'The phased stopwatch.'} },
        { x:6,y:66,w:88,h:12, type:'button', label:{es:'Registrar nutrición', en:'Log nutrition'}, desc:{es:'Foto, código o manual.', en:'Photo, barcode, or manual.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Navegación principal.', en:'Primary navigation.'} },
      ]
    },
    {
      id: 'checkin', order: 6, aspect: 'phone',
      title: { es: 'Check-in', en: 'Check-in' },
      what: { es: 'Tres formas de registrar asistencia: QR (el miembro muestra, tu staff escanea), GPS al llegar, o manual.', en: 'Three ways to log attendance: QR (member shows, your staff scans), GPS on arrival, or manual.' },
      usage: { es: 'El check-in alimenta la asistencia y la racha — es tu señal más honesta de quién de verdad viene al gimnasio.', en: "Check-in feeds attendance and the streak — it's your most honest signal of who's actually showing up." },
      calculates: { es: 'El QR se firma con HMAC-SHA256 y comparación en tiempo constante para que no se falsifique. La racha protege días de cierre del gimnasio y días de descanso.', en: "The QR is signed with HMAC-SHA256 and constant-time comparison so it can't be forged. The streak protects gym-closure days and rest days." },
      elements: [
        { x:20,y:6,w:60,h:10, type:'header', label:{es:'Racha actual', en:'Current streak'}, desc:{es:'Días seguidos, con congelamiento.', en:'Consecutive days, with freeze.'} },
        { x:22,y:20,w:56,h:32, type:'card', label:{es:'Código QR', en:'QR code'}, desc:{es:'Se refresca cada 60s.', en:'Refreshes every 60s.'} },
        { x:6,y:56,w:88,h:8, type:'button', label:{es:'Congelar racha', en:'Freeze streak'}, desc:{es:'1 gratis al mes.', en:'1 free per month.'} },
        { x:6,y:68,w:88,h:18, type:'list', label:{es:'Historial', en:'History'}, desc:{es:'Por fecha, con ícono del método.', en:'By date, with the method icon.'} },
      ]
    },
    {
      id: 'rutinas', order: 7, aspect: 'phone',
      title: { es: 'Mis Rutinas', en: 'My Workouts' },
      what: { es: 'La biblioteca de rutinas del miembro en tres pestañas: propias, programas del gimnasio y auto-generadas (“Para ti”).', en: 'The member’s routine library in three tabs: their own, gym programs, and AI-generated (“For You”).' },
      usage: { es: 'Los programas del gimnasio que tú creas aparecen aquí para que se inscriban — una gran forma de guiar a los principiantes.', en: 'The gym programs you create show up here for members to enroll in — a great way to guide beginners.' },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Título y crear rutina.', en:'Title and create routine.'} },
        { x:6,y:14,w:88,h:8, type:'chip-row', label:{es:'Pestañas', en:'Tabs'}, desc:{es:'Mis · Del gimnasio · Para ti.', en:'Mine · Gym · For You.'} },
        { x:6,y:25,w:88,h:20, type:'card', label:{es:'Tarjeta de rutina', en:'Routine card'}, desc:{es:'Nombre, duración y músculos.', en:'Name, duration, and muscles.'} },
        { x:6,y:48,w:88,h:20, type:'card', label:{es:'Programa del gimnasio', en:'Gym program'}, desc:{es:'Botón de inscribirse.', en:'Enroll button.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Navegación principal.', en:'Primary navigation.'} },
      ]
    },
    {
      id: 'sesion', order: 8, aspect: 'phone',
      title: { es: 'Sesión Activa', en: 'Active Session' },
      what: { es: 'La experiencia de entrenamiento a pantalla completa: peso/reps sugeridos, registro de series, RPE, descanso y celebración de PR.', en: 'The full-screen workout experience: suggested weight/reps, set logging, RPE, rest timer, and PR celebration.' },
      usage: { es: 'Es donde el miembro pasa el tiempo real de entreno. Mientras más registra aquí, más exactos quedan sus PRs y su progreso.', en: "It's where real training time happens. The more a member logs here, the more accurate their PRs and progress." },
      calculates: { es: 'El peso sugerido sale del motor de sobrecarga progresiva: estima el 1RM (Epley ≤12 reps, Brzycki >12) y aplica doble progresión (primero reps, luego peso).', en: 'The suggested weight comes from the progressive-overload engine: it estimates 1RM (Epley ≤12 reps, Brzycki >12) and applies double progression (reps first, then weight).' },
      alert: { es: 'Alerta de Récord Personal (PR): se dispara cuando una serie supera el mejor peso o reps previo del miembro en ese ejercicio, con confeti.', en: "Personal Record (PR) alert: fires when a set beats the member's previous best weight or reps on that exercise, with confetti." },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Cronómetro', en:'Timer'}, desc:{es:'Tiempo de la sesión.', en:'Session elapsed time.'} },
        { x:6,y:14,w:88,h:12, type:'card', label:{es:'Ejercicio actual', en:'Current exercise'}, desc:{es:'Nombre, video y serie en curso.', en:'Name, video, and current set.'} },
        { x:6,y:29,w:88,h:7, type:'chip-row', label:{es:'Peso sugerido', en:'Suggested weight'}, desc:{es:'Del motor de sobrecarga.', en:'From the overload engine.'} },
        { x:6,y:39,w:28,h:8, type:'input', label:{es:'Reps', en:'Reps'}, desc:{es:'Botones rápidos 6/8/10/12.', en:'Quick buttons 6/8/10/12.'} },
        { x:36,y:39,w:28,h:8, type:'input', label:{es:'Peso', en:'Weight'}, desc:{es:'Se registra por serie.', en:'Logged per set.'} },
        { x:66,y:39,w:28,h:8, type:'button', label:{es:'Marcar serie', en:'Mark set'}, desc:{es:'Guarda y arranca el descanso.', en:'Saves and starts rest.'} },
        { x:6,y:50,w:88,h:7, type:'badge', label:{es:'¡Nuevo PR!', en:'New PR!'}, desc:{es:'Aparece al batir un récord.', en:'Appears when a record breaks.'} },
        { x:6,y:83,w:88,h:8, type:'button', label:{es:'Terminar', en:'Finish'}, desc:{es:'Cierra y muestra el resumen.', en:'Closes and shows the summary.'} },
      ]
    },
    {
      id: 'resumen', order: 9, aspect: 'phone',
      title: { es: 'Resumen de Sesión', en: 'Session Summary' },
      what: { es: 'Pantalla de cierre: duración, volumen total, series, PRs, XP ganado y sincronización con Apple Health / Google Fit.', en: 'The close screen: duration, total volume, sets, PRs, XP earned, and sync to Apple Health / Google Fit.' },
      usage: { es: 'El momento de dopamina después de entrenar. Aquí el miembro comparte su entreno — es marketing orgánico para tu gimnasio.', en: "The post-workout dopamine hit. This is where members share their workout — organic marketing for your gym." },
      calculates: { es: 'Volumen total = Σ (series × reps × peso) de la sesión. El XP se otorga por volumen, dificultad y metas, y alimenta el nivel del miembro.', en: 'Total volume = Σ (sets × reps × weight) for the session. XP is awarded from volume, difficulty, and goals, and feeds the member’s level.' },
      elements: [
        { x:15,y:6,w:70,h:12, type:'header', label:{es:'¡Completado!', en:'Complete!'}, desc:{es:'Confeti si hubo PR.', en:'Confetti if there was a PR.'} },
        { x:6,y:22,w:42,h:14, type:'card', label:{es:'Volumen total', en:'Total volume'}, desc:{es:'En libras.', en:'In pounds.'} },
        { x:52,y:22,w:42,h:14, type:'card', label:{es:'Duración', en:'Duration'}, desc:{es:'Y series completadas.', en:'And sets completed.'} },
        { x:6,y:40,w:88,h:12, type:'chip-row', label:{es:'XP y nivel', en:'XP & level'}, desc:{es:'Barra de progreso al siguiente nivel.', en:'Progress bar to next level.'} },
        { x:6,y:56,w:88,h:12, type:'list', label:{es:'PRs de hoy', en:'Today’s PRs'}, desc:{es:'Con trofeo por cada uno.', en:'A trophy for each.'} },
        { x:6,y:82,w:88,h:9, type:'button', label:{es:'Compartir', en:'Share'}, desc:{es:'Genera una imagen con tu marca.', en:'Generates a branded image.'} },
      ]
    },
    {
      id: 'cardio', order: 10, aspect: 'phone',
      title: { es: 'Cardio en Vivo', en: 'Live Cardio' },
      what: { es: 'Cronómetro por fases (calentamiento → tracking → enfriamiento) para correr, bici o remo, con ritmo cardíaco y calorías.', en: 'A phased stopwatch (warmup → tracking → cooldown) for running, cycling, or rowing, with heart rate and calories.' },
      usage: { es: 'Da a los miembros de cardio la misma sensación de progreso que los de pesas — cuenta para su racha y su actividad.', en: 'Gives cardio members the same sense of progress as lifters — it counts toward their streak and activity.' },
      elements: [
        { x:6,y:5,w:88,h:8, type:'chip-row', label:{es:'Fase', en:'Phase'}, desc:{es:'Calentamiento / tracking / enfriamiento.', en:'Warmup / tracking / cooldown.'} },
        { x:15,y:17,w:70,h:22, type:'header', label:{es:'Tiempo', en:'Elapsed'}, desc:{es:'Cronómetro grande.', en:'Big stopwatch.'} },
        { x:6,y:44,w:42,h:12, type:'card', label:{es:'Ritmo cardíaco', en:'Heart rate'}, desc:{es:'Manual o desde el reloj.', en:'Manual or from the watch.'} },
        { x:52,y:44,w:42,h:12, type:'card', label:{es:'Calorías', en:'Calories'}, desc:{es:'Estimadas en tiempo real.', en:'Estimated in real time.'} },
        { x:6,y:60,w:88,h:8, type:'button', label:{es:'Pausar', en:'Pause'}, desc:{es:'Detiene sin perder el registro.', en:'Stops without losing the log.'} },
        { x:6,y:82,w:88,h:9, type:'button', label:{es:'Guardar sesión', en:'Save session'}, desc:{es:'Crea el registro y sincroniza salud.', en:'Creates the log and syncs health.'} },
      ]
    },
    {
      id: 'ejercicios', order: 11, aspect: 'phone',
      title: { es: 'Biblioteca de Ejercicios', en: 'Exercise Library' },
      what: { es: '144 ejercicios con video, diagrama de músculos y filtros. El miembro puede crear los suyos y usar los de sus amigos.', en: '144 exercises with video, muscle diagram, and filters. Members can create their own and use their friends’.' },
      usage: { es: 'Es la base de datos que respalda todo. Si falta un ejercicio de tu gimnasio, un miembro puede añadirlo con video.', en: "It's the database behind everything. If your gym has an exercise that's missing, a member can add it with video." },
      elements: [
        { x:6,y:4,w:88,h:8, type:'input', label:{es:'Buscador', en:'Search'}, desc:{es:'Filtra por nombre.', en:'Filters by name.'} },
        { x:6,y:14,w:88,h:8, type:'chip-row', label:{es:'Filtros', en:'Filters'}, desc:{es:'Por músculo o equipo.', en:'By muscle or equipment.'} },
        { x:6,y:25,w:42,h:22, type:'card', label:{es:'Tarjeta de ejercicio', en:'Exercise card'}, desc:{es:'Miniatura, nombre y músculo.', en:'Thumbnail, name, and muscle.'} },
        { x:52,y:25,w:42,h:22, type:'card', label:{es:'Video demo', en:'Video demo'}, desc:{es:'Se reproduce al abrir.', en:'Plays when opened.'} },
        { x:6,y:88,w:88,h:8, type:'button', label:{es:'Crear ejercicio', en:'Create exercise'}, desc:{es:'Añade uno personalizado.', en:'Adds a custom one.'} },
      ]
    },
    {
      id: 'constructor', order: 12, aspect: 'phone',
      title: { es: 'Constructor de Rutina', en: 'Routine Builder' },
      what: { es: 'Arma o edita rutinas: añade ejercicios, ajusta series/reps/descanso, reordena arrastrando y agrupa superseries.', en: 'Build or edit routines: add exercises, set sets/reps/rest, drag to reorder, and group supersets.' },
      usage: { es: 'Para miembros que ya saben lo que quieren. Los que no, mejor usa “Para ti” o un programa del gimnasio.', en: 'For members who know what they want. For those who don’t, point them to “For You” or a gym program.' },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Nombre de la rutina', en:'Routine name'}, desc:{es:'Editable.', en:'Editable.'} },
        { x:6,y:13,w:88,h:8, type:'button', label:{es:'Agregar ejercicio', en:'Add exercise'}, desc:{es:'Abre la biblioteca.', en:'Opens the library.'} },
        { x:6,y:23,w:88,h:14, type:'card', label:{es:'Tarjeta de ejercicio', en:'Exercise card'}, desc:{es:'Arrastra para reordenar.', en:'Drag to reorder.'} },
        { x:10,y:29,w:24,h:6, type:'input', label:{es:'Series/Reps', en:'Sets/Reps'}, desc:{es:'Toca para escribir.', en:'Tap to type.'} },
        { x:6,y:82,w:88,h:9, type:'button', label:{es:'Guardar', en:'Save'}, desc:{es:'Guarda con duración estimada.', en:'Saves with estimated duration.'} },
      ]
    },
    {
      id: 'progreso', order: 13, aspect: 'phone',
      title: { es: 'Progreso', en: 'Progress' },
      what: { es: 'El resumen de por vida: total de entrenamientos, racha, volumen, PRs y nivel, con un gráfico de volumen de 8 semanas.', en: 'The lifetime overview: total workouts, streak, volume, PRs, and level, with an 8-week volume chart.' },
      usage: { es: 'Es la prueba visible de que la app funciona. Un miembro que ve su gráfico subir es un miembro que renueva.', en: "It's visible proof the app works. A member who watches their chart climb is a member who renews." },
      elements: [
        { x:6,y:4,w:88,h:8, type:'chip-row', label:{es:'Pestañas', en:'Tabs'}, desc:{es:'Resumen · Cuerpo · Récords · Nutrición.', en:'Overview · Body · Records · Nutrition.'} },
        { x:6,y:15,w:42,h:14, type:'card', label:{es:'Total y racha', en:'Total & streak'}, desc:{es:'Cifras de por vida.', en:'Lifetime figures.'} },
        { x:52,y:15,w:42,h:14, type:'card', label:{es:'Volumen y PRs', en:'Volume & PRs'}, desc:{es:'Acumulados.', en:'Cumulative.'} },
        { x:6,y:32,w:88,h:26, type:'card', label:{es:'Gráfico de volumen', en:'Volume chart'}, desc:{es:'8 semanas.', en:'8 weeks.'} },
        { x:6,y:61,w:88,h:24, type:'list', label:{es:'Metas', en:'Goals'}, desc:{es:'Con barra de avance.', en:'With progress bars.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Navegación principal.', en:'Primary navigation.'} },
      ]
    },
    {
      id: 'cuerpo', order: 14, aspect: 'phone',
      title: { es: 'Medidas Corporales', en: 'Body Metrics' },
      what: { es: 'Peso con selector 30/90/180/365 días, medidas (pecho, cintura, brazos…) y fotos de progreso, con estimación de grasa por IA.', en: 'Weight with a 30/90/180/365-day selector, measurements (chest, waist, arms…), and progress photos, with AI body-fat estimate.' },
      usage: { es: 'Anima a los miembros a tomar fotos mensuales — el cambio visible es lo que más los engancha a largo plazo.', en: 'Encourage members to take monthly photos — visible change is what hooks them long term.' },
      calculates: { es: 'El % de grasa por foto usa IA con visión. Requiere el consentimiento de “análisis corporal” del miembro; si lo rechaza, sigue en modo manual.', en: 'Photo body-fat uses AI vision. It requires the member’s “body analysis” consent; if declined, they stay in manual mode.' },
      elements: [
        { x:6,y:4,w:88,h:8, type:'chip-row', label:{es:'Periodo', en:'Period'}, desc:{es:'30 / 90 / 180 / 365 días.', en:'30 / 90 / 180 / 365 days.'} },
        { x:6,y:15,w:88,h:24, type:'card', label:{es:'Gráfico de peso', en:'Weight chart'}, desc:{es:'Con línea de tendencia.', en:'With a trend line.'} },
        { x:6,y:42,w:88,h:14, type:'list', label:{es:'Medidas', en:'Measurements'}, desc:{es:'Pecho, cintura, brazos, etc.', en:'Chest, waist, arms, etc.'} },
        { x:6,y:59,w:88,h:20, type:'card', label:{es:'Fotos de progreso', en:'Progress photos'}, desc:{es:'Con análisis de grasa por IA.', en:'With AI body-fat analysis.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Navegación principal.', en:'Primary navigation.'} },
      ]
    },
    {
      id: 'records', order: 15, aspect: 'phone',
      title: { es: 'Récords Personales', en: 'Personal Records' },
      what: { es: '1RM de cinco levantamientos clave con gráfico de progresión y niveles de fuerza (Principiante → Élite) normalizados por peso.', en: '1RM for five key lifts with a progression chart and strength tiers (Beginner → Elite) normalized by bodyweight.' },
      usage: { es: 'La pantalla de presumir. Los niveles de fuerza dan a los miembros una meta clara: “lbs para el siguiente nivel”.', en: 'The bragging screen. Strength tiers give members a clear target: “lbs to the next tier.”' },
      calculates: { es: 'El 1RM se estima de las series registradas (Epley/Brzycki). El nivel de fuerza compara ese 1RM contra el peso corporal del miembro.', en: '1RM is estimated from logged sets (Epley/Brzycki). The strength tier compares that 1RM against the member’s bodyweight.' },
      elements: [
        { x:6,y:4,w:88,h:8, type:'chip-row', label:{es:'Filtro de ejercicio', en:'Exercise filter'}, desc:{es:'Por músculo o equipo.', en:'By muscle or equipment.'} },
        { x:6,y:15,w:88,h:14, type:'card', label:{es:'Nivel de fuerza', en:'Strength tier'}, desc:{es:'Y lbs al siguiente nivel.', en:'And lbs to next tier.'} },
        { x:6,y:32,w:88,h:26, type:'card', label:{es:'Gráfico de 1RM', en:'1RM chart'}, desc:{es:'Progresión en el tiempo.', en:'Progression over time.'} },
        { x:6,y:61,w:88,h:24, type:'list', label:{es:'Historial de PRs', en:'PR history'}, desc:{es:'Mejor marca por día.', en:'Best mark per day.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Navegación principal.', en:'Primary navigation.'} },
      ]
    },
    {
      id: 'nutricion', order: 16, aspect: 'phone',
      title: { es: 'Nutrición', en: 'Nutrition' },
      what: { es: 'Anillos de macros, registro de comidas, escaneo por foto y código de barras, 300+ recetas y generador de plan.', en: 'Macro rings, food logging, photo and barcode scanning, 300+ recipes, and a meal-plan generator.' },
      usage: { es: 'Mantiene a los miembros comprometidos fuera del gimnasio — el 80% del resultado está en la comida y ellos lo sienten.', en: 'Keeps members engaged outside the gym — 80% of results are in the food, and they feel it.' },
      calculates: { es: 'Las metas de macros se calculan del objetivo + medidas. El planificador balancea cal 30%, proteína 35%, carbos 20%, grasa 15%, con tolerancia ±10% cal.', en: 'Macro targets are computed from goal + body metrics. The planner balances cal 30%, protein 35%, carbs 20%, fat 15%, with ±10% cal tolerance.' },
      elements: [
        { x:6,y:5,w:88,h:20, type:'card', label:{es:'Anillos de macros', en:'Macro rings'}, desc:{es:'Calorías, proteína, carbos, grasa.', en:'Calories, protein, carbs, fat.'} },
        { x:6,y:28,w:88,h:8, type:'chip-row', label:{es:'Vistas', en:'Views'}, desc:{es:'Hoy · Descubrir · Guardadas · Compras.', en:'Today · Discover · Saved · Grocery.'} },
        { x:6,y:39,w:88,h:8, type:'button', label:{es:'Escanear comida', en:'Scan food'}, desc:{es:'Foto con IA o código de barras.', en:'AI photo or barcode.'} },
        { x:6,y:50,w:88,h:35, type:'list', label:{es:'Registro del día', en:'Today’s log'}, desc:{es:'Comidas con sus macros.', en:'Meals with their macros.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Navegación principal.', en:'Primary navigation.'} },
      ]
    },
    {
      id: 'plan-comidas', order: 17, aspect: 'phone',
      title: { es: 'Mi Plan de Comidas', en: 'My Meal Plan' },
      what: { es: 'Un plan de día o semana generado desde 300+ recetas, respetando alergias y preferencias del miembro.', en: 'A day or week plan generated from 300+ recipes, respecting the member’s allergies and preferences.' },
      usage: { es: 'Quita la fricción del “¿qué como?”. Un plan puesto es un miembro que no abandona su dieta a la semana.', en: 'Removes the “what do I eat?” friction. A plan in place is a member who doesn’t quit their diet in a week.' },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Semana', en:'Week'}, desc:{es:'Con fechas.', en:'With dates.'} },
        { x:6,y:14,w:88,h:8, type:'chip-row', label:{es:'Días', en:'Days'}, desc:{es:'Toca un día para ver sus comidas.', en:'Tap a day to see its meals.'} },
        { x:6,y:25,w:88,h:14, type:'card', label:{es:'Comida', en:'Meal'}, desc:{es:'Toca para receta y macros.', en:'Tap for recipe and macros.'} },
        { x:74,y:27,w:18,h:6, type:'button', label:{es:'Quitar', en:'Remove'}, desc:{es:'Regenera solo esa comida.', en:'Regenerates just that meal.'} },
        { x:6,y:82,w:88,h:9, type:'button', label:{es:'Generar semana', en:'Generate week'}, desc:{es:'7 días sin repetir en 3.', en:'7 days, no repeats within 3.'} },
      ]
    },
    {
      id: 'compras', order: 18, aspect: 'phone',
      title: { es: 'Lista de Compras', en: 'Grocery List' },
      what: { es: 'Una lista generada automáticamente desde las recetas del plan, agrupada por comida y con cantidades.', en: 'A checklist auto-generated from the plan’s recipes, grouped by meal and with quantities.' },
      usage: { es: 'Convierte el plan en acción real en el supermercado — el puente entre “quiero comer bien” y hacerlo.', en: 'Turns the plan into real action at the store — the bridge between “I want to eat well” and doing it.' },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Título y # de artículos.', en:'Title and item count.'} },
        { x:6,y:14,w:88,h:8, type:'chip-row', label:{es:'Grupos', en:'Groups'}, desc:{es:'Por comida o categoría.', en:'By meal or category.'} },
        { x:6,y:25,w:88,h:60, type:'list', label:{es:'Artículos', en:'Items'}, desc:{es:'Con casilla para marcar.', en:'With a check-off box.'} },
      ]
    },
    {
      id: 'metas', order: 19, aspect: 'phone',
      title: { es: 'Metas', en: 'Goals' },
      what: { es: 'Metas de 1RM, peso corporal, % grasa, cantidad de entrenos, racha o volumen, con validación de fecha realista.', en: 'Goals for 1RM, bodyweight, body-fat %, workout count, streak, or volume, with realistic-date validation.' },
      usage: { es: 'Una meta activa cambia lo que la app le sugiere al miembro — prioriza los ejercicios ligados a esa meta.', en: 'An active goal changes what the app suggests — it prioritizes exercises tied to that goal.' },
      calculates: { es: 'La fecha objetivo se valida contra tasas de progreso científicas (principiante/intermedio/avanzado), para que la meta sea alcanzable, no fantasía.', en: 'The target date is validated against scientific progression rates (beginner/intermediate/advanced), so the goal is reachable, not fantasy.' },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Título y crear meta.', en:'Title and create goal.'} },
        { x:6,y:14,w:42,h:16, type:'card', label:{es:'Meta activa', en:'Active goal'}, desc:{es:'Con barra de avance.', en:'With a progress bar.'} },
        { x:52,y:14,w:42,h:16, type:'card', label:{es:'Meta activa', en:'Active goal'}, desc:{es:'Toca para editar.', en:'Tap to edit.'} },
        { x:6,y:82,w:88,h:9, type:'button', label:{es:'Nueva meta', en:'New goal'}, desc:{es:'Elige tipo y fecha.', en:'Pick type and date.'} },
      ]
    },
    {
      id: 'feed', order: 20, aspect: 'phone',
      title: { es: 'Feed Social', en: 'Social Feed' },
      what: { es: 'Actividad de amigos: entrenos, PRs, logros y check-ins, con likes, comentarios y publicaciones con foto.', en: 'Friends’ activity: workouts, PRs, achievements, and check-ins, with likes, comments, and photo posts.' },
      usage: { es: 'La prueba social que mantiene viva la comunidad de tu gimnasio dentro de la app — motivación entre pares, gratis.', en: 'The social proof that keeps your gym’s community alive inside the app — peer motivation, for free.' },
      elements: [
        { x:6,y:4,w:88,h:8, type:'chip-row', label:{es:'Pestañas', en:'Tabs'}, desc:{es:'Feed · Retos · Clasificación.', en:'Feed · Challenges · Leaderboard.'} },
        { x:6,y:15,w:88,h:8, type:'chip-row', label:{es:'Entrenando ahora', en:'Training now'}, desc:{es:'Avatares de quien entrena.', en:'Avatars of who’s training.'} },
        { x:6,y:26,w:88,h:30, type:'card', label:{es:'Publicación', en:'Post'}, desc:{es:'Actividad, foto, like y comentar.', en:'Activity, photo, like, and comment.'} },
        { x:6,y:59,w:88,h:26, type:'card', label:{es:'Publicación', en:'Post'}, desc:{es:'Toca el avatar para ver perfil.', en:'Tap the avatar for a profile.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Navegación principal.', en:'Primary navigation.'} },
      ]
    },
    {
      id: 'retos', order: 21, aspect: 'phone',
      title: { es: 'Retos', en: 'Challenges' },
      what: { es: 'Retos de consistencia, volumen, PRs o en equipo, con leaderboard en vivo, cuenta regresiva y premios por nivel.', en: 'Challenges of consistency, volume, PRs, or team, with a live leaderboard, countdown, and tiered rewards.' },
      usage: { es: 'Tu palanca de compromiso más fuerte. Lanza uno desde Admin cada mes — participar dispara asistencia y PRs.', en: 'Your strongest engagement lever. Launch one from Admin each month — joining spikes attendance and PRs.' },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Retos activos.', en:'Active challenges.'} },
        { x:6,y:14,w:88,h:22, type:'card', label:{es:'Reto en vivo', en:'Live challenge'}, desc:{es:'Cuenta regresiva y premio.', en:'Countdown and reward.'} },
        { x:6,y:39,w:88,h:30, type:'list', label:{es:'Leaderboard', en:'Leaderboard'}, desc:{es:'Se actualiza en tiempo real.', en:'Updates in real time.'} },
        { x:6,y:72,w:88,h:8, type:'button', label:{es:'Unirse', en:'Join'}, desc:{es:'Entra al reto.', en:'Enters the challenge.'} },
      ]
    },
    {
      id: 'clasificacion', order: 22, aspect: 'phone',
      title: { es: 'Clasificación', en: 'Leaderboard' },
      what: { es: 'Siete categorías (volumen, entrenos, más mejorado, consistencia, racha, PRs, check-ins) con tu posición destacada.', en: 'Seven categories (volume, workouts, most improved, consistency, streak, PRs, check-ins) with your position highlighted.' },
      usage: { es: 'La competencia amistosa retiene. La misma data alimenta la Pantalla TV del gimnasio para reconocer a los que destacan.', en: 'Friendly competition retains. The same data feeds the gym TV Display to recognize top performers.' },
      calculates: { es: '“Más mejorado” compara el 1RM actual contra el de hace un periodo. “Consistencia” = % de días planeados que el miembro asistió.', en: '“Most improved” compares current 1RM against a period ago. “Consistency” = % of planned days the member attended.' },
      elements: [
        { x:6,y:4,w:88,h:8, type:'chip-row', label:{es:'Categoría', en:'Category'}, desc:{es:'7 métricas.', en:'7 metrics.'} },
        { x:6,y:15,w:88,h:14, type:'card', label:{es:'Tu posición', en:'Your position'}, desc:{es:'Rango y percentil.', en:'Rank and percentile.'} },
        { x:6,y:32,w:88,h:8, type:'chip-row', label:{es:'Periodo', en:'Period'}, desc:{es:'Semanal / mensual / histórico.', en:'Weekly / monthly / all-time.'} },
        { x:6,y:43,w:88,h:42, type:'list', label:{es:'Ranking', en:'Ranking'}, desc:{es:'Nombre y valor.', en:'Name and value.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Navegación principal.', en:'Primary navigation.'} },
      ]
    },
    {
      id: 'clases', order: 23, aspect: 'phone',
      title: { es: 'Clases', en: 'Classes' },
      what: { es: 'Horario con tarjetas de clase, barra de capacidad, lista de espera con auto-promoción, reserva recurrente y calificación.', en: 'Schedule with class cards, capacity bar, waitlist with auto-promotion, recurring booking, and rating.' },
      usage: { es: 'Si tu gimnasio da clases, actívalas en Admin. La reserva recurrente asegura que los asiduos siempre tengan su cupo.', en: 'If your gym runs classes, enable them in Admin. Recurring booking guarantees regulars always keep their spot.' },
      elements: [
        { x:6,y:4,w:88,h:8, type:'chip-row', label:{es:'Días', en:'Days'}, desc:{es:'Tira de días de la semana.', en:'Week-day strip.'} },
        { x:6,y:15,w:88,h:22, type:'card', label:{es:'Tarjeta de clase', en:'Class card'}, desc:{es:'Imagen, hora y capacidad.', en:'Image, time, and capacity.'} },
        { x:6,y:31,w:88,h:5, type:'chip-row', label:{es:'Barra de capacidad', en:'Capacity bar'}, desc:{es:'Reservados / total.', en:'Booked / total.'} },
        { x:6,y:40,w:88,h:22, type:'card', label:{es:'Otra clase', en:'Another class'}, desc:{es:'Lista de espera si está llena.', en:'Waitlist if full.'} },
        { x:6,y:65,w:88,h:8, type:'button', label:{es:'Reservar', en:'Book'}, desc:{es:'Con opción de repetir semanal.', en:'With repeat-weekly option.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Navegación principal.', en:'Primary navigation.'} },
      ]
    },
    {
      id: 'recompensas', order: 24, aspect: 'phone',
      title: { es: 'Recompensas', en: 'Rewards' },
      what: { es: 'El miembro acumula puntos y sube de nivel (Bronce → Diamante) para canjear premios con un QR que tu staff escanea.', en: 'Members earn points and climb tiers (Bronze → Diamond) to redeem rewards via a QR your staff scans.' },
      usage: { es: 'Tu programa de lealtad, sin tarjetas de cartón. Define el catálogo en Admin — un mes gratis por 30k puntos, por ejemplo.', en: 'Your loyalty program, without punch cards. Set the catalog in Admin — a free month for 30k points, say.' },
      calculates: { es: 'Puntos: entreno 50 · PR 100 · check-in 20 · día de racha 10×largo (tope 200) · reto 500 · logro 75. Niveles: Bronce 0–999 hasta Diamante 50k+.', en: 'Points: workout 50 · PR 100 · check-in 20 · streak day 10×length (cap 200) · challenge 500 · achievement 75. Tiers: Bronze 0–999 up to Diamond 50k+.' },
      elements: [
        { x:6,y:4,w:88,h:14, type:'header', label:{es:'Puntos y nivel', en:'Points & tier'}, desc:{es:'Contador animado.', en:'Animated counter.'} },
        { x:6,y:21,w:88,h:8, type:'chip-row', label:{es:'Tarjeta de sellos', en:'Punch card'}, desc:{es:'Cada N check-ins.', en:'Every N check-ins.'} },
        { x:6,y:32,w:88,h:40, type:'list', label:{es:'Catálogo', en:'Catalog'}, desc:{es:'Premios con su costo en puntos.', en:'Rewards with their points cost.'} },
        { x:6,y:75,w:88,h:8, type:'button', label:{es:'Canjear', en:'Redeem'}, desc:{es:'Genera el QR de canje.', en:'Generates the redemption QR.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Navegación principal.', en:'Primary navigation.'} },
      ]
    },
    {
      id: 'referidos', order: 25, aspect: 'phone',
      title: { es: 'Referidos', en: 'Referrals' },
      what: { es: 'Código único por miembro para compartir por texto, redes o QR, con historial de estado (pendiente/completado/expirado).', en: 'A unique code per member to share by text, social, or QR, with status history (pending/completed/expired).' },
      usage: { es: 'Tu canal de crecimiento más barato. Configura en Admin la recompensa para quien refiere y para el referido.', en: 'Your cheapest growth channel. Set the reward for referrer and referred in Admin.' },
      calculates: { es: 'La tasa de conversión = referidos completados ÷ invitados. El referido cuenta como “completado” cuando su cuenta queda activa.', en: 'Conversion rate = completed referrals ÷ invited. A referral counts as “completed” when the account becomes active.' },
      elements: [
        { x:6,y:5,w:88,h:16, type:'card', label:{es:'Tu código', en:'Your code'}, desc:{es:'Con botón de copiar.', en:'With a copy button.'} },
        { x:6,y:25,w:42,h:8, type:'button', label:{es:'Compartir', en:'Share'}, desc:{es:'Texto, redes o enlace.', en:'Text, social, or link.'} },
        { x:52,y:25,w:42,h:8, type:'button', label:{es:'Mostrar QR', en:'Show QR'}, desc:{es:'Para escanear en persona.', en:'To scan in person.'} },
        { x:6,y:38,w:88,h:47, type:'list', label:{es:'Historial', en:'History'}, desc:{es:'Nombre del referido y estado.', en:'Referred name and status.'} },
      ]
    },
    {
      id: 'logros', order: 26, aspect: 'phone',
      title: { es: 'Logros', en: 'Achievements' },
      what: { es: 'Treinta y tantas insignias que se desbloquean solas: entrenos, rachas, PRs, volumen y comunidad.', en: 'Thirty-plus badges that unlock on their own: workouts, streaks, PRs, volume, and community.' },
      usage: { es: 'Micro-metas que no tienes que gestionar. Cada desbloqueo es un empujoncito de dopamina que trae al miembro de vuelta.', en: "Micro-goals you don't have to manage. Each unlock is a small dopamine nudge that brings the member back." },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Logros obtenidos / total.', en:'Earned / total.'} },
        { x:6,y:14,w:88,h:8, type:'chip-row', label:{es:'Categorías', en:'Categories'}, desc:{es:'Entrenos, rachas, PRs…', en:'Workouts, streaks, PRs…'} },
        { x:6,y:25,w:26,h:16, type:'badge', label:{es:'Insignia', en:'Badge'}, desc:{es:'Obtenida.', en:'Earned.'} },
        { x:37,y:25,w:26,h:16, type:'badge', label:{es:'Insignia', en:'Badge'}, desc:{es:'En progreso, con barra.', en:'In progress, with a bar.'} },
        { x:68,y:25,w:26,h:16, type:'badge', label:{es:'Bloqueada', en:'Locked'}, desc:{es:'Aún no desbloqueada.', en:'Not yet unlocked.'} },
      ]
    },
    {
      id: 'mensajes', order: 27, aspect: 'phone',
      title: { es: 'Mensajes', en: 'Messages' },
      what: { es: 'Chat estilo iMessage entre amigos (y con staff/entrenadores), cifrado en reposo, con recibos de lectura.', en: 'iMessage-style chat between friends (and with staff/trainers), encrypted at rest, with read receipts.' },
      usage: { es: 'Tu canal directo con el miembro dentro de la app. Útil para seguimiento personal sin depender de WhatsApp.', en: 'Your direct line to the member inside the app. Useful for personal follow-up without relying on WhatsApp.' },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Título y no leídos.', en:'Title and unread count.'} },
        { x:6,y:14,w:88,h:70, type:'list', label:{es:'Conversaciones', en:'Conversations'}, desc:{es:'Foto, último mensaje y hora.', en:'Photo, last message, and time.'} },
        { x:78,y:16,w:14,h:6, type:'badge', label:{es:'No leído', en:'Unread'}, desc:{es:'Punto o número.', en:'Dot or count.'} },
      ]
    },
    {
      id: 'notificaciones', order: 28, aspect: 'phone',
      title: { es: 'Notificaciones', en: 'Notifications' },
      what: { es: 'Centro con 11 tipos codificados por color: anuncios, PRs, logros, retos, amigos, reservas, recompensas y metas.', en: 'A center with 11 color-coded types: announcements, PRs, achievements, challenges, friends, bookings, rewards, and goals.' },
      usage: { es: 'El miembro controla qué recibe. Respeta las horas de silencio (10pm–7am), así que tus anuncios no molestan de noche.', en: 'The member controls what they get. It respects quiet hours (10pm–7am), so your announcements don’t bother them at night.' },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Marcar leído / limpiar.', en:'Mark read / clear.'} },
        { x:6,y:14,w:88,h:14, type:'card', label:{es:'Anuncio', en:'Announcement'}, desc:{es:'Con cuenta de expiración.', en:'With an expiry countdown.'} },
        { x:6,y:31,w:88,h:14, type:'card', label:{es:'PR o logro', en:'PR or achievement'}, desc:{es:'Codificado por color.', en:'Color-coded.'} },
        { x:6,y:48,w:88,h:37, type:'list', label:{es:'Más notificaciones', en:'More notifications'}, desc:{es:'Cargar más de 5 en 5.', en:'Load more, 5 at a time.'} },
      ]
    },
    {
      id: 'perfil', order: 29, aspect: 'phone',
      title: { es: 'Perfil', en: 'Profile' },
      what: { es: 'Estadísticas de por vida, logros, metas, avatar personalizable y el código de amigo del miembro.', en: 'Lifetime stats, achievements, goals, a customizable avatar, and the member’s friend code.' },
      usage: { es: 'La identidad del miembro dentro de tu gimnasio. Un perfil con racha alta y logros es un miembro enganchado.', en: "The member's identity inside your gym. A profile with a high streak and badges is an engaged member." },
      elements: [
        { x:6,y:4,w:88,h:16, type:'header', label:{es:'Avatar y stats', en:'Avatar & stats'}, desc:{es:'Nivel, racha, volumen.', en:'Level, streak, volume.'} },
        { x:6,y:23,w:88,h:20, type:'card', label:{es:'Volumen semanal', en:'Weekly volume'}, desc:{es:'Gráfico de 8 semanas.', en:'8-week chart.'} },
        { x:6,y:46,w:88,h:18, type:'list', label:{es:'Logros', en:'Achievements'}, desc:{es:'Obtenidos y en progreso.', en:'Earned and in progress.'} },
        { x:6,y:82,w:88,h:8, type:'button', label:{es:'Ajustes', en:'Settings'}, desc:{es:'Abre configuración.', en:'Opens settings.'} },
      ]
    },
    {
      id: 'ajustes', order: 30, aspect: 'phone',
      title: { es: 'Ajustes', en: 'Settings' },
      what: { es: 'Identidad, nivel y meta, equipo, lesiones, idioma, modo oscuro, permisos, privacidad, salud, exportar datos y borrar cuenta.', en: 'Identity, level and goal, equipment, injuries, language, dark mode, permissions, privacy, health, data export, and account deletion.' },
      usage: { es: 'Aquí viven los ajustes de privacidad y el consentimiento de IA — importa para cumplir con las tiendas y la ley.', en: 'Privacy settings and AI consent live here — it matters for app-store and legal compliance.' },
      elements: [
        { x:6,y:5,w:88,h:14, type:'list', label:{es:'Identidad y meta', en:'Identity & goal'}, desc:{es:'Nombre, nivel, objetivo.', en:'Name, level, goal.'} },
        { x:6,y:22,w:88,h:8, type:'toggle', label:{es:'Idioma / modo oscuro', en:'Language / dark mode'}, desc:{es:'Recarga en vivo.', en:'Live reload.'} },
        { x:6,y:33,w:88,h:14, type:'list', label:{es:'Permisos', en:'Permissions'}, desc:{es:'Notificaciones, cámara, salud.', en:'Notifications, camera, health.'} },
        { x:6,y:50,w:88,h:14, type:'list', label:{es:'Privacidad', en:'Privacy'}, desc:{es:'Bloqueados y consentimiento de IA.', en:'Blocked users and AI consent.'} },
        { x:6,y:67,w:88,h:8, type:'button', label:{es:'Exportar datos', en:'Export data'}, desc:{es:'CSV de entrenos, PRs, cuerpo.', en:'CSV of workouts, PRs, body.'} },
        { x:6,y:78,w:88,h:8, type:'button', label:{es:'Borrar cuenta', en:'Delete account'}, desc:{es:'Con confirmación escrita.', en:'With typed confirmation.'} },
      ]
    },
  ],

  trainer: [
    {
      id: 'inicio', order: 1, aspect: 'phone',
      title: { es: 'Inicio', en: 'Home' },
      what: {
        es: 'Panel de llegada del entrenador: próxima sesión, resumen de la semana y accesos rápidos a clientes.',
        en: "The trainer's landing dashboard: next session, week-at-a-glance, and quick access to clients."
      },
      usage: {
        es: 'Revisa esta pantalla al llegar al gimnasio: confirma tu próxima sesión y detecta clientes que necesitan seguimiento hoy.',
        en: 'Check this screen when you arrive: confirm your next session and spot clients who need follow-up today.'
      },
      calculates: {
        es: 'Adherencia semanal = sesiones completadas ÷ sesiones agendadas, promediada entre todos tus clientes activos.',
        en: 'Weekly adherence = completed sessions ÷ scheduled sessions, averaged across all your active clients.'
      },
      elements: [
        { x:6,y:4,w:88,h:7,  type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Tu nombre y la fecha.', en:'Your name and the date.'} },
        { x:6,y:14,w:88,h:16, type:'card', label:{es:'Próxima sesión', en:'Next session'}, desc:{es:'Cliente, hora y lugar.', en:'Client, time, and location.'} },
        { x:6,y:33,w:40,h:8, type:'button', label:{es:'Iniciar sesión', en:'Start session'}, desc:{es:'Abre el registro en vivo.', en:'Opens live tracking.'} },
        { x:50,y:33,w:44,h:8, type:'button', label:{es:'Ver agenda', en:'View schedule'}, desc:{es:'Salta al calendario del día.', en:"Jumps to today's calendar."} },
        { x:6,y:45,w:88,h:10, type:'chip-row', label:{es:'KPIs de la semana', en:'Weekly KPIs'}, desc:{es:'Adherencia, sesiones y cobros.', en:'Adherence, sessions, and payouts.'} },
        { x:6,y:59,w:88,h:24, type:'list', label:{es:'Clientes en riesgo', en:'Clients at risk'}, desc:{es:'Ordenados por urgencia.', en:'Sorted by urgency.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Inicio · Clientes · Mensajes · Perfil.', en:'Home · Clients · Messages · Profile.'} },
      ]
    },
    {
      id: 'clientes', order: 2, aspect: 'phone',
      title: { es: 'Mis Clientes', en: 'My Clients' },
      what: {
        es: 'Lista completa de tus clientes asignados, con estado de riesgo y última actividad.',
        en: 'Full roster of your assigned clients, with risk status and last activity.'
      },
      usage: {
        es: 'Revisa esta pantalla al inicio del turno para identificar clientes nuevos, en riesgo o que necesitan seguimiento.',
        en: 'Check this screen at the start of your shift to spot new clients, at-risk clients, and anyone who needs follow-up.'
      },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Título y total de clientes.', en:'Title and client count.'} },
        { x:6,y:13,w:88,h:8, type:'input', label:{es:'Buscador', en:'Search'}, desc:{es:'Filtra clientes por nombre.', en:'Filters clients by name.'} },
        { x:6,y:23,w:88,h:8, type:'chip-row', label:{es:'Filtros', en:'Filters'}, desc:{es:'Todos, en riesgo o nuevos.', en:'All, at risk, or new.'} },
        { x:6,y:34,w:88,h:56, type:'list', label:{es:'Filas de cliente', en:'Client rows'}, desc:{es:'Foto, nombre, racha y riesgo.', en:'Photo, name, streak, and risk.'} },
        { x:74,y:34,w:20,h:8, type:'badge', label:{es:'Insignia: En riesgo', en:'Badge: At risk'}, desc:{es:'Aparece tras 10+ días sin actividad.', en:'Appears after 10+ days inactive.'} },
        { x:0,y:92,w:100,h:8, type:'tabbar', label:{es:'Barra inferior', en:'Bottom bar'}, desc:{es:'Navegación principal.', en:'Primary navigation.'} },
      ]
    },
    {
      id: 'perfil-cliente', order: 3, aspect: 'phone',
      title: { es: 'Perfil del Cliente', en: 'Client Profile' },
      what: {
        es: 'Vista detallada de un cliente: métricas, historial de entrenos y notas.',
        en: "A single client's detail view: metrics, workout history, and notes."
      },
      usage: {
        es: 'Ábrelo antes de cada sesión para revisar el historial reciente y ajustar la rutina de hoy.',
        en: "Open it before each session to check recent history and adjust today's routine."
      },
      calculates: {
        es: 'Adherencia individual y racha actual se recalculan cada vez que el cliente completa o falta una sesión.',
        en: "Individual adherence and current streak recalculate every time the client completes or misses a session."
      },
      elements: [
        { x:6,y:4,w:88,h:14, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Foto, nombre y racha.', en:'Photo, name, and streak.'} },
        { x:6,y:20,w:88,h:10, type:'chip-row', label:{es:'Métricas', en:'Metrics'}, desc:{es:'Adherencia, sesiones, última visita.', en:'Adherence, sessions, last visit.'} },
        { x:6,y:32,w:42,h:8, type:'button', label:{es:'Asignar programa', en:'Assign program'}, desc:{es:'Abre el flujo de asignación.', en:'Opens the assignment flow.'} },
        { x:50,y:32,w:44,h:8, type:'button', label:{es:'Enviar mensaje', en:'Send message'}, desc:{es:'Abre el chat con el cliente.', en:'Opens chat with the client.'} },
        { x:6,y:43,w:88,h:8, type:'chip-row', label:{es:'Pestañas', en:'Tabs'}, desc:{es:'Historial, notas y preparación.', en:'History, notes, and readiness.'} },
        { x:6,y:53,w:88,h:35, type:'list', label:{es:'Historial de entrenos', en:'Workout history'}, desc:{es:'Sesiones pasadas, más reciente arriba.', en:'Past sessions, newest first.'} },
      ]
    },
    {
      id: 'constructor', order: 4, aspect: 'phone',
      title: { es: 'Constructor de Entrenos', en: 'Workout Builder' },
      what: {
        es: 'Arma una rutina arrastrando ejercicios, ajustando series, repeticiones y peso.',
        en: 'Assemble a routine by dragging in exercises and adjusting sets, reps, and weight.'
      },
      usage: {
        es: 'Arma la rutina aquí antes de la sesión, o ajústala en vivo si el cliente necesita un cambio.',
        en: "Build the routine here before the session, or adjust it live if the client needs a change."
      },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Nombre de la rutina, editable.', en:'Routine name, editable.'} },
        { x:6,y:13,w:88,h:8, type:'button', label:{es:'Agregar ejercicio', en:'Add exercise'}, desc:{es:'Abre la biblioteca.', en:'Opens the library.'} },
        { x:6,y:23,w:88,h:14, type:'card', label:{es:'Tarjeta de ejercicio', en:'Exercise card'}, desc:{es:'Mantén presionado para reordenar.', en:'Press and hold to reorder.'} },
        { x:10,y:29,w:20,h:6, type:'input', label:{es:'Series', en:'Sets'}, desc:{es:'Toca para escribir el número.', en:'Tap to type the number.'} },
        { x:34,y:29,w:20,h:6, type:'input', label:{es:'Repeticiones', en:'Reps'}, desc:{es:'Toca para escribir el número.', en:'Tap to type the number.'} },
        { x:58,y:29,w:20,h:6, type:'input', label:{es:'Peso', en:'Weight'}, desc:{es:'Toca para escribir el número.', en:'Tap to type the number.'} },
        { x:6,y:82,w:88,h:9, type:'button', label:{es:'Guardar y asignar', en:'Save & assign'}, desc:{es:'Guarda y ofrece asignarla.', en:'Saves it and offers to assign it.'} },
      ]
    },
    {
      id: 'biblioteca', order: 5, aspect: 'phone',
      title: { es: 'Biblioteca de Ejercicios', en: 'Exercise Library' },
      what: {
        es: 'Catálogo buscable de ejercicios con video, músculos trabajados y variantes.',
        en: 'A searchable catalog of exercises with video, muscles worked, and variants.'
      },
      usage: {
        es: 'Úsala para encontrar variantes rápido cuando un cliente no puede hacer el ejercicio planeado.',
        en: "Use it to find quick variants when a client can't do the planned exercise."
      },
      elements: [
        { x:6,y:4,w:88,h:8, type:'input', label:{es:'Buscador', en:'Search'}, desc:{es:'Filtra por nombre.', en:'Filters by name.'} },
        { x:6,y:14,w:88,h:8, type:'chip-row', label:{es:'Filtros', en:'Filters'}, desc:{es:'Por músculo o equipo.', en:'By muscle or equipment.'} },
        { x:6,y:25,w:42,h:22, type:'card', label:{es:'Tarjeta de ejercicio', en:'Exercise card'}, desc:{es:'Miniatura, nombre y músculo.', en:'Thumbnail, name, and muscle.'} },
        { x:50,y:25,w:42,h:22, type:'card', label:{es:'Tarjeta de ejercicio', en:'Exercise card'}, desc:{es:'Toca para ver video y detalle.', en:'Tap for video and detail.'} },
        { x:6,y:88,w:88,h:8, type:'button', label:{es:'Crear ejercicio', en:'Create exercise'}, desc:{es:'Agrega uno personalizado.', en:'Adds a custom one.'} },
      ]
    },
    {
      id: 'asignar', order: 6, aspect: 'phone',
      title: { es: 'Asignar Programa', en: 'Assign Program' },
      what: {
        es: 'Envía una rutina o programa de varias semanas a uno o varios clientes.',
        en: 'Sends a routine or multi-week program to one or more clients.'
      },
      usage: {
        es: 'Asigna aquí cuando quieras enviar el mismo programa a varios clientes a la vez.',
        en: 'Assign here when you want to send the same program to several clients at once.'
      },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Programa seleccionado.', en:'Selected program.'} },
        { x:6,y:14,w:88,h:30, type:'list', label:{es:'Lista de clientes', en:'Client list'}, desc:{es:'Selección múltiple.', en:'Multi-select.'} },
        { x:6,y:48,w:88,h:8, type:'input', label:{es:'Fecha de inicio', en:'Start date'}, desc:{es:'Cuándo empieza el programa.', en:'When the program begins.'} },
        { x:6,y:60,w:88,h:8, type:'toggle', label:{es:'Notificar al cliente', en:'Notify client'}, desc:{es:'Envía un push al asignar.', en:'Sends a push on assignment.'} },
        { x:6,y:82,w:88,h:9, type:'button', label:{es:'Asignar', en:'Assign'}, desc:{es:'Confirma y envía.', en:'Confirms and sends.'} },
      ]
    },
    {
      id: 'sesion-vivo', order: 7, aspect: 'phone',
      title: { es: 'Sesión en Vivo', en: 'Live Session' },
      what: {
        es: 'Registra series, repeticiones y peso en tiempo real mientras el cliente entrena.',
        en: 'Logs sets, reps, and weight in real time while the client trains.'
      },
      usage: {
        es: 'Regístralo todo en el momento — así el volumen y las alertas de PR quedan exactos.',
        en: "Log everything in the moment — that's what keeps volume and PR alerts accurate."
      },
      calculates: {
        es: 'Volumen total = Σ (series × repeticiones × peso) en la sesión. Se compara contra el mejor histórico del cliente en ese ejercicio.',
        en: "Total volume = Σ (sets × reps × weight) for the session. It's compared against the client's historical best for that exercise."
      },
      alert: {
        es: 'Alerta de Récord Personal (PR): se dispara cuando un set supera el peso o repeticiones máximas previas del cliente en ese ejercicio.',
        en: "Personal Record (PR) Alert: fires when a set beats the client's previous max weight or reps on that exercise."
      },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Cronómetro', en:'Timer'}, desc:{es:'Tiempo desde el inicio.', en:'Time since start.'} },
        { x:6,y:14,w:88,h:12, type:'card', label:{es:'Ejercicio actual', en:'Current exercise'}, desc:{es:'Nombre y serie en curso.', en:'Name and current set.'} },
        { x:6,y:29,w:28,h:8, type:'input', label:{es:'Repeticiones', en:'Reps'}, desc:{es:'Se registra al terminar la serie.', en:'Logged when the set ends.'} },
        { x:36,y:29,w:28,h:8, type:'input', label:{es:'Peso usado', en:'Weight used'}, desc:{es:'Se registra al terminar la serie.', en:'Logged when the set ends.'} },
        { x:66,y:29,w:28,h:8, type:'button', label:{es:'Marcar serie', en:'Mark set'}, desc:{es:'Guarda y arranca el descanso.', en:'Saves it and starts rest.'} },
        { x:6,y:41,w:88,h:6, type:'badge', label:{es:'¡Nuevo PR!', en:'New PR!'}, desc:{es:'Aparece al batir un récord.', en:'Appears when a record is beaten.'} },
        { x:6,y:50,w:88,h:8, type:'chip-row', label:{es:'Descanso', en:'Rest timer'}, desc:{es:'Cuenta regresiva entre series.', en:'Countdown between sets.'} },
        { x:6,y:82,w:88,h:9, type:'button', label:{es:'Terminar sesión', en:'End session'}, desc:{es:'Cierra y muestra el resumen.', en:'Closes it and shows the summary.'} },
      ]
    },
    {
      id: 'preparacion', order: 8, aspect: 'phone',
      title: { es: 'Mapa de Preparación', en: 'Readiness Map' },
      what: {
        es: 'Mapa corporal que muestra qué tan recuperado o fatigado está cada grupo muscular del cliente.',
        en: "A body map showing how recovered or fatigued each of the client's muscle groups is."
      },
      usage: {
        es: 'Consúltalo antes de programar, para no sobrecargar un grupo muscular ya fatigado.',
        en: "Check it before programming so you don't overload an already fatigued muscle group."
      },
      calculates: {
        es: 'Puntaje de preparación = promedio ponderado por las series hechas esta semana en cada grupo muscular. ≥80 = fresco, ≥60 = moderado, <60 = fatigado.',
        en: 'Readiness score = average weighted by sets done this week per muscle group. ≥80 = fresh, ≥60 = moderate, <60 = fatigued.'
      },
      alert: {
        es: 'Alerta de grupo fatigado: un grupo muscular por debajo de 60 se resalta en el mapa para evitar sobreentrenarlo.',
        en: 'Fatigued-group alert: a muscle group scoring below 60 is highlighted on the map to avoid overtraining it.'
      },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Título de la pantalla.', en:'Screen title.'} },
        { x:20,y:14,w:60,h:18, type:'chip-row', label:{es:'Puntaje general', en:'Overall score'}, desc:{es:'Número y estado (fresco/moderado/fatigado).', en:'Number and state (fresh/moderate/fatigued).'} },
        { x:15,y:35,w:70,h:40, type:'card', label:{es:'Silueta del cuerpo', en:'Body silhouette'}, desc:{es:'Toca una zona para ver el detalle.', en:'Tap a zone for detail.'} },
        { x:6,y:80,w:42,h:7, type:'button', label:{es:'Vista frontal', en:'Front view'}, desc:{es:'Cambia a frente.', en:'Switches to front.'} },
        { x:52,y:80,w:42,h:7, type:'button', label:{es:'Vista posterior', en:'Back view'}, desc:{es:'Cambia a espalda.', en:'Switches to back.'} },
      ]
    },
    {
      id: 'volumen', order: 9, aspect: 'phone',
      title: { es: 'Rastreador Muscular', en: 'Muscle Tracer' },
      what: {
        es: 'Compara el volumen semanal por grupo muscular contra un rango objetivo.',
        en: 'Compares weekly volume per muscle group against a target range.'
      },
      usage: {
        es: 'Revísalo cada semana para balancear el programa antes de que un grupo quede sub o sobre-entrenado.',
        en: 'Review it weekly to balance the program before a group gets under- or over-trained.'
      },
      calculates: {
        es: 'Volumen semanal por grupo = suma de series de esa semana. Se compara contra un rango objetivo (mínimo–máximo) recomendado.',
        en: "Weekly volume per group = sum of that week's sets. It's compared against a recommended target range (min–max)."
      },
      alert: {
        es: 'Alerta de sub/sobre-entrenamiento: se marca un grupo si cae por debajo o por encima de su rango objetivo dos semanas seguidas.',
        en: 'Under/over-training alert: a group is flagged if it falls below or above its target range for two weeks running.'
      },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Selector de cliente', en:'Client selector'}, desc:{es:'Cambia sin salir de la pantalla.', en:'Switches without leaving the screen.'} },
        { x:6,y:14,w:88,h:60, type:'chip-row', label:{es:'Barras por grupo', en:'Bars per group'}, desc:{es:'Color indica si está en rango.', en:"Color shows if it's in range."} },
        { x:6,y:78,w:88,h:6, type:'badge', label:{es:'Fuera de rango', en:'Out of range'}, desc:{es:'Se agrega cuando se activa la alerta.', en:'Added when the alert triggers.'} },
      ]
    },
    {
      id: 'agenda', order: 10, aspect: 'phone',
      title: { es: 'Calendario', en: 'Schedule' },
      what: {
        es: 'Vista semanal de tus sesiones agendadas, con huecos disponibles para nuevas citas.',
        en: 'A weekly view of your scheduled sessions, with open slots for new appointments.'
      },
      usage: {
        es: 'Úsalo para ver huecos libres antes de ofrecerle un horario a un cliente nuevo.',
        en: 'Use it to see open slots before offering a new client a time.'
      },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Semana actual', en:'Current week'}, desc:{es:'Flechas para cambiar de semana.', en:'Arrows to change week.'} },
        { x:6,y:14,w:88,h:8, type:'chip-row', label:{es:'Selector de día', en:'Day picker'}, desc:{es:'Toca un día para ver su agenda.', en:'Tap a day for its agenda.'} },
        { x:6,y:25,w:88,h:55, type:'list', label:{es:'Bloques de sesión', en:'Session blocks'}, desc:{es:'Cliente y tipo por hora.', en:'Client and type by hour.'} },
        { x:6,y:83,w:88,h:8, type:'button', label:{es:'Nueva cita', en:'New appointment'}, desc:{es:'Abre el formulario.', en:'Opens the form.'} },
      ]
    },
    {
      id: 'mensajes', order: 11, aspect: 'phone',
      title: { es: 'Mensajes', en: 'Messages' },
      what: {
        es: 'Bandeja de conversaciones directas con tus clientes.',
        en: 'Inbox of direct conversations with your clients.'
      },
      usage: {
        es: 'Respóndelos antes de tu primera sesión del día — mantiene el compromiso del cliente.',
        en: 'Answer these before your first session of the day — it keeps clients engaged.'
      },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Título y no leídos.', en:'Title and unread count.'} },
        { x:6,y:14,w:88,h:70, type:'list', label:{es:'Conversaciones', en:'Conversations'}, desc:{es:'Foto, último mensaje y hora.', en:'Photo, last message, and time.'} },
        { x:78,y:16,w:14,h:6, type:'badge', label:{es:'No leído', en:'Unread'}, desc:{es:'Punto o número de mensajes.', en:'Dot or message count.'} },
      ]
    },
    {
      id: 'notas', order: 12, aspect: 'phone',
      title: { es: 'Notas del Cliente', en: 'Client Notes' },
      what: {
        es: 'Registro privado de observaciones, lesiones y check-ins de cada cliente.',
        en: "A private log of observations, injuries, and check-ins for each client."
      },
      usage: {
        es: 'Anota lesiones o molestias justo después de la sesión, mientras las recuerdas.',
        en: 'Log injuries or discomfort right after the session, while you remember them.'
      },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Título de la sección.', en:'Section title.'} },
        { x:6,y:14,w:88,h:8, type:'button', label:{es:'Agregar nota', en:'Add note'}, desc:{es:'Campo de texto con fecha automática.', en:'Text field with an automatic date.'} },
        { x:6,y:25,w:88,h:60, type:'list', label:{es:'Historial', en:'History'}, desc:{es:'Más reciente arriba.', en:'Newest on top.'} },
      ]
    },
    {
      id: 'mi-perfil', order: 13, aspect: 'phone',
      title: { es: 'Mi Perfil', en: 'My Profile' },
      what: {
        es: 'Configuración de tu cuenta de entrenador: datos, especialidades y disponibilidad.',
        en: 'Your trainer account settings: info, specialties, and availability.'
      },
      usage: {
        es: 'Mantén tu disponibilidad al día — es lo que ven los miembros al buscar entrenador.',
        en: 'Keep your availability current — it\'s what members see when browsing trainers.'
      },
      elements: [
        { x:6,y:4,w:88,h:16, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Editable al tocar.', en:'Editable on tap.'} },
        { x:6,y:22,w:88,h:8, type:'button', label:{es:'Disponibilidad', en:'Availability'}, desc:{es:'Define tus horarios.', en:'Sets your open hours.'} },
        { x:6,y:33,w:88,h:8, type:'button', label:{es:'Perfil público', en:'Public profile'}, desc:{es:'Cómo te ven los miembros.', en:'How members see you.'} },
        { x:6,y:44,w:88,h:8, type:'button', label:{es:'Cerrar sesión', en:'Log out'}, desc:{es:'Sale de este dispositivo.', en:'Signs out on this device.'} },
      ]
    },
    {
      id: 'perfil-publico', order: 14, aspect: 'phone',
      title: { es: 'Perfil Público', en: 'Public Profile' },
      what: {
        es: 'Lo que los miembros ven al elegir entrenador: bio, especialidades y calificación.',
        en: 'What members see when choosing a trainer: bio, specialties, and rating.'
      },
      usage: {
        es: 'Actualiza tu bio y especialidades — es tu vitrina frente a miembros nuevos.',
        en: "Keep your bio and specialties current — it's your storefront to new members."
      },
      calculates: {
        es: 'Calificación promedio = promedio de las reseñas de clientes (1–5 estrellas) de los últimos 90 días.',
        en: 'Average rating = average of client reviews (1–5 stars) over the last 90 days.'
      },
      elements: [
        { x:6,y:4,w:88,h:16, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Estrellas y reseñas.', en:'Stars and review count.'} },
        { x:6,y:22,w:88,h:10, type:'chip-row', label:{es:'Especialidades', en:'Specialties'}, desc:{es:'Ej. Fuerza, Movilidad.', en:'E.g. Strength, Mobility.'} },
        { x:6,y:34,w:88,h:20, type:'card', label:{es:'Biografía', en:'Bio'}, desc:{es:'Tu enfoque como entrenador.', en:'Your training approach.'} },
        { x:6,y:82,w:88,h:9, type:'button', label:{es:'Solicitar', en:'Request'}, desc:{es:'Solo miembros; te envía una solicitud.', en:'Members only; sends you a request.'} },
      ]
    },
    {
      id: 'alertas-trainer', order: 15, aspect: 'phone',
      title: { es: 'Alertas', en: 'Alerts' },
      what: {
        es: 'Bandeja de todas las alertas del sistema relevantes para ti: clientes en riesgo, PRs y fatiga muscular.',
        en: 'Inbox of every system alert relevant to you: clients at risk, PRs, and muscle fatigue.'
      },
      usage: {
        es: 'Revísala varias veces al día — es tu lista de pendientes, generada por la app.',
        en: "Check it a few times a day — it's your to-do list, generated by the app."
      },
      elements: [
        { x:6,y:4,w:88,h:7, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Título y no leídas.', en:'Title and unread count.'} },
        { x:6,y:14,w:88,h:8, type:'chip-row', label:{es:'Filtros', en:'Filters'}, desc:{es:'Riesgo, PR, fatiga, mensajes.', en:'Risk, PR, fatigue, messages.'} },
        { x:6,y:25,w:88,h:60, type:'list', label:{es:'Lista de alertas', en:'Alert list'}, desc:{es:'Icono, cliente y hora.', en:'Icon, client, and time.'} },
      ]
    },
  ],

  admin: [
    {
      id: 'overview', order: 1, aspect: 'desktop',
      title: { es: 'Panel Principal', en: 'Overview' },
      what: { es: 'Tu mañana de un vistazo: tarjetas de KPI, la cola de miembros en riesgo, el pulso semanal y la actividad reciente.', en: 'Your morning at a glance: KPI cards, the at-risk queue, the weekly pulse, and recent activity.' },
      usage: { es: 'Ábrelo primero cada día. La cola de la mañana está ordenada por riesgo — es tu lista de a-quién-contactar-hoy.', en: 'Open it first each day. The morning queue is sorted by risk — it’s your who-to-contact-today list.' },
      calculates: { es: 'Tasa activa = miembros con al menos un entrenamiento completado en 30 días ÷ total de miembros × 100.', en: 'Active rate = members with at least one completed workout in 30 days ÷ total members × 100.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones del admin.', en:'Every admin section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Saludo y fecha.', en:'Greeting and date.'} },
        { x:17,y:20,w:19,h:15, type:'stat', label:{es:'Tarjetas KPI', en:'KPI cards'}, desc:{es:'Tasa activa, nuevos, referidos.', en:'Active rate, new, referrals.'} },
        { x:17,y:38,w:38,h:52, type:'table', label:{es:'Cola de la mañana', en:'Morning queue'}, desc:{es:'Miembros en riesgo por urgencia.', en:'At-risk members by urgency.'} },
        { x:58,y:38,w:40,h:24, type:'chart', label:{es:'Pulso semanal', en:'Weekly pulse'}, desc:{es:'Check-ins por día.', en:'Check-ins by day.'} },
        { x:58,y:65,w:40,h:25, type:'card', label:{es:'Actividad reciente', en:'Recent activity'}, desc:{es:'Últimas acciones de miembros.', en:'Latest member actions.'} },
      ]
    },
    {
      id: 'cola-manana', order: 2, aspect: 'desktop',
      title: { es: 'Cola de la Mañana', en: 'Morning Queue' },
      what: { es: 'La lista priorizada de miembros que necesitan atención hoy, coloreada por nivel de riesgo de cancelación.', en: 'The prioritized list of members who need attention today, colored by churn-risk tier.' },
      usage: { es: 'Trabaja de arriba hacia abajo. Cada nombre abre su ficha y el modal de recuperación en un toque.', en: 'Work top to bottom. Each name opens their card and the win-back modal in one tap.' },
      alert: { es: 'Un miembro entra a la cola cuando su puntaje de churn cruza 30 (nivel Medio). Ver Parte “Alertas”.', en: 'A member enters the queue when their churn score crosses 30 (Medium tier). See the “Alerts” part.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Total en riesgo hoy.', en:'Total at risk today.'} },
        { x:17,y:20,w:81,h:8, type:'chip-row', label:{es:'Filtros', en:'Filters'}, desc:{es:'Por nivel y contactados.', en:'By tier and contacted.'} },
        { x:17,y:31,w:81,h:16, type:'card', label:{es:'Fila crítica', en:'Critical row'}, desc:{es:'Nombre, señal y tendencia.', en:'Name, signal, and trend.'} },
        { x:74,y:33,w:22,h:6, type:'button', label:{es:'Recuperar', en:'Win back'}, desc:{es:'Abre el modal de contacto.', en:'Opens the contact modal.'} },
        { x:17,y:50,w:81,h:40, type:'table', label:{es:'Más miembros', en:'More members'}, desc:{es:'Ordenados por puntaje.', en:'Sorted by score.'} },
      ]
    },
    {
      id: 'resets', order: 3, aspect: 'desktop',
      title: { es: 'Aprobaciones de Reset', en: 'Reset Approvals' },
      what: { es: 'La cola de solicitudes de restablecimiento de contraseña que esperan tu aprobación.', en: 'The queue of password-reset requests awaiting your approval.' },
      usage: { es: 'Revísalas a diario: expiran en 24 h. Aprobar rápido evita el “no puedo entrar” que hace que un miembro se rinda.', en: 'Check daily: they expire in 24h. Approving fast avoids the “I can’t log in” that makes a member give up.' },
      alert: { es: 'Cada solicitud genera una notificación en tiempo real. Ver Parte “Alertas”.', en: 'Each request creates a real-time notification. See the “Alerts” part.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Solicitudes pendientes.', en:'Pending requests.'} },
        { x:17,y:20,w:81,h:14, type:'card', label:{es:'Solicitud', en:'Request'}, desc:{es:'Miembro, correo y hora.', en:'Member, email, and time.'} },
        { x:66,y:23,w:14,h:7, type:'button', label:{es:'Aprobar', en:'Approve'}, desc:{es:'Habilita el cambio.', en:'Enables the change.'} },
        { x:82,y:23,w:14,h:7, type:'button', label:{es:'Negar', en:'Deny'}, desc:{es:'Rechaza la solicitud.', en:'Rejects the request.'} },
        { x:17,y:37,w:81,h:53, type:'table', label:{es:'Cola', en:'Queue'}, desc:{es:'Solicitudes con caducidad 24 h.', en:'Requests with a 24h expiry.'} },
      ]
    },
    {
      id: 'miembros', order: 4, aspect: 'desktop',
      title: { es: 'Miembros', en: 'Members' },
      what: { es: 'El directorio completo con búsqueda, filtros por estado, invitaciones, acciones en lote y exportación CSV.', en: 'The full directory with search, status filters, invites, bulk actions, and CSV export.' },
      usage: { es: 'Tu fuente de verdad de quién está activo, pausado o cancelado. Filtra y exporta para cualquier campaña.', en: 'Your source of truth for who’s active, paused, or churned. Filter and export for any campaign.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:50,h:8, type:'input', label:{es:'Buscador', en:'Search'}, desc:{es:'Por nombre o correo.', en:'By name or email.'} },
        { x:70,y:9,w:28,h:8, type:'button', label:{es:'Invitar / Exportar', en:'Invite / Export'}, desc:{es:'Enlace de invitación o CSV.', en:'Invite link or CSV.'} },
        { x:17,y:20,w:81,h:7, type:'chip-row', label:{es:'Filtros', en:'Filters'}, desc:{es:'Activo, pausado, cancelado.', en:'Active, paused, churned.'} },
        { x:17,y:30,w:81,h:60, type:'table', label:{es:'Lista de miembros', en:'Member list'}, desc:{es:'Nombre, estado, última actividad.', en:'Name, status, last activity.'} },
      ]
    },
    {
      id: 'detalle-miembro', order: 5, aspect: 'desktop',
      title: { es: 'Detalle de Miembro', en: 'Member Detail' },
      what: { es: 'La ficha de un miembro en cuatro pestañas: Entrenamientos, Asistencia (mapa de calor), PRs y Notas.', en: 'A member’s card in four tabs: Workouts, Attendance (heatmap), PRs, and Notes.' },
      usage: { es: 'Ábrelo antes de contactar a alguien en riesgo — el mapa de calor de asistencia te dice cuándo dejó de venir.', en: 'Open it before contacting someone at risk — the attendance heatmap tells you when they stopped coming.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:12, type:'header', label:{es:'Cabecera del miembro', en:'Member header'}, desc:{es:'Foto, estado, contacto.', en:'Photo, status, contact.'} },
        { x:17,y:24,w:81,h:7, type:'chip-row', label:{es:'Pestañas', en:'Tabs'}, desc:{es:'Entrenos · Asistencia · PRs · Notas.', en:'Workouts · Attendance · PRs · Notes.'} },
        { x:17,y:34,w:50,h:56, type:'chart', label:{es:'Mapa de calor', en:'Heatmap'}, desc:{es:'Check-ins por día × hora.', en:'Check-ins by day × hour.'} },
        { x:70,y:34,w:28,h:56, type:'card', label:{es:'Notas del admin', en:'Admin notes'}, desc:{es:'Historial privado.', en:'Private log.'} },
      ]
    },
    {
      id: 'invitaciones', order: 6, aspect: 'desktop',
      title: { es: 'Invitaciones', en: 'Invites' },
      what: { es: 'Enlaces de invitación de un solo uso con seguimiento de reclamo, para que solo entren tus miembros.', en: 'One-use invite links with claim tracking, so only your members join.' },
      usage: { es: 'Genera invitaciones para nuevos miembros e imprímelas o compártelas. Cada enlace se usa una sola vez.', en: 'Generate invites for new members and print or share them. Each link is used only once.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:60,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Invitaciones activas.', en:'Active invites.'} },
        { x:80,y:9,w:18,h:8, type:'button', label:{es:'Nueva invitación', en:'New invite'}, desc:{es:'Crea un enlace de un uso.', en:'Creates a one-use link.'} },
        { x:17,y:20,w:81,h:70, type:'table', label:{es:'Lista de invitaciones', en:'Invite list'}, desc:{es:'Estado: pendiente o reclamada.', en:'Status: pending or claimed.'} },
      ]
    },
    {
      id: 'segmentos', order: 7, aspect: 'desktop',
      title: { es: 'Segmentos', en: 'Segments' },
      what: { es: 'Cohortes de miembros filtradas por estado, nivel de riesgo, actividad, meta o antigüedad, guardadas para reusar.', en: 'Member cohorts filtered by status, risk tier, activity, goal, or tenure, saved for reuse.' },
      usage: { es: 'Arma un segmento una vez (ej. “en riesgo + 3+ meses”) y apúntale campañas dirigidas cuando quieras.', en: 'Build a segment once (e.g. “at risk + 3+ months”) and point targeted campaigns at it whenever.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Segmentos guardados.', en:'Saved segments.'} },
        { x:17,y:20,w:30,h:70, type:'card', label:{es:'Constructor de filtros', en:'Filter builder'}, desc:{es:'Estado, riesgo, meta, antigüedad.', en:'Status, risk, goal, tenure.'} },
        { x:50,y:20,w:48,h:60, type:'table', label:{es:'Miembros del segmento', en:'Segment members'}, desc:{es:'Vista previa en vivo.', en:'Live preview.'} },
        { x:50,y:82,w:48,h:8, type:'button', label:{es:'Guardar / Exportar', en:'Save / Export'}, desc:{es:'Reusar o descargar CSV.', en:'Reuse or download CSV.'} },
      ]
    },
    {
      id: 'churn', order: 8, aspect: 'desktop',
      title: { es: 'Riesgo de Cancelación', en: 'Churn Risk' },
      what: { es: 'El corazón de la app: cada miembro con un puntaje 0–100, su nivel, una explicación legible y las 3 señales que más pesan.', en: 'The heart of the app: every member with a 0–100 score, their tier, a readable explanation, and the top 3 signals.' },
      usage: { es: 'Úsalo como guía de prioridad, no como veredicto. La explicación de cada miembro te dice por qué está en riesgo.', en: 'Use it as a priority guide, not a verdict. Each member’s explanation tells you why they’re at risk.' },
      calculates: { es: 'Modelo v3 “asistencia primero”: riesgo = (riesgoAsistencia + riesgoCompromiso) × multiplicador por antigüedad, luego + bono protector, recortado 0–100. Detalle completo en “Tus Números”.', en: 'v3 “attendance-first” model: risk = (attendanceRisk + engagementRisk) × tenure multiplier, then + protective bonus, clamped 0–100. Full detail in “Your Numbers”.' },
      alert: { es: 'Cuando un miembro cruza 30, entra a la cola de la mañana y te llega una notificación.', en: 'When a member crosses 30, they enter the morning queue and you get a notification.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Recalcular puntajes.', en:'Recalculate scores.'} },
        { x:17,y:20,w:81,h:7, type:'chip-row', label:{es:'Filtros por nivel', en:'Tier filters'}, desc:{es:'Crítico, alto, medio, bajo.', en:'Critical, high, medium, low.'} },
        { x:17,y:30,w:81,h:18, type:'card', label:{es:'Tarjeta de miembro', en:'Member card'}, desc:{es:'Puntaje, señales y tendencia.', en:'Score, signals, and trend.'} },
        { x:74,y:32,w:22,h:6, type:'button', label:{es:'Recuperar', en:'Win back'}, desc:{es:'Abre el modal de contacto.', en:'Opens the contact modal.'} },
        { x:17,y:51,w:81,h:39, type:'table', label:{es:'Miembros en riesgo', en:'At-risk members'}, desc:{es:'Ordenados por puntaje.', en:'Sorted by score.'} },
      ]
    },
    {
      id: 'recuperacion', order: 9, aspect: 'desktop',
      title: { es: 'Recuperación', en: 'Win-Back' },
      what: { es: 'El modal para contactar a un miembro en riesgo: elige plantilla y método —push, llamada/SMS o correo.', en: 'The modal to contact an at-risk member: pick a template and method — push, call/SMS, or email.' },
      usage: { es: 'Guarda historial de contacto para que no re-contactes dentro de 7 días. Personaliza la plantilla con el nombre.', en: 'It logs contact history so you don’t re-contact within 7 days. Personalize the template with their name.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:30,y:16,w:55,h:14, type:'header', label:{es:'Miembro a contactar', en:'Member to contact'}, desc:{es:'Nombre y último contacto.', en:'Name and last contact.'} },
        { x:30,y:33,w:55,h:9, type:'chip-row', label:{es:'Método', en:'Method'}, desc:{es:'Push, llamada/SMS o correo.', en:'Push, call/SMS, or email.'} },
        { x:30,y:45,w:55,h:26, type:'card', label:{es:'Plantilla', en:'Template'}, desc:{es:'Específica de churn o genérica.', en:'Churn-specific or generic.'} },
        { x:30,y:74,w:55,h:9, type:'button', label:{es:'Enviar', en:'Send'}, desc:{es:'Registra el contacto.', en:'Logs the contact.'} },
      ]
    },
    {
      id: 'analitica', order: 10, aspect: 'desktop',
      title: { es: 'Analítica', en: 'Analytics' },
      what: { es: 'El tablero de 9 gráficos: crecimiento, retención, actividad, cohortes, retos, embudo, ciclo de vida y entrenadores.', en: 'The 9-chart dashboard: growth, retention, activity, cohorts, challenges, funnel, lifecycle, and trainers.' },
      usage: { es: 'Cada KPI tiene una meta mensual editable con barra de avance. El asesor sugiere metas realistas según tu base.', en: 'Each KPI has an editable monthly target with a progress bar. The advisor suggests realistic targets from your baseline.' },
      calculates: { es: 'Las 6 KPIs — retención, tasa activa, entrenamientos promedio, tasa de check-in, tasa de churn y NPS — se explican con su fórmula en “Tus Números”.', en: 'The 6 KPIs — retention, active rate, avg workouts, check-in rate, churn rate, and NPS — are explained with their formula in “Your Numbers”.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Rango de fechas.', en:'Date range.'} },
        { x:17,y:20,w:19,h:14, type:'stat', label:{es:'KPI con meta', en:'KPI with target'}, desc:{es:'Verde/amarillo/rojo vs. meta.', en:'Green/yellow/red vs. target.'} },
        { x:17,y:37,w:39,h:26, type:'chart', label:{es:'Crecimiento', en:'Growth'}, desc:{es:'Cohortes por mes.', en:'Cohorts by month.'} },
        { x:58,y:37,w:40,h:26, type:'chart', label:{es:'Retención', en:'Retention'}, desc:{es:'Curvas de supervivencia.', en:'Survival curves.'} },
        { x:17,y:66,w:81,h:24, type:'chart', label:{es:'Actividad', en:'Activity'}, desc:{es:'Check-ins y entrenos por día.', en:'Check-ins and workouts per day.'} },
      ]
    },
    {
      id: 'cohortes', order: 11, aspect: 'desktop',
      title: { es: 'Retención por Cohorte', en: 'Cohort Retention' },
      what: { es: 'Una tabla que muestra, mes por mes de ingreso, qué porcentaje de cada cohorte sigue activa a las 4, 8, 12 y 24 semanas.', en: 'A table showing, by signup month, what percent of each cohort is still active at weeks 4, 8, 12, and 24.' },
      usage: { es: 'Busca dónde cae la retención — casi siempre alrededor del mes 3. Ahí es donde tu esfuerzo rinde más.', en: 'Look for where retention drops — usually around month 3. That’s where your effort pays off most.' },
      calculates: { es: 'Cada celda = % de la cohorte que registró un entrenamiento en esa semana. La columna revela el valle de churn.', en: 'Each cell = % of the cohort that logged a workout in that week. The column reveals the churn valley.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Retención por cohorte.', en:'Retention by cohort.'} },
        { x:17,y:20,w:81,h:12, type:'chart', label:{es:'Curvas', en:'Curves'}, desc:{es:'Supervivencia por cohorte.', en:'Survival per cohort.'} },
        { x:17,y:35,w:81,h:55, type:'table', label:{es:'Tabla de cohortes', en:'Cohort table'}, desc:{es:'Filas = mes; columnas = semanas.', en:'Rows = month; columns = weeks.'} },
      ]
    },
    {
      id: 'embudo', order: 12, aspect: 'desktop',
      title: { es: 'Embudo de Onboarding', en: 'Onboarding Funnel' },
      what: { es: 'Cada paso del onboarding con cuántos lo empezaron, cuántos lo terminaron y dónde está la mayor caída.', en: 'Each onboarding step with how many started, how many finished, and where the biggest drop-off is.' },
      usage: { es: 'El paso con más caída es tu fuga de nuevos miembros. Simplifícalo o explícalo mejor y activarás a más gente.', en: 'The step with the biggest drop is your new-member leak. Simplify or explain it and you’ll activate more people.' },
      calculates: { es: 'Caída por paso = (completaron el paso anterior − completaron este) ÷ completaron el anterior × 100.', en: 'Drop-off per step = (finished previous step − finished this one) ÷ finished previous × 100.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Embudo de onboarding.', en:'Onboarding funnel.'} },
        { x:17,y:20,w:81,h:52, type:'chart', label:{es:'Barras del embudo', en:'Funnel bars'}, desc:{es:'Un paso por barra.', en:'One step per bar.'} },
        { x:17,y:76,w:81,h:14, type:'card', label:{es:'Mayor caída', en:'Biggest drop'}, desc:{es:'Resaltada automáticamente.', en:'Highlighted automatically.'} },
      ]
    },
    {
      id: 'asistencia', order: 13, aspect: 'desktop',
      title: { es: 'Asistencia', en: 'Attendance' },
      what: { es: 'Patrones de check-in: totales, visitantes únicos, hora pico y un mapa de calor por día × hora.', en: 'Check-in patterns: totals, unique visitors, peak hour, and a day × hour heatmap.' },
      usage: { es: 'La hora pico te dice cuándo reforzar staff o clases. El delta % te avisa si el tráfico sube o baja.', en: 'The peak hour tells you when to add staff or classes. The delta % warns you if traffic is rising or falling.' },
      calculates: { es: 'Delta % = (segunda mitad del periodo − primera mitad) ÷ primera mitad × 100. Hora pico = día+hora con más check-ins.', en: 'Delta % = (second half of period − first half) ÷ first half × 100. Peak hour = day+hour with the most check-ins.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:60,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Total de check-ins.', en:'Total check-ins.'} },
        { x:80,y:9,w:18,h:8, type:'chip-row', label:{es:'Periodo', en:'Period'}, desc:{es:'7 / 30 / 90 días.', en:'7 / 30 / 90 days.'} },
        { x:17,y:20,w:19,h:14, type:'stat', label:{es:'Resumen', en:'Summary'}, desc:{es:'Únicos, promedio, hora pico.', en:'Unique, average, peak hour.'} },
        { x:17,y:37,w:81,h:53, type:'chart', label:{es:'Mapa de calor', en:'Heatmap'}, desc:{es:'Día × hora, 6am–8pm.', en:'Day × hour, 6am–8pm.'} },
      ]
    },
    {
      id: 'clases', order: 14, aspect: 'desktop',
      title: { es: 'Clases', en: 'Classes' },
      what: { es: 'Gestiona el horario: crea clases con imagen, capacidad, entrenador y plantilla de entreno, y ve su analítica.', en: 'Manage the schedule: create classes with image, capacity, trainer, and workout template, and see their analytics.' },
      usage: { es: 'Revisa la tasa de asistencia y la calificación por clase — te dice cuáles llenar más y cuáles reemplazar.', en: 'Check attendance rate and rating per class — it tells you which to add more of and which to replace.' },
      calculates: { es: 'Tasa de asistencia = asistentes ÷ capacidad × 100. Calificación = promedio de estrellas 1–5.', en: 'Attendance rate = attendees ÷ capacity × 100. Rating = average of 1–5 stars.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:60,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Horario de clases.', en:'Class schedule.'} },
        { x:80,y:9,w:18,h:8, type:'button', label:{es:'Nueva clase', en:'New class'}, desc:{es:'Crea una clase.', en:'Creates a class.'} },
        { x:17,y:20,w:48,h:70, type:'table', label:{es:'Lista de clases', en:'Class list'}, desc:{es:'Horario, entrenador, capacidad.', en:'Time, trainer, capacity.'} },
        { x:68,y:20,w:30,h:70, type:'card', label:{es:'Analítica de clase', en:'Class analytics'}, desc:{es:'Asistencia y calificación.', en:'Attendance and rating.'} },
      ]
    },
    {
      id: 'retos', order: 15, aspect: 'desktop',
      title: { es: 'Retos', en: 'Challenges' },
      what: { es: 'Crea retos (consistencia, volumen, PRs, equipo), define duración, reglas de puntaje y niveles de premio.', en: 'Create challenges (consistency, volume, PRs, team), set duration, scoring rules, and reward tiers.' },
      usage: { es: 'Lanza uno cada mes. Participar dispara asistencia y PRs — es tu palanca de compromiso más fuerte.', en: 'Launch one each month. Joining spikes attendance and PRs — it’s your strongest engagement lever.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:60,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Retos activos.', en:'Active challenges.'} },
        { x:80,y:9,w:18,h:8, type:'button', label:{es:'Nuevo reto', en:'New challenge'}, desc:{es:'Crea y programa.', en:'Create and schedule.'} },
        { x:17,y:20,w:48,h:32, type:'card', label:{es:'Reto en curso', en:'Live challenge'}, desc:{es:'Tipo, duración, premio.', en:'Type, duration, reward.'} },
        { x:68,y:20,w:30,h:70, type:'table', label:{es:'Leaderboard en vivo', en:'Live leaderboard'}, desc:{es:'Se actualiza en tiempo real.', en:'Updates in real time.'} },
        { x:17,y:56,w:48,h:34, type:'chip-row', label:{es:'Lanzar / pausar / archivar', en:'Launch / pause / archive'}, desc:{es:'Flujo del reto.', en:'Challenge flow.'} },
      ]
    },
    {
      id: 'programas', order: 16, aspect: 'desktop',
      title: { es: 'Programas', en: 'Programs' },
      what: { es: 'Programas de entrenamiento para todo el gimnasio (semanas → días → ejercicios) con seguimiento de inscripción.', en: 'Gym-wide workout programs (weeks → days → exercises) with enrollment tracking.' },
      usage: { es: 'Crea 2–3 programas por nivel. Aparecen en la app del miembro como “Programas del gimnasio” para inscribirse.', en: 'Create 2–3 programs per level. They show in the member app as “Gym programs” to enroll in.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:60,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Programas del gimnasio.', en:'Gym programs.'} },
        { x:80,y:9,w:18,h:8, type:'button', label:{es:'Nuevo programa', en:'New program'}, desc:{es:'Semanas, días, ejercicios.', en:'Weeks, days, exercises.'} },
        { x:17,y:20,w:39,h:70, type:'table', label:{es:'Lista de programas', en:'Program list'}, desc:{es:'Con inscritos por programa.', en:'With enrollees per program.'} },
        { x:58,y:20,w:40,h:70, type:'card', label:{es:'Estructura', en:'Structure'}, desc:{es:'Semanas y días del programa.', en:'Program weeks and days.'} },
      ]
    },
    {
      id: 'clasificacion', order: 17, aspect: 'desktop',
      title: { es: 'Clasificación', en: 'Leaderboard' },
      what: { es: 'Configura las 7 métricas del leaderboard (volumen, entrenos, más mejorado, consistencia, racha, PRs, check-ins).', en: 'Configure the 7 leaderboard metrics (volume, workouts, most improved, consistency, streak, PRs, check-ins).' },
      usage: { es: 'La misma data alimenta la Pantalla TV del gimnasio. Elige métricas que premien el esfuerzo, no solo la fuerza bruta.', en: 'The same data feeds the gym TV Display. Pick metrics that reward effort, not just raw strength.' },
      calculates: { es: '“Más mejorado” = cambio del 1RM contra un periodo atrás. “Consistencia” = % de días planeados que el miembro asistió.', en: '“Most improved” = 1RM change vs. a period ago. “Consistency” = % of planned days the member attended.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Clasificación del gimnasio.', en:'Gym leaderboard.'} },
        { x:17,y:20,w:81,h:8, type:'chip-row', label:{es:'Métrica y periodo', en:'Metric & period'}, desc:{es:'7 métricas, semanal/mensual.', en:'7 metrics, weekly/monthly.'} },
        { x:17,y:31,w:81,h:59, type:'table', label:{es:'Ranking', en:'Ranking'}, desc:{es:'Nombre y valor por miembro.', en:'Name and value per member.'} },
      ]
    },
    {
      id: 'pantalla-tv', order: 18, aspect: 'desktop',
      title: { es: 'Pantalla TV', en: 'TV Display' },
      what: { es: 'Modo pantalla completa para el televisor del gimnasio: rota leaderboards, retos y PRs cada 20 segundos, con tu marca.', en: 'Fullscreen mode for the gym TV: rotates leaderboards, challenges, and PRs every 20 seconds, with your branding.' },
      usage: { es: 'Ponlo en una TV en el piso del gimnasio. Ver tu nombre en pantalla motiva a los miembros a volver.', en: 'Put it on a TV on the gym floor. Seeing their name on screen motivates members to come back.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Vista previa y abrir en TV.', en:'Preview and open on TV.'} },
        { x:17,y:20,w:81,h:56, type:'chart', label:{es:'Vista previa', en:'Preview'}, desc:{es:'Leaderboard a pantalla completa.', en:'Fullscreen leaderboard.'} },
        { x:17,y:80,w:81,h:10, type:'chip-row', label:{es:'Rotación', en:'Rotation'}, desc:{es:'Qué métricas mostrar y cada cuánto.', en:'Which metrics to show and how often.'} },
      ]
    },
    {
      id: 'anuncios', order: 19, aspect: 'desktop',
      title: { es: 'Anuncios', en: 'Announcements' },
      what: { es: 'Crea y programa anuncios (noticia, evento, reto, mantenimiento) con envío de push a todos los miembros.', en: 'Create and schedule announcements (news, event, challenge, maintenance) with push broadcast to all members.' },
      usage: { es: 'Aparecen en el panel del miembro y en “Mi gimnasio”. Úsalos para cambios de horario, feriados y eventos.', en: 'They show in the member dashboard and “My Gym.” Use them for hour changes, holidays, and events.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:60,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Anuncios programados.', en:'Scheduled announcements.'} },
        { x:80,y:9,w:18,h:8, type:'button', label:{es:'Nuevo anuncio', en:'New announcement'}, desc:{es:'Redacta y programa.', en:'Draft and schedule.'} },
        { x:17,y:20,w:45,h:70, type:'card', label:{es:'Editor', en:'Editor'}, desc:{es:'Tipo, texto y fecha.', en:'Type, text, and date.'} },
        { x:65,y:20,w:33,h:70, type:'card', label:{es:'Vista previa', en:'Preview'}, desc:{es:'Cómo lo ve el miembro.', en:'How the member sees it.'} },
      ]
    },
    {
      id: 'mensajeria', order: 20, aspect: 'desktop',
      title: { es: 'Mensajería', en: 'Messaging' },
      what: { es: 'Chat directo con miembros, con estado de entrega (enviado / entregado / leído).', en: 'Direct chat with members, with delivery status (sent / delivered / read).' },
      usage: { es: 'Para seguimiento personal uno a uno. Combínalo con Segmentos para mensajes dirigidos a grupos.', en: 'For one-to-one personal follow-up. Combine it with Segments for group-targeted messages.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:30,h:81, type:'table', label:{es:'Conversaciones', en:'Conversations'}, desc:{es:'Lista de miembros.', en:'Member list.'} },
        { x:50,y:9,w:48,h:70, type:'card', label:{es:'Hilo de chat', en:'Chat thread'}, desc:{es:'Con recibos de lectura.', en:'With read receipts.'} },
        { x:50,y:82,w:48,h:8, type:'input', label:{es:'Redactar', en:'Compose'}, desc:{es:'Escribe y envía.', en:'Type and send.'} },
      ]
    },
    {
      id: 'plantillas-email', order: 21, aspect: 'desktop',
      title: { es: 'Plantillas de Email', en: 'Email Templates' },
      what: { es: 'Plantillas de correo con variables de personalización ({{nombre}}, {{puntaje}}) para automatizar comunicaciones.', en: 'Email templates with personalization variables ({{name}}, {{score}}) to automate communications.' },
      usage: { es: 'Arma tus correos de bienvenida y recuperación una vez. La app rellena las variables por miembro.', en: 'Build your welcome and win-back emails once. The app fills the variables per member.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Plantillas de correo.', en:'Email templates.'} },
        { x:17,y:20,w:30,h:70, type:'table', label:{es:'Lista', en:'List'}, desc:{es:'Plantillas guardadas.', en:'Saved templates.'} },
        { x:50,y:20,w:48,h:58, type:'card', label:{es:'Editor con variables', en:'Editor with variables'}, desc:{es:'{{nombre}}, {{puntaje}}…', en:'{{name}}, {{score}}…'} },
        { x:50,y:80,w:48,h:10, type:'card', label:{es:'Vista previa', en:'Preview'}, desc:{es:'Correo renderizado.', en:'Rendered email.'} },
      ]
    },
    {
      id: 'plantillas-mensajes', order: 22, aspect: 'desktop',
      title: { es: 'Plantillas de Mensajes', en: 'Message Templates' },
      what: { es: 'Plantillas de texto corto para push y SMS, también con variables de personalización.', en: 'Short-text templates for push and SMS, also with personalization variables.' },
      usage: { es: 'Guarda tus mensajes de recuperación aquí para enviarlos en un toque desde la cola de la mañana.', en: 'Save your win-back messages here to send them in one tap from the morning queue.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Plantillas de mensaje.', en:'Message templates.'} },
        { x:17,y:20,w:30,h:70, type:'table', label:{es:'Lista', en:'List'}, desc:{es:'Plantillas guardadas.', en:'Saved templates.'} },
        { x:50,y:20,w:48,h:70, type:'card', label:{es:'Editor', en:'Editor'}, desc:{es:'Texto corto con variables.', en:'Short text with variables.'} },
      ]
    },
    {
      id: 'resumen-semanal', order: 23, aspect: 'desktop',
      title: { es: 'Resumen Semanal', en: 'Weekly Digest' },
      what: { es: 'La configuración del correo de resumen semanal: activarlo, elegir plantilla, destinatarios y hora de envío.', en: 'The weekly-summary email config: enable it, pick template, recipients, and send time.' },
      usage: { es: 'Actívalo para recibir cada semana un resumen de tu gimnasio sin abrir la app. Buen pulso pasivo.', en: 'Enable it to get a weekly summary of your gym without opening the app. A good passive pulse.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Resumen semanal.', en:'Weekly digest.'} },
        { x:17,y:20,w:81,h:9, type:'toggle', label:{es:'Activar digest', en:'Enable digest'}, desc:{es:'Enciende el correo semanal.', en:'Turns on the weekly email.'} },
        { x:17,y:32,w:81,h:30, type:'card', label:{es:'Plantilla y destinatarios', en:'Template & recipients'}, desc:{es:'Qué se envía y a quién.', en:'What’s sent and to whom.'} },
        { x:17,y:65,w:81,h:9, type:'input', label:{es:'Hora de envío', en:'Send time'}, desc:{es:'Día y hora.', en:'Day and time.'} },
      ]
    },
    {
      id: 'nps', order: 24, aspect: 'desktop',
      title: { es: 'Opinión de Miembros (NPS)', en: 'Member Feedback (NPS)' },
      what: { es: 'Crea encuestas y mide el NPS. Ve respuestas con comentario, distribución por puntaje y tasa de respuesta.', en: 'Create surveys and measure NPS. See responses with comments, score distribution, and response rate.' },
      usage: { es: 'Lee los comentarios de los detractores — ahí están tus mejores pistas para reducir cancelaciones.', en: 'Read the detractor comments — that’s your best signal for cutting cancellations.' },
      calculates: { es: 'NPS = (% Promotores − % Detractores) × 100. Promotor = puntaje ≥4, Pasivo = 3, Detractor = ≤2. Rango −100 a +100.', en: 'NPS = (% Promoters − % Detractors) × 100. Promoter = score ≥4, Passive = 3, Detractor = ≤2. Range −100 to +100.' },
      alert: { es: 'Cada respuesta genera una notificación y actualiza el NPS en vivo.', en: 'Each response creates a notification and updates NPS live.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:60,h:8, type:'header', label:{es:'Puntaje NPS', en:'NPS score'}, desc:{es:'De −100 a +100.', en:'From −100 to +100.'} },
        { x:80,y:9,w:18,h:8, type:'button', label:{es:'Nueva encuesta', en:'New survey'}, desc:{es:'Una activa por gimnasio.', en:'One active per gym.'} },
        { x:17,y:20,w:35,h:26, type:'chart', label:{es:'Distribución', en:'Distribution'}, desc:{es:'Conteo por puntaje 1–5.', en:'Count per 1–5 score.'} },
        { x:17,y:49,w:81,h:41, type:'table', label:{es:'Respuestas', en:'Responses'}, desc:{es:'Comentario y nombre.', en:'Comment and name.'} },
      ]
    },
    {
      id: 'recompensas', order: 25, aspect: 'desktop',
      title: { es: 'Recompensas', en: 'Rewards' },
      what: { es: 'El catálogo de premios y la economía de puntos: añade/edita recompensas y gestiona tarjetas de sellos.', en: 'The reward catalog and points economy: add/edit rewards and manage punch cards.' },
      usage: { es: 'Define premios que valgan la pena canjear — un mes gratis, mercancía, sesión con entrenador. Es tu programa de lealtad.', en: 'Set rewards worth redeeming — a free month, merch, a PT session. It’s your loyalty program.' },
      calculates: { es: 'Puntos que ganan los miembros: entreno 50 · PR 100 · check-in 20 · día de racha 10×largo (tope 200) · reto 500 · logro 75.', en: 'Points members earn: workout 50 · PR 100 · check-in 20 · streak day 10×length (cap 200) · challenge 500 · achievement 75.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:60,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Catálogo de recompensas.', en:'Reward catalog.'} },
        { x:80,y:9,w:18,h:8, type:'button', label:{es:'Nueva recompensa', en:'New reward'}, desc:{es:'Nombre y costo en puntos.', en:'Name and points cost.'} },
        { x:17,y:20,w:48,h:70, type:'table', label:{es:'Recompensas', en:'Rewards'}, desc:{es:'Premio y costo en puntos.', en:'Reward and points cost.'} },
        { x:68,y:20,w:30,h:70, type:'card', label:{es:'Tarjetas de sellos', en:'Punch cards'}, desc:{es:'Cada N check-ins.', en:'Every N check-ins.'} },
      ]
    },
    {
      id: 'tienda', order: 26, aspect: 'desktop',
      title: { es: 'Tienda', en: 'Store' },
      what: { es: 'El escaparate de canje que ven los miembros, con el leaderboard de puntos y el historial de redenciones.', en: 'The redemption storefront members see, with the points leaderboard and redemption history.' },
      usage: { es: 'Vigila qué se canjea y qué no. Si emites muchos puntos y nadie canjea, tus premios no motivan.', en: 'Watch what gets redeemed and what doesn’t. If you issue lots of points and nobody redeems, your rewards don’t motivate.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Tienda de puntos.', en:'Points store.'} },
        { x:17,y:20,w:48,h:44, type:'stat', label:{es:'Vitrina de premios', en:'Reward showcase'}, desc:{es:'Como lo ve el miembro.', en:'As the member sees it.'} },
        { x:68,y:20,w:30,h:44, type:'table', label:{es:'Leaderboard de puntos', en:'Points leaderboard'}, desc:{es:'Quién tiene más.', en:'Who has the most.'} },
        { x:17,y:67,w:81,h:23, type:'table', label:{es:'Historial de canjes', en:'Redemption history'}, desc:{es:'Quién canjeó qué.', en:'Who redeemed what.'} },
      ]
    },
    {
      id: 'ingresos', order: 27, aspect: 'desktop',
      title: { es: 'Ingresos y Sellos', en: 'Revenue & Punch Cards' },
      what: { es: 'Uso de tarjetas de sellos (emitidas, completadas, en progreso) y la economía de puntos por tipo.', en: 'Punch-card usage (issued, completed, in progress) and the points economy by type.' },
      usage: { es: 'La tasa de completado te dice si tus tarjetas de sellos motivan asistencia o si nadie las termina.', en: 'The completion rate tells you whether your punch cards drive attendance or nobody finishes them.' },
      calculates: { es: 'Tasa de completado = tarjetas completadas ÷ tarjetas emitidas × 100. Neto de puntos = emitidos − canjeados.', en: 'Completion rate = completed cards ÷ issued cards × 100. Net points = issued − redeemed.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Ingresos y sellos.', en:'Revenue and stamps.'} },
        { x:17,y:20,w:19,h:14, type:'stat', label:{es:'Resumen de sellos', en:'Stamp summary'}, desc:{es:'Emitidos, completados, tasa.', en:'Issued, completed, rate.'} },
        { x:17,y:37,w:39,h:53, type:'chart', label:{es:'Puntos emitidos vs. canjeados', en:'Points issued vs. redeemed'}, desc:{es:'Por tipo.', en:'By type.'} },
        { x:58,y:37,w:40,h:53, type:'table', label:{es:'Desglose', en:'Breakdown'}, desc:{es:'Por categoría de premio.', en:'By reward category.'} },
      ]
    },
    {
      id: 'referidos', order: 28, aspect: 'desktop',
      title: { es: 'Referidos', en: 'Referrals' },
      what: { es: 'Configura las recompensas de referido (para quien refiere y para el referido) y ve el historial y la conversión.', en: 'Configure referral rewards (referrer and referred) and see the history and conversion.' },
      usage: { es: 'Es tu canal de crecimiento más barato. Una recompensa generosa a ambos lados se paga sola con un solo miembro nuevo.', en: 'It’s your cheapest growth channel. A generous reward on both sides pays for itself with a single new member.' },
      calculates: { es: 'Tasa de conversión = referidos completados ÷ invitados × 100. Se cuenta “completado” cuando la cuenta queda activa.', en: 'Conversion rate = completed referrals ÷ invited × 100. Counts as “completed” when the account becomes active.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Programa de referidos.', en:'Referral program.'} },
        { x:17,y:20,w:35,h:30, type:'card', label:{es:'Recompensas', en:'Rewards'}, desc:{es:'Referidor y referido.', en:'Referrer and referred.'} },
        { x:55,y:20,w:43,h:30, type:'stat', label:{es:'Tasa de conversión', en:'Conversion rate'}, desc:{es:'Completados ÷ invitados.', en:'Completed ÷ invited.'} },
        { x:17,y:53,w:81,h:37, type:'table', label:{es:'Historial', en:'History'}, desc:{es:'Estado por referido.', en:'Status per referral.'} },
      ]
    },
    {
      id: 'entrenadores', order: 29, aspect: 'desktop',
      title: { es: 'Entrenadores', en: 'Trainers' },
      what: { es: 'Gestiona a tus entrenadores y su desempeño: sesiones, PRs de clientes y retención por entrenador.', en: 'Manage your trainers and their performance: sessions, client PRs, and retention per trainer.' },
      usage: { es: 'Compara la retención de clientes entre entrenadores — te dice quién retiene y quién necesita apoyo.', en: 'Compare client retention across trainers — it tells you who retains and who needs support.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:60,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Entrenadores del gimnasio.', en:'Gym trainers.'} },
        { x:80,y:9,w:18,h:8, type:'button', label:{es:'Añadir entrenador', en:'Add trainer'}, desc:{es:'Asigna el rol.', en:'Assigns the role.'} },
        { x:17,y:20,w:81,h:70, type:'table', label:{es:'Lista con desempeño', en:'List with performance'}, desc:{es:'Clientes, sesiones, retención.', en:'Clients, sessions, retention.'} },
      ]
    },
    {
      id: 'moderacion', order: 30, aspect: 'desktop',
      title: { es: 'Moderación', en: 'Moderation' },
      what: { es: 'Contenido reportado (posts, comentarios, mensajes) con flujo aprobar / borrar / restaurar.', en: 'Reported content (posts, comments, messages) with an approve / delete / restore flow.' },
      usage: { es: 'Revísala a diario. Mantener el feed limpio protege la comunidad — un solo post tóxico ahuyenta miembros.', en: 'Check it daily. Keeping the feed clean protects the community — a single toxic post drives members away.' },
      alert: { es: 'La app auto-bloquea contenido de severidad alta antes de publicarse y te avisa. Un SLA de 24 h te envía correo si algo queda sin atender.', en: 'The app auto-blocks high-severity content before it posts and alerts you. A 24h SLA emails you if anything goes unaddressed.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Reportes pendientes.', en:'Pending reports.'} },
        { x:17,y:20,w:81,h:18, type:'card', label:{es:'Contenido reportado', en:'Reported content'}, desc:{es:'Con contexto.', en:'With context.'} },
        { x:60,y:23,w:36,h:6, type:'chip-row', label:{es:'Aprobar / Borrar / Restaurar', en:'Approve / Delete / Restore'}, desc:{es:'Acción de moderación.', en:'Moderation action.'} },
        { x:17,y:41,w:81,h:49, type:'table', label:{es:'Cola de reportes', en:'Report queue'}, desc:{es:'Con reloj de SLA 24 h.', en:'With a 24h SLA clock.'} },
      ]
    },
    {
      id: 'reportes', order: 31, aspect: 'desktop',
      title: { es: 'Reportes', en: 'Reports' },
      what: { es: 'Genera reportes de miembros, ingresos y asistencia, y expórtalos a CSV.', en: 'Generate member, revenue, and attendance reports, and export them to CSV.' },
      usage: { es: 'Úsalo para tu contabilidad o para presentarle números a un socio o inversionista.', en: 'Use it for your bookkeeping or to present numbers to a partner or investor.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Generador de reportes.', en:'Report generator.'} },
        { x:17,y:20,w:35,h:50, type:'card', label:{es:'Tipo y rango', en:'Type & range'}, desc:{es:'Miembros, ingresos, asistencia.', en:'Members, revenue, attendance.'} },
        { x:55,y:20,w:43,h:50, type:'table', label:{es:'Vista previa', en:'Preview'}, desc:{es:'Datos del reporte.', en:'Report data.'} },
        { x:17,y:73,w:81,h:9, type:'button', label:{es:'Exportar CSV', en:'Export CSV'}, desc:{es:'Descarga el archivo.', en:'Downloads the file.'} },
      ]
    },
    {
      id: 'registro', order: 32, aspect: 'desktop',
      title: { es: 'Registro de Acciones', en: 'Audit Log' },
      what: { es: 'El registro de toda acción de admin —invitar, suspender, crear clase, lanzar reto, cambios de ajustes— con quién, qué y cuándo.', en: 'The log of every admin action — invite, suspend, create class, launch challenge, settings changes — with who, what, and when.' },
      usage: { es: 'Tu red de seguridad. Si algo cambió y no sabes quién, aquí está. Útil si tienes más de un admin.', en: 'Your safety net. If something changed and you don’t know who, it’s here. Useful once you have more than one admin.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Registro de acciones.', en:'Action log.'} },
        { x:17,y:20,w:81,h:8, type:'chip-row', label:{es:'Filtros', en:'Filters'}, desc:{es:'Fecha, tipo, admin.', en:'Date, type, admin.'} },
        { x:17,y:31,w:81,h:59, type:'table', label:{es:'Entradas', en:'Entries'}, desc:{es:'Admin, acción, objetivo, hora.', en:'Admin, action, target, time.'} },
      ]
    },
    {
      id: 'pruebas-ab', order: 33, aspect: 'desktop',
      title: { es: 'Pruebas A/B', en: 'A/B Testing' },
      what: { es: 'Prueba variantes de una función o mensaje con dos grupos de miembros y mide cuál rinde mejor.', en: 'Test variants of a feature or message with two member groups and measure which performs better.' },
      usage: { es: 'Función avanzada. Úsala para decidir con datos —por ejemplo, qué mensaje de recuperación convierte más.', en: 'Advanced feature. Use it to decide with data — for instance, which win-back message converts more.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Pruebas activas.', en:'Active tests.'} },
        { x:17,y:20,w:39,h:34, type:'card', label:{es:'Variante A', en:'Variant A'}, desc:{es:'Con su tasa de adopción.', en:'With its adoption rate.'} },
        { x:58,y:20,w:40,h:34, type:'card', label:{es:'Variante B', en:'Variant B'}, desc:{es:'Con su tasa de adopción.', en:'With its adoption rate.'} },
        { x:17,y:57,w:81,h:33, type:'chart', label:{es:'Resultado', en:'Result'}, desc:{es:'Significancia estadística.', en:'Statistical significance.'} },
      ]
    },
    {
      id: 'marca', order: 34, aspect: 'desktop',
      title: { es: 'Marca', en: 'Branding' },
      what: { es: 'Sube tu logo, elige colores (primario + secundario) de 10 paletas y pon el nombre de tu gimnasio.', en: 'Upload your logo, pick colors (primary + secondary) from 10 palettes, and set your gym name.' },
      usage: { es: 'La app entera se re-tiñe con tu marca en tiempo real — para el miembro y el entrenador. Hazlo primero.', en: 'The whole app re-themes to your brand in real time — for members and trainers. Do this first.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Identidad del gimnasio.', en:'Gym identity.'} },
        { x:17,y:20,w:39,h:24, type:'card', label:{es:'Logo', en:'Logo'}, desc:{es:'Súbelo aquí.', en:'Upload it here.'} },
        { x:17,y:47,w:39,h:20, type:'chip-row', label:{es:'Paleta de colores', en:'Color palette'}, desc:{es:'10 presets primario+secundario.', en:'10 primary+secondary presets.'} },
        { x:58,y:20,w:40,h:70, type:'chart', label:{es:'Vista previa en vivo', en:'Live preview'}, desc:{es:'La app con tu marca.', en:'The app with your brand.'} },
      ]
    },
    {
      id: 'ajustes-gimnasio', order: 35, aspect: 'desktop',
      title: { es: 'Ajustes del Gimnasio', en: 'Gym Settings' },
      what: { es: 'Nombre, dirección, teléfono y correo; horario día por día y cierres por feriado; el toggle de QR y el flujo de registro.', en: 'Name, address, phone, and email; day-by-day hours and holiday closures; the QR toggle and registration flow.' },
      usage: { es: 'Los horarios y feriados protegen la racha del miembro en días de cierre — mantenlos al día para no romper rachas injustamente.', en: 'Hours and holidays protect the member’s streak on closure days — keep them current so streaks don’t break unfairly.' },
      elements: [
        { x:0,y:0,w:15,h:100, type:'sidebar', label:{es:'Navegación', en:'Navigation'}, desc:{es:'Todas las secciones.', en:'Every section.'} },
        { x:17,y:9,w:81,h:8, type:'header', label:{es:'Encabezado', en:'Header'}, desc:{es:'Ajustes del gimnasio.', en:'Gym settings.'} },
        { x:17,y:20,w:39,h:32, type:'card', label:{es:'Info del gimnasio', en:'Gym info'}, desc:{es:'Nombre, dirección, contacto.', en:'Name, address, contact.'} },
        { x:58,y:20,w:40,h:32, type:'card', label:{es:'Horario y feriados', en:'Hours & holidays'}, desc:{es:'Protegen la racha.', en:'They protect the streak.'} },
        { x:17,y:55,w:81,h:12, type:'toggle', label:{es:'QR de check-in', en:'QR check-in'}, desc:{es:'Activa el escaneo en la puerta.', en:'Enables door scanning.'} },
        { x:17,y:70,w:81,h:20, type:'card', label:{es:'Flujo de registro', en:'Registration flow'}, desc:{es:'Opciones para nuevos miembros.', en:'Options for new members.'} },
      ]
    },
  ],

  numbers: [
    {
      id: 'churn-score',
      title: { es: 'Puntaje de Cancelación (Churn)', en: 'Churn Score' },
      formula: {
        es: 'riesgo = (riesgoAsistencia + riesgoCompromiso) × multiplicadorAntigüedad\npuntaje = recorta( riesgo + bonoProtector , 0 , 100 )\n\nNiveles:  ≥80 Crítico · 55–79 Alto · 30–54 Medio · &lt;30 Bajo',
        en: 'risk = (attendanceRisk + engagementRisk) × tenureMultiplier\nscore = clamp( risk + protectiveBonus , 0 , 100 )\n\nTiers:  ≥80 Critical · 55–79 High · 30–54 Medium · &lt;30 Low'
      },
      body: {
        es: 'Modelo v3 “asistencia primero”. La asistencia (recencia, frecuencia, tendencia, racha) pesa más que el compromiso en la app; si la asistencia es sana, el compromiso solo no puede pasar de Medio. El multiplicador por antigüedad sube el riesgo alrededor del mes 3 (el valle de churn) y lo baja para miembros de más de un año. Casos especiales: pausado = 0; &lt;14 días o &lt;4 eventos = sin datos; ≥30 días inactivo = latente (95); ≥60 días = cancelado (100).',
        en: 'v3 “attendance-first” model. Attendance (recency, frequency, trend, streak) weighs more than in-app engagement; if attendance is healthy, engagement alone can’t exceed Medium. The tenure multiplier raises risk around month 3 (the churn valley) and lowers it for members over a year. Special cases: paused = 0; &lt;14 days or &lt;4 events = insufficient data; ≥30 days inactive = dormant (95); ≥60 days = churned (100).'
      }
    },
    {
      id: 'retencion',
      title: { es: 'Tasa de Retención', en: 'Retention Rate' },
      formula: {
        es: 'retención = miembros activos establecidos ÷ total establecidos × 100',
        en: 'retention = active established members ÷ total established × 100'
      },
      body: {
        es: 'De los miembros que entraron hace más de 30 días, el porcentaje que registró un entrenamiento completado en los últimos 30 días. Es conductual (basada en actividad real), no en el estatus de la membresía. Excluye miembros importados solo-historial.',
        en: 'Of members who joined more than 30 days ago, the percent who logged a completed workout in the last 30 days. It’s behavioral (based on real activity), not membership status. Excludes history-only imported members.'
      }
    },
    {
      id: 'tasa-activa',
      title: { es: 'Tasa Activa', en: 'Active Rate' },
      formula: { es: 'tasa activa = miembros activos en 30 días ÷ total de miembros × 100', en: 'active rate = members active in 30 days ÷ total members × 100' },
      body: { es: 'El porcentaje de TODOS tus miembros (no solo los establecidos) con al menos un entrenamiento completado en 30 días. Es la KPI de un vistazo en tu panel principal.', en: 'The percent of ALL your members (not just established ones) with at least one completed workout in 30 days. It’s the at-a-glance KPI on your overview.' }
    },
    {
      id: 'entrenos-promedio',
      title: { es: 'Entrenamientos Promedio', en: 'Average Workouts' },
      formula: { es: 'promedio = sesiones completadas (30 días) ÷ total de miembros', en: 'average = completed sessions (30 days) ÷ total members' },
      body: { es: 'Un proxy de frecuencia por miembro: cuántos entrenamientos, en promedio, registra cada miembro al mes. Subir esto suele preceder mejor retención.', en: 'A per-member frequency proxy: how many workouts, on average, each member logs per month. Raising it usually precedes better retention.' }
    },
    {
      id: 'tasa-checkin',
      title: { es: 'Tasa de Check-in', en: 'Check-in Rate' },
      formula: { es: 'tasa = (check-ins promedio por día ÷ total de miembros) × 100', en: 'rate = (average check-ins per day ÷ total members) × 100' },
      body: { es: 'El tráfico del gimnasio: cuántos miembros, en proporción, pisan el gimnasio en un día típico. Distinto de la tasa activa porque cuenta asistencia, no entrenamientos registrados.', en: 'Gym foot traffic: what share of members walk into the gym on a typical day. Different from active rate because it counts attendance, not logged workouts.' }
    },
    {
      id: 'tasa-churn',
      title: { es: 'Tasa de Cancelación', en: 'Churn Rate' },
      formula: { es: 'tasa de churn = 100 − retención', en: 'churn rate = 100 − retention' },
      body: { es: 'El complemento de la retención. Si retienes 62%, tu churn es 38%. Es la cifra que más mueve la aguja de tu negocio: bajar el churn 5 puntos vale más que sumar muchos miembros nuevos.', en: 'The complement of retention. If you retain 62%, your churn is 38%. It’s the figure that most moves your business: cutting churn 5 points is worth more than adding lots of new members.' }
    },
    {
      id: 'nps',
      title: { es: 'NPS (Opinión de Miembros)', en: 'NPS (Member Feedback)' },
      formula: {
        es: 'NPS = (% Promotores − % Detractores) × 100\nPromotor = puntaje ≥4 · Pasivo = 3 · Detractor = ≤2   (rango −100 a +100)',
        en: 'NPS = (% Promoters − % Detractors) × 100\nPromoter = score ≥4 · Passive = 3 · Detractor = ≤2   (range −100 to +100)'
      },
      body: { es: 'Lealtad neta a partir de una encuesta de 1–5. Un NPS que sube anticipa mejor retención; lee siempre los comentarios de los detractores, ahí están tus mejores pistas.', en: 'Net loyalty from a 1–5 survey. A rising NPS precedes better retention; always read the detractor comments, that’s your best signal.' }
    },
    {
      id: 'economia-puntos',
      title: { es: 'Economía de Puntos', en: 'Points Economy' },
      formula: {
        es: 'emitidos = entreno 50 · PR 100 · check-in 20 · racha 10×largo (≤200) · reto 500 · logro 75\nneto = emitidos − canjeados',
        en: 'issued = workout 50 · PR 100 · check-in 20 · streak 10×length (≤200) · challenge 500 · achievement 75\nnet = issued − redeemed'
      },
      body: { es: 'Cómo ganan y gastan puntos tus miembros. Si emites muchos puntos pero casi nadie canjea, tu catálogo de premios no motiva — revísalo.', en: 'How your members earn and spend points. If you issue lots of points but almost nobody redeems, your reward catalog isn’t motivating — revisit it.' }
    },
    {
      id: 'cohorte',
      title: { es: 'Retención por Cohorte', en: 'Cohort Retention' },
      body: { es: 'Agrupa a los miembros por el mes en que entraron y sigue qué porcentaje sigue activo a las 4, 8, 12 y 24 semanas. Revela el valle de churn (casi siempre el mes 3) mejor que cualquier promedio.', en: 'Groups members by the month they joined and tracks what percent stays active at weeks 4, 8, 12, and 24. It reveals the churn valley (usually month 3) better than any average.' }
    },
    {
      id: 'readiness-score',
      title: { es: 'Puntaje de Preparación', en: 'Readiness Score' },
      body: {
        es: 'Promedio ponderado por las series hechas esta semana en cada grupo muscular de un cliente. Va de 0 a 100. ≥80 se considera "fresco", ≥60 "moderado", por debajo de 60 "fatigado". Aparece en el Mapa de Preparación.',
        en: 'A weighted average of sets done this week across a client\'s muscle groups. Ranges 0–100. ≥80 is "fresh," ≥60 is "moderate," below 60 is "fatigued." Shown in the Readiness Map.'
      }
    },
    {
      id: 'adherencia',
      title: { es: 'Adherencia', en: 'Adherence' },
      body: {
        es: 'Sesiones completadas ÷ sesiones agendadas, en un rango de tiempo (semana, mes). Se muestra a nivel de cliente individual y promediada por entrenador.',
        en: 'Completed sessions ÷ scheduled sessions, over a time range (week, month). Shown per individual client and averaged per trainer.'
      }
    },
  ],

  alerts: [
    {
      id: 'churn-risk',
      title: { es: 'Riesgo de Cancelación', en: 'Churn Risk' },
      trigger: { es: 'Un miembro cruza un puntaje de churn de 30 (nivel Medio).', en: 'A member crosses a churn score of 30 (Medium tier).' },
      action: { es: 'Se añade a la cola de la mañana. Abre su ficha, mira las 3 señales que más pesan y lanza el modal de recuperación.', en: 'They’re added to the morning queue. Open their card, read the top 3 signals, and launch the win-back modal.' }
    },
    {
      id: 'low-attendance',
      title: { es: 'Baja Asistencia', en: 'Low Attendance' },
      trigger: { es: 'La asistencia de un miembro cae por debajo de su base (por ejemplo, de 3× a menos de 1× por semana).', en: 'A member’s attendance drops below their baseline (for example, from 3× to under 1× per week).' },
      action: { es: 'Contáctalo desde Riesgo de Cancelación antes de que se enfríe del todo — la asistencia es la señal más temprana.', en: 'Reach out from Churn Risk before they cool off completely — attendance is the earliest signal.' }
    },
    {
      id: 'moderation-flagged',
      title: { es: 'Contenido Reportado', en: 'Content Flagged' },
      trigger: { es: 'Un miembro reporta un post, comentario o mensaje, o el sistema lo auto-bloquea por severidad alta.', en: 'A member reports a post, comment, or message, or the system auto-blocks it for high severity.' },
      action: { es: 'Revísalo en Moderación (aprobar / borrar / restaurar). Un SLA de 24 h te envía un correo si queda sin atender.', en: 'Review it in Moderation (approve / delete / restore). A 24h SLA emails you if it goes unaddressed.' }
    },
    {
      id: 'nps-response',
      title: { es: 'Respuesta de NPS', en: 'NPS Response' },
      trigger: { es: 'Un miembro responde la encuesta de NPS.', en: 'A member submits the NPS survey.' },
      action: { es: 'La página de NPS se actualiza sola. Lee el comentario — si es un detractor, ahí está tu pista para retenerlo.', en: 'The NPS page updates itself. Read the comment — if it’s a detractor, that’s your cue to retain them.' }
    },
    {
      id: 'password-reset',
      title: { es: 'Solicitud de Reset de Contraseña', en: 'Password Reset Request' },
      trigger: { es: 'Un miembro pide restablecer su contraseña desde el login.', en: 'A member requests a password reset from the login.' },
      action: { es: 'Aprueba o niega desde el Panel Principal o la cola de resets. Expira en 24 h — aprobar rápido evita el “no puedo entrar”.', en: 'Approve or deny from Overview or the resets queue. It expires in 24h — approving fast avoids the “I can’t log in.”' }
    },
    {
      id: 'system-alert',
      title: { es: 'Alerta de Sistema', en: 'System Alert' },
      trigger: { es: 'Problemas de estado del sistema (base de datos, funciones, fallo al enviar push).', en: 'System health issues (database, functions, push-delivery failure).' },
      action: { es: 'Aparece en la categoría Sistema de tu bandeja. Normalmente se resuelve solo; si persiste, avisa a soporte.', en: 'Shows in the System category of your inbox. Usually self-resolves; if it persists, contact support.' }
    },
    {
      id: 'new-member',
      title: { es: 'Nuevo Miembro', en: 'New Member' },
      trigger: { es: 'Un miembro reclama una invitación o completa el registro.', en: 'A member claims an invite or completes signup.' },
      action: { es: 'Aparece en el directorio y en el widget de nuevos ingresos. Es el mejor momento para un mensaje de bienvenida.', en: 'Shows in the directory and the new-signups widget. It’s the best moment for a welcome message.' }
    },
    {
      id: 'pr-alert',
      title: { es: 'Alerta de Récord Personal (PR)', en: 'Personal Record (PR) Alert' },
      trigger: {
        es: 'Un set en Sesión en Vivo supera el peso o repeticiones máximas previas del cliente en ese ejercicio.',
        en: "A set in Live Session beats the client's previous max weight or reps on that exercise."
      },
      action: {
        es: 'Felicita al cliente en el momento; considera ajustar el peso objetivo de su próxima rutina.',
        en: "Congratulate the client in the moment; consider adjusting the target weight in their next routine."
      }
    },
    {
      id: 'cliente-riesgo',
      title: { es: 'Cliente en Riesgo', en: 'Client At Risk' },
      trigger: {
        es: 'El cliente lleva 10 o más días sin registrar actividad ni check-in.',
        en: 'The client has gone 10+ days without logging activity or a check-in.'
      },
      action: {
        es: 'Envía un mensaje directo o agenda una llamada de seguimiento antes de que cancele.',
        en: 'Send a direct message or schedule a check-in call before they cancel.'
      }
    },
    {
      id: 'grupo-fatigado',
      title: { es: 'Grupo Muscular Fatigado', en: 'Fatigued Muscle Group' },
      trigger: {
        es: 'Un grupo muscular obtiene un Puntaje de Preparación menor a 60.',
        en: 'A muscle group scores below 60 on the Readiness Score.'
      },
      action: {
        es: 'Evita programar ese grupo en la próxima sesión; prioriza recuperación o trabajo ligero.',
        en: "Avoid programming that group in the next session; prioritize recovery or light work."
      }
    },
  ],

  glossary: [
    { term: { es: 'Adherencia', en: 'Adherence' }, def: { es: 'Sesiones completadas ÷ sesiones agendadas.', en: 'Completed sessions ÷ scheduled sessions.' } },
    { term: { es: 'Racha', en: 'Streak' }, def: { es: 'Días o semanas consecutivas con actividad registrada.', en: 'Consecutive days or weeks with logged activity.' } },
    { term: { es: 'Preparación', en: 'Readiness' }, def: { es: 'Qué tan recuperado está un grupo muscular, de 0 a 100.', en: 'How recovered a muscle group is, 0–100.' } },
    { term: { es: 'PR (Récord Personal)', en: 'PR (Personal Record)' }, def: { es: 'El mejor peso o repeticiones logrado por un cliente en un ejercicio.', en: "A client's best weight or reps achieved on an exercise." } },
    { term: { es: 'Volumen', en: 'Volume' }, def: { es: 'Series × repeticiones × peso, sumado por sesión o semana.', en: 'Sets × reps × weight, summed per session or week.' } },
    { term: { es: 'Riesgo de Cancelación', en: 'Churn Risk' }, def: { es: 'Probabilidad estimada de que un miembro cancele su membresía.', en: 'Estimated likelihood that a member will cancel their membership.' } },
    { term: { es: 'NPS', en: 'NPS' }, def: { es: 'Net Promoter Score: qué tan probable es que un miembro recomiende el gimnasio.', en: 'Net Promoter Score: how likely a member is to recommend the gym.' } },
    { term: { es: 'Check-in', en: 'Check-in' }, def: { es: 'Registro de que un miembro asistió o entrenó en una fecha dada.', en: 'A record that a member attended or trained on a given date.' } },
    { term: { es: 'Retención', en: 'Retention' }, def: { es: 'De los miembros con más de 30 días, el % que siguió entrenando en los últimos 30.', en: 'Of members past 30 days, the % who kept training in the last 30.' } },
    { term: { es: 'Tasa Activa', en: 'Active Rate' }, def: { es: '% de todos los miembros con al menos un entrenamiento en 30 días.', en: '% of all members with at least one workout in 30 days.' } },
    { term: { es: 'Cohorte', en: 'Cohort' }, def: { es: 'Grupo de miembros que entraron el mismo mes; se usa para ver retención en el tiempo.', en: 'A group of members who joined the same month; used to view retention over time.' } },
    { term: { es: 'Valle de Churn', en: 'Churn Valley' }, def: { es: 'El punto (casi siempre el mes 3) donde más miembros cancelan.', en: 'The point (usually month 3) where the most members cancel.' } },
    { term: { es: 'Segmento', en: 'Segment' }, def: { es: 'Cohorte guardada por filtros (estado, riesgo, meta) para campañas dirigidas.', en: 'A saved cohort by filters (status, risk, goal) for targeted campaigns.' } },
    { term: { es: 'Punch card (Tarjeta de sellos)', en: 'Punch card' }, def: { es: 'Tarjeta virtual: cada N check-ins da una recompensa.', en: 'A virtual card: every N check-ins earns a reward.' } },
    { term: { es: 'SLA', en: 'SLA' }, def: { es: 'Tiempo máximo de respuesta; el de moderación es 24 horas.', en: 'Maximum response time; moderation’s is 24 hours.' } },
    { term: { es: 'Sobrecarga Progresiva', en: 'Progressive Overload' }, def: { es: 'El motor que sugiere subir peso o reps con el tiempo para que el miembro progrese.', en: 'The engine that suggests raising weight or reps over time so the member keeps progressing.' } },
    { term: { es: 'RPE', en: 'RPE' }, def: { es: 'Esfuerzo percibido de 1 a 10 que el miembro marca por serie.', en: 'Rate of perceived exertion, 1–10, the member marks per set.' } },
  ],
};
