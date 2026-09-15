export type ActionCandidate = {
  id: string;
  text: string;
  verb: string;
  status?: "open" | "linked" | "ignored";
  linkedTaskId?: string | null;
  linkedTaskTitle?: string | null;
  relationType?: string | null;
  startIndex?: number;
  endIndex?: number;
  matchedText?: string;
  confidence?: "high" | "medium";
  reason?: string;
};

type Segment = {
  text: string;
  startIndex: number;
  endIndex: number;
};

type ActionRule = {
  verb: string;
  pattern: RegExp;
  reason: string;
};

export const ACTION_VERBS = [
  "hacer",
  "realizar",
  "revisar",
  "corregir",
  "validar",
  "aprobar",
  "entregar",
  "enviar",
  "coordinar",
  "documentar",
  "ajustar",
  "verificar",
  "levantar",
  "programar",
  "medir",
  "calificar",
  "crear",
  "actualizar",
  "definir",
  "resolver",
  "analizar",
  "confirmar",
  "preparar",
  "cargar",
  "responder",
  "completar",
  "gestionar",
  "calidad",
] as const;

const ACTION_RULES: ActionRule[] = [
  { verb: "hacer", pattern: /\b(hacer|hag[ao]s?|hagan|haremos|realiz(ar|a|an|amos|ado|ada|ados|adas|acion|aciones|o|aron|ando|ara|aran|e|en)|ejecut(ar|a|an|amos|ado|ada|o|aron|ando|e|en)|desarroll(ar|a|an|amos|ado|ada|o|aron|ando|e|en)|gener(ar|a|an|amos|ado|ada|o|aron|ando|e|en))\b/, reason: "Accion de ejecucion" },
  { verb: "revisar", pattern: /\b(revis(ar|a|an|amos|ado|ada|ados|adas|e|en|ion|iones|o|aron|ando|ara|aran)|mir(ar|a|an|emos|ado|ada|o|aron|ando|e|en)|inspeccion(ar|a|an|ado|ada|o|aron|ando|e|en))\b/, reason: "Revision pendiente" },
  { verb: "corregir", pattern: /\b(correg(ir|imos|ido|ida|idos|idas|ira|iran|iremos|iendo)|corrig(io|ieron|iendo)|corrij(a|an|amos)|subsan(ar|a|an|ado|ada|o|aron|ando|e|en)|arregl(ar|a|an|ado|ada|o|aron|ando|e|en))\b/, reason: "Correccion o ajuste" },
  { verb: "validar", pattern: /\b(valid(ar|a|an|amos|ado|ada|e|en|acion|aciones|o|aron|ando|ara|aran)|verific(ar|a|an|amos|ado|ada|acion|aciones|o|aron|ando|e|en)|comprob(ar|o|aron|ado|ada|emos|ando|e|en))\b/, reason: "Validacion requerida" },
  { verb: "aprobar", pattern: /\b(aprob(ar|a|an|amos|ado|ada|e|en|acion|aciones|o|aron|ando|ara|aran)|aval(ar|a|an|ado|ada|o|aron|ando|e|en)|autorizar|autoriz(ar|a|an|ado|ada|acion|o|aron|ando|e|en))\b/, reason: "Aprobacion requerida" },
  { verb: "entregar", pattern: /\b(entreg(ar|a|an|amos|ado|ada|e|en|o|aron|ando|ara|aran)|radic(ar|a|an|ado|ada|o|aron|ando|e|en)|present(ar|a|an|ado|ada|o|aron|ando|e|en))\b/, reason: "Entrega comprometida" },
  { verb: "enviar", pattern: /\b(envi(ar|a|an|amos|ado|ada|e|en|o|aron|ando|ara|aran)|remit(ir|e|en|ido|ida|io|ieron|iendo)|compart(ir|e|en|ido|ida|io|ieron|iendo))\b/, reason: "Envio o comunicacion" },
  { verb: "coordinar", pattern: /\b(coordin(ar|a|an|amos|ado|ada|e|en|o|aron|ando|ara|aran)|agend(ar|a|an|ado|ada|o|aron|ando|e|en)|program(ar|a|an|amos|ado|ada|e|en|o|aron|ando|ara|aran))\b/, reason: "Coordinacion necesaria" },
  { verb: "documentar", pattern: /\b(document(ar|a|an|amos|ado|ada|e|en|o|aron|ando|ara|aran)|registr(ar|a|an|ado|ada|o|aron|ando|e|en)|soport(ar|a|an|ado|ada|o|aron|ando|e|en)|evidenci(ar|a|an|ado|ada|o|aron|ando|e|en))\b/, reason: "Registro o soporte" },
  { verb: "ajustar", pattern: /\b(ajust(ar|a|an|amos|ado|ada|e|en|o|aron|ando|ara|aran)|modific(ar|a|an|ado|ada|acion|aciones|o|aron|ando|e|en)|actualiz(ar|a|an|amos|ado|ada|e|en|acion|aciones|o|aron|ando|ara|aran))\b/, reason: "Ajuste o actualizacion" },
  { verb: "levantar", pattern: /\b(levant(ar|a|an|amos|ado|ada|e|en)|recolect(ar|a|an|ado|ada)|captur(ar|a|an|ado|ada))\b/, reason: "Levantamiento de informacion" },
  { verb: "medir", pattern: /\b(med(ir|imos|ido|ida|ira|iran)|cuantific(ar|a|an|ado|ada)|contabiliz(ar|a|an|ado|ada))\b/, reason: "Medicion o conteo" },
  { verb: "calificar", pattern: /\b(calific(ar|a|an|amos|ado|ada|e|en)|evalu(ar|a|an|ado|ada|acion|aciones)|rank(e|i)?ar)\b/, reason: "Evaluacion o calificacion" },
  { verb: "crear", pattern: /\b(cre(ar|a|an|amos|ado|ada|e|en|acion|aciones)|configur(ar|a|an|ado|ada)|mont(ar|a|an|ado|ada))\b/, reason: "Creacion o configuracion" },
  { verb: "definir", pattern: /\b(defin(ir|imos|ido|ida|ira|iran|io|ieron|iendo)|acord(ar|amos|ado|ada|aron|o|ando)|decid(ir|imos|ido|ida|ieron|io|iendo)|establec(er|e|en|ido|ida|io|ieron|iendo))\b/, reason: "Decision accionable" },
  { verb: "resolver", pattern: /\b(resolv(er|emos|ido|ida|era|eran)|solucion(ar|a|an|ado|ada)|desbloque(ar|a|an|ado|ada))\b/, reason: "Problema por resolver" },
  { verb: "analizar", pattern: /\b(analiz(ar|a|an|amos|ado|ada|e|en|o|aron|ando|ara|aran)|analisis|estudi(ar|a|an|ado|ada|o|aron|ando|e|en)|diagnostic(ar|a|an|ado|ada|o|aron|ando|e|en))\b/, reason: "Analisis requerido" },
  { verb: "confirmar", pattern: /\b(confirm(ar|a|an|amos|ado|ada|e|en)|ratific(ar|a|an|ado|ada)|validar con)\b/, reason: "Confirmacion pendiente" },
  { verb: "preparar", pattern: /\b(prepar(ar|a|an|amos|ado|ada|e|en)|alist(ar|a|an|ado|ada)|organizar|organiz(ar|a|an|ado|ada))\b/, reason: "Preparacion necesaria" },
  { verb: "cargar", pattern: /\b(carg(ar|a|an|amos|ado|ada|ue|uen)|sub(ir|e|en|ido|ida)|adjunt(ar|a|an|ado|ada))\b/, reason: "Carga de informacion" },
  { verb: "responder", pattern: /\b(respond(er|emos|ido|ida|era|eran)|contest(ar|a|an|ado|ada)|dar respuesta)\b/, reason: "Respuesta pendiente" },
  { verb: "completar", pattern: /\b(complet(ar|a|an|amos|ado|ada|e|en)|finaliz(ar|a|an|ado|ada)|cerr(ar|amos|ado|ada|ar))\b/, reason: "Cierre o completitud" },
  { verb: "gestionar", pattern: /\b(gestion(ar|a|an|amos|ado|ada|e|en)|tramitar|tramit(ar|a|an|ado|ada)|lider(ar|a|an|ado|ada))\b/, reason: "Gestion requerida" },
  { verb: "calidad", pattern: /\b(calidad|devolucion(es)?|rechaz(o|os|ar|ado|ada)|aceptacion(es)?|no conformidad(es)?)\b/, reason: "Evento de calidad" },
];

