import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/backend';
import { doc, updateDoc, arrayRemove } from '@/lib/supabase/document-store';
import { toast } from 'sonner';

interface RemoveMemberModalProps {
  memberToRemove: { id: string, name: string } | null;
  onClose: () => void;
  projectId: string;
  teamMembers: any[];
}

export function RemoveMemberModal({ memberToRemove, onClose, projectId, teamMembers }: RemoveMemberModalProps) {
  const [isRemovingMember, setIsRemovingMember] = useState(false);

  if (!memberToRemove) return null;

  const executeRemoveMember = async () => {
    setIsRemovingMember(true);
    
    const member = teamMembers.find(m => m.id === memberToRemove.id);

    try {
      const docRef = doc(db, 'projects', projectId);
      const updates: any = {
        assignedTeamMembers: arrayRemove(memberToRemove.id)
      };
      
      if (member && member.email) {
        updates.assignedEmails = arrayRemove(member.email);
      }
      
      await updateDoc(docRef, updates);
      toast.success('Miembro removido correctamente');
      onClose();
    } catch (error) {
      console.error("Error removing member:", error);
      toast.error("Error al remover el miembro del proyecto");
    } finally {
      setIsRemovingMember(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 text-red-600 mb-4">
          <div className="p-2 bg-red-100 rounded-full">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">Remover Miembro</h3>
        </div>
        
        <p className="text-slate-600 mb-6">
          ¿Estás seguro de que deseas remover a <strong className="text-slate-900">&quot;{memberToRemove.name}&quot;</strong> del proyecto?
        </p>
        
        <div className="flex justify-end gap-3">
          <Button 
            variant="outline" 
            onClick={onClose}
            disabled={isRemovingMember}
            className="border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </Button>
          <Button 
            onClick={executeRemoveMember}
            disabled={isRemovingMember}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {isRemovingMember ? 'Removiendo...' : 'Sí, remover miembro'}
          </Button>
        </div>
      </div>
    </div>
  );
}
