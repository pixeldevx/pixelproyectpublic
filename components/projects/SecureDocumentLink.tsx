"use client";

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { storage } from '@/lib/backend';
import {
  getAuthorizedDownloadURL,
  getStoragePathFromDownloadUrl,
  ref,
} from '@/lib/supabase/storage-shim';

export function SecureDocumentLink({
  storagePath,
  fallbackUrl,
  className,
  children,
  title,
}: {
  storagePath?: string | null;
  fallbackUrl?: string | null;
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  const [opening, setOpening] = useState(false);

  const handleOpen = async () => {
    if (opening) return;
    const previewWindow = window.open('about:blank', '_blank');
    if (previewWindow) previewWindow.opener = null;
    setOpening(true);
    try {
      const recoverableStoragePath = storagePath || getStoragePathFromDownloadUrl(fallbackUrl);
      const url = recoverableStoragePath
        ? await getAuthorizedDownloadURL(ref(storage, recoverableStoragePath))
        : String(fallbackUrl || '');
      if (!url) throw new Error('El soporte no tiene una ruta disponible.');
      if (!previewWindow) {
        throw new Error('El navegador bloqueó la pestaña del soporte. Habilita las ventanas emergentes para Pixel.');
      }
      previewWindow.location.replace(url);
    } catch (error: any) {
      previewWindow?.close();
      toast.error(error?.message || 'No se pudo abrir el soporte.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <button type="button" onClick={handleOpen} disabled={opening} className={className} title={title}>
      {opening && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}
