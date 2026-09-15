const normalizeTitleToken = (value: any) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getTaskTitle = (task: any, fallback = 'Sin título') =>
  String(task?.title || task?.name || fallback).trim() || fallback;

export const stripExternalWorkflowIdFromTitle = (title: any, externalWorkflowId: any) => {
  const externalId = String(externalWorkflowId || '').trim();
  let cleanTitle = String(title || '').trim().replace(/\s+/g, ' ');
  if (!externalId || !cleanTitle) return cleanTitle;

  const escapedExternalId = escapeRegExp(externalId);
  const prefixPatterns = [
    new RegExp(`^\\[\\s*${escapedExternalId}\\s*\\]\\s*`, 'i'),
    new RegExp(`^${escapedExternalId}\\s*[-–—:]?\\s*`, 'i'),
  ];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = cleanTitle;
    prefixPatterns.forEach((pattern) => {
      cleanTitle = cleanTitle.replace(pattern, '').trim().replace(/\s+/g, ' ');
    });
    if (before === cleanTitle) break;
  }

  return cleanTitle;
};

export const isSameWorkflowTitleToken = (left: any, right: any) =>
  Boolean(left && right && normalizeTitleToken(left) === normalizeTitleToken(right));

export const getTaskDisplayTitle = (task: any, fallback = 'Sin título') => {
  const externalId = String(task?.externalWorkflowId || '').trim();
  if (!externalId) return getTaskTitle(task, fallback);

  const ownTitle = stripExternalWorkflowIdFromTitle(getTaskTitle(task, ''), externalId);
  const contextTitle = stripExternalWorkflowIdFromTitle(
    task?.parentTaskTitle ||
      task?.parentTitle ||
      task?.matrixTaskTitle ||
      task?.originalTitle ||
      '',
    externalId
  );

  const baseTitle =
    ownTitle && !isSameWorkflowTitleToken(ownTitle, externalId)
      ? ownTitle
      : contextTitle && !isSameWorkflowTitleToken(contextTitle, externalId)
        ? contextTitle
        : '';

  if (!baseTitle) return externalId;
  return `[${externalId}] ${baseTitle}`;
};

export const sanitizeTaskTitleForSave = (task: any, title: string) => {
  const externalId = String(task?.externalWorkflowId || '').trim();
  const cleanTitle = String(title || '').trim().replace(/\s+/g, ' ');
  if (!externalId) return cleanTitle;

  const strippedTitle = stripExternalWorkflowIdFromTitle(cleanTitle, externalId);
  return strippedTitle || externalId;
};
