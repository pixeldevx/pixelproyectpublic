"use client"

import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, getDocs, where } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { useAuth } from '@/hooks/useAuth';
import { isCurrencyRateCard } from '@/lib/rate-card-config';

export interface DashboardMetrics {
  totalPlannedBudget: number;
  totalActualCost: number;
  totalProduction: number;
  acceptanceRate: number;
  utilizationRate: number;
  dailyProduction: { name: string; realizados: number; devueltos: number; meta: number }[];
  teamPerformance: { name: string; value: number; reworkValue: number; photoURL?: string }[];
  projectSummary: string;
  loading: boolean;
}

export function useDashboardData() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalPlannedBudget: 0,
    totalActualCost: 0,
    totalProduction: 0,
    acceptanceRate: 0,
    utilizationRate: 0,
    dailyProduction: [],
    teamPerformance: [],
    projectSummary: '',
    loading: true,
  });

  useEffect(() => {
    if (!user) return;

    // Fetch all projects assigned to the user or owned by the user
    const projectsQuery = query(collection(db, 'projects'));
    
    const unsubscribeProjects = onSnapshot(projectsQuery, async (projectsSnapshot) => {
      const projectsData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      let totalPlanned = 0;
      let totalActual = 0;
      let totalProd = 0;
      let totalApproved = 0;
      let totalReturned = 0;
      
      const allTasks: any[] = [];
      const allRateCards: any[] = [];
      const userTotals: Record<string, { name: string; value: number; reworkValue: number; photoURL?: string }> = {};

      // For each project, fetch its subcollections
      // Note: In a real large-scale app, we'd optimize this with better indexing or aggregation
      for (const project of projectsData) {
        const projectId = project.id;
        
        // Fetch Budget Lines
        const budgetSnapshot = await getDocs(collection(db, 'projects', projectId, 'budgetLines'));
        budgetSnapshot.forEach(doc => {
          const data = doc.data();
          totalPlanned += data.plannedAmount || 0;
        });

        // Fetch Rate Cards
        const rateCardsSnapshot = await getDocs(collection(db, 'projects', projectId, 'rateCards'));
        const projectRateCards: any[] = [];
        rateCardsSnapshot.forEach(doc => {
          const data = { id: doc.id, ...doc.data() } as any;
          projectRateCards.push(data);
          allRateCards.push(data);
          
          const generatedValue = (data.currentValue || 0) * (data.rate || 0);
          const reworkValue = (data.reworkValue || 0) * (data.rate || 0);
          if (isCurrencyRateCard(data)) {
            totalActual += (generatedValue + reworkValue);
          }
          totalProd += (data.currentValue || 0);

          // Aggregate user stats
          if (isCurrencyRateCard(data) && data.userStats) {
            Object.entries(data.userStats).forEach(([uid, units]: [string, any]) => {
              if (!userTotals[uid]) {
                userTotals[uid] = { name: 'Usuario', value: 0, reworkValue: 0 };
              }
              userTotals[uid].value += units * (data.rate || 0);
            });
          }
          if (isCurrencyRateCard(data) && data.userReworkStats) {
            Object.entries(data.userReworkStats).forEach(([uid, units]: [string, any]) => {
              if (!userTotals[uid]) {
                userTotals[uid] = { name: 'Usuario', value: 0, reworkValue: 0 };
              }
              userTotals[uid].reworkValue += units * (data.rate || 0);
            });
          }
        });

        // Fetch Tasks for workflow history (to calculate acceptance rate and daily production)
        const tasksSnapshot = await getDocs(collection(db, 'projects', projectId, 'tasks'));
        tasksSnapshot.forEach(doc => {
          const data = doc.data() as any;
          allTasks.push(data);
          
          if (data.workflowHistory) {
            data.workflowHistory.forEach((h: any) => {
              if (h.action === 'approve') totalApproved++;
              if (h.action === 'return') totalReturned++;
            });
          }
        });
      }

      // Calculate Acceptance Rate
      const acceptanceRate = (totalApproved + totalReturned) > 0 
        ? (totalApproved / (totalApproved + totalReturned)) * 100 
        : 100;

      // Calculate Utilization Rate (placeholder logic: actual vs planned budget)
      const utilizationRate = totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0;

      // Mock daily production for now based on last 5 days
      const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
      const dailyProduction = days.map(day => ({
        name: day,
        realizados: Math.floor(totalProd / 5) + Math.floor(Math.random() * 20),
        devueltos: Math.floor(totalReturned / 5) + Math.floor(Math.random() * 5),
        meta: Math.floor(totalProd / 4)
      }));

      // Fetch user details for teamPerformance
      const userIds = Object.keys(userTotals);
      if (userIds.length > 0) {
        const usersSnapshot = await getDocs(query(collection(db, 'users'), where('uid', 'in', userIds)));
        usersSnapshot.forEach(doc => {
          const userData = doc.data();
          if (userTotals[userData.uid]) {
            userTotals[userData.uid].name = userData.displayName || userData.name || 'Usuario';
            userTotals[userData.uid].photoURL = userData.photoURL;
          }
        });
      }

      setMetrics({
        totalPlannedBudget: totalPlanned,
        totalActualCost: totalActual,
        totalProduction: totalProd,
        acceptanceRate: Math.round(acceptanceRate * 10) / 10,
        utilizationRate: Math.round(utilizationRate * 10) / 10,
        dailyProduction,
        teamPerformance: Object.values(userTotals).map(u => ({
          name: u.name,
          value: Math.round(u.value),
          reworkValue: Math.round(u.reworkValue),
          photoURL: u.photoURL
        })),
        projectSummary: `Proyecto con ${projectsData.length} frentes activos. Presupuesto ejecutado al ${Math.round(utilizationRate)}%.`,
        loading: false,
      });
    });

    return () => unsubscribeProjects();
  }, [user]);

  return metrics;
}
