export type SchoolStage = "lactantes" | "maternal" | "prekinder" | "preescolar";
export type ActivityOption = { value: string; label: string; symbol: string };
export type ChoiceActivity = {
  id: string;
  kind: "choice";
  area: string;
  title: string;
  ageLabel: string;
  stages: SchoolStage[];
  prompt: string;
  options: ActivityOption[];
  speakText?: string;
  hint: string;
};
export type DrawingActivity = {
  id: string;
  kind: "drawing";
  area: string;
  title: string;
  ageLabel: string;
  stages: SchoolStage[];
  prompt: string;
  hint: string;
};
export type InteractiveActivity = ChoiceActivity | DrawingActivity;

export const interactiveActivities: InteractiveActivity[] = [
  {
    id: "palabra-cat",
    kind: "choice",
    area: "Lenguajes",
    title: "Escucha y nombra",
    ageLabel: "Con acompañamiento familiar",
    stages: ["lactantes", "maternal", "prekinder", "preescolar"],
    prompt: "Escucha la palabra. ¿Qué animal dice cat?",
    speakText: "cat",
    options: [
      { value: "cat", label: "Gato", symbol: "🐱" },
      { value: "dog", label: "Perro", symbol: "🐶" },
      { value: "bird", label: "Pájaro", symbol: "🐦" },
    ],
    hint: "Repitan la palabra juntos y busquen un objeto o dibujo que empiece con el mismo sonido.",
  },
  {
    id: "semillas-contar",
    kind: "choice",
    area: "Saberes y pensamiento científico",
    title: "Cuenta las semillas",
    ageLabel: "Maternal a preescolar",
    stages: ["maternal", "prekinder", "preescolar"],
    prompt: "¿Cuántas semillas hay en la maceta?",
    options: [
      { value: "2", label: "Dos semillas", symbol: "🌱🌱" },
      { value: "3", label: "Tres semillas", symbol: "🌱🌱🌱" },
      { value: "4", label: "Cuatro semillas", symbol: "🌱🌱🌱🌱" },
    ],
    hint: "Señalen cada semilla una sola vez y cuenten en voz alta.",
  },
  {
    id: "huerto-cuidado",
    kind: "choice",
    area: "Ética, naturaleza y sociedad",
    title: "Cuida el huerto",
    ageLabel: "Para todas las etapas",
    stages: ["lactantes", "maternal", "prekinder", "preescolar"],
    prompt: "La tierra está seca. ¿Qué ayuda a la planta?",
    options: [
      { value: "agua", label: "Regarla con cuidado", symbol: "💧" },
      { value: "arrancar", label: "Arrancar sus hojas", symbol: "🍃" },
      { value: "basura", label: "Dejar basura en la maceta", symbol: "🗑️" },
    ],
    hint: "Después del reto, observen una planta real y hablen de lo que necesita para crecer.",
  },
  {
    id: "equipo-amable",
    kind: "choice",
    area: "De lo humano a lo comunitario",
    title: "Jugamos en equipo",
    ageLabel: "Para todas las etapas",
    stages: ["lactantes", "maternal", "prekinder", "preescolar"],
    prompt: "Una compañera quiere jugar. ¿Qué podemos hacer?",
    options: [
      { value: "invitar", label: "Invitarla a participar", symbol: "🤝" },
      { value: "ignorar", label: "Seguir sin escucharla", symbol: "🙉" },
      { value: "quitar", label: "Quitarle el juguete", symbol: "🧸" },
    ],
    hint: "Cuenten una forma de ayudar a alguien en casa o en la escuela.",
  },
  {
    id: "patron-colores",
    kind: "choice",
    area: "Saberes y pensamiento científico",
    title: "Continúa el patrón",
    ageLabel: "Prekínder y preescolar",
    stages: ["prekinder", "preescolar"],
    prompt: "Mira: rojo, azul, rojo, ___. ¿Qué color sigue?",
    options: [
      { value: "rojo", label: "Rojo", symbol: "🔴" },
      { value: "azul", label: "Azul", symbol: "🔵" },
      { value: "verde", label: "Verde", symbol: "🟢" },
    ],
    hint: "Lean la secuencia en voz alta y señalen cada color mientras la repiten.",
  },
  {
    id: "historia-semilla",
    kind: "choice",
    area: "Lenguajes",
    title: "La historia de una semilla",
    ageLabel: "Maternal a preescolar",
    stages: ["maternal", "prekinder", "preescolar"],
    prompt: "¿Qué aparece primero en la historia de una planta?",
    options: [
      { value: "flor", label: "Una flor", symbol: "🌼" },
      { value: "semilla", label: "Una semilla", symbol: "🌰" },
      { value: "fruta", label: "Una fruta", symbol: "🍎" },
    ],
    hint: "Inventen juntos qué pasa después y cuenten la historia con dibujos o gestos.",
  },
  {
    id: "dibuja-huerto",
    kind: "drawing",
    area: "Creatividad y STEAM",
    title: "Diseña un huerto",
    ageLabel: "Con acompañamiento familiar",
    stages: ["lactantes", "maternal", "prekinder", "preescolar"],
    prompt: "Dibuja una planta y lo que necesita para crecer. El dibujo se guarda en los logros de este alumno.",
    hint: "Pueden dibujar con el dedo en el celular o con el mouse. Un adulto acompaña a los niños más pequeños.",
  },
];

export const stageLabels: Record<SchoolStage, string> = {
  lactantes: "Lactantes",
  maternal: "Maternal",
  prekinder: "Prekínder",
  preescolar: "Preescolar",
};
