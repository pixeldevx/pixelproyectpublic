"use client"

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Building2, ImageIcon, Loader2, Save, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { doc, onSnapshot, serverTimestamp, setDoc } from '@/lib/supabase/document-store';
import { db, storage } from '@/lib/backend';
import { ref, uploadBytes, getDownloadURL } from '@/lib/supabase/storage-shim';
import { useAuth } from '@/hooks/useAuth';

const BRANDING_DOC_PATH = ['app_config', 'branding'] as const;
const DEFAULT_COMPANY_NAME = 'Pixel Project';
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

const acceptedLogoTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

const extensionFor = (file: File) => {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName) return fromName;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
};

export function BrandingManagement() {
  const { user, userRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [companyName, setCompanyName] = useState(DEFAULT_COMPANY_NAME);
  const [logoUrl, setLogoUrl] = useState('');
  const [logoPath, setLogoPath] = useState('');
  const [selectedLogo, setSelectedLogo] = useState<File | null>(null);

  const canManageBranding = userRole === 'admin';

  useEffect(() => {
    if (!canManageBranding) {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, ...BRANDING_DOC_PATH),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        setCompanyName(data.companyName || DEFAULT_COMPANY_NAME);
        setLogoUrl(data.logoUrl || '');
        setLogoPath(data.logoPath || '');
        setLoading(false);
      },
      (error) => {
        console.error('Error loading branding config:', error);
        toast.error('No se pudo cargar la marca de la aplicación.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [canManageBranding]);

  const selectedLogoLabel = useMemo(() => {
    if (!selectedLogo) return 'Ningún archivo seleccionado';
    return `${selectedLogo.name} · ${(selectedLogo.size / 1024).toFixed(0)} KB`;
  }, [selectedLogo]);

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      setSelectedLogo(null);
      return;
    }

    if (!acceptedLogoTypes.has(file.type)) {
      toast.warning('Usa un logo en PNG, JPG o WEBP.');
      event.target.value = '';
      setSelectedLogo(null);
      return;
    }

    if (file.size > MAX_LOGO_SIZE_BYTES) {
      toast.warning('El logo debe pesar máximo 2 MB.');
      event.target.value = '';
      setSelectedLogo(null);
      return;
    }

    setSelectedLogo(file);
  };

  const handleSaveBranding = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageBranding || !user) return;

    const cleanCompanyName = companyName.trim();
    if (!cleanCompanyName) {
      toast.warning('Define el nombre de la empresa.');
      return;
    }

    setSaving(true);
    try {
      let nextLogoUrl = logoUrl;
      let nextLogoPath = logoPath;

      if (selectedLogo) {
        const logoExtension = extensionFor(selectedLogo);
        const storagePath = `branding/company-logo-${Date.now()}.${logoExtension}`;
        const logoRef = ref(storage, storagePath);
        const uploadResult = await uploadBytes(logoRef, selectedLogo);
        nextLogoUrl = await getDownloadURL(uploadResult.ref);
        nextLogoPath = uploadResult.ref.fullPath;
      }

      await setDoc(
        doc(db, ...BRANDING_DOC_PATH),
        {
          companyName: cleanCompanyName,
          logoUrl: nextLogoUrl || null,
          logoPath: nextLogoPath || null,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
          updatedByEmail: user.email || null,
        },
        { merge: true }
      );

      setSelectedLogo(null);
      toast.success('Marca actualizada.');
    } catch (error: any) {
      console.error('Error saving branding config:', error);
      toast.error(error?.message || 'No se pudo guardar la marca.');
    } finally {
      setSaving(false);
    }
  };

  if (!canManageBranding) return null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Building2 size={22} />
            </div>
            <div>
              <CardTitle>Marca de la instancia</CardTitle>
              <CardDescription>
                Personaliza el nombre y logo que aparecen en la navegación del aplicativo.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm font-medium text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Cargando marca...
            </div>
          ) : (
            <form onSubmit={handleSaveBranding} className="space-y-5">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">
                  Nombre visible de la empresa
                </label>
                <input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder="Ej: Acme Projects"
                  className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">
                  Logo de la empresa
                </label>
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition hover:border-indigo-300 hover:bg-indigo-50/50">
                  <UploadCloud className="mb-3 h-8 w-8 text-indigo-500" />
                  <span className="text-sm font-bold text-slate-800">Subir logo</span>
                  <span className="mt-1 text-xs text-slate-500">PNG, JPG o WEBP · máximo 2 MB</span>
                  <span className="mt-3 max-w-full truncate rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm">
                    {selectedLogoLabel}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoChange}
                    className="sr-only"
                  />
                </label>
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={saving || !companyName.trim()}
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Guardar marca
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Vista previa</CardTitle>
          <CardDescription>Así se verá en la barra lateral.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
            <div className="flex items-center gap-3">
              <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-indigo-600 text-lg font-black text-white shadow-lg">
                {logoUrl ? (
                  <Image src={logoUrl} alt={companyName || DEFAULT_COMPANY_NAME} fill sizes="48px" className="object-cover" />
                ) : (
                  <ImageIcon size={22} />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-black">{companyName || DEFAULT_COMPANY_NAME}</p>
                <p className="truncate text-xs font-semibold text-slate-400">Powered by Pixel Project</p>
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            Esta configuración es por instancia. Cada organización puede tener su propia marca sin afectar las demás instalaciones conectadas al mismo código.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
