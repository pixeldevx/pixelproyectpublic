import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
} from 'pdf-lib';

type ContractorReportSignature = {
  name: string;
  email?: string;
  jobTitle?: string;
  signedAt?: string;
  imageBlob?: Blob;
  imageUrl?: string;
  imageFileName?: string;
};

export type ContractorAccountPdfReport = {
  documentKind: 'chargeAccount' | 'activityReport';
  title: string;
  accountId: string;
  projectName: string;
  status: string;
  generatedAt: string;
  contractor: {
    name: string;
    email?: string;
    jobTitle?: string;
    identificationType?: string;
    identificationNumber?: string;
    phone?: string;
    address?: string;
    city?: string;
  };
  issueDate?: string;
  issueCity?: string;
  concept?: string;
  payer?: {
    name: string;
    taxId: string;
    address?: string;
    city?: string;
  };
  bankAccount?: {
    bankName: string;
    accountType: string;
    accountNumber: string;
    holderName?: string;
    holderDocument?: string;
  };
  periodStart: string;
  periodEnd: string;
  honorariumAmount: number;
  socialSecurityBase: number;
  minimumWage: number;
  estimatedMinimumWages: number;
  activitySummary?: string;
  activities: Array<{
    title: string;
    type: string;
    stepLabel?: string | null;
    groupName?: string;
    status?: string;
    completedAt?: string;
    dueDate?: string;
    timing?: 'on_time' | 'late' | 'without_schedule';
    daysLate?: number;
    description?: string;
    executionDetail?: string;
  }>;
  performance?: {
    selectedCompleted: number;
    completedOnTime: number;
    completedLate: number;
    completedWithoutSchedule: number;
    openOverdue: number;
    alerts: Array<{
      taskTitle: string;
      stepLabel?: string | null;
      kind: 'open_overdue' | 'completed_late';
      dueDate?: string;
      completedAt?: string;
      daysLate: number;
    }>;
  };
  quality?: {
    reviewed: number;
    accepted: number;
    rejected: number;
    acceptedWithObservations?: number;
    cleanAccepted?: number;
    approvalRate?: number | null;
    observationRate?: number | null;
    score: number | null;
    events: Array<{
      taskTitle: string;
      stepLabel?: string | null;
      result?: string;
      causeLabel?: string | null;
      causeLabels?: string[];
      qualityStatus?: string;
      approvedWithObservations?: boolean;
      comment?: string;
      date?: string;
    }>;
  };
  rates?: {
    income: number;
    cost: number;
    margin: number;
    movements: number;
    rows: Array<{
      name: string;
      units: number;
      income: number;
      cost: number;
      margin: number;
      movements: number;
      unitLabel?: string;
    }>;
  };
  productivity?: {
    roleLabel: string;
    peerCount: number;
    rows: Array<{
      name: string;
      unitLabel: string;
      contractorUnits: number;
      peerAverageUnits: number;
      peerTopUnits: number;
      contractorRank: number;
      professionalCount: number;
      deltaVsAveragePct: number | null;
      professionals: Array<{
        name: string;
        units: number;
        isContractor: boolean;
      }>;
    }>;
  };
  supportDocuments?: Array<{
    label: string;
    fileName: string;
    uploadedAt?: string;
  }>;
  approvals?: Array<{
    stage: string;
    actorName?: string;
    actorEmail?: string;
    at: string;
    comment?: string;
    signature?: ContractorReportSignature;
  }>;
  signature?: ContractorReportSignature;
};

type PdfFonts = {
  regular: PDFFont;
  bold: PDFFont;
  oblique: PDFFont;
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 38;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const CONTENT_BOTTOM = 48;

const NAVY = rgb(0.035, 0.055, 0.15);
const INDIGO = rgb(0.31, 0.27, 0.9);
const CYAN = rgb(0.02, 0.52, 0.65);
const TEAL = rgb(0.03, 0.51, 0.43);
const AMBER = rgb(0.85, 0.45, 0.03);
const ROSE = rgb(0.86, 0.13, 0.28);
const SLATE_900 = rgb(0.08, 0.11, 0.18);
const SLATE_700 = rgb(0.22, 0.27, 0.36);
const SLATE_500 = rgb(0.39, 0.45, 0.55);
const SLATE_300 = rgb(0.8, 0.84, 0.89);
const SLATE_200 = rgb(0.88, 0.91, 0.95);
const SLATE_100 = rgb(0.95, 0.97, 0.98);
const WHITE = rgb(1, 1, 1);

const normalizePdfText = (value: unknown) =>
  String(value ?? '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/\u00b7/g, ' - ')
    .replace(/\u2022/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '');

const wrapText = (font: PDFFont, value: unknown, size: number, maxWidth: number) => {
  const text = normalizePdfText(value).trim();
  if (!text) return [''];
  const lines: string[] = [];
  text.split(/\r?\n/).forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = '';
    words.forEach((word) => {
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        if (current) {
          lines.push(current);
          current = '';
        }
        let fragment = '';
        Array.from(word).forEach((character) => {
          const candidate = `${fragment}${character}`;
          if (fragment && font.widthOfTextAtSize(candidate, size) > maxWidth) {
            lines.push(fragment);
            fragment = character;
          } else {
            fragment = candidate;
          }
        });
        current = fragment;
        return;
      }
      const candidate = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) lines.push(current);
  });
  return lines.length > 0 ? lines : [''];
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const formatNumber = (value: number) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(Number(value || 0));

const SPANISH_UNITS = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho',
  'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
];

