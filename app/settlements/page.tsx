"use client"

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText, Search, ExternalLink, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { collection, query, onSnapshot, where, or } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

export default function SettlementsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!user) return;

    const conditions = [
      where('ownerId', '==', user.uid),
      where('assignedUsers', 'array-contains', user.uid)
    ];

    if (user.email) {
      conditions.push(where('assignedEmails', 'array-contains', user.email));
    }

    const q = query(
      collection(db, 'projects'),
      or(...conditions)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projectsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setProjects(projectsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Liquidaciones (Settlements)</h1>
          <p className="text-slate-500 mt-1">Gestiona las liquidaciones y cierres financieros de tus proyectos.</p>
        </div>
      </div>

      <Card className="mb-8 border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <FileText className="text-indigo-500" size={20} />
              Proyectos para Liquidación
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Buscar proyecto..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-9 pl-9 pr-4 rounded-md border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/50">
                <TableHead className="font-semibold text-slate-600">Proyecto</TableHead>
                <TableHead className="font-semibold text-slate-600">Estado</TableHead>
                <TableHead className="font-semibold text-slate-600">Progreso General</TableHead>
                <TableHead className="font-semibold text-slate-600 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-slate-500">Cargando proyectos...</TableCell>
                </TableRow>
              ) : filteredProjects.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-slate-500">No se encontraron proyectos.</TableCell>
                </TableRow>
              ) : (
                filteredProjects.map((project) => (
                  <TableRow key={project.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-medium text-slate-900">{project.name}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${
                        project.status === 'active' ? 'bg-amber-100 text-amber-700' : 
                        project.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {project.status === 'active' ? 'Activo' : project.status === 'completed' ? 'Completado' : 'En Pausa'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-full bg-slate-100 rounded-full h-1.5 max-w-[100px]">
                          <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: '0%' }}></div>
                        </div>
                        <span className="text-xs text-slate-500">0%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/projects/${project.id}`}>
                        <Button variant="ghost" size="sm" className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 gap-1">
                          <CheckCircle size={14} />
                          Liquidar
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
