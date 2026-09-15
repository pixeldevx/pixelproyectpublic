export type WorkflowRouteOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "is_empty"
  | "is_not_empty"
  | "greater_than"
  | "less_than";

export type WorkflowRouteTarget = number | "complete" | null;

export type WorkflowConditionalRoute = {
  id: string;
  fieldId: string;
  fieldLabel?: string;
  operator: WorkflowRouteOperator;
  value?: string;
  targetStepIndex: WorkflowRouteTarget;
  label?: string;
};

export type WorkflowParallelRoute = {
  id: string;
  targetStepIndex: WorkflowRouteTarget;
  label?: string;
};

export const WORKFLOW_TASK_TYPES = ["workflow", "workflow_variable", "state_workflow"] as const;

export type WorkflowTaskType = (typeof WORKFLOW_TASK_TYPES)[number];

export const isWorkflowTaskType = (type: any): type is WorkflowTaskType =>
  WORKFLOW_TASK_TYPES.includes(String(type || "") as WorkflowTaskType);

export const isVariableWorkflowTaskType = (type: any) =>
  String(type || "") === "workflow_variable";

export const isStateWorkflowTaskType = (type: any) =>
  String(type || "") === "state_workflow";

export const getWorkflowTaskTypeLabel = (type: any) => {
  if (isVariableWorkflowTaskType(type)) return "Workflow variable";
  if (isStateWorkflowTaskType(type)) return "Por estado procedimental";
  return "Workflow";
};

/**
 * Leaves a workflow as one strictly ordered procedure. State workflows reuse
 * the complete workflow runtime, but never branch, jump, run in parallel or
 * create more than one execution.
 */
export const normalizeStateWorkflowSteps = <T extends Record<string, any>>(steps: T[] = []): T[] =>
  steps.map((step, index) => ({
    ...step,
    conditionalRoutes: [],
    parallelRoutes: [],
    parallelNextStepIndexes: null,
    parallelTargets: null,
    decisionNodeEnabled: false,
    parallelNodeEnabled: false,
    decisionPosition: null,
    parallelPosition: null,
    disableImplicitLinearRoute: false,
    manualGraphRouting: false,
    defaultNextStepIndex: null,
    defaultNextStepTarget: null,
    finishWorkflowOnComplete: index === steps.length - 1,
  }));

export const isDynamicWorkflowAssignee = (value: any) =>
  String(value || "").toUpperCase() === "DYNAMIC";

export const WORKFLOW_ROUTE_OPERATORS: Array<{
  value: WorkflowRouteOperator;
  label: string;
  needsValue: boolean;
}> = [
  { value: "equals", label: "Igual a", needsValue: true },
  { value: "not_equals", label: "Diferente de", needsValue: true },
  { value: "contains", label: "Contiene", needsValue: true },
  { value: "not_contains", label: "No contiene", needsValue: true },
  { value: "is_empty", label: "Esta vacio", needsValue: false },
  { value: "is_not_empty", label: "No esta vacio", needsValue: false },
  { value: "greater_than", label: "Mayor que", needsValue: true },
  { value: "less_than", label: "Menor que", needsValue: true },
];