const integerToSpanishWords = (rawValue: number): string => {
  const value = Math.max(0, Math.floor(Math.abs(rawValue)));
  if (value < 30) return SPANISH_UNITS[value];
  if (value < 100) {
    const tens = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
    const base = tens[Math.floor(value / 10)];
    return value % 10 === 0 ? base : `${base} y ${SPANISH_UNITS[value % 10]}`;
  }
  if (value < 1000) {
    if (value === 100) return 'cien';
    const hundreds = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
    const rest = value % 100;
    return `${hundreds[Math.floor(value / 100)]}${rest ? ` ${integerToSpanishWords(rest)}` : ''}`;
  }
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    const prefix = thousands === 1 ? 'mil' : `${integerToSpanishWords(thousands).replace(/uno$/, 'un')} mil`;
    return `${prefix}${rest ? ` ${integerToSpanishWords(rest)}` : ''}`;
  }
  if (value < 1_000_000_000) {
    const millions = Math.floor(value / 1_000_000);
    const rest = value % 1_000_000;
    const prefix = millions === 1 ? 'un millón' : `${integerToSpanishWords(millions).replace(/uno$/, 'un')} millones`;
    return `${prefix}${rest ? ` ${integerToSpanishWords(rest)}` : ''}`;
  }
  const billions = Math.floor(value / 1_000_000_000);
  const rest = value % 1_000_000_000;
  const prefix = billions === 1 ? 'mil millones' : `${integerToSpanishWords(billions).replace(/uno$/, 'un')} mil millones`;
  return `${prefix}${rest ? ` ${integerToSpanishWords(rest)}` : ''}`;
};

const formatMoneyInWords = (value: number) =>
  `${integerToSpanishWords(Math.round(Number(value || 0))).replace(/uno$/, 'un')} pesos moneda corriente`.toUpperCase();