const ACTION_CONTEXT_PATTERNS = [
  /\b(hay que|toca|deb(e|en|emos|eria|erian)|se debe|se deben|queda pendiente|quedan pendientes|pendiente de|compromiso|compromisos|responsable|responsables)\b/,
  /\b(se acordo|acordamos|se decidio|se definio|se solicito|solicitaron|se requiere|se requieren|es necesario|necesitamos|falta|faltan)\b/,
  /\b(para la proxima|antes de|a mas tardar|por favor|prioridad|bloqueante|riesgo|reproceso)\b/,
];

const DELIVERABLE_PATTERNS = /\b(documento|contrato|propuesta|informe|entregable|archivo|evidencia|link|insumo|matriz|base|correo|acta|cronograma|presupuesto|rate card|plantilla|formulario)\b/;

export const foldText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const normalizeWhitespace = (value: string) => value.trim().replace(/\s+/g, " ");

const trimSegment = (rawText: string, startIndex: number): Segment | null => {
  const leadingWhitespace = rawText.match(/^\s*/)?.[0].length || 0;
  const trailingWhitespace = rawText.match(/\s*$/)?.[0].length || 0;
  let text = rawText.slice(leadingWhitespace, rawText.length - trailingWhitespace);
  let nextStartIndex = startIndex + leadingWhitespace;

  const bulletMatch = text.match(/^(([-*•]+|\d+[.)]|[a-z][.)])\s+)/i);
  if (bulletMatch) {
    text = text.slice(bulletMatch[0].length);
    nextStartIndex += bulletMatch[0].length;
  }

  const normalized = normalizeWhitespace(text);
  if (normalized.length < 8) return null;

  return {
    text: normalized,
    startIndex: nextStartIndex,
    endIndex: nextStartIndex + text.length,
  };
};

