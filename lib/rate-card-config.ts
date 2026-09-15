export type StaticRateCardSource = {
  key: string;
  rateCardId: string;
  unitsToAdd: number;
  autoAddUnits: boolean;
  assigneeMode: "default" | "fixed" | "runtime";
  assignToProfessional: boolean;
  assignedTo: string | null;
  source: "step" | "form";
  itemIndex: number | null;
};

export type RateCardValueType = "currency" | "unit";

export const normalizeDecimalInput = (value: any, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;

  const rawValue = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^\d,.\-]/g, "");

  if (!rawValue || rawValue === "-" || rawValue === "." || rawValue === ",") return fallback;

  const hasComma = rawValue.includes(",");
  const hasDot = rawValue.includes(".");
  let normalizedValue = rawValue;

  if (hasComma && hasDot) {
    const lastComma = rawValue.lastIndexOf(",");
    const lastDot = rawValue.lastIndexOf(".");
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalizedValue = rawValue
      .replace(new RegExp(`\\${thousandsSeparator}`, "g"), "")
      .replace(decimalSeparator, ".");
  } else if (hasComma) {
    normalizedValue = rawValue.replace(",", ".");
  } else if ((rawValue.match(/\./g) || []).length > 1) {
    const parts = rawValue.split(".");
    const looksLikeThousands = parts.slice(1).every((part) => part.length === 3);
    normalizedValue = looksLikeThousands
      ? parts.join("")
      : `${parts.slice(0, -1).join("")}.${parts.at(-1)}`;
  }

  const numberValue = Number(normalizedValue);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

export const normalizeRateCardUnits = (value: any, fallback = 1) => {
  const units = normalizeDecimalInput(value, fallback);
  return Number.isFinite(units) && units >= 0 ? units : fallback;
};

export const isInvalidRateCardUnits = (value: any) => {
  if (value === undefined || value === null || value === "") return true;
  const units = normalizeDecimalInput(value, Number.NaN);
  return !Number.isFinite(units) || units < 0;
};

export const normalizeRateCardValueType = (value: any): RateCardValueType =>
  value === "unit" || value === "measure" || value === "quantity" ? "unit" : "currency";

export const isCurrencyRateCard = (rateCard: any) =>
  normalizeRateCardValueType(rateCard?.rateType || rateCard?.valueType) === "currency";

export const getRateCardIncomeRate = (rateCard: any) =>
  normalizeDecimalInput(rateCard?.incomeRate ?? rateCard?.billingRate ?? rateCard?.rate, 0);

export const getRateCardCostRate = (rateCard: any) =>
  normalizeDecimalInput(rateCard?.costRate ?? rateCard?.unitCost ?? rateCard?.productionCost, 0);

export const getRateCardUnitFactor = (rateCard: any) =>
  normalizeDecimalInput(rateCard?.rate ?? rateCard?.unitFactor ?? 1, 1);

export const getRateCardIncomeValue = (units: any, rateCard: any) =>
  isCurrencyRateCard(rateCard) ? normalizeDecimalInput(units, 0) * getRateCardIncomeRate(rateCard) : 0;

export const getRateCardCostValue = (units: any, rateCard: any) =>
  normalizeDecimalInput(units, 0) * getRateCardCostRate(rateCard);

export const getRateCardOutputValue = (units: any, rateCard: any) =>
  isCurrencyRateCard(rateCard)
    ? getRateCardIncomeValue(units, rateCard)
    : normalizeDecimalInput(units, 0) * getRateCardUnitFactor(rateCard);

export const getRateCardOutputUnit = (rateCard: any) => {
  if (isCurrencyRateCard(rateCard)) return rateCard?.currency || "USD";
  return (
    rateCard?.unitLabel ||
    rateCard?.measureUnit ||
    rateCard?.resultUnit ||
    rateCard?.outputUnit ||
    "unidades"
  );
};

export const formatRateCardNumber = (value: any, maximumFractionDigits = 2) =>
  new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(normalizeDecimalInput(value, 0));

export const formatRateCardUnits = (units: any, rateCard: any, maximumFractionDigits = 2) => {
  const indicator = rateCard?.indicator || rateCard?.inputUnit || "unidades";
  return `${formatRateCardNumber(units, maximumFractionDigits)} ${indicator}`;
};

export const formatRateCardValue = (value: any, rateCard: any, maximumFractionDigits = 2) => {
  const numberValue = normalizeDecimalInput(value, 0);

  if (isCurrencyRateCard(rateCard)) {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: rateCard?.currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits,
    }).format(numberValue);
  }

  return `${formatRateCardNumber(numberValue, maximumFractionDigits)} ${getRateCardOutputUnit(rateCard)}`;
};

export const formatRateCardRate = (rate: any, rateCard: any, maximumFractionDigits = 4) => {
  const indicator = rateCard?.indicator || "unidad";
  if (isCurrencyRateCard(rateCard)) {
    return `${formatRateCardValue(getRateCardIncomeRate({ ...rateCard, rate }), rateCard, maximumFractionDigits)} / ${indicator}`;
  }
  return `${formatRateCardNumber(rate, maximumFractionDigits)} ${getRateCardOutputUnit(rateCard)} / ${indicator}`;
};

