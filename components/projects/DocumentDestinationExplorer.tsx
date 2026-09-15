"use client";

import React from "react";
import { Building2, Check, ChevronRight, Folder, FolderOpen, Loader2, Search, X } from "lucide-react";
import { collection, doc, getDoc, getDocs, query, where } from "@/lib/supabase/document-store";
import { db } from "@/lib/backend";
import { loadProjectDocumentFolders } from "@/lib/document-folders";
import { getOrganizationIds } from "@/lib/organizations";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { canLoadProjectForUser } from "@/lib/project-access";

export type DocumentRepositoryDestination = {
  projectId: string;
  projectName: string;
  folderId: string | null;
  folderPath: string;
  folderNames: string[];
};

type DocumentDestinationExplorerProps = {
  isOpen: boolean;
  onClose: () => void;
  sourceProjectId: string;
  sourceProject?: any;
  initialDestination?: Partial<DocumentRepositoryDestination> | null;
  onSelect: (destination: DocumentRepositoryDestination) => void;
};

const getProjectName = (project: any) =>
  String(project?.name || project?.projectName || project?.title || "Proyecto sin nombre");

const getFolderChain = (folderId: string | null, folders: any[]) => {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [String(folder.id), folder]));
  const chain: any[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);

  while (current?.id && !visited.has(String(current.id))) {
    visited.add(String(current.id));
    chain.unshift(current);
    current = current.parentFolderId ? byId.get(String(current.parentFolderId)) : null;
  }

  return chain;
};

