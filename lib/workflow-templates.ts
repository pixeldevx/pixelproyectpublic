import { db } from "@/lib/backend";
import { getOrganizationIds } from "@/lib/organizations";
import { collection, getDocs, query, where } from "@/lib/supabase/document-store";

const ORGANIZATION_TEMPLATE_ROLES = new Set(["admin", "org_admin", "manager", "coordinador"]);

const getProjectName = (project: any) =>
  project?.name || project?.title || project?.projectName || "Proyecto sin nombre";

const getProjectOrganizationName = (project: any) =>
  project?.organizationName || project?.organization || project?.clientName || "";

const sortWorkflowTemplates = (templates: any[]) =>
  [...templates].sort((left: any, right: any) => {
    const projectCompare = String(left.projectName || "").localeCompare(String(right.projectName || ""));
    if (projectCompare !== 0) return projectCompare;
    return String(left.name || "").localeCompare(String(right.name || ""));
  });

export const canLoadOrganizationWorkflowTemplates = (
  userRole?: string | null,
  organizationIds: string[] = []
) => {
  if (!userRole || !ORGANIZATION_TEMPLATE_ROLES.has(userRole)) return false;
  return userRole === "admin" || organizationIds.length > 0;
};

export const getWorkflowTemplateScopeData = (projectId: string, project: any = {}) => {
  const organizationIds = getOrganizationIds(project);

  return {
    projectId,
    projectName: getProjectName(project),
    organizationId: organizationIds[0] || null,
    organizationIds,
    organizationName: getProjectOrganizationName(project),
  };
};

export const getWorkflowTemplateScopeLabel = (template: any, currentProjectId: string) => {
  if (template.projectId === currentProjectId) return "Este proyecto";

  const parts = [
    template.organizationName || "Organizacion asignada",
    template.projectName || "Proyecto",
  ].filter(Boolean);

  return parts.join(" / ");
};

export const loadWorkflowTemplatesForScope = async ({
  projectId,
  project,
  userRole,
  organizationIds,
}: {
  projectId: string;
  project?: any;
  userRole?: string | null;
  organizationIds?: string[];
}) => {
  const allowedOrganizationIds = organizationIds || [];
  const canLoadSharedTemplates = canLoadOrganizationWorkflowTemplates(userRole, allowedOrganizationIds);

  if (!canLoadSharedTemplates) {
    const projectTemplatesQuery = query(
      collection(db, "workflow_templates"),
      where("projectId", "==", projectId)
    );
    const snapshot = await getDocs(projectTemplatesQuery);
    return sortWorkflowTemplates(
      snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
        ...getWorkflowTemplateScopeData(projectId, project),
      }))
    );
  }

  const [templatesSnapshot, projectsSnapshot] = await Promise.all([
    getDocs(collection(db, "workflow_templates")),
    getDocs(collection(db, "projects")),
  ]);

  const projectsById = new Map(
    projectsSnapshot.docs.map((docSnap) => [docSnap.id, { id: docSnap.id, ...docSnap.data() }])
  );
  const allowedSet = new Set(allowedOrganizationIds);

  const templates = templatesSnapshot.docs
    .map((docSnap) => {
      const template = { id: docSnap.id, ...docSnap.data() } as any;
      const sourceProject = projectsById.get(template.projectId) || (template.projectId === projectId ? project : null);
      const templateOrganizationIds = getOrganizationIds(template);
      const sourceOrganizationIds =
        templateOrganizationIds.length > 0 ? templateOrganizationIds : getOrganizationIds(sourceProject);

      return {
        ...template,
        projectName: template.projectName || getProjectName(sourceProject),
        organizationId: template.organizationId || sourceOrganizationIds[0] || null,
        organizationIds: template.organizationIds || sourceOrganizationIds,
        organizationName: template.organizationName || getProjectOrganizationName(sourceProject),
      };
    })
    .filter((template) => {
      if (template.projectId === projectId) return true;
      if (userRole === "admin") return true;

      const sourceOrganizationIds = getOrganizationIds(template);
      return sourceOrganizationIds.some((organizationId) => allowedSet.has(organizationId));
    });

  return sortWorkflowTemplates(templates);
};
