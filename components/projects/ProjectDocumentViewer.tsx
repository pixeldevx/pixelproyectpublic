"use client";

/* eslint-disable @next/next/no-img-element */

import React, { useEffect, useState } from "react";
import { Download, ExternalLink, FileArchive, FileImage, FileText, FileVideo, History, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { storage } from '@/lib/backend';
import { getAuthorizedDownloadURL, ref } from '@/lib/supabase/storage-shim';

type ProjectDocumentViewerProps = {
  document: any | null;
  isOpen: boolean;
  onClose: () => void;
};

const getDocumentName = (document: any) =>
  document?.name || document?.fileName || "Documento sin nombre";

const getDocumentFileName = (document: any) =>
  document?.fileName || document?.name || "";

const getExtension = (document: any) => {
  const source = getDocumentFileName(document).split("?")[0].toLowerCase();
  const extension = source.includes(".") ? source.split(".").pop() || "" : "";
  return extension;
};

const getDocumentUrl = (document: any) => String(document?.url || document?.downloadUrl || "");

const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const textExtensions = new Set(["txt", "csv", "json", "xml", "md", "geojson", "log"]);
const videoExtensions = new Set(["mp4", "webm", "ogg", "mov"]);
const audioExtensions = new Set(["mp3", "wav", "ogg", "m4a", "aac"]);
const officeExtensions = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx"]);

const getPreviewKind = (document: any) => {
  const extension = getExtension(document);
  const contentType = String(document?.contentType || document?.mimeType || "").toLowerCase();

  if (contentType.includes("pdf") || extension === "pdf") return "pdf";
  if (contentType.startsWith("image/") || imageExtensions.has(extension)) return "image";
  if (contentType.startsWith("video/") || videoExtensions.has(extension)) return "video";
  if (contentType.startsWith("audio/") || audioExtensions.has(extension)) return "audio";
  if (contentType.startsWith("text/") || textExtensions.has(extension)) return "text";
  if (officeExtensions.has(extension)) return "office";
  return "fallback";
};

const renderViewerIcon = (kind: string, size: number) => {
  if (kind === "image") return <FileImage size={size} />;
  if (kind === "video" || kind === "audio") return <FileVideo size={size} />;
  if (kind === "office") return <FileArchive size={size} />;
  return <FileText size={size} />;
};

const formatFileSize = (bytes?: number) => {
  const value = Number(bytes || 0);
  if (!value) return "";
  const units = ["Bytes", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const formatVersionDate = (value: any) => {
  if (!value) return '';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
};

const PreviewFallback = ({ documentUrl, kind }: { documentUrl: string; kind: string }) => {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center bg-slate-50 p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200">
          {renderViewerIcon(kind, 30)}
        </div>
        <h3 className="mt-5 text-xl font-black text-slate-900">Vista previa no disponible</h3>
        <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
          Este formato no se puede renderizar directamente en el navegador. Puedes abrirlo o descargarlo sin salir de la gestión del proyecto.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <a
            href={documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700"
          >
            <ExternalLink size={16} className="mr-2" />
            Abrir archivo
          </a>
          <a
            href={documentUrl}
            download
            className="inline-flex h-10 items-center rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white transition hover:bg-indigo-700"
          >
            <Download size={16} className="mr-2" />
            Descargar
          </a>
        </div>
      </div>
    </div>
  );
};

export function ProjectDocumentViewer({ document, isOpen, onClose }: ProjectDocumentViewerProps) {
  const [authorizedUrl, setAuthorizedUrl] = useState('');
  const [accessError, setAccessError] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const versions = Array.isArray(document?.versions)
    ? [...document.versions]
        .filter((version: any) => version?.storagePath || version?.url)
        .sort((left: any, right: any) => Number(right.version || 0) - Number(left.version || 0))
    : [];
  const currentVersion = Number(document?.currentVersion) || Number(versions[0]?.version) || 1;
  const selectedVersionDocument = selectedVersion === null
    ? null
    : versions.find((version: any) => Number(version.version) === selectedVersion) || null;
  const activeDocument = selectedVersionDocument || document;
  const activeStoragePath = String(activeDocument?.storagePath || '');
  const activeFallbackUrl = getDocumentUrl(activeDocument);

  useEffect(() => {
    if (!isOpen) return;
    Promise.resolve().then(() => setSelectedVersion(null));
  }, [document?.id, isOpen]);

  useEffect(() => {
    let active = true;
    if (!isOpen || !document) {
      return () => { active = false; };
    }

    const fallbackUrl = activeFallbackUrl;
    if (!activeStoragePath) {
      Promise.resolve().then(() => {
        if (!active) return;
        setAuthorizedUrl(fallbackUrl);
        setAccessError('');
      });
      return () => { active = false; };
    }

    Promise.resolve().then(() => {
      if (!active) return;
      setAuthorizedUrl('');
      setAccessError('');
    });
    getAuthorizedDownloadURL(ref(storage, activeStoragePath))
      .then((url) => { if (active) setAuthorizedUrl(url); })
      .catch((error) => { if (active) setAccessError(error?.message || 'No se pudo autorizar el documento.'); });
    return () => { active = false; };
  }, [activeFallbackUrl, activeStoragePath, document, isOpen]);

  if (!isOpen || !document) return null;

  const documentUrl = authorizedUrl;
  const documentName = getDocumentName(document);
  const fileName = getDocumentFileName(activeDocument);
  const extension = getExtension(activeDocument);
  const previewKind = getPreviewKind(activeDocument);
  const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(documentUrl)}`;

  const renderPreview = () => {
    if (accessError) {
      return (
        <div className="flex h-full min-h-[420px] items-center justify-center bg-slate-50 p-8 text-center">
          <div><FileText className="mx-auto h-10 w-10 text-rose-400" /><p className="mt-3 text-sm font-black text-rose-700">Acceso no disponible</p><p className="mt-1 text-sm font-medium text-slate-500">{accessError}</p></div>
        </div>
      );
    }

    if (!documentUrl) {
      return (
        <div className="flex h-full min-h-[420px] items-center justify-center bg-slate-50 p-8 text-center">
          <div>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
            <p className="mt-3 text-sm font-bold text-slate-500">Preparando documento...</p>
          </div>
        </div>
      );
    }

    if (previewKind === "image") {
      return (
        <div className="flex h-full min-h-[420px] items-center justify-center bg-slate-950 p-4">
          <img src={documentUrl} alt={documentName} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
        </div>
      );
    }

    if (previewKind === "video") {
      return (
        <div className="flex h-full min-h-[420px] items-center justify-center bg-slate-950 p-4">
          <video src={documentUrl} controls className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </div>
      );
    }

    if (previewKind === "audio") {
      return (
        <div className="flex h-full min-h-[420px] items-center justify-center bg-slate-50 p-8">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                {renderViewerIcon(previewKind, 22)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900">{documentName}</p>
                <p className="text-xs font-semibold text-slate-400">Reproductor de audio</p>
              </div>
            </div>
            <audio src={documentUrl} controls className="mt-5 w-full" />
          </div>
        </div>
      );
    }

    if (previewKind === "pdf" || previewKind === "text") {
      return (
        <iframe
          src={documentUrl}
          title={documentName}
          className="h-full min-h-[70vh] w-full bg-white"
        />
      );
    }

    if (previewKind === "office") {
      return (
        <iframe
          src={officeViewerUrl}
          title={documentName}
          className="h-full min-h-[70vh] w-full bg-white"
        />
      );
    }

    return <PreviewFallback documentUrl={documentUrl} kind={previewKind} />;
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm">
      <div className="flex h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              {renderViewerIcon(previewKind, 22)}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-indigo-600">Visor de documentos</p>
              <h2 className="truncate text-lg font-black text-slate-900">{documentName}</h2>
              <p className="truncate text-xs font-semibold text-slate-500">
                {fileName || "Archivo del proyecto"}
                {extension ? ` · ${extension.toUpperCase()}` : ""}
                {activeDocument?.fileSize ? ` · ${formatFileSize(activeDocument.fileSize)}` : ""}
              </p>
              {versions.length > 1 && (
                <p className="mt-1 text-[11px] font-black text-indigo-600">
                  {selectedVersion === null ? `Versión actual v${currentVersion}` : `Versión histórica v${selectedVersion}`}
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {versions.length > 1 && (
              <select
                value={selectedVersion ?? currentVersion}
                onChange={(event) => {
                  const versionNumber = Number(event.target.value);
                  setSelectedVersion(versionNumber === currentVersion ? null : versionNumber);
                }}
                className="h-10 max-w-32 rounded-xl border border-slate-200 bg-white px-2 text-xs font-black text-slate-700 lg:hidden"
                aria-label="Seleccionar versión del documento"
              >
                {versions.map((version: any) => (
                  <option key={version.version} value={Number(version.version) || 1}>
                    v{Number(version.version) || 1}{Number(version.version) === currentVersion ? ' actual' : ''}
                  </option>
                ))}
              </select>
            )}
            {documentUrl && (
              <>
                <a
                  href={documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700"
                >
                  <ExternalLink size={16} className="mr-2" />
                  Abrir
                </a>
                <a
                  href={documentUrl}
                  download
                  className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700"
                >
                  <Download size={16} className="mr-2" />
                  Descargar
                </a>
              </>
            )}
            <Button type="button" variant="outline" onClick={onClose} className="h-10 rounded-xl">
              <X size={16} className="mr-2" />
              Cerrar
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden bg-slate-100">
          <div className="min-w-0 flex-1 overflow-hidden">
            {renderPreview()}
          </div>
          {versions.length > 1 && (
            <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 lg:block">
              <div className="mb-3 flex items-center gap-2">
                <History size={16} className="text-indigo-600" />
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-800">Historial de versiones</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{versions.length} archivos conservados</p>
                </div>
              </div>
              <div className="space-y-2">
                {versions.map((version: any) => {
                  const versionNumber = Number(version.version) || 1;
                  const isCurrent = versionNumber === currentVersion;
                  const isSelected = selectedVersion === null ? isCurrent : selectedVersion === versionNumber;
                  return (
                    <button
                      type="button"
                      key={`${versionNumber}-${version.storagePath || version.url}`}
                      onClick={() => setSelectedVersion(isCurrent ? null : versionNumber)}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? 'border-indigo-200 bg-indigo-50 ring-2 ring-indigo-500/10'
                          : 'border-slate-200 bg-white hover:border-indigo-100 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black text-slate-800">Versión {versionNumber}</span>
                        {isCurrent && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">
                            Actual
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-xs font-semibold text-slate-500">
                        {version.fileName || version.name || 'Documento'}
                      </span>
                      {(version.stepLabel || formatVersionDate(version.uploadedAt)) && (
                        <span className="mt-1 block text-[10px] font-semibold leading-4 text-slate-400">
                          {[version.stepLabel, formatVersionDate(version.uploadedAt)].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
