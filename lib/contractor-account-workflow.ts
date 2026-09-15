export type ContractorAccountStatus =
  | 'submitted'
  | 'boss_approved'
  | 'operations_approved'
  | 'quality_approved'
  | 'hr_approved'
  | 'accounted'
  | 'paid'
  | 'returned'
  | 'rejected';

export const CONTRACTOR_ACCOUNT_APPROVAL_FIELDS = [
  { key: 'immediateBossId', label: 'Jefe inmediato', detail: 'Primera revisión técnica' },
  { key: 'operationsManagerId', label: 'Gerencia de operaciones', detail: 'Valida el alcance operativo' },
  { key: 'qualityComplianceId', label: 'Calidad y cumplimiento', detail: 'Control documental y de calidad' },
  { key: 'humanTalentId', label: 'Talento humano', detail: 'Revisión contractual' },
  { key: 'accountingId', label: 'Contabilidad', detail: 'Causación y revisión contable' },
  { key: 'administrationId', label: 'Administración y pago', detail: 'Validación final y ejecución del pago' },
] as const;

export type ContractorAccountApprovalConfigKey = typeof CONTRACTOR_ACCOUNT_APPROVAL_FIELDS[number]['key'];
export type ContractorAccountApprovalConfig = Partial<Record<ContractorAccountApprovalConfigKey, string>>;

export const CONTRACTOR_ACCOUNT_ACTIVE_STATUSES: ContractorAccountStatus[] = [
  'submitted',
  'boss_approved',
  'operations_approved',
  'quality_approved',
  'hr_approved',
  'accounted',
  'returned',
];

export const CONTRACTOR_ACCOUNT_STATUS_CONFIG_KEYS: Partial<
  Record<ContractorAccountStatus, ContractorAccountApprovalConfigKey>
> = {
  submitted: 'immediateBossId',
  boss_approved: 'operationsManagerId',
  operations_approved: 'qualityComplianceId',
  quality_approved: 'humanTalentId',
  hr_approved: 'accountingId',
  accounted: 'administrationId',
};

export const CONTRACTOR_ACCOUNT_STAGE_LABELS: Partial<Record<ContractorAccountStatus, string>> = {
  submitted: 'Jefe inmediato',
  boss_approved: 'Gerencia de operaciones',
  operations_approved: 'Calidad y cumplimiento',
  quality_approved: 'Talento humano',
  hr_approved: 'Contabilidad',
  accounted: 'Administración y pago',
  returned: 'Corrección del contratista',
  paid: 'Pagada',
  rejected: 'Rechazada',
};

export const normalizeContractorAccountApprovalConfig = (
  value: unknown,
): Record<ContractorAccountApprovalConfigKey, string> => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    CONTRACTOR_ACCOUNT_APPROVAL_FIELDS.map((field) => [field.key, String(source[field.key] || '').trim()])
  ) as Record<ContractorAccountApprovalConfigKey, string>;
};

export const hasContractorAccountApprovalConfig = (value: unknown) => {
  const normalized = normalizeContractorAccountApprovalConfig(value);
  return CONTRACTOR_ACCOUNT_APPROVAL_FIELDS.some((field) => Boolean(normalized[field.key]));
};

export const resolveContractorAccountApprovalConfig = (
  projectValue: unknown,
  organizationValue?: unknown,
): Record<ContractorAccountApprovalConfigKey, string> => {
  const projectConfig = normalizeContractorAccountApprovalConfig(projectValue);
  const organizationConfig = normalizeContractorAccountApprovalConfig(organizationValue);
  const resolved = Object.fromEntries(
    CONTRACTOR_ACCOUNT_APPROVAL_FIELDS.map((field) => [
      field.key,
      projectConfig[field.key] || organizationConfig[field.key] || '',
    ])
  ) as Record<ContractorAccountApprovalConfigKey, string>;

  // Configuraciones creadas antes de separar Administración de Contabilidad
  // conservan el responsable existente hasta que se seleccione uno nuevo.
  if (!resolved.administrationId) {
    resolved.administrationId = resolved.accountingId;
  }

  return resolved;
};

export const getContractorAccountConfiguredApproverId = (
  config: ContractorAccountApprovalConfig | null | undefined,
  status: ContractorAccountStatus | null | undefined,
) => {
  if (!status) return null;
  const key = CONTRACTOR_ACCOUNT_STATUS_CONFIG_KEYS[status];
  if (!key) return null;
  const directValue = String(config?.[key] || '').trim();
  if (directValue) return directValue;
  if (key === 'administrationId') return String(config?.accountingId || '').trim() || null;
  return null;
};
