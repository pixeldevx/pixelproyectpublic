export type ColombiaMunicipalityOption = {
  code: string;
  name: string;
};

export type ColombiaDepartmentOption = {
  code: string;
  name: string;
  municipalities: ColombiaMunicipalityOption[];
};

export type ColombiaLocationCatalog = {
  source?: {
    file?: string;
    attributeTable?: string;
    layer?: string;
    fields?: Record<string, string>;
    country?: string;
  };
  departments: ColombiaDepartmentOption[];
};

export type ResolvedColombiaLocation = {
  departmentCode: string;
  department: string;
  municipalityCode: string;
  municipality: string;
  locationKey: string;
};

let catalogPromise: Promise<ColombiaLocationCatalog> | null = null;
const COLOMBIA_LOCATION_CATALOG_VERSION = "20260909-bogota-dc";

export const normalizeLocationText = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

export const loadColombiaLocationCatalog = () => {
  if (!catalogPromise) {
    catalogPromise = fetch(
      `/data/colombia-locations.json?v=${COLOMBIA_LOCATION_CATALOG_VERSION}`,
      { cache: "force-cache" },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar el catálogo territorial de Colombia.");
        return (await response.json()) as ColombiaLocationCatalog;
      })
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
  }

  return catalogPromise;
};

export const resolveColombiaLocation = (
  catalog: ColombiaLocationCatalog | null | undefined,
  departmentValue: unknown,
  municipalityValue: unknown
): ResolvedColombiaLocation | null => {
  if (!catalog) return null;
  const departmentKey = normalizeLocationText(departmentValue);
  const municipalityKey = normalizeLocationText(municipalityValue);
  if (!departmentKey || !municipalityKey) return null;

  const department = catalog.departments.find(
    (option) =>
      normalizeLocationText(option.name) === departmentKey ||
      normalizeLocationText(option.code) === departmentKey
  );
  if (!department) return null;

  const municipality = department.municipalities.find(
    (option) =>
      normalizeLocationText(option.name) === municipalityKey ||
      normalizeLocationText(option.code) === municipalityKey
  );
  if (!municipality) return null;

  return {
    departmentCode: department.code,
    department: department.name,
    municipalityCode: municipality.code,
    municipality: municipality.name,
    locationKey: municipality.code,
  };
};

export const inferUniqueColombiaLocation = (
  catalog: ColombiaLocationCatalog | null | undefined,
  municipalityValue: unknown
): ResolvedColombiaLocation | null => {
  if (!catalog) return null;
  const municipalityKey = normalizeLocationText(municipalityValue);
  if (!municipalityKey) return null;

  const matches = catalog.departments.flatMap((department) =>
    department.municipalities
      .filter(
        (municipality) =>
          normalizeLocationText(municipality.name) === municipalityKey ||
          normalizeLocationText(municipality.code) === municipalityKey
      )
      .map((municipality) => ({
        departmentCode: department.code,
        department: department.name,
        municipalityCode: municipality.code,
        municipality: municipality.name,
        locationKey: municipality.code,
      }))
  );

  return matches.length === 1 ? matches[0] : null;
};

export const getTaskDepartment = (task: any) =>
  task?.workflowDepartment || task?.department || task?.departamento || "";

export const getTaskMunicipality = (task: any) =>
  task?.workflowMunicipality || task?.municipality || task?.municipio || "";

export const getTaskMunicipalityCode = (task: any) =>
  task?.workflowMunicipalityCode || task?.municipalityCode || task?.workflowLocationKey || task?.locationKey || "";

export const getTaskMunicipalityDepartmentKey = (task: any) => {
  const municipality = normalizeLocationText(getTaskMunicipality(task));
  const department = normalizeLocationText(getTaskDepartment(task));
  return municipality && department ? `${municipality}|${department}` : "";
};
