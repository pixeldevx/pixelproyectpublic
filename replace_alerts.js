const fs = require('fs');

const filePaths = [
  './app/projects/[id]/page.tsx',
  './components/dashboard/GanttOverview.tsx',
  './components/dashboard/WorkflowTray.tsx',
  './components/projects/ProjectRateCards.tsx',
  './components/projects/ProjectUsers.tsx',
  './components/projects/ProjectActivities.tsx',
  './components/projects/TaskDetailsModal.tsx',
  './components/projects/TaskDocumentsViewer.tsx',
  './components/projects/StartWorkflowModal.tsx'
];

filePaths.forEach(filePath => {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Add import if not present
    if (!content.includes("import { toast } from 'sonner';") && !content.includes('import { toast } from "sonner";')) {
      // Find the last import statement
      const lastImportIndex = content.lastIndexOf('import ');
      if (lastImportIndex !== -1) {
        const endOfLastImport = content.indexOf('\n', lastImportIndex);
        content = content.slice(0, endOfLastImport + 1) + "import { toast } from 'sonner';\n" + content.slice(endOfLastImport + 1);
      } else {
        content = "import { toast } from 'sonner';\n" + content;
      }
    }

    // Replace alerts
    content = content.replace(/alert\("Sincronizado con éxito\. Nuevo valor: \$\{finalValue\} \$\{task\.indicator\}"\);/g, 'toast.success(`Sincronizado con éxito. Nuevo valor: ${finalValue} ${task.indicator}`);');
    content = content.replace(/alert\("Workflow iniciado correctamente\."\);/g, 'toast.success("Workflow iniciado correctamente.");');
    content = content.replace(/alert\("El estado de esta tarea madre se actualiza automáticamente según sus subtareas\."\);/g, 'toast.info("El estado de esta tarea madre se actualiza automáticamente según sus subtareas.");');
    content = content.replace(/alert\("No puedes modificar los pasos de una tarea madre\. Modifica las subtareas\."\);/g, 'toast.info("No puedes modificar los pasos de una tarea madre. Modifica las subtareas.");');
    content = content.replace(/alert\("Por favor completa todos los campos obligatorios\."\);/g, 'toast.warning("Por favor completa todos los campos obligatorios.");');
    content = content.replace(/alert\("Las observaciones son obligatorias\."\);/g, 'toast.warning("Las observaciones son obligatorias.");');
    content = content.replace(/alert\("Por favor ingrese un ID de Workflow\."\);/g, 'toast.warning("Por favor ingrese un ID de Workflow.");');

    // Replace any remaining alerts with toast.error
    content = content.replace(/alert\(/g, 'toast.error(');

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${filePath}`);
  }
});
