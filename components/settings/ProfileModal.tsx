import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { User as UserIcon, X, Camera, PenLine, Landmark, Plus, Trash2 } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from '@/lib/supabase/document-store';
import { updateProfile } from '@/lib/supabase/auth-shim';
import { db, auth, storage } from '@/lib/backend';
import { getAuthorizedDownloadURL, ref } from '@/lib/supabase/storage-shim';
import { toast } from 'sonner';
import { uploadProfilePicture, uploadProfileSignature } from '@/lib/storage-utils';

interface ProfileModalProps {
  user: any;
  isOpen: boolean;
  onClose: () => void;
}

type ProfileBankAccount = {
  id: string;
  bankName: string;
  accountType: string;
  accountNumber: string;
  isDefault?: boolean;
};

const emptyBankAccount = () => ({ id: '', bankName: '', accountType: 'Ahorros', accountNumber: '' });

export function ProfileModal({ user, isOpen, onClose }: ProfileModalProps) {
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(user?.photoURL || null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [signatureStoragePath, setSignatureStoragePath] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [identificationType, setIdentificationType] = useState('CC');
  const [identificationNumber, setIdentificationNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [bankAccounts, setBankAccounts] = useState<ProfileBankAccount[]>([]);
  const [bankAccountDraft, setBankAccountDraft] = useState(emptyBankAccount());
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !user?.uid) return;

    setDisplayName(user.displayName || '');
    setPhotoPreview(user.photoURL || null);
    setPhotoFile(null);
    setSignatureFile(null);

    let active = true;
    const loadSignatureProfile = async () => {
      try {
        const userSnapshot = await getDoc(doc(db, 'users', user.uid));
        const profile = userSnapshot.exists() ? userSnapshot.data() : {};
        const memberSnapshots = await Promise.all([
          user.email
            ? getDocs(query(collection(db, 'team_members'), where('email', '==', user.email)))
            : Promise.resolve(null),
          getDocs(query(collection(db, 'team_members'), where('authUserId', '==', user.uid))),
          getDocs(query(collection(db, 'team_members'), where('uid', '==', user.uid))),
          getDocs(query(collection(db, 'team_members'), where('userId', '==', user.uid))),
        ]);
        const member = memberSnapshots.flatMap((snapshot) => snapshot?.docs || [])[0]?.data() || {};
        if (!active) return;
        setDisplayName(profile.displayName || user.displayName || member.displayName || member.name || '');
        const storedSignaturePath = profile.signatureStoragePath || member.signatureStoragePath || '';
        let storedSignatureUrl = profile.signatureUrl || member.signatureUrl || null;
        if (storedSignaturePath) {
          try {
            storedSignatureUrl = await getAuthorizedDownloadURL(ref(storage, storedSignaturePath));
          } catch (error) {
            console.error('Error authorizing signature preview:', error);
          }
        }
        if (!active) return;
        setSignaturePreview(storedSignatureUrl);
        setSignatureStoragePath(storedSignaturePath);
        setJobTitle(
          member.roleName || member.position || member.jobTitle || profile.roleName || profile.position || profile.jobTitle || ''
        );
        setIdentificationType(profile.identificationType || 'CC');
        setIdentificationNumber(profile.identificationNumber || profile.documentNumber || '');
        setPhone(profile.phone || profile.mobile || '');
        setAddress(profile.address || '');
        setCity(profile.city || '');
        setBankAccounts(Array.isArray(profile.bankAccounts) ? profile.bankAccounts : []);
        setBankAccountDraft(emptyBankAccount());
      } catch (error) {
        console.error('Error loading signature profile:', error);
      }
    };
    void loadSignatureProfile();
    return () => {
      active = false;
    };
  }, [isOpen, user?.displayName, user?.email, user?.photoURL, user?.uid]);

  if (!isOpen) return null;

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSignatureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('La firma debe ser una imagen PNG, JPG o WEBP.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('La imagen de la firma no puede superar 2 MB.');
      return;
    }
    setSignatureFile(file);
    setSignaturePreview(URL.createObjectURL(file));
  };

  const saveBankAccountDraft = () => {
    const bankName = bankAccountDraft.bankName.trim();
    const accountNumber = bankAccountDraft.accountNumber.trim();
    if (!bankName || !accountNumber) {
      toast.error('Completa el banco y el número de cuenta.');
      return;
    }
    const account: ProfileBankAccount = {
      id: bankAccountDraft.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      bankName,
      accountType: bankAccountDraft.accountType || 'Ahorros',
      accountNumber,
      isDefault: bankAccounts.length === 0 || bankAccounts.find((item) => item.id === bankAccountDraft.id)?.isDefault,
    };
    setBankAccounts((current) => [...current.filter((item) => item.id !== account.id), account]);
    setBankAccountDraft(emptyBankAccount());
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsUploading(true);
    try {
      let uploadedPhotoURL = user.photoURL;
      let uploadedSignatureURL = signaturePreview;
      let uploadedSignaturePath = signatureStoragePath;

      if (photoFile) {
        uploadedPhotoURL = await uploadProfilePicture(user.uid, photoFile);
      }
      if (signatureFile) {
        const signatureUpload = await uploadProfileSignature(user.uid, signatureFile);
        uploadedSignatureURL = signatureUpload.url;
        uploadedSignaturePath = signatureUpload.storagePath;
      }

      // Update Supabase User Document
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName: displayName,
        identificationType,
        identificationNumber: identificationNumber.trim(),
        phone: phone.trim(),
        address: address.trim(),
        city: city.trim(),
        bankAccounts,
        ...(uploadedPhotoURL && { photoURL: uploadedPhotoURL }),
        ...(uploadedSignatureURL && {
          signatureUrl: uploadedSignatureURL,
          signatureStoragePath: uploadedSignaturePath,
          signatureUpdatedAt: serverTimestamp(),
        }),
      });

      const memberSnapshots = await Promise.all([
        user.email
          ? getDocs(query(collection(db, 'team_members'), where('email', '==', user.email)))
          : Promise.resolve(null),
        getDocs(query(collection(db, 'team_members'), where('authUserId', '==', user.uid))),
        getDocs(query(collection(db, 'team_members'), where('uid', '==', user.uid))),
        getDocs(query(collection(db, 'team_members'), where('userId', '==', user.uid))),
      ]);
      const matchingMembers = new Map<string, any>();
      memberSnapshots.forEach((snapshot) => snapshot?.docs.forEach((memberDoc) => matchingMembers.set(memberDoc.id, memberDoc)));
      await Promise.all(
        Array.from(matchingMembers.values()).map((memberDoc) =>
          updateDoc(memberDoc.ref, {
            displayName,
            ...(uploadedPhotoURL && { photoURL: uploadedPhotoURL }),
            ...(uploadedSignatureURL && {
              signatureUrl: uploadedSignatureURL,
              signatureStoragePath: uploadedSignaturePath,
              signatureUpdatedAt: serverTimestamp(),
            }),
          })
        )
      );

      // Publish Auth display changes last, after the profile writes finish.
      // Auth listeners may reload workspace context when the display name changes.
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, {
          displayName,
          photoURL: uploadedPhotoURL,
        });
      }

      toast.success("Perfil actualizado exitosamente");
      onClose();
    } catch (error: any) {
      console.error("Error updating profile:", error);
      toast.error(`Error al actualizar el perfil: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl m-4 animate-in fade-in zoom-in-95 duration-200 relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X size={20} />
        </button>
        
        <h3 className="text-lg font-semibold text-slate-900 mb-6 text-center">
          Mi Perfil
        </h3>
        
        <form onSubmit={handleSave}>
          <div className="flex flex-col items-center mb-6">
            <div className="relative group mb-2">
              <div className="w-24 h-24 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center overflow-hidden relative">
                {photoPreview ? (
                  <Image src={photoPreview} alt="Profile" fill className="object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <UserIcon size={40} className="text-slate-400" />
                )}
                <div 
                  className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera size={24} className="text-white mb-1" />
                  <span className="text-white text-xs font-medium">Cambiar</span>
                </div>
              </div>
              <input 
                type="file" 
                accept="image/*" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handlePhotoChange} 
              />
            </div>
            <p className="text-sm text-slate-500">{user?.email}</p>
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Nombre
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Tu nombre"
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="mb-3">
                <p className="text-sm font-bold text-slate-900">Datos para cuentas de cobro</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600">Pixel reutiliza estos datos al generar tu cuenta, sin que tengas que digitarlos cada mes.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-700">
                  Tipo de identificación
                  <select value={identificationType} onChange={(event) => setIdentificationType(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="CC">Cédula de ciudadanía (CC)</option>
                    <option value="CE">Cédula de extranjería (CE)</option>
                    <option value="NIT">NIT</option>
                    <option value="PAS">Pasaporte</option>
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-700">
                  Número de identificación
                  <input value={identificationNumber} onChange={(event) => setIdentificationNumber(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500" />
                </label>
                <label className="text-xs font-bold text-slate-700">
                  Teléfono / celular
                  <input value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500" />
                </label>
                <label className="text-xs font-bold text-slate-700">
                  Ciudad
                  <input value={city} onChange={(event) => setCity(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Ej: Bogotá D.C." />
                </label>
                <label className="text-xs font-bold text-slate-700 sm:col-span-2">
                  Dirección
                  <input value={address} onChange={(event) => setAddress(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-indigo-500" />
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-cyan-100 bg-cyan-50/60 p-4">
              <div className="mb-3 flex items-start gap-3">
                <div className="rounded-lg bg-white p-2 text-cyan-700 shadow-sm"><Landmark size={18} /></div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Cuentas bancarias</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">Agrega varias cuentas y elige la correspondiente al crear cada cuenta de cobro.</p>
                </div>
              </div>
              <div className="space-y-2">
                {bankAccounts.map((account) => (
                  <div key={account.id} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-cyan-100">
                    <button type="button" onClick={() => setBankAccountDraft({ id: account.id, bankName: account.bankName, accountType: account.accountType, accountNumber: account.accountNumber })} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-bold text-slate-900">{account.bankName} · {account.accountType}</p>
                      <p className="text-xs font-semibold text-slate-500">Cuenta terminada en {account.accountNumber.slice(-4)}</p>
                    </button>
                    <button type="button" onClick={() => setBankAccounts((current) => current.filter((item) => item.id !== account.id))} className="rounded-md p-2 text-rose-600 hover:bg-rose-50" aria-label="Eliminar cuenta bancaria"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_130px_1fr_auto]">
                <input value={bankAccountDraft.bankName} onChange={(event) => setBankAccountDraft((current) => ({ ...current, bankName: event.target.value }))} className="h-10 rounded-md border border-cyan-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-cyan-500" placeholder="Banco" />
                <select value={bankAccountDraft.accountType} onChange={(event) => setBankAccountDraft((current) => ({ ...current, accountType: event.target.value }))} className="h-10 rounded-md border border-cyan-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-cyan-500">
                  <option value="Ahorros">Ahorros</option>
                  <option value="Corriente">Corriente</option>
                  <option value="Nequi">Nequi</option>
                  <option value="Daviplata">Daviplata</option>
                  <option value="Otro">Otro</option>
                </select>
                <input value={bankAccountDraft.accountNumber} onChange={(event) => setBankAccountDraft((current) => ({ ...current, accountNumber: event.target.value }))} className="h-10 rounded-md border border-cyan-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-cyan-500" placeholder="Número de cuenta" />
                <button type="button" onClick={saveBankAccountDraft} className="inline-flex h-10 items-center justify-center rounded-md bg-cyan-700 px-3 text-sm font-bold text-white hover:bg-cyan-800"><Plus size={16} className="mr-1" />Guardar</button>
              </div>
            </div>

            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
              <div className="mb-3 flex items-start gap-3">
                <div className="rounded-lg bg-white p-2 text-indigo-600 shadow-sm"><PenLine size={18} /></div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Firma para anticipos y cuentas de cobro</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                    Esta firma se usará únicamente cuando tú solicites o apruebes un anticipo.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => signatureInputRef.current?.click()}
                className="flex min-h-28 w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-indigo-200 bg-white p-3 hover:border-indigo-400"
              >
                {signaturePreview ? (
                  <Image src={signaturePreview} alt="Firma registrada" width={320} height={112} className="max-h-24 w-auto object-contain" unoptimized />
                ) : (
                  <span className="text-xs font-semibold text-slate-500">Cargar firma en PNG, JPG o WEBP</span>
                )}
              </button>
              <input ref={signatureInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleSignatureChange} />
              <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                <p><span className="font-bold text-slate-800">Correo:</span> {user?.email || 'Sin correo'}</p>
                <p><span className="font-bold text-slate-800">Cargo:</span> {jobTitle || 'Sin cargo configurado'}</p>
              </div>
            </div>
          </div>
          
          <div className="flex justify-end gap-3">
            <Button 
              type="button"
              variant="outline" 
              onClick={onClose}
              className="border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </Button>
            <Button 
              type="submit"
              disabled={isUploading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {isUploading ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
