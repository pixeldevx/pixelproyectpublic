import { ref, uploadBytesResumable, getAuthorizedDownloadURL, getDownloadURL } from '@/lib/supabase/storage-shim';
import { storage } from './backend';

export const uploadProfilePicture = async (userId: string, file: File): Promise<string> => {
  const fileExtension = file.name.split('.').pop();
  const storageRef = ref(storage, `profile_pictures/${userId}_${Date.now()}.${fileExtension}`);
  
  const uploadTask = await uploadBytesResumable(storageRef, file);
  const downloadURL = await getDownloadURL(uploadTask.ref);
  
  return downloadURL;
};

export const uploadProfileSignature = async (
  userId: string,
  file: File
): Promise<{ url: string; storagePath: string }> => {
  if (!file.type.startsWith('image/')) {
    throw new Error('La firma debe cargarse como imagen.');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('La imagen de la firma no puede superar 2 MB.');
  }

  const fileExtension = (file.name.split('.').pop() || 'png').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const storagePath = `profile_signatures/${userId}_${Date.now()}.${fileExtension || 'png'}`;
  const storageRef = ref(storage, storagePath);
  const uploadTask = await uploadBytesResumable(storageRef, file);
  return {
    url: await getAuthorizedDownloadURL(uploadTask.ref),
    storagePath: uploadTask.ref.fullPath,
  };
};