const normalizeUnits = (value: any) => normalizeRateCardUnits(value);

const normalizeAutoAddUnits = (value: any) => value !== false;

const normalizeAssignee = (value: any) =>
  typeof value === "string" && value.trim() && value !== "DYNAMIC" ? value.trim() : null;

const normalizeAssigneeMode = (item: any): StaticRateCardSource["assigneeMode"] => {
  if (item?.assigneeMode === "runtime") return "runtime";
  if (item?.assigneeMode === "fixed") return "fixed";
  if (item?.assignToProfessional && normalizeAssignee(item?.assignedTo)) return "fixed";
  return "default";
};

const normalizeAssignToProfessional = (item: any) =>
  normalizeAssigneeMode(item) !== "default";

export const getStaticRateCardAssignee = (
  source: { assigneeMode?: StaticRateCardSource["assigneeMode"] | null; assignedTo?: string | null },
  fallbackAssignee?: string | null,
  runtimeAssignee?: string | null,
) => {
  if (source.assigneeMode === "fixed" && source.assignedTo) return source.assignedTo;
  if (source.assigneeMode === "runtime") return normalizeAssignee(runtimeAssignee) || source.assignedTo || normalizeAssignee(fallbackAssignee);
  return normalizeAssignee(fallbackAssignee);
};

export const getStaticRateCardAssignmentKey = (
  source: {
    rateCardId?: string | null;
    assigneeMode?: StaticRateCardSource["assigneeMode"] | null;
    assignedTo?: string | null;
    key?: string;
    id?: string;
    itemIndex?: number | null;
  },
  fallbackAssignee?: string | null,
  runtimeAssignee?: string | null,
) => {
  const assignedUser = getStaticRateCardAssignee(source, fallbackAssignee, runtimeAssignee);
  const runtimeIdentifier = source.key || source.id || source.itemIndex;
  const pendingRuntimeKey = source.assigneeMode === "runtime"
    ? `runtime:${runtimeIdentifier ?? "pending"}`
    : "unassigned";
  return `${source.rateCardId || ""}::${assignedUser || pendingRuntimeKey}`;
};

export const getStaticRateCardSources = (step: any): StaticRateCardSource[] => {
  const sources: StaticRateCardSource[] = [];

  if (Array.isArray(step?.rateCards) && step.rateCards.length > 0) {
    step.rateCards.forEach((item: any, index: number) => {
      if (!item?.rateCardId) return;
      sources.push({
        key: `step:${item.id || item.rateCardId}:${index}`,
        rateCardId: item.rateCardId,
        unitsToAdd: normalizeUnits(item.unitsToAdd),
        autoAddUnits: normalizeAutoAddUnits(item.autoAddUnits),
        assigneeMode: normalizeAssigneeMode(item),
        assignToProfessional: normalizeAssignToProfessional(item),
        assignedTo: normalizeAssignee(item.assignedTo),
        source: "step",
        itemIndex: index,
      });
    });
  } else if (step?.rateCardId) {
    sources.push({
      key: "step:legacy",
      rateCardId: step.rateCardId,
      unitsToAdd: normalizeUnits(step.unitsToAdd),
      autoAddUnits: normalizeAutoAddUnits(step.autoAddUnits),
      assigneeMode: normalizeAssigneeMode(step),
      assignToProfessional: normalizeAssignToProfessional(step),
      assignedTo: normalizeAssignee(step.assignedTo),
      source: "step",
      itemIndex: null,
    });
  }

  if (Array.isArray(step?.form?.rateCards) && step.form.rateCards.length > 0) {
    step.form.rateCards.forEach((item: any, index: number) => {
      if (!item?.rateCardId) return;
      sources.push({
        key: `form:${item.id || item.rateCardId}:${index}`,
        rateCardId: item.rateCardId,
        unitsToAdd: normalizeUnits(item.unitsToAdd),
        autoAddUnits: normalizeAutoAddUnits(item.autoAddUnits),
        assigneeMode: normalizeAssigneeMode(item),
        assignToProfessional: normalizeAssignToProfessional(item),
        assignedTo: normalizeAssignee(item.assignedTo),
        source: "form",
        itemIndex: index,
      });
    });
  } else if (step?.form?.rateCardId) {
    sources.push({
      key: "form:legacy",
      rateCardId: step.form.rateCardId,
      unitsToAdd: normalizeUnits(step.form.unitsToAdd),
      autoAddUnits: normalizeAutoAddUnits(step.form.autoAddUnits),
      assigneeMode: normalizeAssigneeMode(step.form),
      assignToProfessional: normalizeAssignToProfessional(step.form),
      assignedTo: normalizeAssignee(step.form.assignedTo),
      source: "form",
      itemIndex: null,
    });
  }

  return sources;
};
