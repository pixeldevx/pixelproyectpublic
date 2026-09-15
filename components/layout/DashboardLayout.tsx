"use client"

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import { 
  LayoutDashboard, 
  FolderKanban, 
  Users, 
  FileText, 
  Settings, 
  Bell, 
  ChevronDown,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Inbox,
  ShieldCheck,
  WalletCards,
  PackageSearch,
  UserCircle,
  BriefcaseBusiness,
  KeyRound
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useRolePermissions } from '@/hooks/useRolePermissions';
import { useInboxPendingCount } from '@/hooks/useInboxPendingCount';
import { ProfileModal } from '@/components/settings/ProfileModal';
import { doc, onSnapshot } from '@/lib/supabase/document-store';
import { db } from '@/lib/backend';
import { SYSTEM_ROLE_OPTIONS } from '@/lib/permissions';

const DEFAULT_BRAND_NAME = 'Pixel Project';
const INVENTORY_OVERVIEW_ROLES = new Set(['admin', 'org_admin', 'manager']);
const ROLE_LABELS = Object.fromEntries(
  SYSTEM_ROLE_OPTIONS.map((role) => [role.id, role.name])
) as Record<string, string>;

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, userRole, loading, logout } = useAuth();
  const { permissions: rolePermissions } = useRolePermissions(userRole);
  const isProjectDetailRoute = Boolean(pathname && /^\/projects\/[^/]+/.test(pathname));
  const inboxPendingCount = useInboxPendingCount(!isProjectDetailRoute);
  
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [showLoadingRecovery, setShowLoadingRecovery] = useState(false);
  const [brandName, setBrandName] = useState(DEFAULT_BRAND_NAME);
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const isInitialAuthLoading = loading && !user;
  const canAccessBudgetOverview = ['admin', 'org_admin', 'manager', 'coordinador'].includes(userRole || '');
  const canAccessInventoryOverview = INVENTORY_OVERVIEW_ROLES.has(userRole || '') && rolePermissions.inventoryOverview;
  const canAccessBillingOverview = Boolean(rolePermissions.billingOverview);
  const canAccessPersonnelOverview = Boolean(rolePermissions.personnelOverview);
  const canAccessAdministrationOverview = Boolean(user);
  const roleLabel = ROLE_LABELS[userRole || ''] || 'Perfil de usuario';
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Usuario';
  const userInitial = displayName.charAt(0).toUpperCase();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/');
    }
  }, [loading, router, user]);

  useEffect(() => {
    if (!isInitialAuthLoading) {
      return;
    }

    const timeoutId = window.setTimeout(() => setShowLoadingRecovery(true), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [isInitialAuthLoading]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'app_config', 'branding'),
      (snapshot) => {
        const branding = snapshot.exists() ? snapshot.data() : {};
        setBrandName(branding.companyName || DEFAULT_BRAND_NAME);
        setBrandLogoUrl(branding.logoUrl || '');
      },
      (error) => {
        console.warn('No fue posible cargar la marca de la instancia:', error);
        setBrandName(DEFAULT_BRAND_NAME);
        setBrandLogoUrl('');
      }
    );

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!isProfileMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (profileMenuRef.current?.contains(event.target as Node)) return;
      setIsProfileMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsProfileMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  const handleLogout = async () => {
    setIsProfileMenuOpen(false);
    await logout();
  };

  const openProfileModal = () => {
    setIsProfileMenuOpen(false);
    setIsProfileModalOpen(true);
  };

  if (isInitialAuthLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 px-4">
        <div className="text-center space-y-4">
          <div className="text-slate-900">Cargando...</div>
          {showLoadingRecovery && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500 max-w-sm">
                La sesión está tardando más de lo normal.
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.location.reload()}
                  className="border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Reintentar
                </Button>
                <Button
                  type="button"
                  onClick={() => void logout()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  Cerrar sesión
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 px-4">
        <div className="text-center text-slate-900">Redirigiendo al inicio...</div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-slate-50 text-slate-900 font-sans">
      {/* Sidebar */}
      <aside className={`${isCollapsed ? 'w-20' : 'w-64'} relative z-30 hidden flex-col border-r border-slate-200 bg-white transition-all duration-300 ease-in-out md:flex`}>
        <div className={`h-16 flex items-center ${isCollapsed ? 'justify-center' : 'px-6'} border-b border-slate-200`}>
          <div className="flex items-center gap-2 font-bold text-lg tracking-tight overflow-hidden">
            <div className="relative w-8 h-8 bg-indigo-600 rounded-md flex items-center justify-center text-white shrink-0 overflow-hidden shadow-sm">
              {brandLogoUrl ? (
                <Image
                  src={brandLogoUrl}
                  alt={brandName || DEFAULT_BRAND_NAME}
                  fill
                  sizes="32px"
                  className="object-cover"
                />
              ) : (
                'PX'
              )}
            </div>
            {!isCollapsed && <span className="whitespace-nowrap truncate">{brandName || DEFAULT_BRAND_NAME}</span>}
          </div>
          
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={`absolute -right-3 top-20 w-6 h-6 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:border-indigo-200 shadow-sm z-10 transition-all ${isCollapsed ? 'rotate-180' : ''}`}
            title={isCollapsed ? "Expandir" : "Colapsar"}
          >
            <ChevronLeft size={14} />
          </button>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto overflow-x-hidden">
          {!isCollapsed && (
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 mt-4 px-2 whitespace-nowrap">
              Overview
            </div>
          )}
          <NavItem href="/dashboard" icon={<LayoutDashboard size={18} />} label="Dashboard" active={pathname === '/dashboard'} collapsed={isCollapsed} />
          <NavItem href="/workflows" icon={<Inbox size={18} />} label="Bandeja de entrada" active={pathname?.startsWith('/workflows')} collapsed={isCollapsed} badge={inboxPendingCount} />
          <NavItem href="/projects" icon={<FolderKanban size={18} />} label="Projects" active={pathname?.startsWith('/projects')} collapsed={isCollapsed} />
          <NavItem href="/team" icon={<Users size={18} />} label="Team Performance" active={pathname?.startsWith('/team')} collapsed={isCollapsed} />
          {canAccessPersonnelOverview && (
            <NavItem href="/personnel" icon={<BriefcaseBusiness size={18} />} label="Talento humano" active={pathname?.startsWith('/personnel')} collapsed={isCollapsed} />
          )}
          <NavItem href="/quality" icon={<ShieldCheck size={18} />} label="Calidad global" active={pathname?.startsWith('/quality')} collapsed={isCollapsed} />
          {canAccessInventoryOverview && (
            <NavItem href="/inventory" icon={<PackageSearch size={18} />} label="Inventario global" active={pathname?.startsWith('/inventory')} collapsed={isCollapsed} />
          )}
          {canAccessBudgetOverview && (
            <NavItem href="/budgets" icon={<WalletCards size={18} />} label="Presupuestos" active={pathname?.startsWith('/budgets')} collapsed={isCollapsed} />
          )}
          <NavItem href="/alerts" icon={<Bell size={18} />} label="Alertas" active={pathname?.startsWith('/alerts')} collapsed={isCollapsed} />
          
          {!isCollapsed && (
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 mt-8 px-2 whitespace-nowrap">
              Finance & Billing
            </div>
          )}
          {canAccessBillingOverview && (
            <NavItem href="/billing" icon={<FileText size={18} />} label="Facturación" active={pathname?.startsWith('/billing')} collapsed={isCollapsed} />
          )}
          {canAccessAdministrationOverview && (
            <NavItem href="/administration" icon={<BriefcaseBusiness size={18} />} label="Administrativo" active={pathname?.startsWith('/administration')} collapsed={isCollapsed} />
          )}
          <NavItem href="/settlements" icon={<FileText size={18} />} label="Settlements" active={pathname?.startsWith('/settlements')} collapsed={isCollapsed} />
          <NavItem href="/rate-cards" icon={<FileText size={18} />} label="Rate Cards" active={pathname?.startsWith('/rate-cards')} collapsed={isCollapsed} />
          
          {userRole === 'admin' && !isCollapsed && (
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 mt-8 px-2 whitespace-nowrap">
              System
            </div>
          )}
          {userRole === 'admin' && (
            <NavItem href="/settings" icon={<Settings size={18} />} label="Settings" active={pathname?.startsWith('/settings')} collapsed={isCollapsed} />
          )}
          {userRole === 'admin' && (
            <NavItem href="/licenses" icon={<KeyRound size={18} />} label="Licenciamiento" active={pathname?.startsWith('/licenses')} collapsed={isCollapsed} />
          )}
        </nav>
        
        <div className="p-4 border-t border-slate-200">
          <div 
            className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3 px-2'} py-2 rounded-md hover:bg-slate-100 transition-colors group relative cursor-pointer`}
            onClick={() => setIsProfileModalOpen(true)}
          >
            <div className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden shrink-0 relative">
              {user.photoURL ? (
                <Image 
                  src={user.photoURL} 
                  alt={user.displayName || 'User'} 
                  fill
                  className="object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs font-bold text-slate-500">
                  {userInitial}
                </div>
              )}
            </div>
            {!isCollapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{user.displayName || 'Usuario'}</p>
                  <p className="text-xs text-slate-500 truncate">{user.email}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); void handleLogout(); }}
                  className="text-slate-400 hover:text-red-500 transition-colors" 
                  title="Cerrar sesión"
                >
                  <LogOut size={16} />
                </button>
              </>
            )}
            {isCollapsed && (
              <button 
                onClick={(e) => { e.stopPropagation(); void handleLogout(); }}
                className="absolute -top-2 -right-2 w-5 h-5 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                title="Cerrar sesión"
              >
                <LogOut size={10} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 shrink-0 border-b border-slate-200 bg-white px-3 md:h-16 md:px-8">
          <div className="flex h-full items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3 md:hidden">
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-indigo-600 text-sm font-black text-white shadow-sm">
                {brandLogoUrl ? (
                  <Image
                    src={brandLogoUrl}
                    alt={brandName || DEFAULT_BRAND_NAME}
                    fill
                    sizes="36px"
                    className="object-cover"
                  />
                ) : (
                  'PX'
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-950">{brandName || DEFAULT_BRAND_NAME}</p>
                <p className="truncate text-[11px] font-bold text-slate-400">Operacion inteligente</p>
              </div>
            </div>

            <div className="hidden flex-1 md:block" />
          
            <div className="flex items-center gap-2 md:gap-4">
            {loading && (
              <span className="hidden text-xs font-medium text-slate-400 sm:inline">
                Verificando sesión...
              </span>
            )}

            <div className="relative hidden md:block" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setIsProfileMenuOpen((current) => !current)}
                className="flex max-w-[280px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/40"
                aria-haspopup="menu"
                aria-expanded={isProfileMenuOpen}
              >
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-indigo-50 ring-1 ring-indigo-100">
                  {user.photoURL ? (
                    <Image
                      src={user.photoURL}
                      alt={displayName}
                      fill
                      className="object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-xs font-black text-indigo-700">
                      {userInitial}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black leading-4 text-slate-950">{displayName}</p>
                  <p className="truncate text-[11px] font-bold text-slate-500">{roleLabel}</p>
                </div>
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-slate-400 transition-transform ${isProfileMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isProfileMenuOpen && (
                <div
                  className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/12"
                  role="menu"
                >
                  <div className="border-b border-slate-100 bg-slate-50 p-4">
                    <div className="flex items-center gap-3">
                      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-indigo-100 ring-1 ring-indigo-200">
                        {user.photoURL ? (
                          <Image
                            src={user.photoURL}
                            alt={displayName}
                            fill
                            className="object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-sm font-black text-indigo-700">
                            {userInitial}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-950">{displayName}</p>
                        <p className="truncate text-xs font-semibold text-slate-500">{user.email}</p>
                      </div>
                    </div>
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white px-3 py-1 text-[11px] font-black uppercase tracking-wider text-indigo-700">
                      <ShieldCheck size={13} />
                      {roleLabel}
                    </div>
                  </div>

                  <div className="p-2">
                    <button
                      type="button"
                      onClick={openProfileModal}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-slate-700 transition hover:bg-slate-50 hover:text-indigo-700"
                      role="menuitem"
                    >
                      <UserCircle size={18} className="text-slate-400" />
                      Ver y editar perfil
                    </button>
                    {userRole === 'admin' && (
                      <Link
                        href="/settings"
                        onClick={() => setIsProfileMenuOpen(false)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 hover:text-indigo-700"
                        role="menuitem"
                      >
                        <Settings size={18} className="text-slate-400" />
                        Configuración del sistema
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-red-600 transition hover:bg-red-50"
                      role="menuitem"
                    >
                      <LogOut size={18} />
                      Cerrar sesión
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={openProfileModal}
              className="relative h-9 w-9 overflow-hidden rounded-full bg-slate-100 md:hidden"
              aria-label="Abrir perfil"
            >
              {user.photoURL ? (
                <Image
                  src={user.photoURL}
                  alt={user.displayName || 'Usuario'}
                  fill
                  className="object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs font-black text-slate-500">
                  {userInitial}
                </span>
              )}
            </button>
            </div>
          </div>
        </header>
        
        {/* Page Content */}
        <div className="flex-1 overflow-y-auto p-3 pb-24 sm:p-5 sm:pb-24 md:p-8">
          <div className="w-full">
            {children}
          </div>
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-14px_30px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        <div className="grid grid-cols-4 gap-1">
          <MobileNavItem href="/dashboard" icon={<LayoutDashboard size={18} />} label="Dashboard" active={pathname === '/dashboard'} />
          <MobileNavItem href="/workflows" icon={<Inbox size={18} />} label="Bandeja" active={pathname?.startsWith('/workflows')} badge={inboxPendingCount} />
          <MobileNavItem href="/projects" icon={<FolderKanban size={18} />} label="Proyectos" active={pathname?.startsWith('/projects')} />
          <MobileNavItem href="/alerts" icon={<Bell size={18} />} label="Alertas" active={pathname?.startsWith('/alerts')} />
        </div>
      </nav>

      <ProfileModal 
        user={user} 
        isOpen={isProfileModalOpen} 
        onClose={() => setIsProfileModalOpen(false)} 
      />
    </div>
  );
}

function NavItem({ href, icon, label, active, collapsed, badge }: { href: string, icon: React.ReactNode, label: string, active?: boolean, collapsed?: boolean, badge?: number }) {
  return (
    <Link 
      href={href} 
      className={`relative flex items-center ${collapsed ? 'justify-center' : 'gap-3 px-3'} py-2 rounded-md transition-all text-sm font-medium ${
        active 
          ? 'bg-indigo-50 text-indigo-700' 
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
      title={collapsed ? label : undefined}
    >
      <span className={`${active ? 'text-indigo-600' : 'text-slate-400'} shrink-0`}>{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
      {Boolean(badge) && (
        <span className={`${collapsed ? 'absolute -right-1 -top-1' : 'ml-auto'} min-w-5 rounded-full bg-indigo-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white`}>
          {badge && badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

function MobileNavItem({ href, icon, label, active, badge }: { href: string, icon: React.ReactNode, label: string, active?: boolean, badge?: number }) {
  return (
    <Link
      href={href}
      className={`relative flex min-h-[54px] flex-col items-center justify-center rounded-2xl text-[11px] font-black transition-all ${
        active
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      <span className={active ? 'text-white' : 'text-slate-400'}>{icon}</span>
      <span className="mt-1 max-w-full truncate px-1">{label}</span>
      {Boolean(badge) && (
        <span className={`absolute right-2 top-1.5 min-w-5 rounded-full px-1.5 text-center text-[10px] font-black leading-5 ${
          active ? 'bg-white text-indigo-700' : 'bg-indigo-600 text-white'
        }`}>
          {badge && badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}
