import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
} from 'pdf-lib';

export type UserStoryReportRole = {
  role: string;
  permissions: string[];
  responsibility?: string;
};

export type UserStoryReportCriterion = {
  title?: string;
  category?: string;
  statement?: string;
  given?: string;
  when?: string;
  then?: string;
};

export type UserStoryReportField = {
  section?: string;
  name: string;
  format?: string;
  origin?: string;
  behavior?: string;
  required?: boolean;
  editable?: boolean;
};

export type UserStoryReportChecklistItem = {
  label: string;
  done: boolean;
};

export type UserStoryReportImage = {
  name?: string;
  caption?: string;
  url?: string;
  bytes?: Uint8Array | ArrayBuffer;
  contentType?: string;
};

export type UserStoryPdfReport = {
  projectName: string;
  organizationName?: string;
  code: string;
  title: string;
  status?: string;
  isDraft?: boolean;
  version?: number;
  generatedAt?: string | Date;
  updatedAt?: string | Date;
  updatedBy?: string;
  releaseName?: string;
  epicName?: string;
  submoduleNames?: string[];
  sprintName?: string;
  responsibleNames?: string[];
  narrative: {
    actor?: string;
    wantTo?: string;
    soThat?: string;
    context?: string;
  };
  scope?: {
    included?: string[];
    excluded?: string[];
  };
  roles?: UserStoryReportRole[];
  rolesAndPermissions?: string;
  acceptanceCriteria?: UserStoryReportCriterion[];
  fieldMatrix?: UserStoryReportField[];
  businessRules?: string[];
  integrations?: string[];
  notifications?: string[];
  dependencies?: string[];
  nonFunctionalRequirements?: string[];
  traceabilityReferences?: string[];
  definitionOfReady?: UserStoryReportChecklistItem[];
  definitionOfDone?: UserStoryReportChecklistItem[];
  images?: UserStoryReportImage[];
};

export type GeneratedUserStoryPdf = {
  bytes: Uint8Array;
  fileName: string;
  warnings: string[];
};

type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
  oblique: PDFFont;
};

type TableColumn = {
  label: string;
  width: number;
  align?: 'left' | 'center';
};

