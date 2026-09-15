import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/backend';
import { doc, updateDoc, arrayUnion } from '@/lib/supabase/document-store';
import { toast } from 'sonner';

interface AssignMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  teamMembers: any[];
  project: any;
}

export function AssignMemberModal({ isOpen, onClose, projectId, teamMembers, project }: AssignMemberModalProps) {
  const [selectedMemberId, setSelectedMemberId] = useState('');

  if (!isOpen) return null;

  const handleAssignMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMemberId) return;

    const selectedMember = teamMembers.find(m => m.id === selectedMemberId);
    if (!selectedMember) return;

    try {
      const docRef = doc(db, 'projects', projectId);
      await updateDoc(docRef, {
        assignedTeamMembers: arrayUnion(selectedMemberId),
        assignedEmails: arrayUnion(selectedMember.email)
      });
      setSelectedMemberId('');
      onClose();
      toast.success('Miembro asignado correctamente');
    } catch (error) {
      console.error("Error assigning member:", error);
      toast.error("Error al asignar el miembro al proyecto");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 m-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Asignar Miembro del Equipo</h3>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>
        
        <form onSubmit={handleAssignMember}>
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">Seleccionar Miembro</label>
            <select
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-slate-900"
            >
              <option value="">Seleccione un miembro...</option>
              {teamMembers
                .filter(member => !project.assignedTeamMembers?.includes(member.id))
                .map(member => (
                  <option key={member.id} value={member.id}>
                    {member.name} - {member.roleName}
                  </option>
                ))
              }
            </select>
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
              disabled={!selectedMemberId}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              Asignar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