export const createWorkflowRouteId = () =>
  `route_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const routeOperatorNeedsValue = (operator?: string) =>
  WORKFLOW_ROUTE_OPERATORS.find((item) => item.value === operator)?.needsValue !== false;

export const getWorkflowStepFormFields = (step: any) =>
  Array.isArray(step?.form?.fields) ? step.form.fields : [];

const normalizeRouteOperator = (value: any): WorkflowRouteOperator => {
  const operator = String(value || "equals") as WorkflowRouteOperator;
  return WORKFLOW_ROUTE_OPERATORS.some((item) => item.value === operator)
    ? operator
    : "equals";
};

const normalizeTarget = (value: any): WorkflowRouteTarget | undefined => {
  if (value === "complete") return "complete";
  if (value === null) return null;
  if (value === undefined || value === "") return undefined;

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

export const normalizeWorkflowRouteTarget = normalizeTarget;

export const normalizeWorkflowRoutes = (routes: any[] = []): WorkflowConditionalRoute[] =>
  routes
    .map((route) => {
      const operator = normalizeRouteOperator(route?.operator);
      const targetStepIndex = normalizeTarget(
        route?.targetStepIndex ??
          route?.target ??
          route?.nextStepIndex ??
          route?.nextStep ??
          route?.targetIndex
      );

      return {
        id: route?.id || createWorkflowRouteId(),
        fieldId: String(route?.fieldId || ""),
        fieldLabel: route?.fieldLabel || "",
        operator,
        value: routeOperatorNeedsValue(operator) ? String(route?.value ?? "") : "",
        targetStepIndex: targetStepIndex ?? null,
        label: route?.label || "",
      };
    })
    .filter((route) => route.fieldId);

export const normalizeWorkflowParallelRoutes = (routes: any[] = []): WorkflowParallelRoute[] =>
  routes
    .map((route) => {
      const rawTarget =
        typeof route === "number" || route === "complete"
          ? route
          : route?.targetStepIndex ??
            route?.target ??
            route?.nextStepIndex ??
            route?.nextStep ??
            route?.targetIndex;

      return {
        id: route?.id || createWorkflowRouteId(),
        targetStepIndex: normalizeTarget(rawTarget) ?? null,
        label: route?.label || "",
      };
    })
    .filter((route) => route.targetStepIndex !== null);

const remapWorkflowRouteTarget = (
  target: any,
  indexMap: Map<number, number>
): WorkflowRouteTarget => {
  const normalized = normalizeTarget(target);
  if (normalized === "complete") return "complete";
  if (normalized === null || normalized === undefined) return null;
  return indexMap.has(normalized) ? indexMap.get(normalized)! : null;
};

export const remapWorkflowStepRouteTargets = <T extends Record<string, any>>(
  steps: T[],
  oldIndexByNewIndex: number[]
): T[] => {
  const indexMap = new Map<number, number>();
  oldIndexByNewIndex.forEach((oldIndex, newIndex) => {
    if (Number.isFinite(oldIndex)) indexMap.set(oldIndex, newIndex);
  });

  return steps.map((step) => {
    const conditionalRoutes = normalizeWorkflowRoutes(step.conditionalRoutes || step.routes || []).map((route) => ({
      ...route,
      targetStepIndex: remapWorkflowRouteTarget(route.targetStepIndex, indexMap),
    }));
    const parallelRoutes = normalizeWorkflowParallelRoutes(
      step.parallelRoutes || step.parallelNextStepIndexes || step.parallelTargets || []
    )
      .map((route) => ({
        ...route,
        targetStepIndex: remapWorkflowRouteTarget(route.targetStepIndex, indexMap),
      }))
      .filter((route) => route.targetStepIndex !== null);
    const defaultNextStepIndex = remapWorkflowRouteTarget(
      step.defaultNextStepIndex ?? step.defaultNextStepTarget,
      indexMap
    );

    return {
      ...step,
      conditionalRoutes,
      parallelRoutes,
      parallelNextStepIndexes: null,
      defaultNextStepIndex,
    };
  });
};

export const normalizeWorkflowParallelTargets = (
  value: any,
  currentIndex: number,
  stepCount: number
): WorkflowParallelRoute[] => {
  const rawRoutes = Array.isArray(value)
    ? value
    : Array.isArray(value?.parallelRoutes)
      ? value.parallelRoutes
      : [];

  return normalizeWorkflowParallelRoutes(
    rawRoutes.map((item: any) =>
      typeof item === "number" || item === "complete"
        ? { targetStepIndex: item }
        : item
    )
  ).filter((route) => {
    const target = targetToRuntimeIndex(route.targetStepIndex, currentIndex, stepCount);
    return typeof target === "number";
  });
};

export const normalizeWorkflowDefaultTarget = (
  value: any,
  currentIndex: number,
  stepCount: number
): WorkflowRouteTarget | undefined => {
  const normalized = normalizeTarget(value);
  if (normalized === undefined) return undefined;
  if (normalized === null) return undefined;
  if (normalized === "complete") return "complete";
  if (normalized === currentIndex) return undefined;
  return normalized >= 0 && normalized < stepCount ? normalized : undefined;
};

const targetToRuntimeIndex = (
  target: WorkflowRouteTarget | undefined,
  currentIndex: number,
  stepCount: number
): number | null | undefined => {
  if (target === undefined) return undefined;
  if (target === null) return undefined;
  if (target === "complete") return null;
  if (target === currentIndex) return undefined;
  return target >= 0 && target < stepCount ? target : undefined;
};

const isEmptyValue = (value: any) => {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim().length === 0;
};

const toComparableText = (value: any) => {
  if (Array.isArray(value)) return value.map((item) => String(item).toLowerCase());
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value ?? "").trim().toLowerCase();
};

export const evaluateWorkflowRoute = (
  route: WorkflowConditionalRoute,
  formData: Record<string, any> = {}
) => {
  const currentValue = formData?.[route.fieldId];
  const expectedValue = String(route.value ?? "").trim().toLowerCase();

  switch (route.operator) {
    case "is_empty":
      return isEmptyValue(currentValue);
    case "is_not_empty":
      return !isEmptyValue(currentValue);
    case "greater_than": {
      const currentNumber = Number(currentValue);
      const expectedNumber = Number(route.value);
      return Number.isFinite(currentNumber) && Number.isFinite(expectedNumber) && currentNumber > expectedNumber;
    }
    case "less_than": {
      const currentNumber = Number(currentValue);
      const expectedNumber = Number(route.value);
      return Number.isFinite(currentNumber) && Number.isFinite(expectedNumber) && currentNumber < expectedNumber;
    }
    case "not_equals": {
      const comparable = toComparableText(currentValue);
      return Array.isArray(comparable)
        ? !comparable.includes(expectedValue)
        : comparable !== expectedValue;
    }
    case "contains": {
      const comparable = toComparableText(currentValue);
      return Array.isArray(comparable)
        ? comparable.some((item) => item.includes(expectedValue))
        : comparable.includes(expectedValue);
    }
    case "not_contains": {
      const comparable = toComparableText(currentValue);
      return Array.isArray(comparable)
        ? !comparable.some((item) => item.includes(expectedValue))
        : !comparable.includes(expectedValue);
    }
    case "equals":
    default: {
      const comparable = toComparableText(currentValue);
      return Array.isArray(comparable)
        ? comparable.includes(expectedValue)
        : comparable === expectedValue;
    }
  }
};

export const resolveWorkflowNextStepIndex = ({
  steps,
  currentIndex,
  formData,
}: {
  steps: any[];
  currentIndex: number;
  formData?: Record<string, any>;
}): number | null => {
  const stepCount = steps.length;
  const currentStep = steps[currentIndex];
  const implicitLinearDisabled = Boolean(
    currentStep?.disableImplicitLinearRoute || currentStep?.manualGraphRouting
  );
  const linearNext = !implicitLinearDisabled && currentIndex < stepCount - 1 ? currentIndex + 1 : null;
  const routes = normalizeWorkflowRoutes(currentStep?.conditionalRoutes || currentStep?.routes || []);

  for (const route of routes) {
    if (!evaluateWorkflowRoute(route, formData || {})) continue;
    const target = targetToRuntimeIndex(route.targetStepIndex, currentIndex, stepCount);
    if (target !== undefined) return target;
  }

  const rawDefaultTarget = currentStep?.defaultNextStepIndex ?? currentStep?.defaultNextStepTarget;
  const hasExplicitDefaultTarget = rawDefaultTarget !== undefined && rawDefaultTarget !== null && rawDefaultTarget !== "";
  const defaultTarget = normalizeWorkflowDefaultTarget(
    hasExplicitDefaultTarget ? rawDefaultTarget : undefined,
    currentIndex,
    stepCount
  );
  const runtimeDefault = targetToRuntimeIndex(defaultTarget, currentIndex, stepCount);

  return runtimeDefault === undefined ? linearNext : runtimeDefault;
};

export const resolveWorkflowNextStepIndexes = ({
  steps,
  currentIndex,
  formData,
}: {
  steps: any[];
  currentIndex: number;
  formData?: Record<string, any>;
}): number[] => {
  const stepCount = steps.length;
  const currentStep = steps[currentIndex];
  if (!currentStep || currentStep?.finishWorkflowOnComplete) return [];

  const primaryTarget = resolveWorkflowNextStepIndex({ steps, currentIndex, formData });
  const targets = new Set<number>();
  if (typeof primaryTarget === "number") targets.add(primaryTarget);

  normalizeWorkflowParallelTargets(
    [
      ...(Array.isArray(currentStep.parallelNextStepIndexes) ? currentStep.parallelNextStepIndexes : []),
      ...(Array.isArray(currentStep.parallelTargets) ? currentStep.parallelTargets : []),
      ...(Array.isArray(currentStep.parallelRoutes) ? currentStep.parallelRoutes : []),
    ],
    currentIndex,
    stepCount
  ).forEach((route) => {
    const target = targetToRuntimeIndex(route.targetStepIndex, currentIndex, stepCount);
    if (typeof target === "number") targets.add(target);
  });

  return Array.from(targets).filter((target) => target !== currentIndex);
};

export const resolveWorkflowInboundStepIndex = ({
  steps,
  currentIndex,
  history = [],
}: {
  steps: any[];
  currentIndex: number;
  history?: any[];
}): number | null => {
  const stepCount = Array.isArray(steps) ? steps.length : 0;
  if (stepCount === 0 || currentIndex < 0 || currentIndex >= stepCount) return null;

  const routedTrail = [...(Array.isArray(history) ? history : [])]
    .reverse()
    .find((entry) => {
      const action = String(entry?.action || "");
      const nextStepIndex = Number(entry?.nextStepIndex);
      const stepIndex = Number(entry?.stepIndex);
      return (
        (action === "approve" || action === "advance") &&
        Number.isFinite(stepIndex) &&
        Number.isFinite(nextStepIndex) &&
        stepIndex >= 0 &&
        stepIndex < stepCount &&
        stepIndex !== currentIndex &&
        nextStepIndex === currentIndex
      );
    });

  if (routedTrail) return Number(routedTrail.stepIndex);

  return null;
};

export const resolveWorkflowPreviousStepIndex = ({
  steps,
  currentIndex,
  history = [],
}: {
  steps: any[];
  currentIndex: number;
  history?: any[];
}): number | null => {
  const stepCount = Array.isArray(steps) ? steps.length : 0;
  if (stepCount === 0 || currentIndex < 0 || currentIndex >= stepCount) return null;

  const inboundStepIndex = resolveWorkflowInboundStepIndex({ steps, currentIndex, history });
  if (inboundStepIndex !== null) return inboundStepIndex;

  if (currentIndex <= 0) return null;

  for (let sourceIndex = currentIndex - 1; sourceIndex >= 0; sourceIndex -= 1) {
    const sourceStep = steps[sourceIndex];
    const sourceWasUsed = String(sourceStep?.status || "") === "listo" || Boolean(sourceStep?.completedAt);
    if (!sourceWasUsed) continue;

    const target = resolveWorkflowNextStepIndex({
      steps,
      currentIndex: sourceIndex,
      formData: sourceStep?.formData || {},
    });
    if (target === currentIndex) return sourceIndex;
  }

  return currentIndex - 1;
};

export const resolveWorkflowQualitySourceStepIndex = ({
  steps,
  currentIndex,
  history = [],
}: {
  steps: any[];
  currentIndex: number;
  history?: any[];
}): number | null => {
  const sourceStepIndex = resolveWorkflowPreviousStepIndex({ steps, currentIndex, history });
  return sourceStepIndex === currentIndex ? null : sourceStepIndex;
};

const ACTIVE_WORKFLOW_STEP_STATUSES = new Set(["en_curso", "reproceso", "detenido", "pending"]);

export const isActiveWorkflowStepStatus = (status: any) =>
  ACTIVE_WORKFLOW_STEP_STATUSES.has(String(status || ""));

export const resolveWorkflowActiveStepIndexes = ({ steps }: { steps: any[] }) =>
  Array.isArray(steps)
    ? steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => isActiveWorkflowStepStatus(step?.status))
        .map(({ index }) => index)
    : [];

export const resolveWorkflowActiveStepIndex = ({
  steps,
  currentIndex = 0,
}: {
  steps: any[];
  currentIndex?: number;
}) => {
  const stepCount = Array.isArray(steps) ? steps.length : 0;
  if (stepCount === 0) return 0;

  const boundedCurrentIndex = Math.min(Math.max(0, Number(currentIndex) || 0), stepCount - 1);
  const explicitActiveIndex = resolveWorkflowActiveStepIndexes({ steps })[0] ?? -1;

  if (explicitActiveIndex !== -1) return explicitActiveIndex;
  if (String(steps[boundedCurrentIndex]?.status || "") !== "listo") return boundedCurrentIndex;

  const firstOpenStepIndex = steps.findIndex((step) => String(step?.status || "") !== "listo");
  return firstOpenStepIndex === -1 ? stepCount - 1 : firstOpenStepIndex;
};

export const getWorkflowTargetLabel = (
  target: WorkflowRouteTarget | undefined,
  steps: any[],
  currentIndex: number,
  fallback = "Siguiente paso"
) => {
  const normalized = normalizeWorkflowDefaultTarget(target, currentIndex, steps.length);
  if (normalized === "complete" || normalized === null) return "Finalizar workflow";
  if (typeof normalized === "number") {
    return `Paso ${normalized + 1}: ${steps[normalized]?.label || "Sin nombre"}`;
  }
  return fallback;
};

export const getWorkflowRouteDescription = (
  route: WorkflowConditionalRoute,
  steps: any[],
  currentIndex: number
) => {
  const operatorLabel =
    WORKFLOW_ROUTE_OPERATORS.find((operator) => operator.value === route.operator)?.label || "Igual a";
  const valueLabel = routeOperatorNeedsValue(route.operator) ? ` "${route.value || "..."}"` : "";
  return `${route.fieldLabel || route.fieldId || "Variable"} ${operatorLabel}${valueLabel} -> ${getWorkflowTargetLabel(
    route.targetStepIndex,
    steps,
    currentIndex,
    "Ruta no valida"
  )}`;
};