type EmbeddedReportImage = {
  image: PDFImage;
  name: string;
  caption: string;
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const CONTENT_TOP = PAGE_HEIGHT - 58;
const CONTENT_BOTTOM = 54;

const NAVY = rgb(0.035, 0.055, 0.12);
const INK = rgb(0.075, 0.1, 0.18);
const SLATE = rgb(0.28, 0.34, 0.43);
const MUTED = rgb(0.46, 0.52, 0.61);
const LINE = rgb(0.84, 0.87, 0.92);
const SURFACE = rgb(0.965, 0.975, 0.99);
const WHITE = rgb(1, 1, 1);
const VIOLET = rgb(0.42, 0.22, 0.95);
const VIOLET_LIGHT = rgb(0.955, 0.94, 1);
const CYAN = rgb(0.02, 0.57, 0.72);
const CYAN_LIGHT = rgb(0.92, 0.98, 0.995);
const GREEN = rgb(0.035, 0.58, 0.4);
const GREEN_LIGHT = rgb(0.92, 0.985, 0.955);
const AMBER = rgb(0.88, 0.46, 0.05);
const AMBER_LIGHT = rgb(1, 0.975, 0.91);

const text = (value: unknown) => String(value ?? '').trim();

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

const fileToken = (value: unknown, fallback: string) =>
  normalizePdfText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || fallback;

const toDate = (value?: string | Date) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (value?: string | Date) => {
  const parsed = toDate(value);
  if (!parsed) return 'Sin fecha';
  return parsed.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const wrapText = (font: PDFFont, value: unknown, size: number, maxWidth: number) => {
  const normalized = normalizePdfText(value).trim();
  if (!normalized) return [''];
  const lines: string[] = [];

  normalized.split(/\r?\n/).forEach((paragraph) => {
    if (!paragraph.trim()) {
      lines.push('');
      return;
    }
    const words = paragraph.trim().split(/\s+/);
    let current = '';
    words.forEach((word) => {
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        if (current) lines.push(current);
        current = '';
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

  return lines.length ? lines : [''];
};

const asArray = (value?: string[]) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

const parseRoles = (report: UserStoryPdfReport): UserStoryReportRole[] => {
  if (Array.isArray(report.roles) && report.roles.length) {
    return report.roles
      .map((role) => ({
        role: text(role.role),
        permissions: asArray(role.permissions),
        responsibility: text(role.responsibility),
      }))
      .filter((role) => role.role || role.permissions.length || role.responsibility);
  }

  return normalizePdfText(report.rolesAndPermissions)
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':');
      if (separator < 0) return { role: 'Rol o actor', permissions: [line] };
      return {
        role: line.slice(0, separator).trim(),
        permissions: [line.slice(separator + 1).trim()].filter(Boolean),
      };
    });
};

const contentTypeFromName = (image: UserStoryReportImage) => {
  const provided = text(image.contentType).toLowerCase();
  if (provided) return provided;
  const name = `${image.name || ''} ${image.url || ''}`.toLowerCase();
  if (/\.png(?:$|[?#])/.test(name)) return 'image/png';
  if (/\.jpe?g(?:$|[?#])/.test(name)) return 'image/jpeg';
  if (/\.webp(?:$|[?#])/.test(name)) return 'image/webp';
  if (/\.gif(?:$|[?#])/.test(name)) return 'image/gif';
  if (/\.bmp(?:$|[?#])/.test(name)) return 'image/bmp';
  if (/\.svg(?:$|[?#])/.test(name)) return 'image/svg+xml';
  if (/\.avif(?:$|[?#])/.test(name)) return 'image/avif';
  return '';
};

const getImageBytes = async (source: UserStoryReportImage) => {
  if (source.bytes instanceof Uint8Array) return source.bytes;
  if (source.bytes instanceof ArrayBuffer) return new Uint8Array(source.bytes);
  if (!source.url) return null;
  const response = await fetch(source.url, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

const convertBrowserImageToPng = async (bytes: Uint8Array, contentType: string) => {
  if (
    typeof window === 'undefined'
    || typeof document === 'undefined'
    || typeof createImageBitmap !== 'function'
  ) return null;

  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], {
    type: contentType || 'application/octet-stream',
  }));
  const maximumDimension = 1_800;
  const scale = Math.min(1, maximumDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close?.();
    return null;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const converted = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return converted ? new Uint8Array(await converted.arrayBuffer()) : null;
};

const embedReportImages = async (
  pdf: PDFDocument,
  sources: UserStoryReportImage[],
  warnings: string[],
) => {
  const embedded: EmbeddedReportImage[] = [];
  for (const [index, source] of sources.entries()) {
    const label = text(source.name) || `Imagen ${index + 1}`;
    try {
      const bytes = await getImageBytes(source);
      if (!bytes?.length) {
        warnings.push(`${label}: no contiene datos de imagen.`);
        continue;
      }
      const hintedType = contentTypeFromName(source);
      const isPng = hintedType === 'image/png' || (bytes[0] === 0x89 && bytes[1] === 0x50);
      const isJpeg = hintedType === 'image/jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8);
      let embeddedImage: PDFImage;
      const optimized = await convertBrowserImageToPng(bytes, hintedType);
      if (optimized) embeddedImage = await pdf.embedPng(optimized);
      else if (isPng) embeddedImage = await pdf.embedPng(bytes);
      else if (isJpeg) embeddedImage = await pdf.embedJpg(bytes);
      else {
        warnings.push(`${label}: el formato no pudo convertirse a una imagen compatible con el PDF.`);
        continue;
      }
      embedded.push({
        image: embeddedImage,
        name: label,
        caption: text(source.caption),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'error desconocido';
      warnings.push(`${label}: no fue posible cargar la imagen (${reason}).`);
    }
  }
  return embedded;
};

export const generateUserStoryPdf = async (report: UserStoryPdfReport): Promise<GeneratedUserStoryPdf> => {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    oblique: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  const warnings: string[] = [];
  const images = await embedReportImages(pdf, report.images || [], warnings);
  const generatedAt = toDate(report.generatedAt) || new Date();
  const title = text(report.title) || 'Historia de usuario sin título';
  const code = text(report.code) || 'HU';
  const fileName = `historia-usuario-${fileToken(code, 'hu')}-${fileToken(title, 'sin-titulo')}.pdf`;

  pdf.setTitle(`${code} - ${title}`);
  pdf.setSubject('Expediente funcional de historia de usuario');
  pdf.setAuthor('Pixel Project');
  pdf.setCreator('Pixel Project');
  pdf.setCreationDate(generatedAt);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = CONTENT_TOP;
  let sectionNumber = 0;

  const addPage = (continuation?: string) => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = CONTENT_TOP;
    if (continuation) {
      page.drawText('PIXEL / PRODUCT DELIVERY', {
        x: MARGIN_X,
        y: PAGE_HEIGHT - 33,
        size: 7,
        font: fonts.bold,
        color: VIOLET,
      });
      const continuationLines = wrapText(fonts.bold, continuation, 8, CONTENT_WIDTH - 175);
      page.drawText(continuationLines[0], {
        x: MARGIN_X + 162,
        y: PAGE_HEIGHT - 34,
        size: 8,
        font: fonts.bold,
        color: MUTED,
      });
      page.drawLine({
        start: { x: MARGIN_X, y: PAGE_HEIGHT - 43 },
        end: { x: PAGE_WIDTH - MARGIN_X, y: PAGE_HEIGHT - 43 },
        thickness: 0.7,
        color: LINE,
      });
    }
  };

  const ensureSpace = (height: number, continuation?: string) => {
    if (y - height < CONTENT_BOTTOM) addPage(continuation);
  };

  const drawParagraph = (
    value: unknown,
    options: {
      font?: PDFFont;
      size?: number;
      lineHeight?: number;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      continuation?: string;
      gapAfter?: number;
    } = {},
  ) => {
    const font = options.font || fonts.regular;
    const size = options.size || 9;
    const lineHeight = options.lineHeight || size + 3.3;
    const indent = options.indent || 0;
    const lines = wrapText(font, value || 'Sin información registrada.', size, CONTENT_WIDTH - indent);
    lines.forEach((line) => {
      ensureSpace(lineHeight + 2, options.continuation);
      page.drawText(line, {
        x: MARGIN_X + indent,
        y,
        size,
        font,
        color: options.color || SLATE,
      });
      y -= lineHeight;
    });
    y -= options.gapAfter ?? 5;
  };

  const drawSectionTitle = (label: string, description?: string) => {
    sectionNumber += 1;
    ensureSpace(description ? 57 : 43, label);
    page.drawRectangle({ x: MARGIN_X, y: y - 24, width: 27, height: 27, color: VIOLET });
    page.drawText(String(sectionNumber).padStart(2, '0'), {
      x: MARGIN_X + 6.5,
      y: y - 14,
      size: 8,
      font: fonts.bold,
      color: WHITE,
    });
    const titleLines = wrapText(fonts.bold, label, 15, CONTENT_WIDTH - 42);
    page.drawText(titleLines[0], {
      x: MARGIN_X + 40,
      y: y - 12,
      size: 15,
      font: fonts.bold,
      color: INK,
    });
    y -= 32;
    if (description) {
      const lines = wrapText(fonts.regular, description, 8, CONTENT_WIDTH - 40);
      lines.forEach((line) => {
        page.drawText(line, { x: MARGIN_X + 40, y, size: 8, font: fonts.regular, color: MUTED });
        y -= 10;
      });
      y -= 4;
    }
  };

  const drawLabelledBlock = (
    label: string,
    value: unknown,
    tone: 'violet' | 'cyan' | 'green' = 'violet',
    continuation?: string,
  ) => {
    const accent = tone === 'cyan' ? CYAN : tone === 'green' ? GREEN : VIOLET;
    const fill = tone === 'cyan' ? CYAN_LIGHT : tone === 'green' ? GREEN_LIGHT : VIOLET_LIGHT;
    const body = text(value) || 'Sin información registrada.';
    const lines = wrapText(fonts.regular, body, 9, CONTENT_WIDTH - 28);
    const height = Math.max(52, 31 + lines.length * 12);
    if (height <= PAGE_HEIGHT - CONTENT_BOTTOM - 75) {
      ensureSpace(height + 8, continuation);
      page.drawRectangle({
        x: MARGIN_X,
        y: y - height,
        width: CONTENT_WIDTH,
        height,
        color: fill,
        borderColor: accent,
        borderWidth: 0.7,
        opacity: 0.72,
      });
      page.drawText(normalizePdfText(label).toUpperCase(), {
        x: MARGIN_X + 13,
        y: y - 17,
        size: 7,
        font: fonts.bold,
        color: accent,
      });
      lines.forEach((line, index) => {
        page.drawText(line, {
          x: MARGIN_X + 13,
          y: y - 36 - index * 12,
          size: 9,
          font: fonts.regular,
          color: INK,
        });
      });
      y -= height + 8;
      return;
    }
    ensureSpace(40, continuation);
    page.drawText(normalizePdfText(label).toUpperCase(), { x: MARGIN_X, y, size: 7, font: fonts.bold, color: accent });
    y -= 15;
    drawParagraph(body, { continuation, gapAfter: 9 });
  };

  const drawList = (
    items: string[] | undefined,
    options: { emptyLabel?: string; tone?: 'violet' | 'cyan' | 'green' | 'amber'; continuation?: string } = {},
  ) => {
    const values = asArray(items);
    if (!values.length) {
      drawParagraph(options.emptyLabel || 'Sin elementos registrados.', {
        font: fonts.oblique,
        size: 8.5,
        color: MUTED,
        continuation: options.continuation,
      });
      return;
    }
    const accent = options.tone === 'cyan'
      ? CYAN
      : options.tone === 'green'
        ? GREEN
        : options.tone === 'amber'
          ? AMBER
          : VIOLET;
    values.forEach((item, index) => {
      const lines = wrapText(fonts.regular, item, 8.8, CONTENT_WIDTH - 31);
      ensureSpace(Math.max(25, lines.length * 11 + 8), options.continuation);
      page.drawRectangle({ x: MARGIN_X, y: y - 15, width: 17, height: 17, color: accent });
      const number = String(index + 1);
      const numberWidth = fonts.bold.widthOfTextAtSize(number, 7);
      page.drawText(number, {
        x: MARGIN_X + (17 - numberWidth) / 2,
        y: y - 10.5,
        size: 7,
        font: fonts.bold,
        color: WHITE,
      });
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: MARGIN_X + 27,
          y: y - 9 - lineIndex * 11,
          size: 8.8,
          font: fonts.regular,
          color: SLATE,
        });
      });
      y -= Math.max(25, lines.length * 11 + 8);
    });
    y -= 3;
  };

  const drawSubheading = (label: string, continuation?: string) => {
    ensureSpace(30, continuation);
    page.drawText(normalizePdfText(label), { x: MARGIN_X, y: y - 10, size: 10.5, font: fonts.bold, color: INK });
    y -= 16;
    page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_WIDTH - MARGIN_X, y }, thickness: 0.65, color: LINE });
    y -= 15;
  };

  const drawTable = (
    columns: TableColumn[],
    rows: string[][],
    continuation: string,
    emptyLabel = 'Sin registros.',
  ) => {
    const headerHeight = 27;
    const fontSize = 7.2;
    const lineHeight = 9.2;
    const padding = 5;
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const scale = CONTENT_WIDTH / totalWidth;
    const actualColumns = columns.map((column) => ({ ...column, width: column.width * scale }));

    const drawHeader = () => {
      ensureSpace(headerHeight + 45, continuation);
      page.drawRectangle({
        x: MARGIN_X,
        y: y - headerHeight,
        width: CONTENT_WIDTH,
        height: headerHeight,
        color: NAVY,
      });
      let x = MARGIN_X;
      actualColumns.forEach((column) => {
        const labelLines = wrapText(fonts.bold, column.label.toUpperCase(), 6.2, column.width - padding * 2).slice(0, 2);
        labelLines.forEach((line, index) => {
          page.drawText(line, {
            x: x + padding,
            y: y - 11 - index * 7.2,
            size: 6.2,
            font: fonts.bold,
            color: WHITE,
          });
        });
        x += column.width;
      });
      y -= headerHeight;
    };

    drawHeader();
    if (!rows.length) {
      page.drawRectangle({ x: MARGIN_X, y: y - 29, width: CONTENT_WIDTH, height: 29, borderColor: LINE, borderWidth: 0.6 });
      page.drawText(normalizePdfText(emptyLabel), { x: MARGIN_X + 7, y: y - 18, size: 8, font: fonts.oblique, color: MUTED });
      y -= 39;
      return;
    }

    rows.forEach((row, rowIndex) => {
      const wrapped = actualColumns.map((column, columnIndex) =>
        wrapText(fonts.regular, row[columnIndex] || '', fontSize, column.width - padding * 2));
      let consumedLines = 0;
      const maxLines = Math.max(...wrapped.map((cell) => cell.length));

      while (consumedLines < maxLines) {
        const availableLines = Math.max(1, Math.floor((y - CONTENT_BOTTOM - padding * 2) / lineHeight));
        if (availableLines < 2) {
          addPage(continuation);
          drawHeader();
          continue;
        }
        const linesInChunk = Math.min(maxLines - consumedLines, availableLines);
        const rowHeight = Math.max(27, linesInChunk * lineHeight + padding * 2);
        page.drawRectangle({
          x: MARGIN_X,
          y: y - rowHeight,
          width: CONTENT_WIDTH,
          height: rowHeight,
          color: rowIndex % 2 === 0 ? WHITE : SURFACE,
          borderColor: LINE,
          borderWidth: 0.5,
        });
        let x = MARGIN_X;
        actualColumns.forEach((column, columnIndex) => {
          const cellLines = wrapped[columnIndex].slice(consumedLines, consumedLines + linesInChunk);
          cellLines.forEach((line, lineIndex) => {
            const lineWidth = fonts.regular.widthOfTextAtSize(line, fontSize);
            const textX = column.align === 'center'
              ? x + Math.max(padding, (column.width - lineWidth) / 2)
              : x + padding;
            page.drawText(line, {
              x: textX,
              y: y - padding - fontSize - lineIndex * lineHeight,
              size: fontSize,
              font: fonts.regular,
              color: SLATE,
            });
          });
          x += column.width;
        });
        y -= rowHeight;
        consumedLines += linesInChunk;
        if (consumedLines < maxLines) {
          addPage(continuation);
          drawHeader();
        }
      }
    });
    y -= 11;
  };

  addPage();
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 196, width: PAGE_WIDTH, height: 196, color: NAVY });
  page.drawRectangle({ x: MARGIN_X, y: PAGE_HEIGHT - 65, width: 47, height: 4, color: CYAN });
  page.drawText('PIXEL / PRODUCT DELIVERY', { x: MARGIN_X, y: PAGE_HEIGHT - 49, size: 8, font: fonts.bold, color: CYAN });
  page.drawText(normalizePdfText(text(report.status) || 'EXPEDIENTE FUNCIONAL').toUpperCase(), {
    x: PAGE_WIDTH - MARGIN_X - 140,
    y: PAGE_HEIGHT - 49,
    size: 7,
    font: fonts.bold,
    color: WHITE,
  });
  page.drawText(normalizePdfText(code), { x: MARGIN_X, y: PAGE_HEIGHT - 91, size: 12, font: fonts.bold, color: CYAN });
  const titleLines = wrapText(fonts.bold, title, 23, CONTENT_WIDTH).slice(0, 3);
  titleLines.forEach((line, index) => {
    page.drawText(line, { x: MARGIN_X, y: PAGE_HEIGHT - 123 - index * 27, size: 23, font: fonts.bold, color: WHITE });
  });
  y = PAGE_HEIGHT - 228;

  if (report.isDraft) {
    page.drawRectangle({
      x: MARGIN_X,
      y: y - 34,
      width: CONTENT_WIDTH,
      height: 34,
      color: AMBER_LIGHT,
      borderColor: AMBER,
      borderWidth: 0.7,
    });
    page.drawText('BORRADOR SIN GUARDAR', {
      x: MARGIN_X + 11,
      y: y - 15,
      size: 8.5,
      font: fonts.bold,
      color: AMBER,
    });
    page.drawText('No corresponde a una versión oficial del expediente.', {
      x: MARGIN_X + 11,
      y: y - 27,
      size: 7.2,
      font: fonts.regular,
      color: SLATE,
    });
    y -= 46;
  }

  const metadata = [
    ['Proyecto', report.projectName],
    ['Organización', report.organizationName || 'Sin organización'],
    ['Release', report.releaseName || 'Sin Release'],
    ['Épica', report.epicName || 'Sin épica'],
    ['Submódulos', asArray(report.submoduleNames).join(', ') || 'Sin submódulo'],
    ['Sprint', report.sprintName || 'Sin planificar'],
    ['Versión', report.isDraft ? 'Sin versión - borrador' : `v${Number(report.version || 0)}`],
    ['Generado', formatDateTime(generatedAt)],
  ];
  const cardGap = 8;
  const cardWidth = (CONTENT_WIDTH - cardGap) / 2;
  metadata.forEach(([label, value], index) => {
    const column = index % 2;
    if (index > 0 && column === 0) y -= 52 + cardGap;
    const x = MARGIN_X + column * (cardWidth + cardGap);
    page.drawRectangle({ x, y: y - 52, width: cardWidth, height: 52, color: SURFACE, borderColor: LINE, borderWidth: 0.6 });
    page.drawText(normalizePdfText(label).toUpperCase(), { x: x + 10, y: y - 15, size: 6.4, font: fonts.bold, color: MUTED });
    const valueLines = wrapText(fonts.bold, value, 9, cardWidth - 20).slice(0, 2);
    valueLines.forEach((line, lineIndex) => {
      page.drawText(line, { x: x + 10, y: y - 33 - lineIndex * 10, size: 9, font: fonts.bold, color: INK });
    });
  });
  y -= 52 + 20;
  const owners = asArray(report.responsibleNames).join(', ') || report.updatedBy || 'Sin responsable asignado';
  drawLabelledBlock('Responsables', owners, 'cyan', 'Ficha de identificación');
  if (report.updatedAt) {
    drawParagraph(`Última actualización: ${formatDateTime(report.updatedAt)}${report.updatedBy ? ` por ${report.updatedBy}` : ''}.`, {
      font: fonts.oblique,
      size: 7.7,
      color: MUTED,
      continuation: 'Ficha de identificación',
    });
  }

  drawSectionTitle('Narrativa de la historia', 'La necesidad se expresa desde el actor, el resultado esperado y el valor que debe producir.');
  drawLabelledBlock('Como', report.narrative?.actor, 'violet', 'Narrativa de la historia');
  drawLabelledBlock('Quiero', report.narrative?.wantTo, 'cyan', 'Narrativa de la historia');
  drawLabelledBlock('Para', report.narrative?.soThat, 'green', 'Narrativa de la historia');
  drawSubheading('Contexto funcional', 'Narrativa de la historia');
  drawParagraph(report.narrative?.context, { continuation: 'Narrativa de la historia', gapAfter: 10 });

  drawSectionTitle('Alcance', 'Límites explícitos para proteger el objetivo de la historia y facilitar su validación.');
  drawSubheading('Incluye', 'Alcance');
  drawList(report.scope?.included, { tone: 'green', continuation: 'Alcance', emptyLabel: 'No se definió alcance incluido.' });
  drawSubheading('No incluye', 'Alcance');
  drawList(report.scope?.excluded, { tone: 'amber', continuation: 'Alcance', emptyLabel: 'No se registraron exclusiones.' });

  drawSectionTitle('Roles y permisos', 'Actores, responsabilidades y límites de actuación dentro de la historia.');
  const roles = parseRoles(report);
  drawTable(
    [
      { label: 'Rol', width: 125 },
      { label: 'Responsabilidad', width: 170 },
      { label: 'Permisos y acciones', width: 233 },
    ],
    roles.map((role) => [role.role, role.responsibility || '-', role.permissions.join('\n') || '-']),
    'Roles y permisos',
    'No se documentaron roles o permisos.',
  );

  drawSectionTitle('Criterios de aceptación', 'Condiciones verificables que determinan si la historia cumple el resultado esperado.');
  const criteria = report.acceptanceCriteria || [];
  if (!criteria.length) {
    drawParagraph('No se registraron criterios de aceptación.', { font: fonts.oblique, color: MUTED, continuation: 'Criterios de aceptación' });
  }
  criteria.forEach((criterion, index) => {
    ensureSpace(54, 'Criterios de aceptación');
    page.drawText(`${String(index + 1).padStart(2, '0')}  ${normalizePdfText(criterion.title || 'Criterio de aceptación')}`, {
      x: MARGIN_X,
      y,
      size: 10,
      font: fonts.bold,
      color: INK,
    });
    if (criterion.category) {
      const category = normalizePdfText(criterion.category).toUpperCase();
      const width = fonts.bold.widthOfTextAtSize(category, 6.2) + 12;
      page.drawRectangle({ x: PAGE_WIDTH - MARGIN_X - width, y: y - 5, width, height: 16, color: VIOLET_LIGHT });
      page.drawText(category, { x: PAGE_WIDTH - MARGIN_X - width + 6, y, size: 6.2, font: fonts.bold, color: VIOLET });
    }
    y -= 17;
    if (text(criterion.statement)) drawParagraph(criterion.statement, { size: 8.6, continuation: 'Criterios de aceptación', gapAfter: 5 });
    if (text(criterion.given)) drawLabelledBlock('Dado', criterion.given, 'violet', 'Criterios de aceptación');
    if (text(criterion.when)) drawLabelledBlock('Cuando', criterion.when, 'cyan', 'Criterios de aceptación');
    if (text(criterion.then)) drawLabelledBlock('Entonces', criterion.then, 'green', 'Criterios de aceptación');
    y -= 4;
  });

  drawSectionTitle('Matriz de campos', 'Definición de entradas, fuentes, comportamiento y permisos de edición.');
  drawTable(
    [
      { label: 'Sección / campo', width: 118 },
      { label: 'Formato', width: 78 },
      { label: 'Origen', width: 85 },
      { label: 'Comportamiento', width: 189 },
      { label: 'Control', width: 58, align: 'center' },
    ],
    (report.fieldMatrix || []).map((field) => [
      `${text(field.section) || 'General'}\n${text(field.name) || 'Campo sin nombre'}`,
      text(field.format) || '-',
      text(field.origin) || '-',
      text(field.behavior) || '-',
      `${field.required ? 'Requerido' : 'Opcional'}\n${field.editable === false ? 'Solo lectura' : 'Editable'}`,
    ]),
    'Matriz de campos',
    'No se documentaron campos.',
  );

  drawSectionTitle('Reglas, integraciones y calidad', 'Restricciones de negocio y condiciones técnicas que completan la especificación.');
  const groupedLists: Array<{ label: string; values?: string[]; tone: 'violet' | 'cyan' | 'green' | 'amber' }> = [
    { label: 'Reglas de negocio', values: report.businessRules, tone: 'violet' },
    { label: 'Integraciones', values: report.integrations, tone: 'cyan' },
    { label: 'Notificaciones', values: report.notifications, tone: 'green' },
    { label: 'Dependencias', values: report.dependencies, tone: 'amber' },
    { label: 'Requisitos no funcionales', values: report.nonFunctionalRequirements, tone: 'violet' },
    { label: 'Trazabilidad y referencias', values: report.traceabilityReferences, tone: 'cyan' },
  ];
  groupedLists.forEach((group) => {
    drawSubheading(group.label, 'Reglas, integraciones y calidad');
    drawList(group.values, { tone: group.tone, continuation: 'Reglas, integraciones y calidad' });
  });

  drawSectionTitle('Preparación y cierre', 'Listas de control comunes para iniciar con claridad y terminar con evidencia.');
  const drawChecklist = (label: string, items: UserStoryReportChecklistItem[] | undefined) => {
    drawSubheading(label, 'Preparación y cierre');
    const values = Array.isArray(items) ? items : [];
    if (!values.length) {
      drawParagraph('Sin verificaciones registradas.', { font: fonts.oblique, color: MUTED, continuation: 'Preparación y cierre' });
      return;
    }
    values.forEach((item) => {
      const lines = wrapText(fonts.regular, item.label, 8.8, CONTENT_WIDTH - 32);
      ensureSpace(Math.max(24, lines.length * 11 + 7), 'Preparación y cierre');
      page.drawRectangle({
        x: MARGIN_X,
        y: y - 15,
        width: 16,
        height: 16,
        borderColor: item.done ? GREEN : MUTED,
        borderWidth: 1,
        color: item.done ? GREEN_LIGHT : WHITE,
      });
      if (item.done) {
        page.drawText('OK', { x: MARGIN_X + 2.5, y: y - 9.5, size: 5.8, font: fonts.bold, color: GREEN });
      }
      lines.forEach((line, index) => {
        page.drawText(line, { x: MARGIN_X + 27, y: y - 9 - index * 11, size: 8.8, font: fonts.regular, color: SLATE });
      });
      y -= Math.max(24, lines.length * 11 + 7);
    });
    y -= 6;
  };
  drawChecklist('Definition of Ready', report.definitionOfReady);
  drawChecklist('Definition of Done', report.definitionOfDone);

  if (images.length) {
    ensureSpace(430, 'Evidencia visual');
    drawSectionTitle('Evidencia visual', 'Imágenes de referencia, prototipos o capturas asociadas a la historia.');
    images.forEach((asset, index) => {
      const maxWidth = CONTENT_WIDTH;
      const maxHeight = 330;
      const scale = Math.min(maxWidth / asset.image.width, maxHeight / asset.image.height, 1);
      const imageWidth = asset.image.width * scale;
      const imageHeight = asset.image.height * scale;
      const captionLines = wrapText(fonts.regular, asset.caption || asset.name, 7.8, CONTENT_WIDTH);
      ensureSpace(imageHeight + captionLines.length * 10 + 35, 'Evidencia visual');
      page.drawText(`${String(index + 1).padStart(2, '0')}  ${normalizePdfText(asset.name)}`, {
        x: MARGIN_X,
        y,
        size: 9.5,
        font: fonts.bold,
        color: INK,
      });
      y -= 15;
      page.drawRectangle({
        x: MARGIN_X,
        y: y - imageHeight - 10,
        width: CONTENT_WIDTH,
        height: imageHeight + 10,
        color: SURFACE,
        borderColor: LINE,
        borderWidth: 0.6,
      });
      page.drawImage(asset.image, {
        x: MARGIN_X + (CONTENT_WIDTH - imageWidth) / 2,
        y: y - imageHeight - 5,
        width: imageWidth,
        height: imageHeight,
      });
      y -= imageHeight + 18;
      captionLines.forEach((line) => {
        page.drawText(line, { x: MARGIN_X, y, size: 7.8, font: fonts.oblique, color: MUTED });
        y -= 10;
      });
      y -= 10;
    });
  }

  pages.forEach((targetPage, index) => {
    targetPage.drawLine({
      start: { x: MARGIN_X, y: 36 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: 36 },
      thickness: 0.55,
      color: LINE,
    });
    targetPage.drawText(`${normalizePdfText(code)} / EXPEDIENTE FUNCIONAL`, {
      x: MARGIN_X,
      y: 21,
      size: 6.4,
      font: fonts.bold,
      color: MUTED,
    });
    const pageLabel = `${index + 1} / ${pages.length}`;
    const pageLabelWidth = fonts.bold.widthOfTextAtSize(pageLabel, 6.4);
    targetPage.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN_X - pageLabelWidth,
      y: 21,
      size: 6.4,
      font: fonts.bold,
      color: MUTED,
    });
  });

  const bytes = await pdf.save();
  return { bytes, fileName, warnings };
};

export const downloadUserStoryPdf = async (report: UserStoryPdfReport) => {
  if (typeof window === 'undefined') {
    throw new Error('La descarga del informe debe iniciarse desde el navegador.');
  }
  const generated = await generateUserStoryPdf(report);
  const blob = new Blob([new Uint8Array(generated.bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = generated.fileName;
  anchor.style.display = 'none';
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return generated;
};
