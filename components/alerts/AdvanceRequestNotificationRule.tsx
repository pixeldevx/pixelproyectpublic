type Props = { projects: any[]; organizations: any[] };

export function AdvanceRequestNotificationRule(_props: Props) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-900">Avisos de anticipos desactivados</h2>
      <p className="mt-2 text-sm text-slate-600">
        Esta instancia no envía avisos automáticos de anticipos ni conserva copias de sus datos para notificaciones.
      </p>
    </section>
  );
}
