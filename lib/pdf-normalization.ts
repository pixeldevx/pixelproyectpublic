import { PDFDocument } from 'pdf-lib';

export type PdfPasswordRequest = {
  fileName: string;
  incorrectPassword: boolean;
};

export type PdfPasswordRequester = (request: PdfPasswordRequest) => Promise<string | null>;

export type PreparedPdfUpload = {
  uploadFile: File;
  originalFile: File | null;
  wasPasswordProtected: boolean;
  originalSha256: string;
  normalizedSha256?: string;
  pageCount?: number;
  normalizedAt?: string;
  method?: 'pdfjs-rasterized-v1';
};

export class PdfPasswordCancelledError extends Error {
  constructor() {
    super('La carga del PDF protegido fue cancelada.');
    this.name = 'PdfPasswordCancelledError';
  }
}

const isPdfFile = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

const sha256 = async (bytes: ArrayBuffer | Uint8Array) => {
  const source = bytes instanceof Uint8Array ? Uint8Array.from(bytes).buffer : bytes;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

const canvasToJpegBytes = (canvas: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('No se pudo renderizar una página del PDF protegido.'));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      'image/jpeg',
      0.94
    );
  });

const buildNormalizedFileName = (fileName: string) => {
  const baseName = fileName.replace(/\.pdf$/i, '').trim() || 'soporte';
  return `${baseName}-normalizado.pdf`;
};

/**
 * Detects encrypted PDFs in the browser and creates a password-free derivative.
 * The password only exists inside the callback/loader lifecycle and is never returned.
 */
export const preparePdfForUpload = async (
  file: File,
  requestPassword: PdfPasswordRequester
): Promise<PreparedPdfUpload> => {
  const originalBytes = await file.arrayBuffer();
  const originalSha256 = await sha256(originalBytes);

  if (!isPdfFile(file)) {
    return {
      uploadFile: file,
      originalFile: null,
      wasPasswordProtected: false,
      originalSha256,
    };
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(originalBytes.slice(0)),
    isEvalSupported: false,
    useWasm: false,
  });
  let wasPasswordProtected = false;
  let cancelled = false;

  loadingTask.onPassword = (
    updatePassword: (password: string) => void,
    reason: number
  ) => {
    wasPasswordProtected = true;
    const incorrectPassword = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    void requestPassword({ fileName: file.name, incorrectPassword })
      .then((password) => {
        if (!password) {
          cancelled = true;
          void loadingTask.destroy();
          return;
        }
        updatePassword(password);
      })
      .catch(() => {
        cancelled = true;
        void loadingTask.destroy();
      });
  };

  let sourceDocument;
  try {
    sourceDocument = await loadingTask.promise;
  } catch (error) {
    if (cancelled) throw new PdfPasswordCancelledError();
    throw error;
  }

  if (!wasPasswordProtected) {
    const pageCount = sourceDocument.numPages;
    await loadingTask.destroy();
    return {
      uploadFile: file,
      originalFile: null,
      wasPasswordProtected: false,
      originalSha256,
      pageCount,
    };
  }

  const normalizedDocument = await PDFDocument.create();
  normalizedDocument.setTitle(buildNormalizedFileName(file.name));
  normalizedDocument.setProducer('Pixel Project PDF Normalizer');
  normalizedDocument.setCreator('Pixel Project');

  try {
    for (let pageNumber = 1; pageNumber <= sourceDocument.numPages; pageNumber += 1) {
      const sourcePage = await sourceDocument.getPage(pageNumber);
      const baseViewport = sourcePage.getViewport({ scale: 1 });
      const scale = Math.max(1.5, Math.min(2.5, 2400 / Math.max(baseViewport.width, baseViewport.height)));
      const viewport = sourcePage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('El navegador no pudo preparar el PDF protegido.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await sourcePage.render({
        canvas,
        canvasContext: context,
        viewport,
        background: '#ffffff',
      }).promise;

      const jpeg = await normalizedDocument.embedJpg(await canvasToJpegBytes(canvas));
      const targetPage = normalizedDocument.addPage([baseViewport.width, baseViewport.height]);
      targetPage.drawImage(jpeg, {
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
      });
      sourcePage.cleanup();
      canvas.width = 1;
      canvas.height = 1;
    }

    const normalizedBytes = Uint8Array.from(
      await normalizedDocument.save({ useObjectStreams: true })
    );
    const normalizedFile = new File(
      [normalizedBytes],
      buildNormalizedFileName(file.name),
      { type: 'application/pdf', lastModified: Date.now() }
    );

    return {
      uploadFile: normalizedFile,
      originalFile: file,
      wasPasswordProtected: true,
      originalSha256,
      normalizedSha256: await sha256(normalizedBytes),
      pageCount: sourceDocument.numPages,
      normalizedAt: new Date().toISOString(),
      method: 'pdfjs-rasterized-v1',
    };
  } finally {
    await loadingTask.destroy();
  }
};