const splitIntoSegments = (content: string): Segment[] => {
  const segments: Segment[] = [];
  const segmentPattern = /[^.!?;\n]+[.!?]?/g;
  let match: RegExpExecArray | null;

  while ((match = segmentPattern.exec(content)) !== null) {
    const segment = trimSegment(match[0], match.index);
    if (segment) segments.push(segment);
  }

  return segments;
};

const candidateIdFor = (text: string, startIndex: number, verb: string) =>
  `${startIndex}-${verb}-${foldText(text).replace(/[^a-z0-9]+/g, "-").slice(0, 56)}`;

const findActionRule = (foldedSegment: string) =>
  ACTION_RULES.find((rule) => rule.pattern.test(foldedSegment));

const hasActionContext = (foldedSegment: string) =>
  ACTION_CONTEXT_PATTERNS.some((pattern) => pattern.test(foldedSegment));

const isDeliverableWithoutVerb = (foldedSegment: string) =>
  hasActionContext(foldedSegment) && DELIVERABLE_PATTERNS.test(foldedSegment);

export const detectActionCandidates = (content: string): ActionCandidate[] => {
  const seen = new Set<string>();

  return splitIntoSegments(content).reduce<ActionCandidate[]>((candidates, segment) => {
    const foldedSegment = foldText(segment.text);
    const rule = findActionRule(foldedSegment);
    const contextOnly = !rule && isDeliverableWithoutVerb(foldedSegment);

    if (!rule && !contextOnly) return candidates;

    const verb = rule?.verb || "pendiente";
    const key = foldText(segment.text).replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) return candidates;
    seen.add(key);

    const matchedText = rule ? foldedSegment.match(rule.pattern)?.[0] : undefined;

    candidates.push({
      id: candidateIdFor(segment.text, segment.startIndex, verb),
      text: segment.text,
      verb,
      status: "open",
      startIndex: segment.startIndex,
      endIndex: segment.endIndex,
      matchedText,
      confidence: rule && hasActionContext(foldedSegment) ? "high" : "medium",
      reason: rule?.reason || "Pendiente accionable",
    });

    return candidates;
  }, []);
};

const candidateMergeKey = (candidate: ActionCandidate) =>
  foldText(candidate.text).replace(/[^a-z0-9]+/g, " ").trim();

export const mergeActionCandidates = (
  storedCandidates: ActionCandidate[] = [],
  content: string
): ActionCandidate[] => {
  const freshCandidates = detectActionCandidates(content);
  const storedById = new Map(storedCandidates.map((candidate) => [candidate.id, candidate]));
  const storedByText = new Map(storedCandidates.map((candidate) => [candidateMergeKey(candidate), candidate]));
  const usedStoredIds = new Set<string>();

  const merged: ActionCandidate[] = freshCandidates.map((freshCandidate) => {
    const storedCandidate =
      storedById.get(freshCandidate.id) ||
      storedByText.get(candidateMergeKey(freshCandidate));

    if (storedCandidate) usedStoredIds.add(storedCandidate.id);

    return {
      ...freshCandidate,
      ...(storedCandidate || {}),
      id: storedCandidate?.id || freshCandidate.id,
      text: freshCandidate.text,
      verb: freshCandidate.verb,
      startIndex: freshCandidate.startIndex,
      endIndex: freshCandidate.endIndex,
      matchedText: freshCandidate.matchedText,
      confidence: freshCandidate.confidence,
      reason: freshCandidate.reason,
      status: storedCandidate?.status || freshCandidate.status,
    };
  });

  storedCandidates.forEach((storedCandidate) => {
    if (usedStoredIds.has(storedCandidate.id)) return;
    if (storedCandidate.status === "ignored") return;
    merged.push(storedCandidate);
  });

  return merged.sort((left, right) => (left.startIndex ?? 0) - (right.startIndex ?? 0));
};