const formatDate = (value?: unknown) => {
  if (!value) return 'Sin fecha';
  if (value instanceof Date) {
    return value.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  if (typeof (value as any)?.toDate === 'function') {
    return formatDate((value as any).toDate());
  }
  if (typeof value === 'object') {
    const candidate = (value as any).seconds
      ? new Date((value as any).seconds * 1000)
      : (value as any).date || (value as any).value || null;
    if (candidate) return formatDate(candidate);
    return 'Sin fecha';
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(String(value));
  if (Number.isNaN(date.getTime())) return normalizePdfText(value);
  return date.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const fitText = (font: PDFFont, value: unknown, size: number, maxWidth: number) => {
  const text = normalizePdfText(value);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let fitted = text;
  while (fitted.length > 1 && font.widthOfTextAtSize(`${fitted}...`, size) > maxWidth) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted.trimEnd()}...`;
};

const convertImageBlobToPng = async (blob: Blob) => {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar la firma para el PDF.');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('No se pudo convertir la firma.')),
      'image/png'
    );
  });
  return new Uint8Array(await pngBlob.arrayBuffer());
};

const embedSignature = async (
  pdf: PDFDocument,
  signature?: ContractorAccountPdfReport['signature']
): Promise<PDFImage | null> => {
  if (!signature?.imageBlob && !signature?.imageUrl) return null;
  try {
    const blob = signature.imageBlob || await (await fetch(signature.imageUrl || '')).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const fileName = String(signature.imageFileName || signature.imageUrl || '').toLowerCase();
    if (blob.type.includes('png') || fileName.endsWith('.png')) return pdf.embedPng(bytes);
    if (blob.type.includes('jpeg') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return pdf.embedJpg(bytes);
    return pdf.embedPng(await convertImageBlobToPng(blob));
  } catch (error) {
    console.warn('La imagen de firma no pudo incorporarse al informe de cuenta de cobro:', error);
    return null;
  }
};

export const generateContractorAccountPdf = async (report: ContractorAccountPdfReport) => {
  const pdf = await PDFDocument.create();
  const fonts: PdfFonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    oblique: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const signatureImage = await embedSignature(pdf, report.signature);
  const approvalSignatureImages = await Promise.all(
    (report.approvals || []).map((approval) => embedSignature(pdf, approval.signature))
  );

  pdf.setTitle(normalizePdfText(`${report.title} ${report.accountId}`));
  pdf.setSubject('Cuenta de cobro e informe contractual generado por Pixel Project');
  pdf.setAuthor('Pixel Project');
  pdf.setCreator('Pixel Project');

  let page!: PDFPage;
  let y = PAGE_HEIGHT - 42;
  const pages: PDFPage[] = [];

  const addPage = (continuationLabel?: string) => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = PAGE_HEIGHT - 40;
    page.drawText('PIXEL PROJECT', {
      x: MARGIN_X,
      y,
      size: 8,
      font: fonts.bold,
      color: CYAN,
    });
    page.drawText(fitText(fonts.bold, report.projectName, 8, 270), {
      x: PAGE_WIDTH - MARGIN_X - Math.min(270, fonts.bold.widthOfTextAtSize(normalizePdfText(report.projectName), 8)),
      y,
      size: 8,
      font: fonts.bold,
      color: SLATE_500,
    });
    y -= 18;
    if (continuationLabel) {
      page.drawText(fitText(fonts.bold, continuationLabel, 8, CONTENT_WIDTH), {
        x: MARGIN_X,
        y,
        size: 8,
        font: fonts.bold,
        color: SLATE_500,
      });
      y -= 18;
    }
  };

  const ensureSpace = (required: number, continuationLabel?: string) => {
    if (y - required < CONTENT_BOTTOM) addPage(continuationLabel);
  };

  const drawSectionTitle = (number: string, title: string, subtitle?: string) => {
    ensureSpace(subtitle ? 54 : 38, title);
    page.drawCircle({ x: MARGIN_X + 10, y: y - 9, size: 10, color: INDIGO });
    page.drawText(number, {
      x: MARGIN_X + 7,
      y: y - 12,
      size: 8,
      font: fonts.bold,
      color: WHITE,
    });
    page.drawText(normalizePdfText(title), {
      x: MARGIN_X + 28,
      y: y - 13,
      size: 15,
      font: fonts.bold,
      color: NAVY,
    });
    y -= 30;
    if (subtitle) {
      const lines = wrapText(fonts.regular, subtitle, 8.5, CONTENT_WIDTH);
      lines.forEach((line) => {
        page.drawText(line, { x: MARGIN_X, y, size: 8.5, font: fonts.regular, color: SLATE_500 });
        y -= 11;
      });
      y -= 5;
    }
  };

  const drawParagraph = (value: unknown, options?: { bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number }) => {
    const font = options?.bold ? fonts.bold : fonts.regular;
    const indent = options?.indent || 0;
    const lines = wrapText(font, value, 9, CONTENT_WIDTH - indent);
    lines.forEach((line) => {
      ensureSpace(14, 'Continuación del informe');
      page.drawText(line, {
        x: MARGIN_X + indent,
        y,
        size: 9,
        font,
        color: options?.color || SLATE_700,
      });
      y -= 12;
    });
    y -= 3;
  };

  const drawMetricGrid = (metrics: Array<{ label: string; value: string; tone?: 'indigo' | 'teal' | 'amber' | 'rose' }>) => {
    const columns = Math.min(4, metrics.length || 1);
    const gap = 8;
    const width = (CONTENT_WIDTH - gap * (columns - 1)) / columns;
    const rows = Math.ceil(metrics.length / columns);
    ensureSpace(rows * 58 + 8, 'Resumen de indicadores');
    metrics.forEach((metric, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = MARGIN_X + column * (width + gap);
      const top = y - row * 58;
      const tone = metric.tone === 'teal'
        ? TEAL
        : metric.tone === 'amber'
          ? AMBER
          : metric.tone === 'rose'
            ? ROSE
            : INDIGO;
      page.drawRectangle({
        x,
        y: top - 48,
        width,
        height: 48,
        color: SLATE_100,
        borderColor: SLATE_200,
        borderWidth: 0.7,
      });
      page.drawRectangle({ x, y: top - 48, width: 3, height: 48, color: tone });
      page.drawText(fitText(fonts.bold, metric.label.toUpperCase(), 7, width - 16), {
        x: x + 10,
        y: top - 15,
        size: 7,
        font: fonts.bold,
        color: SLATE_500,
      });
      page.drawText(fitText(fonts.bold, metric.value, 13, width - 16), {
        x: x + 10,
        y: top - 36,
        size: 13,
        font: fonts.bold,
        color: tone,
      });
    });
    y -= rows * 58 + 4;
  };

  const drawKeyValues = (rows: Array<{ label: string; value: string }>) => {
    rows.forEach((row) => {
      const valueLines = wrapText(fonts.regular, row.value, 8.5, CONTENT_WIDTH - 170);
      const height = Math.max(25, valueLines.length * 11 + 10);
      ensureSpace(height, 'Datos de la cuenta');
      page.drawRectangle({
        x: MARGIN_X,
        y: y - height,
        width: 155,
        height,
        color: SLATE_100,
        borderColor: SLATE_200,
        borderWidth: 0.6,
      });
      page.drawRectangle({
        x: MARGIN_X + 155,
        y: y - height,
        width: CONTENT_WIDTH - 155,
        height,
        color: WHITE,
        borderColor: SLATE_200,
        borderWidth: 0.6,
      });
      page.drawText(fitText(fonts.bold, row.label.toUpperCase(), 7.2, 139), {
        x: MARGIN_X + 9,
        y: y - 15,
        size: 7.2,
        font: fonts.bold,
        color: SLATE_500,
      });
      valueLines.forEach((line, index) => {
        page.drawText(line, {
          x: MARGIN_X + 164,
          y: y - 15 - index * 11,
          size: 8.5,
          font: fonts.regular,
          color: SLATE_900,
        });
      });
      y -= height;
    });
    y -= 8;
  };

  const drawApprovalSignatures = () => {
    const approvals = report.approvals || [];
    if (approvals.length === 0) {
      drawParagraph('La cuenta aún no registra aprobaciones posteriores a la radicación.');
      return;
    }
    approvals.forEach((approval, index) => {
      const signature = approval.signature;
      const signatureImage = approvalSignatureImages[index];
      const cardHeight = 88;
      ensureSpace(cardHeight + 12, 'Firmas de aprobación');
      page.drawRectangle({
        x: MARGIN_X,
        y: y - cardHeight,
        width: CONTENT_WIDTH,
        height: cardHeight,
        color: SLATE_100,
        borderColor: SLATE_200,
        borderWidth: 0.7,
      });
      page.drawRectangle({
        x: MARGIN_X,
        y: y - cardHeight,
        width: 4,
        height: cardHeight,
        color: signature ? TEAL : AMBER,
      });
      if (signatureImage) {
        const scaled = signatureImage.scale(1);
        const ratio = Math.min(145 / scaled.width, 48 / scaled.height, 1);
        page.drawImage(signatureImage, {
          x: MARGIN_X + 15,
          y: y - 68,
          width: scaled.width * ratio,
          height: scaled.height * ratio,
        });
      } else {
        page.drawText(signature ? 'Firma registrada sin imagen disponible' : 'Aprobación histórica sin imagen de firma', {
          x: MARGIN_X + 15,
          y: y - 46,
          size: 7.6,
          font: fonts.oblique,
          color: signature ? SLATE_500 : AMBER,
        });
      }
      const detailX = MARGIN_X + 184;
      const detailWidth = CONTENT_WIDTH - 198;
      page.drawText(fitText(fonts.bold, approval.stage, 8, detailWidth), {
        x: detailX,
        y: y - 18,
        size: 8,
        font: fonts.bold,
        color: CYAN,
      });
      page.drawText(fitText(fonts.bold, signature?.name || approval.actorName || 'Responsable no identificado', 10, detailWidth), {
        x: detailX,
        y: y - 37,
        size: 10,
        font: fonts.bold,
        color: NAVY,
      });
      page.drawText(fitText(fonts.regular, signature?.jobTitle || 'Aprobador', 8, detailWidth), {
        x: detailX,
        y: y - 53,
        size: 8,
        font: fonts.regular,
        color: SLATE_700,
      });
      page.drawText(fitText(fonts.regular, signature?.email || approval.actorEmail || 'Sin correo registrado', 7.5, detailWidth), {
        x: detailX,
        y: y - 67,
        size: 7.5,
        font: fonts.regular,
        color: SLATE_500,
      });
      page.drawText(normalizePdfText(`Firmado: ${formatDate(signature?.signedAt || approval.at)}`), {
        x: detailX,
        y: y - 80,
        size: 7.2,
        font: fonts.bold,
        color: signature ? TEAL : AMBER,
      });
      y -= cardHeight + 10;
    });
  };

  const drawTable = ({
    headers,
    rows,
    widths,
    continuationLabel,
  }: {
    headers: string[];
    rows: string[][];
    widths: number[];
    continuationLabel: string;
  }) => {
    const drawHeader = () => {
      ensureSpace(50, continuationLabel);
      let x = MARGIN_X;
      headers.forEach((header, index) => {
        page.drawRectangle({
          x,
          y: y - 23,
          width: widths[index],
          height: 23,
          color: NAVY,
        });
        page.drawText(fitText(fonts.bold, header.toUpperCase(), 6.6, widths[index] - 10), {
          x: x + 5,
          y: y - 15,
          size: 6.6,
          font: fonts.bold,
          color: WHITE,
        });
        x += widths[index];
      });
      y -= 23;
    };
    drawHeader();
    rows.forEach((row, rowIndex) => {
      const cellLines = row.map((cell, index) => wrapText(fonts.regular, cell, 7.4, widths[index] - 10));
      const height = Math.max(23, Math.max(...cellLines.map((lines) => lines.length)) * 9.5 + 9);
      if (y - height < CONTENT_BOTTOM) {
        addPage(continuationLabel);
        drawHeader();
      }
      let x = MARGIN_X;
      row.forEach((_cell, index) => {
        page.drawRectangle({
          x,
          y: y - height,
          width: widths[index],
          height,
          color: rowIndex % 2 === 0 ? WHITE : SLATE_100,
          borderColor: SLATE_200,
          borderWidth: 0.45,
        });
        cellLines[index].forEach((line, lineIndex) => {
          page.drawText(line, {
            x: x + 5,
            y: y - 14 - lineIndex * 9.5,
            size: 7.4,
            font: fonts.regular,
            color: SLATE_700,
          });
        });
        x += widths[index];
      });
      y -= height;
    });
    y -= 10;
  };

  const drawActivity = (activity: ContractorAccountPdfReport['activities'][number], index: number) => {
    ensureSpace(72, 'Detalle de actividades ejecutadas');
    const tone = activity.timing === 'late' ? AMBER : activity.timing === 'on_time' ? TEAL : SLATE_500;
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 29,
      width: CONTENT_WIDTH,
      height: 29,
      color: SLATE_100,
      borderColor: SLATE_200,
      borderWidth: 0.6,
    });
    page.drawRectangle({ x: MARGIN_X, y: y - 29, width: 4, height: 29, color: tone });
    page.drawText(fitText(fonts.bold, `${index + 1}. ${activity.title}`, 9.4, CONTENT_WIDTH - 150), {
      x: MARGIN_X + 11,
      y: y - 13,
      size: 9.4,
      font: fonts.bold,
      color: NAVY,
    });
    const timingLabel = activity.timing === 'late'
      ? `Fuera de tiempo (${activity.daysLate || 0} días)`
      : activity.timing === 'on_time'
        ? 'Cierre a tiempo'
        : 'Sin fecha programada';
    page.drawText(fitText(fonts.bold, timingLabel, 7.2, 125), {
      x: PAGE_WIDTH - MARGIN_X - 132,
      y: y - 13,
      size: 7.2,
      font: fonts.bold,
      color: tone,
    });
    page.drawText(fitText(fonts.regular, `${activity.type} - ${activity.groupName || 'Sin grupo'}`, 7.2, CONTENT_WIDTH - 20), {
      x: MARGIN_X + 11,
      y: y - 24,
      size: 7.2,
      font: fonts.regular,
      color: SLATE_500,
    });
    y -= 37;
    drawKeyValues([
      { label: 'Paso / alcance', value: activity.stepLabel || activity.title },
      { label: 'Cronograma', value: `Programada: ${formatDate(activity.dueDate)} | Finalizada: ${formatDate(activity.completedAt)}` },
    ]);
    if (activity.description) {
      drawParagraph('Descripción o alcance', { bold: true, color: SLATE_900 });
      drawParagraph(activity.description);
    }
    drawParagraph('Evidencia de lo realizado', { bold: true, color: SLATE_900 });
    drawParagraph(activity.executionDetail || 'Actividad finalizada en Pixel sin detalle adicional diligenciado.');
    y -= 5;
  };

  const drawProductivityChart = (row: NonNullable<ContractorAccountPdfReport['productivity']>['rows'][number]) => {
    const visibleProfessionals = row.professionals.slice(0, 10);
    const chartHeight = 52 + visibleProfessionals.length * 20;
    ensureSpace(chartHeight, 'Comparativo de productividad');
    page.drawText(fitText(fonts.bold, row.name, 10.5, CONTENT_WIDTH - 110), {
      x: MARGIN_X,
      y,
      size: 10.5,
      font: fonts.bold,
      color: NAVY,
    });
    page.drawText(`#${row.contractorRank} de ${row.professionalCount}`, {
      x: PAGE_WIDTH - MARGIN_X - 60,
      y,
      size: 8.5,
      font: fonts.bold,
      color: INDIGO,
    });
    y -= 16;
    page.drawText(
      normalizePdfText(`Profesional: ${formatNumber(row.contractorUnits)} | Promedio del mismo cargo: ${formatNumber(row.peerAverageUnits)} ${row.unitLabel}`),
      { x: MARGIN_X, y, size: 7.7, font: fonts.regular, color: SLATE_500 }
    );
    y -= 16;
    const maxUnits = Math.max(1, ...visibleProfessionals.map((professional) => professional.units));
    visibleProfessionals.forEach((professional) => {
      const labelWidth = 130;
      const barMaxWidth = CONTENT_WIDTH - labelWidth - 55;
      page.drawText(fitText(fonts.regular, professional.name, 7.5, labelWidth - 5), {
        x: MARGIN_X,
        y,
        size: 7.5,
        font: professional.isContractor ? fonts.bold : fonts.regular,
        color: professional.isContractor ? INDIGO : SLATE_700,
      });
      page.drawRectangle({
        x: MARGIN_X + labelWidth,
        y: y - 2,
        width: barMaxWidth,
        height: 7,
        color: SLATE_200,
      });
      page.drawRectangle({
        x: MARGIN_X + labelWidth,
        y: y - 2,
        width: Math.max(1.5, barMaxWidth * (professional.units / maxUnits)),
        height: 7,
        color: professional.isContractor ? INDIGO : CYAN,
      });
      page.drawText(formatNumber(professional.units), {
        x: PAGE_WIDTH - MARGIN_X - 48,
        y,
        size: 7.5,
        font: professional.isContractor ? fonts.bold : fonts.regular,
        color: professional.isContractor ? INDIGO : SLATE_700,
      });
      y -= 20;
    });
    y -= 9;
  };

  addPage();
  if (report.documentKind === 'chargeAccount') {
    page.drawLine({
      start: { x: MARGIN_X, y: y - 6 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: y - 6 },
      thickness: 2,
      color: CYAN,
    });
    y -= 34;
    const accountTitle = normalizePdfText(`CUENTA DE COBRO No. ${report.accountId}`);
    page.drawText(accountTitle, {
      x: (PAGE_WIDTH - fonts.bold.widthOfTextAtSize(accountTitle, 18)) / 2,
      y,
      size: 18,
      font: fonts.bold,
      color: NAVY,
    });
    y -= 25;
    const issueLine = normalizePdfText(`${report.issueCity || report.contractor.city || 'Ciudad no registrada'}, ${formatDate(report.issueDate || report.generatedAt)}`);
    page.drawText(issueLine, {
      x: (PAGE_WIDTH - fonts.regular.widthOfTextAtSize(issueLine, 9)) / 2,
      y,
      size: 9,
      font: fonts.regular,
      color: SLATE_500,
    });
    y -= 38;
    const payerName = normalizePdfText(report.payer?.name || 'EMPRESA PAGADORA NO CONFIGURADA');
    page.drawText(payerName, {
      x: (PAGE_WIDTH - fonts.bold.widthOfTextAtSize(payerName, 14)) / 2,
      y,
      size: 14,
      font: fonts.bold,
      color: NAVY,
    });
    y -= 19;
    const payerTaxId = normalizePdfText(`NIT ${report.payer?.taxId || 'Sin NIT registrado'}`);
    page.drawText(payerTaxId, {
      x: (PAGE_WIDTH - fonts.bold.widthOfTextAtSize(payerTaxId, 10)) / 2,
      y,
      size: 10,
      font: fonts.bold,
      color: SLATE_700,
    });
    y -= 34;
    const owesLabel = 'DEBE A:';
    page.drawText(owesLabel, {
      x: (PAGE_WIDTH - fonts.bold.widthOfTextAtSize(owesLabel, 10)) / 2,
      y,
      size: 10,
      font: fonts.bold,
      color: SLATE_500,
    });
    y -= 18;
    const contractorName = normalizePdfText(report.contractor.name);
    page.drawText(contractorName, {
      x: (PAGE_WIDTH - fonts.bold.widthOfTextAtSize(contractorName, 13)) / 2,
      y,
      size: 13,
      font: fonts.bold,
      color: NAVY,
    });
    y -= 18;
    const contractorId = normalizePdfText(`${report.contractor.identificationType || 'CC'} ${report.contractor.identificationNumber || 'Sin identificación registrada'}`);
    page.drawText(contractorId, {
      x: (PAGE_WIDTH - fonts.regular.widthOfTextAtSize(contractorId, 10)) / 2,
      y,
      size: 10,
      font: fonts.regular,
      color: SLATE_700,
    });
    y -= 30;
    drawParagraph(
      `Por concepto de ${report.concept || `servicios prestados en el proyecto ${report.projectName} durante el periodo comprendido entre ${formatDate(report.periodStart)} y ${formatDate(report.periodEnd)}`}.`
    );
    drawParagraph(
      `Valor total: ${formatMoney(report.honorariumAmount)} (${formatMoneyInWords(report.honorariumAmount)}).`,
      { bold: true, color: NAVY }
    );
    drawSectionTitle('1', 'Datos del prestador y del pago');
    drawKeyValues([
      { label: 'Prestador', value: `${report.contractor.name} | ${report.contractor.identificationType || 'CC'} ${report.contractor.identificationNumber || 'Sin registrar'}` },
      { label: 'Contacto', value: [report.contractor.address, report.contractor.city, report.contractor.phone, report.contractor.email].filter(Boolean).join(' | ') || 'Sin registrar' },
      { label: 'Empresa pagadora', value: [report.payer?.name, `NIT ${report.payer?.taxId || 'Sin registrar'}`, report.payer?.address, report.payer?.city].filter(Boolean).join(' | ') },
      { label: 'Periodo y proyecto', value: `${formatDate(report.periodStart)} - ${formatDate(report.periodEnd)} | ${report.projectName}` },
      { label: 'Cuenta para pago', value: report.bankAccount ? `${report.bankAccount.bankName} | ${report.bankAccount.accountType} No. ${report.bankAccount.accountNumber} | Titular: ${report.bankAccount.holderName || report.contractor.name}` : 'Sin cuenta bancaria registrada' },
      { label: 'Valor total', value: `${formatMoney(report.honorariumAmount)} | ${formatMoneyInWords(report.honorariumAmount)}` },
    ]);
    drawSectionTitle('2', 'Aprobaciones y firmas verificadas', 'Cada aprobación conserva el responsable, la fecha y la firma registrada en su perfil al momento de aprobar.');
    drawApprovalSignatures();
  } else {
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 104,
      width: CONTENT_WIDTH,
      height: 104,
      color: NAVY,
    });
    page.drawText('INFORME CONTRACTUAL DE ACTIVIDADES', {
      x: MARGIN_X + 20,
      y: y - 31,
      size: 17,
      font: fonts.bold,
      color: WHITE,
    });
    page.drawText(fitText(fonts.regular, report.projectName, 11, CONTENT_WIDTH - 40), {
      x: MARGIN_X + 20,
      y: y - 54,
      size: 11,
      font: fonts.regular,
      color: rgb(0.72, 0.8, 0.91),
    });
    page.drawText(normalizePdfText(`Periodo ${formatDate(report.periodStart)} - ${formatDate(report.periodEnd)}`), {
      x: MARGIN_X + 20,
      y: y - 76,
      size: 9,
      font: fonts.bold,
      color: rgb(0.39, 0.86, 0.82),
    });
    page.drawText(fitText(fonts.bold, report.accountId, 8, 155), {
      x: PAGE_WIDTH - MARGIN_X - 175,
      y: y - 76,
      size: 8,
      font: fonts.bold,
      color: WHITE,
    });
    y -= 126;
    drawMetricGrid([
      { label: 'Honorarios', value: formatMoney(report.honorariumAmount), tone: 'indigo' },
      { label: 'Actividades', value: String(report.activities.length), tone: 'teal' },
      { label: 'Calidad limpia', value: report.quality?.score === null || report.quality?.score === undefined ? 'Sin dato' : `${report.quality.score}%`, tone: report.quality?.rejected ? 'rose' : report.quality?.acceptedWithObservations ? 'amber' : 'teal' },
      { label: 'Alertas', value: String(report.performance?.alerts.length || 0), tone: report.performance?.alerts.length ? 'amber' : 'teal' },
    ]);
    drawSectionTitle('1', 'Identificación y alcance del cobro');
    drawKeyValues([
      { label: 'Contratista', value: report.contractor.name },
      { label: 'Identificación', value: `${report.contractor.identificationType || 'CC'} ${report.contractor.identificationNumber || 'Sin registrar'}` },
      { label: 'Correo', value: report.contractor.email || 'Sin correo registrado' },
      { label: 'Cargo', value: report.contractor.jobTitle || 'Sin cargo configurado' },
      { label: 'Proyecto', value: report.projectName },
      { label: 'Periodo cobrado', value: `${formatDate(report.periodStart)} - ${formatDate(report.periodEnd)}` },
      { label: 'Estado en Pixel', value: report.status },
      { label: 'Honorarios', value: formatMoney(report.honorariumAmount) },
      { label: 'Base de parafiscales (40%)', value: `${formatMoney(report.socialSecurityBase)} | ${report.estimatedMinimumWages} mínimo(s) estimado(s) sobre SMLV ${formatMoney(report.minimumWage)}` },
    ]);
    drawSectionTitle('2', 'Lectura ejecutiva del periodo', 'Síntesis de ejecución, calidad, productividad y señales que requieren revisión antes del pago.');
    const performance = report.performance;
    drawMetricGrid([
      { label: 'Cierres a tiempo', value: String(performance?.completedOnTime || 0), tone: 'teal' },
      { label: 'Cierres tardíos', value: String(performance?.completedLate || 0), tone: performance?.completedLate ? 'amber' : 'teal' },
      { label: 'Vencidas abiertas', value: String(performance?.openOverdue || 0), tone: performance?.openOverdue ? 'rose' : 'teal' },
      { label: 'Sin cronograma', value: String(performance?.completedWithoutSchedule || 0), tone: 'indigo' },
      { label: 'Revisiones calidad', value: String(report.quality?.reviewed || 0), tone: 'indigo' },
      { label: 'Rechazos calidad', value: String(report.quality?.rejected || 0), tone: report.quality?.rejected ? 'rose' : 'teal' },
      { label: 'Calidad con obs.', value: String(report.quality?.acceptedWithObservations || 0), tone: report.quality?.acceptedWithObservations ? 'amber' : 'teal' },
      { label: 'Ingreso rates', value: formatMoney(report.rates?.income || 0), tone: 'teal' },
      { label: 'Margen rates', value: formatMoney(report.rates?.margin || 0), tone: 'indigo' },
    ]);
    if (report.activitySummary) drawParagraph(report.activitySummary);

    const reviewSignals: string[] = [];
    if ((performance?.openOverdue || 0) > 0) reviewSignals.push(`${performance?.openOverdue} actividad(es) permanecen vencidas y abiertas.`);
    if ((performance?.completedLate || 0) > 0) reviewSignals.push(`${performance?.completedLate} actividad(es) fueron cerradas fuera del plazo programado.`);
    if ((report.quality?.acceptedWithObservations || 0) > 0) reviewSignals.push(`${report.quality?.acceptedWithObservations} revisión(es) fueron aprobadas con observaciones de calidad.`);
    if ((report.quality?.rejected || 0) > 0) reviewSignals.push(`${report.quality?.rejected} revisión(es) de calidad resultaron rechazadas.`);
    if ((performance?.completedWithoutSchedule || 0) > 0) reviewSignals.push(`${performance?.completedWithoutSchedule} actividad(es) finalizadas no tenían fecha programada para medir oportunidad.`);
    if ((report.rates?.movements || 0) === 0) reviewSignals.push('No se registraron movimientos de rate cards a nombre del profesional en el periodo.');
    if (reviewSignals.length === 0) reviewSignals.push('No se detectaron alertas de oportunidad, calidad o trazabilidad de rates con la información disponible.');
    drawParagraph('Señales para la decisión administrativa', { bold: true, color: NAVY });
    reviewSignals.forEach((signal) => drawParagraph(`- ${signal}`, { color: signal.startsWith('No se detectaron') ? TEAL : AMBER, indent: 8 }));

    drawSectionTitle('3', 'Detalle de actividades ejecutadas', 'Cada registro muestra el alcance, lo reportado en el paso de Pixel y el cumplimiento frente al cronograma.');
    if (report.activities.length === 0) {
      drawParagraph('No hay actividades relacionadas con esta cuenta de cobro.');
    } else {
      report.activities.forEach(drawActivity);
    }

    drawSectionTitle('4', 'Alertas de oportunidad y vencimiento');
    const alertRows = (performance?.alerts || []).map((alert) => [
      alert.kind === 'open_overdue' ? 'Vencida abierta' : 'Cierre tardío',
      alert.taskTitle,
      alert.stepLabel || 'Sin paso',
      formatDate(alert.dueDate),
      alert.kind === 'open_overdue' ? 'Pendiente' : formatDate(alert.completedAt),
      `${alert.daysLate} día(s)`,
    ]);
    if (alertRows.length > 0) {
      drawTable({
        headers: ['Alerta', 'Actividad', 'Paso', 'Vencía', 'Cierre', 'Desviación'],
        rows: alertRows,
        widths: [72, 138, 90, 78, 78, 76],
        continuationLabel: 'Alertas de oportunidad y vencimiento',
      });
    } else {
      drawParagraph('No se detectaron actividades vencidas abiertas ni cierres fuera de tiempo en el alcance analizado.', { color: TEAL });
    }

    drawSectionTitle('5', 'Informe de calidad del periodo');
    drawMetricGrid([
      { label: 'Revisadas', value: String(report.quality?.reviewed || 0), tone: 'indigo' },
      { label: 'Sin observaciones', value: String(report.quality?.cleanAccepted ?? Math.max(0, (report.quality?.accepted || 0) - (report.quality?.acceptedWithObservations || 0))), tone: 'teal' },
      { label: 'Con observaciones', value: String(report.quality?.acceptedWithObservations || 0), tone: report.quality?.acceptedWithObservations ? 'amber' : 'teal' },
      { label: 'Rechazadas', value: String(report.quality?.rejected || 0), tone: report.quality?.rejected ? 'rose' : 'teal' },
      { label: 'Calidad limpia', value: report.quality?.score === null || report.quality?.score === undefined ? 'Sin dato' : `${report.quality.score}%`, tone: report.quality?.rejected || report.quality?.acceptedWithObservations ? 'amber' : 'teal' },
      { label: 'Tasa de aprobación', value: report.quality?.approvalRate === null || report.quality?.approvalRate === undefined ? 'Sin dato' : `${report.quality.approvalRate}%`, tone: 'indigo' },
    ]);
    const qualityRows = (report.quality?.events || []).map((event) => [
      event.taskTitle,
      event.stepLabel || 'Sin paso',
      event.approvedWithObservations || event.qualityStatus === 'accepted_with_observations'
        ? 'Aprobada con observaciones'
        : event.result === 'accepted' ? 'Aceptada' : event.result === 'rejected' ? 'Rechazada' : event.result || 'Revisada',
      (Array.isArray(event.causeLabels) && event.causeLabels.length > 0 ? event.causeLabels.join(', ') : event.causeLabel) || 'Sin causa',
      formatDate(event.date),
      event.comment || 'Sin comentario',
    ]);
    if (qualityRows.length > 0) {
      drawTable({
        headers: ['Tarea', 'Paso', 'Resultado', 'Causa', 'Fecha', 'Comentario'],
        rows: qualityRows,
        widths: [118, 82, 66, 76, 72, 118],
        continuationLabel: 'Informe de calidad del periodo',
      });
    } else {
      drawParagraph('El contratista no presenta eventos de gestión de calidad registrados en el periodo.');
    }

    drawSectionTitle('6', 'Informe financiero y de rates del periodo');
    drawMetricGrid([
      { label: 'Movimientos', value: String(report.rates?.movements || 0), tone: 'indigo' },
      { label: 'Ingreso', value: formatMoney(report.rates?.income || 0), tone: 'teal' },
      { label: 'Costo', value: formatMoney(report.rates?.cost || 0), tone: 'rose' },
      { label: 'Margen', value: formatMoney(report.rates?.margin || 0), tone: 'indigo' },
    ]);
    const rateRows = (report.rates?.rows || []).map((row) => [
      row.name,
      `${formatNumber(row.units)} ${row.unitLabel || 'unidad'}`,
      String(row.movements),
      formatMoney(row.income),
      formatMoney(row.cost),
      formatMoney(row.margin),
    ]);
    if (rateRows.length > 0) {
      drawTable({
        headers: ['Rate card', 'Producción', 'Mov.', 'Ingreso', 'Costo', 'Margen'],
        rows: rateRows,
        widths: [152, 96, 48, 82, 76, 78],
        continuationLabel: 'Informe financiero y de rates',
      });
    } else {
      drawParagraph('No hay movimientos de rate cards registrados a nombre del contratista en el periodo.');
    }

    ensureSpace(170, 'Comparativo de productividad por cargo');
    drawSectionTitle('7', 'Comparativo de productividad por cargo', `El profesional se compara únicamente con integrantes del proyecto que tienen el cargo "${report.productivity?.roleLabel || 'Sin cargo configurado'}". Los valores corresponden a unidades de producción por rate; no mezclan unidades diferentes.`);
    if ((report.productivity?.rows || []).length > 0) {
      report.productivity?.rows.forEach(drawProductivityChart);
    } else {
      drawParagraph('No hay rates suficientes para construir una comparación de productividad en este periodo.');
    }

    drawSectionTitle('8', 'Trazabilidad documental y de aprobaciones');
    const supportRows = (report.supportDocuments || []).map((document) => [
      document.label,
      document.fileName,
      formatDate(document.uploadedAt),
    ]);
    if (supportRows.length > 0) {
      drawTable({
        headers: ['Documento soporte', 'Archivo', 'Fecha de carga'],
        rows: supportRows,
        widths: [196, 236, 100],
        continuationLabel: 'Trazabilidad documental',
      });
    } else {
      drawParagraph('No se encontraron documentos externos asociados a la cuenta.');
    }
    const approvalRows = (report.approvals || []).map((approval) => [
      approval.stage,
      approval.actorName || 'Sin actor',
      formatDate(approval.at),
      approval.comment || 'Sin observación',
    ]);
    if (approvalRows.length > 0) {
      drawTable({
        headers: ['Etapa', 'Responsable', 'Fecha', 'Observación'],
        rows: approvalRows,
        widths: [118, 142, 86, 186],
        continuationLabel: 'Trazabilidad de aprobaciones',
      });
    } else {
      drawParagraph('La cuenta aún no registra aprobaciones posteriores a la radicación.');
    }
    drawSectionTitle('9', 'Firmas de aprobación', 'Firmas asociadas a las decisiones registradas durante el ciclo de aprobación de la cuenta.');
    drawApprovalSignatures();
  }

  drawSectionTitle(report.documentKind === 'chargeAccount' ? '3' : '10', 'Firma y certificación del contratista');
  ensureSpace(110, 'Firma del contratista');
  page.drawRectangle({
    x: MARGIN_X,
    y: y - 94,
    width: CONTENT_WIDTH,
    height: 94,
    color: SLATE_100,
    borderColor: SLATE_200,
    borderWidth: 0.7,
  });
  if (signatureImage) {
    const scaled = signatureImage.scale(1);
    const maxWidth = 160;
    const maxHeight = 55;
    const ratio = Math.min(maxWidth / scaled.width, maxHeight / scaled.height, 1);
    page.drawImage(signatureImage, {
      x: MARGIN_X + 16,
      y: y - 71,
      width: scaled.width * ratio,
      height: scaled.height * ratio,
    });
  } else {
    page.drawText('Firma registrada en Pixel', {
      x: MARGIN_X + 16,
      y: y - 48,
      size: 9,
      font: fonts.oblique,
      color: SLATE_500,
    });
  }
  page.drawText(fitText(fonts.bold, report.signature?.name || report.contractor.name, 10, 300), {
    x: MARGIN_X + 200,
    y: y - 29,
    size: 10,
    font: fonts.bold,
    color: NAVY,
  });
  page.drawText(fitText(fonts.regular, report.signature?.jobTitle || report.contractor.jobTitle || 'Contratista', 8.3, 300), {
    x: MARGIN_X + 200,
    y: y - 46,
    size: 8.3,
    font: fonts.regular,
    color: SLATE_700,
  });
  page.drawText(fitText(fonts.regular, report.signature?.email || report.contractor.email || '', 8.3, 300), {
    x: MARGIN_X + 200,
    y: y - 62,
    size: 8.3,
    font: fonts.regular,
    color: SLATE_500,
  });
  page.drawText(normalizePdfText(`Firmado: ${formatDate(report.signature?.signedAt)}`), {
    x: MARGIN_X + 200,
    y: y - 78,
    size: 7.7,
    font: fonts.bold,
    color: TEAL,
  });
  y -= 110;
  drawParagraph(
    report.documentKind === 'chargeAccount'
      ? 'Documento generado por Pixel con los datos y firmas registrados al momento de su expedición.'
      : 'Este informe consolida los registros disponibles en Pixel para apoyar la revisión del cumplimiento contractual. Las alertas y comparativos son evidencia de gestión y no sustituyen la validación documental ni la decisión formal de aprobación o pago.',
    { color: SLATE_500 }
  );

  const totalPages = pages.length;
  pages.forEach((target, index) => {
    target.drawLine({
      start: { x: MARGIN_X, y: 31 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: 31 },
      thickness: 0.6,
      color: SLATE_300,
    });
    target.drawText(report.documentKind === 'chargeAccount' ? 'PIXEL PROJECT - CUENTA DE COBRO' : 'PIXEL PROJECT - INFORME CONTRACTUAL', {
      x: MARGIN_X,
      y: 17,
      size: 6.8,
      font: fonts.bold,
      color: SLATE_500,
    });
    const pageLabel = `Página ${index + 1} de ${totalPages}`;
    target.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN_X - fonts.regular.widthOfTextAtSize(pageLabel, 7),
      y: 17,
      size: 7,
      font: fonts.regular,
      color: SLATE_500,
    });
  });

  const bytes = await pdf.save();
  return { bytes };
};
