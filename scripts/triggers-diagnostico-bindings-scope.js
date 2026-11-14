import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

function construirMotivos(fila) {
  const motivos = [];

  if (Number(fila.trigger_portal || 0) === 1) {
    motivos.push('trigger_portal');
  }

  if (Number(fila.trigger_tenant || 0) === 1) {
    motivos.push('trigger_tenant');
  }

  if (Number(fila.tenant_distinto || 0) === 1) {
    motivos.push('tenant_distinto');
  }

  if (Number(fila.empresa_distinta || 0) === 1) {
    motivos.push('empresa_distinta');
  }

  if (Number(fila.trigger_sitio_sobre_monitor_empresa || 0) === 1) {
    motivos.push('trigger_sitio_sobre_monitor_empresa');
  }

  if (Number(fila.trigger_sitio_otro_sitio || 0) === 1) {
    motivos.push('trigger_sitio_otro_sitio');
  }

  return motivos;
}

function resumirMotivos(bindings = []) {
  const totales = new Map();

  for (const binding of bindings) {
    for (const motivo of binding.motivos) {
      totales.set(motivo, Number(totales.get(motivo) || 0) + 1);
    }
  }

  return Object.fromEntries(
    [...totales.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
  );
}

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();

  if (!configuracion.sql.estaCompleta) {
    throw new Error(
      'Configuracion SQL incompleta. Revisa SQL_HOST, SQL_USUARIO y SQL_BASE_DATOS.'
    );
  }

  const clienteSql = new ClienteSql(configuracion.sql);

  try {
    const filas = await clienteSql.consultar(
      `
        SELECT
          atm.id,
          atm.monitor_id,
          atm.trigger_id,
          atm.activo,
          atm.fecha_creacion,
          atm.fecha_actualizacion,
          m.nombre AS monitor_nombre,
          m.tipo AS monitor_tipo,
          m.tenant_id AS monitor_tenant_id,
          m.empresa_id AS monitor_empresa_id,
          m.sitio_id AS monitor_sitio_id,
          t.nombre AS trigger_nombre,
          t.tipo AS trigger_tipo,
          t.tenant_id AS trigger_tenant_id,
          t.empresa_id AS trigger_empresa_id,
          t.sitio_id AS trigger_sitio_id,
          CASE
            WHEN t.tenant_id IS NULL AND t.empresa_id IS NULL AND t.sitio_id IS NULL
              THEN 1
            ELSE 0
          END AS trigger_portal,
          CASE
            WHEN t.tenant_id IS NOT NULL AND t.empresa_id IS NULL AND t.sitio_id IS NULL
              THEN 1
            ELSE 0
          END AS trigger_tenant,
          CASE
            WHEN t.tenant_id IS NOT NULL AND m.tenant_id <> t.tenant_id
              THEN 1
            ELSE 0
          END AS tenant_distinto,
          CASE
            WHEN t.empresa_id IS NOT NULL AND m.empresa_id <> t.empresa_id
              THEN 1
            ELSE 0
          END AS empresa_distinta,
          CASE
            WHEN t.sitio_id IS NOT NULL AND m.sitio_id IS NULL
              THEN 1
            ELSE 0
          END AS trigger_sitio_sobre_monitor_empresa,
          CASE
            WHEN t.sitio_id IS NOT NULL AND m.sitio_id IS NOT NULL AND m.sitio_id <> t.sitio_id
              THEN 1
            ELSE 0
          END AS trigger_sitio_otro_sitio
        FROM asignaciones_triggers_monitores atm
        INNER JOIN monitores m ON m.id = atm.monitor_id
        INNER JOIN triggers t ON t.id = atm.trigger_id
        WHERE
          atm.activo = 0
          AND (
            t.tenant_id IS NULL
            OR t.empresa_id IS NULL
            OR m.tenant_id <> t.tenant_id
            OR m.empresa_id <> t.empresa_id
            OR (
              t.sitio_id IS NOT NULL
              AND (
                m.sitio_id IS NULL
                OR m.sitio_id <> t.sitio_id
              )
            )
          )
        ORDER BY atm.fecha_actualizacion DESC, atm.id DESC
      `
    );

    const bindings = filas.map((fila) => ({
      id: Number(fila.id),
      monitorId: Number(fila.monitor_id),
      monitorNombre: fila.monitor_nombre || null,
      monitorTipo: fila.monitor_tipo || null,
      monitorScope: {
        tenantId: fila.monitor_tenant_id == null ? null : Number(fila.monitor_tenant_id),
        empresaId:
          fila.monitor_empresa_id == null ? null : Number(fila.monitor_empresa_id),
        sitioId: fila.monitor_sitio_id == null ? null : Number(fila.monitor_sitio_id)
      },
      triggerId: Number(fila.trigger_id),
      triggerNombre: fila.trigger_nombre || null,
      triggerTipo: fila.trigger_tipo || null,
      triggerScope: {
        tenantId: fila.trigger_tenant_id == null ? null : Number(fila.trigger_tenant_id),
        empresaId:
          fila.trigger_empresa_id == null ? null : Number(fila.trigger_empresa_id),
        sitioId: fila.trigger_sitio_id == null ? null : Number(fila.trigger_sitio_id)
      },
      activo: Boolean(fila.activo),
      fechaCreacion: fila.fecha_creacion || null,
      fechaActualizacion: fila.fecha_actualizacion || null,
      motivos: construirMotivos(fila)
    }));

    const salida = {
      totalCandidatos: bindings.length,
      resumenMotivos: resumirMotivos(bindings),
      bindings
    };

    console.log(JSON.stringify(salida, null, 2));
  } finally {
    await clienteSql.cerrar();
  }
}

main().catch((error) => {
  console.error('[triggers:diagnostico-bindings-scope] Error fatal');
  console.error(error);
  process.exit(1);
});
