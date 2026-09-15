"use client"

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = "Ha ocurrido un error inesperado.";
      let isSupabaseError = false;

      try {
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.error && parsed.operationType) {
            isSupabaseError = true;
            errorMessage = `Error de base de datos: ${parsed.error} (${parsed.operationType} en ${parsed.path})`;
          }
        }
      } catch (e) {
        // Not a JSON error message
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-8 text-center bg-slate-50 rounded-2xl border border-slate-200">
          <div className="p-4 bg-red-50 rounded-full text-red-600 mb-4">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">¡Ups! Algo salió mal</h2>
          <p className="text-slate-600 max-w-md mb-6">
            {errorMessage}
          </p>
          <Button 
            onClick={() => window.location.reload()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <RefreshCcw size={18} className="mr-2" /> Recargar aplicación
          </Button>
          
          {isSupabaseError && (
            <p className="mt-4 text-xs text-slate-400">
              Si el problema persiste, contacta al administrador para revisar los permisos de Supabase.
            </p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