export function DocumentDestinationExplorer({
  isOpen,
  onClose,
  sourceProjectId,
  sourceProject,
  initialDestination,
  onSelect,
}: DocumentDestinationExplorerProps) {
  const { user, userRole, userOrganizationId, userOrganizationIds } = useAuth();
  const [projects, setProjects] = React.useState<any[]>([]);
  const [folders, setFolders] = React.useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = React.useState("");
  const [currentFolderId, setCurrentFolderId] = React.useState<string | null>(null);
  const [projectSearch, setProjectSearch] = React.useState("");
  const [folderSearch, setFolderSearch] = React.useState("");
  const [loadingProjects, setLoadingProjects] = React.useState(false);
  const [loadingFolders, setLoadingFolders] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!isOpen || !sourceProjectId) return;
    let cancelled = false;

    const loadProjects = async () => {
      setLoadingProjects(true);
      setError("");
      try {
        let resolvedSourceProject = sourceProject;
        if (!resolvedSourceProject?.id) {
          const sourceSnapshot = await getDoc(doc(db, "projects", sourceProjectId));
          resolvedSourceProject = sourceSnapshot.exists()
            ? { id: sourceSnapshot.id, ...sourceSnapshot.data() }
            : null;
        }

        if (!resolvedSourceProject) {
          throw new Error("No fue posible validar el proyecto de origen.");
        }

        const sourceOrganizationIds = getOrganizationIds(resolvedSourceProject);
        const [snapshot, memberSnapshot] = await Promise.all([
          getDocs(collection(db, "projects")),
          user?.email
            ? getDocs(query(collection(db, "team_members"), where("email", "==", user.email)))
            : Promise.resolve(null),
        ]);
        const assignedIds = Array.from(new Set([
          user?.uid,
          ...(memberSnapshot?.docs || []).flatMap((item) => {
            const member = item.data();
            return [item.id, member?.uid, member?.authUserId, member?.email];
          }),
        ].filter(Boolean).map(String)));
        const managedOrganizationIds = userOrganizationIds.length > 0
          ? userOrganizationIds
          : userOrganizationId
            ? [userOrganizationId]
            : [];
        const accessibleProjects = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((project) => {
            if (project.id === sourceProjectId) return true;
            if (sourceOrganizationIds.length === 0) return false;
            const candidateOrganizationIds = getOrganizationIds(project);
            return candidateOrganizationIds.some((id) => sourceOrganizationIds.includes(id)) &&
              canLoadProjectForUser(project, {
                assignedIds,
                managedOrganizationIds,
                userId: user?.uid,
                userRole,
              });
          })
          .sort((left, right) => {
            if (left.id === sourceProjectId) return -1;
            if (right.id === sourceProjectId) return 1;
            return getProjectName(left).localeCompare(getProjectName(right), "es");
          });

        if (cancelled) return;
        setProjects(accessibleProjects);
        const preferredProjectId = accessibleProjects.some(
          (project) => project.id === initialDestination?.projectId,
        )
          ? String(initialDestination?.projectId)
          : sourceProjectId;
        setSelectedProjectId(preferredProjectId);
      } catch (loadError: any) {
        if (!cancelled) setError(loadError?.message || "No se pudieron cargar los proyectos.");
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    };

    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, [
    initialDestination?.projectId,
    isOpen,
    sourceProject,
    sourceProjectId,
    user?.email,
    user?.uid,
    userOrganizationId,
    userOrganizationIds,
    userRole,
  ]);

  React.useEffect(() => {
    if (!isOpen || !selectedProjectId) return;
    let cancelled = false;

    const loadFolders = async () => {
      setLoadingFolders(true);
      setError("");
      try {
        const nextFolders = await loadProjectDocumentFolders(selectedProjectId);
        if (cancelled) return;
        setFolders(nextFolders);
        const preferredFolderId =
          selectedProjectId === initialDestination?.projectId &&
          initialDestination?.folderId &&
          nextFolders.some((folder) => folder.id === initialDestination.folderId)
            ? String(initialDestination.folderId)
            : null;
        setCurrentFolderId(preferredFolderId);
        setFolderSearch("");
      } catch (loadError: any) {
        if (!cancelled) {
          setFolders([]);
          setCurrentFolderId(null);
          setError(loadError?.message || "No se pudieron cargar las carpetas del proyecto.");
        }
      } finally {
        if (!cancelled) setLoadingFolders(false);
      }
    };

    void loadFolders();
    return () => {
      cancelled = true;
    };
  }, [initialDestination?.folderId, initialDestination?.projectId, isOpen, selectedProjectId]);

  if (!isOpen) return null;

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const currentChain = getFolderChain(currentFolderId, folders);
  const normalizedProjectSearch = projectSearch.trim().toLocaleLowerCase();
  const filteredProjects = projects.filter((project) =>
    getProjectName(project).toLocaleLowerCase().includes(normalizedProjectSearch),
  );
  const normalizedFolderSearch = folderSearch.trim().toLocaleLowerCase();
  const visibleFolders = folders
    .filter((folder) => {
      if (normalizedFolderSearch) {
        return String(folder.name || "").toLocaleLowerCase().includes(normalizedFolderSearch);
      }
      return String(folder.parentFolderId || "") === String(currentFolderId || "");
    })
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "es"));

  const confirmSelection = () => {
    if (!selectedProject) return;
    const folderNames = currentChain.map((folder) => String(folder.name || "Carpeta"));
    onSelect({
      projectId: selectedProject.id,
      projectName: getProjectName(selectedProject),
      folderId: currentFolderId,
      folderPath: folderNames.join(" / "),
      folderNames,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">Elegir destino documental</h3>
            <p className="mt-1 text-xs text-slate-500">
              Solo aparecen proyectos accesibles que pertenecen a la misma organización.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={19} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex min-h-[230px] flex-col border-b border-slate-100 bg-slate-50/70 p-4 md:border-b-0 md:border-r">
            <label className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-500">Repositorio / proyecto</label>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
              <input
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                placeholder="Buscar proyecto"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {loadingProjects ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500"><Loader2 size={15} className="animate-spin" /> Cargando proyectos...</div>
              ) : filteredProjects.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-center text-xs text-slate-500">No hay proyectos disponibles.</div>
              ) : filteredProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedProjectId(project.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${selectedProjectId === project.id ? "bg-indigo-600 font-bold text-white" : "text-slate-700 hover:bg-white"}`}
                >
                  <Building2 size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{getProjectName(project)}</span>
                  {project.id === sourceProjectId && <span className={`text-[9px] uppercase ${selectedProjectId === project.id ? "text-indigo-100" : "text-indigo-500"}`}>Actual</span>}
                </button>
              ))}
            </div>
          </aside>

          <section className="flex min-h-[330px] min-w-0 flex-col p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs font-bold text-slate-600">
                <button type="button" onClick={() => setCurrentFolderId(null)} className="rounded px-1.5 py-1 hover:bg-indigo-50 hover:text-indigo-700">
                  Documentación del proyecto
                </button>
                {currentChain.map((folder) => (
                  <React.Fragment key={folder.id}>
                    <ChevronRight size={13} className="text-slate-300" />
                    <button type="button" onClick={() => setCurrentFolderId(String(folder.id))} className="max-w-[180px] truncate rounded px-1.5 py-1 hover:bg-indigo-50 hover:text-indigo-700">
                      {folder.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
              <div className="relative w-full shrink-0 sm:w-52">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={15} />
                <input
                  value={folderSearch}
                  onChange={(event) => setFolderSearch(event.target.value)}
                  placeholder="Buscar carpeta"
                  className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/40 p-2">
              {loadingFolders ? (
                <div className="flex h-40 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={17} className="animate-spin" /> Cargando carpetas...</div>
              ) : visibleFolders.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center text-center text-slate-400">
                  <FolderOpen size={30} className="mb-2" />
                  <p className="text-sm font-bold">{normalizedFolderSearch ? "No se encontraron carpetas" : "Esta ubicación no tiene subcarpetas"}</p>
                  <p className="mt-1 text-xs">Puedes seleccionar la ubicación actual.</p>
                </div>
              ) : visibleFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => {
                    setCurrentFolderId(String(folder.id));
                    setFolderSearch("");
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-white hover:text-indigo-700 hover:shadow-sm"
                >
                  <Folder size={18} className="shrink-0 text-indigo-500" />
                  <span className="min-w-0 flex-1 truncate">{folder.name || "Carpeta"}</span>
                  <ChevronRight size={15} className="text-slate-300" />
                </button>
              ))}
            </div>

            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
          </section>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs text-slate-600">
            <span className="font-black text-slate-800">Destino:</span>{" "}
            <span>{selectedProject ? getProjectName(selectedProject) : "Selecciona un proyecto"}</span>
            <span className="text-slate-400"> / Documentación del proyecto{currentChain.length ? ` / ${currentChain.map((folder) => folder.name).join(" / ")}` : ""}</span>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="button" onClick={confirmSelection} disabled={!selectedProject || loadingFolders} className="bg-indigo-600 text-white hover:bg-indigo-700">
              <Check size={16} className="mr-1.5" /> Usar esta ubicación
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
