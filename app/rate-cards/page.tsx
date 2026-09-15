"use client"

import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CreditCard, Search, ExternalLink, Users, User, CheckCircle2, Clock, ListTodo, BarChart3, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { collection, query, onSnapshot, where, or, collectionGroup, getDocs } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import { Progress } from '@/components/ui/progress';
import { handleDataError, OperationType } from '@/lib/backend-utils';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import Image from 'next/image';
import {
  formatRateCardRate,
  formatRateCardUnits,
  formatRateCardValue,
  getRateCardCostRate,
  getRateCardCostValue,
  getRateCardIncomeRate,
  getRateCardIncomeValue,
  getRateCardOutputValue,
  isCurrencyRateCard,
} from '@/lib/rate-card-config';

export default function RateCardsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'projects' | 'people' | 'economic'>('projects');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberTasks, setMemberTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [allRateCards, setAllRateCards] = useState<any[]>([]);
  const [allTasks, setAllTasks] = useState<any[]>([]);
  const [loadingEconomic, setLoadingEconomic] = useState(false);
  const [selectedEconomicRateId, setSelectedEconomicRateId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    // Fetch projects
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

    const unsubscribeProjects = onSnapshot(q, (snapshot) => {
      const projectsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setProjects(projectsData);
      setLoading(false);
    });

    // Fetch team members
    const qTeam = query(collection(db, 'team_members'));
    const unsubscribeTeam = onSnapshot(qTeam, (snapshot) => {
      const teamData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setTeamMembers(teamData);
    });

    return () => {
      unsubscribeProjects();
      unsubscribeTeam();
    };
  }, [user]);

  const handleSelectMember = (id: string) => {
    if (id !== selectedMemberId) {
      setMemberTasks([]);
      setLoadingTasks(true);
      setSelectedMemberId(id);
    }
  };

  useEffect(() => {
    if (!selectedMemberId) {
      return;
    }

    // Fetch tasks for the selected member across all projects
    // We use collectionGroup to fetch all tasks where assignedTo matches the selected member
    // Note: This might require a composite index in Supabase
    const qTasks = query(
      collectionGroup(db, 'tasks'),
      where('assignedTo', '==', selectedMemberId)
    );

    const unsubscribeTasks = onSnapshot(qTasks, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => {
        const data = doc.data();
        // The parent of the task document is the 'tasks' collection, 
        // and its parent is the project document.
        const projectId = doc.ref.parent.parent?.id;
        return {
          id: doc.id,
          projectId,
          ...data
        };
      });
      setMemberTasks(tasksData);
      setLoadingTasks(false);
    }, (error: any) => {
      handleDataError(error, OperationType.LIST, 'tasks');
      setLoadingTasks(false);
    });

    return () => unsubscribeTasks();
  }, [selectedMemberId]);

  const handleTabChange = (tab: 'projects' | 'people' | 'economic') => {
    if (tab === 'economic' && activeTab !== 'economic') {
      setLoadingEconomic(true);
    }
    setActiveTab(tab);
  };

  useEffect(() => {
    if (activeTab !== 'economic') return;

    // Fetch all rate cards
    const qRateCards = query(collectionGroup(db, 'rateCards'));
    const unsubscribeRateCards = onSnapshot(qRateCards, (snapshot) => {
      const rcData = snapshot.docs.map(doc => {
        const data = doc.data();
        const projectId = doc.ref.parent.parent?.id;
        return {
          id: doc.id,
          projectId,
          ...data
        };
      });
      setAllRateCards(rcData);
    }, (error) => {
      handleDataError(error, OperationType.LIST, 'rateCards');
    });

    // Fetch all tasks
    const qAllTasks = query(collectionGroup(db, 'tasks'));
    const unsubscribeAllTasks = onSnapshot(qAllTasks, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => {
        const data = doc.data();
        const projectId = doc.ref.parent.parent?.id;
        return {
          id: doc.id,
          projectId,
          ...data
        };
      });
      setAllTasks(tasksData);
      setLoadingEconomic(false);
    }, (error) => {
      console.error("Error fetching all tasks:", error);
      setLoadingEconomic(false);
    });

    return () => {
      unsubscribeRateCards();
      unsubscribeAllTasks();
    };
  }, [activeTab]);

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredMembers = teamMembers.filter(m => 
    m.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    m.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedMember = teamMembers.find(m => m.id === selectedMemberId);

  // Calculate stats for the selected member
  const completedTasks = memberTasks.filter(t => t.status === 'completed').length;
  const totalTasks = memberTasks.length;
  const activeTasks = memberTasks.filter(t => t.status !== 'completed');
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Calculate economic data
  const accessibleProjectIds = new Set(projects.map(p => p.id));
  const filteredRateCards = allRateCards.filter(rc => accessibleProjectIds.has(rc.projectId));

  const globalUserTotals: Record<string, { name: string; income: number; cost: number; output: number }> = {};

  const economicData = filteredRateCards.map(card => {
    const project = projects.find(p => p.id === card.projectId);
    const cardTasks = allTasks.filter(t => t.projectId === card.projectId);
    
    let totalUnits = 0;
    if (card.syncExternal) {
      totalUnits = card.currentValue || 0;
    } else {
      cardTasks.forEach(task => {
        if (task.indicator && task.indicator.toLowerCase() === card.indicator.toLowerCase()) {
          const value = task.indicatorValue || 0;
          const progress = task.progress || 0;
          totalUnits += value * (progress / 100);
        }
      });
    }
    
    const totalIncome = getRateCardIncomeValue(totalUnits, card);
    const totalCost = getRateCardCostValue(totalUnits, card);
    const totalGenerated = getRateCardOutputValue(totalUnits, card);

    if (card.userStats) {
      Object.entries(card.userStats).forEach(([userId, units]: [string, any]) => {
        const member = teamMembers.find(m => m.id === userId);
        const userName = member ? member.name : 'Usuario Desconocido';
        const amount = Number(units || 0);
        
        if (!globalUserTotals[userId]) {
          globalUserTotals[userId] = { name: userName, income: 0, cost: 0, output: 0 };
        }
        globalUserTotals[userId].income += getRateCardIncomeValue(amount, card);
        globalUserTotals[userId].cost += getRateCardCostValue(amount, card);
        globalUserTotals[userId].output += getRateCardOutputValue(amount, card);
      });
    }
    
    return {
      ...card,
      projectName: project?.name || 'Proyecto Desconocido',
      totalUnits,
      totalIncome,
      totalCost,
      totalGenerated,
      margin: totalIncome - totalCost,
    };
  }).filter(card => 
    card.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    card.projectName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const globalUserChartData = Object.values(globalUserTotals)
    .map(row => ({ ...row, margin: row.income - row.cost }))
    .sort((a, b) => (b.income + b.output) - (a.income + a.output));
  const totalMoneyGenerated = economicData
    .filter(isCurrencyRateCard)
    .reduce((sum, card) => sum + card.totalIncome, 0);
  const totalMoneyCost = economicData.reduce((sum, card) => sum + card.totalCost, 0);
  const totalMoneyMargin = totalMoneyGenerated - totalMoneyCost;
  const totalUnitOutput = economicData
    .filter((card) => !isCurrencyRateCard(card))
    .reduce((sum, card) => sum + card.totalGenerated, 0);
  const unitMetricCount = economicData.filter((card) => !isCurrencyRateCard(card)).length;
  const selectedEconomicRate = economicData.find(card => card.id === selectedEconomicRateId) || economicData[0] || null;
  const selectedEconomicContributors = selectedEconomicRate?.userStats
    ? Object.entries(selectedEconomicRate.userStats)
      .map(([userId, units]: [string, any]) => {
        const member = teamMembers.find(m => m.id === userId);
        const amount = Number(units || 0);
        return {
          userId,
          name: member?.name || 'Usuario Desconocido',
          units: amount,
          income: getRateCardIncomeValue(amount, selectedEconomicRate),
          cost: getRateCardCostValue(amount, selectedEconomicRate),
          output: getRateCardOutputValue(amount, selectedEconomicRate),
        };
      })
      .sort((left, right) => right.units - left.units)
      .slice(0, 5)
    : [];
  const formatMoney = (value: number, currency = 'USD') =>
    value.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });

  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Rate Cards & Logros</h1>
          <p className="text-slate-500 mt-1">Monitorea proyectos y desempeño individual del equipo.</p>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-lg">
          <button 
            onClick={() => handleTabChange('projects')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'projects' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Por Proyecto
          </button>
          <button 
            onClick={() => handleTabChange('people')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'people' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Por Persona
          </button>
          <button 
            onClick={() => handleTabChange('economic')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'economic' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Económica
          </button>
        </div>
      </div>

      {activeTab === 'projects' ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <CreditCard className="text-indigo-500" size={20} />
                Proyectos con Rate Cards
              </CardTitle>
              <div className="relative w-full sm:w-64">
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
                  <TableHead className="font-semibold text-slate-600">Última Actualización</TableHead>
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
                      <TableCell className="text-slate-500 text-sm">
                        {project.updatedAt?.toDate().toLocaleDateString() || 'N/A'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/projects/${project.id}?tab=rate-cards`}>
                          <Button variant="ghost" size="sm" className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 gap-1">
                            <ExternalLink size={14} />
                            Ver Rate Cards
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
      ) : activeTab === 'people' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Sidebar: Member List */}
          <div className="lg:col-span-1">
            <Card className="border-slate-200 shadow-sm h-full">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Users className="text-indigo-500" size={20} />
                  Equipo
                </CardTitle>
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Buscar persona..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full h-9 pl-9 pr-4 rounded-md border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>
              </CardHeader>
              <CardContent className="p-0 max-h-[600px] overflow-y-auto">
                <div className="divide-y divide-slate-100">
                  {filteredMembers.map((member) => (
                    <button
                      key={member.id}
                      onClick={() => handleSelectMember(member.id)}
                      className={`w-full text-left p-4 hover:bg-slate-50 transition-colors flex items-center gap-3 ${selectedMemberId === member.id ? 'bg-indigo-50 border-r-4 border-indigo-500' : ''}`}
                    >
                      <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold overflow-hidden relative">
                        {member.photoURL ? (
                          <Image src={member.photoURL} alt={member.name} fill className="object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          member.name.charAt(0)
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{member.name}</p>
                        <p className="text-xs text-slate-500 truncate">{member.roleName || 'Miembro'}</p>
                      </div>
                    </button>
                  ))}
                  {filteredMembers.length === 0 && (
                    <div className="p-8 text-center text-slate-500 text-sm">
                      No se encontraron miembros.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content: Member Details & Tasks */}
          <div className="lg:col-span-2 space-y-6">
            {!selectedMemberId ? (
              <div className="bg-slate-50 rounded-xl border border-dashed border-slate-300 p-12 text-center h-full flex flex-col items-center justify-center">
                <User className="w-12 h-12 text-slate-300 mb-4" />
                <h3 className="text-lg font-medium text-slate-900">Selecciona una persona</h3>
                <p className="text-slate-500 max-w-xs mx-auto mt-2">
                  Elige un miembro del equipo para ver sus logros y tareas en ejecución.
                </p>
              </div>
            ) : (
              <>
                {/* Member Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="border-slate-200 shadow-sm">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-slate-500 text-sm font-medium">Logros</span>
                        <CheckCircle2 className="text-emerald-500" size={18} />
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-slate-900">{completedTasks}</span>
                        <span className="text-slate-400 text-sm">tareas completadas</span>
                      </div>
                      <div className="mt-4">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-500">Tasa de éxito</span>
                          <span className="font-bold text-indigo-600">{completionRate}%</span>
                        </div>
                        <Progress value={completionRate} className="h-1.5" />
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className="border-slate-200 shadow-sm">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-slate-500 text-sm font-medium">En Ejecución</span>
                        <Clock className="text-amber-500" size={18} />
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-slate-900">{activeTasks.length}</span>
                        <span className="text-slate-400 text-sm">tareas activas</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-4">
                        Distribuidas en {new Set(activeTasks.map(t => t.projectId)).size} proyectos.
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-sm">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-slate-500 text-sm font-medium">Total Asignado</span>
                        <ListTodo className="text-indigo-500" size={18} />
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-slate-900">{totalTasks}</span>
                        <span className="text-slate-400 text-sm">tareas totales</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-4">
                        Historial completo de asignaciones.
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Active Tasks Table */}
                <Card className="border-slate-200 shadow-sm">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-semibold flex items-center gap-2">
                      <BarChart3 className="text-indigo-500" size={20} />
                      Tareas en Ejecución
                    </CardTitle>
                    <CardDescription>
                      Listado de tareas activas de {selectedMember?.name} en todos los proyectos.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/50">
                          <TableHead className="font-semibold text-slate-600">Tarea</TableHead>
                          <TableHead className="font-semibold text-slate-600">Proyecto</TableHead>
                          <TableHead className="font-semibold text-slate-600">Estado</TableHead>
                          <TableHead className="font-semibold text-slate-600 text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingTasks ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8 text-slate-500">Cargando tareas...</TableCell>
                          </TableRow>
                        ) : activeTasks.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8 text-slate-500">No hay tareas en ejecución.</TableCell>
                          </TableRow>
                        ) : (
                          activeTasks.map((task) => {
                            const project = projects.find(p => p.id === task.projectId);
                            return (
                              <TableRow key={task.id} className="hover:bg-slate-50/50">
                                <TableCell>
                                  <div className="font-medium text-slate-900">{task.title}</div>
                                  <div className="text-xs text-slate-500 truncate max-w-[200px]">{task.description}</div>
                                </TableCell>
                                <TableCell className="text-sm text-slate-600">
                                  {project?.name || 'Cargando...'}
                                </TableCell>
                                <TableCell>
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                    task.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 
                                    task.status === 'todo' ? 'bg-slate-100 text-slate-600' : 
                                    'bg-amber-100 text-amber-700'
                                  }`}>
                                    {task.status === 'in_progress' ? 'En Progreso' : 
                                     task.status === 'todo' ? 'Pendiente' : 
                                     task.status}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Link href={`/projects/${task.projectId}?tab=tasks`}>
                                    <Button variant="ghost" size="sm" className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50">
                                      Ir a Tarea
                                    </Button>
                                  </Link>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card className="border-emerald-100 bg-emerald-50 shadow-sm">
              <CardContent className="p-5">
                <h2 className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Ingresos</h2>
                <p className="mt-2 text-3xl font-black text-slate-900">{formatMoney(totalMoneyGenerated)}</p>
                <span className="mt-1 block text-xs font-semibold text-emerald-700">rates monetarios</span>
              </CardContent>
            </Card>
            <Card className="border-rose-100 bg-rose-50 shadow-sm">
              <CardContent className="p-5">
                <h2 className="text-xs font-bold text-rose-700 uppercase tracking-wider">Costos</h2>
                <p className="mt-2 text-3xl font-black text-slate-900">{formatMoney(totalMoneyCost)}</p>
                <span className="mt-1 block text-xs font-semibold text-rose-700">costo de producción</span>
              </CardContent>
            </Card>
            <Card className="border-indigo-100 bg-indigo-50 shadow-sm">
              <CardContent className="p-5">
                <h2 className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Margen</h2>
                <p className={`mt-2 text-3xl font-black ${totalMoneyMargin < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{formatMoney(totalMoneyMargin)}</p>
                <span className="mt-1 block text-xs font-semibold text-indigo-700">ingreso menos costo</span>
              </CardContent>
            </Card>
            <Card className="border-sky-100 bg-sky-50 shadow-sm">
              <CardContent className="p-5">
                <h2 className="text-xs font-bold text-sky-700 uppercase tracking-wider">Productividad</h2>
                <p className="mt-2 text-3xl font-black text-slate-900">{totalUnitOutput.toLocaleString('es-CO', { maximumFractionDigits: 1 })}</p>
                <span className="mt-1 block text-xs font-semibold text-sky-700">{unitMetricCount} rates por unidades</span>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="border-slate-200 shadow-sm xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-500 flex items-center gap-2">
                  <Users size={16} className="text-indigo-500" />
                  Contribución por usuario
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[200px]">
                {globalUserChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={globalUserChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(value) => `$${value}`} />
                      <RechartsTooltip 
                        formatter={(value: any, name: any) => [
                          name === 'output'
                            ? Number(value).toLocaleString('es-CO', { maximumFractionDigits: 1 })
                            : formatMoney(Number(value)),
                          name === 'income' ? 'Ingreso' : name === 'cost' ? 'Costo' : name === 'margin' ? 'Margen' : 'Productividad',
                        ]}
                        cursor={{ fill: '#f1f5f9' }}
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} />
                      <Bar dataKey="cost" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={32} />
                      <Bar dataKey="output" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-400 text-sm italic">
                    No hay datos por usuario aún
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <DollarSign size={16} className="text-indigo-500" />
                  Rate seleccionado
                </CardTitle>
                <select
                  value={selectedEconomicRate?.id || ''}
                  onChange={(event) => setSelectedEconomicRateId(event.target.value)}
                  className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  {economicData.map(card => (
                    <option key={card.id} value={card.id}>{card.name} · {card.projectName}</option>
                  ))}
                </select>
              </CardHeader>
              <CardContent>
                {selectedEconomicRate ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                        {isCurrencyRateCard(selectedEconomicRate) ? 'Monetario' : 'Productividad'}
                      </p>
                      <p className="mt-1 font-black text-slate-900">{selectedEconomicRate.name}</p>
                      <p className="text-xs text-slate-500">{selectedEconomicRate.projectName}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-emerald-50 p-3">
                        <p className="font-bold text-emerald-700">Ingreso</p>
                        <p className="mt-1 font-black text-slate-900">{formatMoney(selectedEconomicRate.totalIncome, selectedEconomicRate.currency || 'USD')}</p>
                      </div>
                      <div className="rounded-lg bg-rose-50 p-3">
                        <p className="font-bold text-rose-700">Costo</p>
                        <p className="mt-1 font-black text-slate-900">{formatMoney(selectedEconomicRate.totalCost, selectedEconomicRate.currency || 'USD')}</p>
                      </div>
                      <div className="rounded-lg bg-indigo-50 p-3">
                        <p className="font-bold text-indigo-700">Resultado</p>
                        <p className="mt-1 font-black text-slate-900">{formatRateCardValue(selectedEconomicRate.totalGenerated, selectedEconomicRate)}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="font-bold text-slate-600">Unidades</p>
                        <p className="mt-1 font-black text-slate-900">{formatRateCardUnits(selectedEconomicRate.totalUnits, selectedEconomicRate, 1)}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Top personas</p>
                      {selectedEconomicContributors.length === 0 ? (
                        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Aún no hay contribuciones por persona.</p>
                      ) : (
                        selectedEconomicContributors.map((person: any) => (
                          <div key={person.userId} className="flex items-center justify-between rounded-lg border border-slate-100 p-2 text-xs">
                            <span className="font-semibold text-slate-700">{person.name}</span>
                            <span className="font-black text-indigo-600">{formatRateCardUnits(person.units, selectedEconomicRate, 1)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                    Selecciona un rate card para ver su pulso.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <BarChart3 className="text-indigo-500" size={20} />
                  Desglose por Rate Card
                </CardTitle>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Buscar rate card o proyecto..." 
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
                    <TableHead className="font-semibold text-slate-600">Rate Card</TableHead>
                    <TableHead className="font-semibold text-slate-600">Proyecto</TableHead>
                    <TableHead className="font-semibold text-slate-600">Indicador</TableHead>
                    <TableHead className="font-semibold text-slate-600">Tipo / Factor</TableHead>
                    <TableHead className="font-semibold text-slate-600 text-right">Resultado</TableHead>
                    <TableHead className="font-semibold text-slate-600 text-right">Ingreso</TableHead>
                    <TableHead className="font-semibold text-slate-600 text-right">Costo</TableHead>
                    <TableHead className="font-semibold text-slate-600 text-right">Margen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingEconomic ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-slate-500">Cargando datos económicos...</TableCell>
                    </TableRow>
                  ) : economicData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-slate-500">No se encontraron rate cards.</TableCell>
                    </TableRow>
                  ) : (
                    economicData.map((card) => (
                      <TableRow key={card.id} className="hover:bg-slate-50/50">
                        <TableCell className="font-medium text-slate-900">{card.name}</TableCell>
                        <TableCell className="text-slate-600">{card.projectName}</TableCell>
                        <TableCell className="text-slate-600">{card.indicator}</TableCell>
                        <TableCell className="font-medium text-indigo-600">
                          <div>{formatRateCardRate(isCurrencyRateCard(card) ? getRateCardIncomeRate(card) : card.rate, card)}</div>
                          {getRateCardCostRate(card) > 0 && (
                            <div className="mt-1 text-[11px] font-semibold text-rose-600">
                              Costo {formatMoney(getRateCardCostRate(card), card.currency || 'USD')} / {card.indicator || 'unidad'}
                            </div>
                          )}
                          <div className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                            {isCurrencyRateCard(card) ? 'Dinero' : 'Unidad / medida'}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-medium text-emerald-600">
                            {formatRateCardValue(card.totalGenerated, card)}
                          </div>
                          <div className="text-xs text-slate-500 font-normal">{formatRateCardUnits(card.totalUnits, card, 1)}</div>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-emerald-700">
                          {formatMoney(card.totalIncome, card.currency || 'USD')}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-rose-700">
                          {formatMoney(card.totalCost, card.currency || 'USD')}
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${card.margin < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                          {formatMoney(card.margin, card.currency || 'USD')}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </DashboardLayout>
  );
}
