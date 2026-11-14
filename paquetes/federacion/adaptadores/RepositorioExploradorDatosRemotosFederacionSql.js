import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';
import { FAMILIAS_FEDERACION } from '../src/CatalogosFederacion.js';

const CONSULTAS_DETALLE = Object.freeze({
  estructuraOrganizativa: Object.freeze({
    tabla: 'versiones_nodos_organizativos_remotos',
    columnas: `r.tipo_nodo AS tipo_registro,r.estado_registro,r.nombre,
      r.estado_origen AS estado_resumen,r.materializada_en_utc,
      r.causa_retirada,NULL AS tiempo_dato_utc,NULL AS vigente_hasta_utc,
      NULL AS referencia_1,NULL AS referencia_2,NULL AS referencia_3`
  }),
  contextoOperativoAgentesSesiones: Object.freeze({
    tabla: 'versiones_contexto_operativo_agentes_remotos',
    columnas: `'agente' AS tipo_registro,r.estado_registro,r.nombre_agente AS nombre,
      r.estado_pol AS estado_resumen,r.materializada_en_utc,r.causa_retirada,
      r.ultimo_heartbeat_utc AS tiempo_dato_utc,NULL AS vigente_hasta_utc,
      NULL AS referencia_1,NULL AS referencia_2,NULL AS referencia_3`
  }),
  telemetria: Object.freeze({
    tabla: 'registros_telemetria_remotos',
    columnas: `r.tipo_registro,r.estado_registro,NULL AS nombre,
      NULL AS estado_resumen,r.materializada_en_utc,r.causa_retirada,
      r.tiempo_dato_utc,r.vigente_hasta_origen_utc AS vigente_hasta_utc,
      r.fuente_origen_id AS referencia_1,r.senal_origen_id AS referencia_2,
      r.referencia_origen_id AS referencia_3`
  }),
  monitores: Object.freeze({
    tabla: 'registros_monitores_remotos',
    columnas: `r.tipo_registro,r.estado_registro,NULL AS nombre,
      r.estado_operativo AS estado_resumen,r.materializada_en_utc,r.causa_retirada,
      r.tiempo_dato_utc,r.vigente_hasta_origen_utc AS vigente_hasta_utc,
      r.monitor_origen_id AS referencia_1,r.referencia_origen_id AS referencia_2,
      NULL AS referencia_3`
  }),
  triggersInformativos: Object.freeze({
    tabla: 'registros_triggers_informativos_remotos',
    columnas: `r.tipo_registro,r.estado_registro,NULL AS nombre,
      r.estado_ejecucion AS estado_resumen,r.materializada_en_utc,r.causa_retirada,
      r.tiempo_dato_utc,NULL AS vigente_hasta_utc,
      r.trigger_origen_id AS referencia_1,r.monitor_origen_id AS referencia_2,
      r.referencia_origen_id AS referencia_3`
  }),
  auditoria: Object.freeze({
    tabla: 'registros_auditoria_remota',
    columnas: `'evento' AS tipo_registro,'presente' AS estado_registro,
      NULL AS nombre,r.resultado_validacion_receptor AS estado_resumen,
      r.materializada_en_utc,r.causa_validacion AS causa_retirada,
      r.efectivo_en_origen_utc AS tiempo_dato_utc,NULL AS vigente_hasta_utc,
      NULL AS referencia_1,NULL AS referencia_2,NULL AS referencia_3`
  }),
  avisosFederados: Object.freeze({
    tabla: 'registros_avisos_federados',
    columnas: `r.tipo_registro,r.estado_registro,NULL AS nombre,
      CONCAT_WS(' · ',r.estado_ciclo,r.gravedad) AS estado_resumen,
      r.materializada_en_utc,NULL AS causa_retirada,r.tiempo_dato_utc,
      NULL AS vigente_hasta_utc,NULL AS referencia_1,NULL AS referencia_2,
      NULL AS referencia_3`
  })
});

export class RepositorioExploradorDatosRemotosFederacionSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('El explorador de datos remotos requiere SQL de lectura.');
    }
    this.clienteSql = clienteSql;
  }

  async listar({ scope, familias, familia = null, installationOrigenId = null,
    proyeccionId = null, pagina = 1, limite = 25 } = {}) {
    const autorizadas = validarFamilias(familias);
    const familiaFiltrada = familia === null || familia === ''
      ? null
      : FAMILIAS_FEDERACION.exigir(familia, { campo: 'familia' });
    if (familiaFiltrada && !autorizadas.includes(familiaFiltrada)) {
      throw errorAcceso('familia_no_autorizada', 'La familia solicitada no es visible.');
    }
    const numeroPagina = enteroAcotado(pagina, 1, 1_000_000, 'pagina');
    const tamanoPagina = enteroAcotado(limite, 1, 100, 'limite');
    const { clausulas, parametros } = construirFiltros({
      scope,
      familias: familiaFiltrada ? [familiaFiltrada] : autorizadas,
      installationOrigenId,
      proyeccionId
    });
    const where = clausulas.join(' AND ');
    const excluirAlertas = `COALESCE((
      SELECT rm.tipo_registro FROM registros_monitores_remotos rm
       WHERE rm.proyeccion_id=p.proyeccion_id
         AND rm.generacion_id=a.generacion_actual_id
         AND rm.secuencia_elemento<=v.ultima_secuencia_evaluada
       ORDER BY rm.secuencia_elemento DESC LIMIT 1
    ),'')<>'alerta'`;
    const desde = `FROM proyecciones_federacion p
      JOIN estados_actuales_proyecciones_federacion a
        ON a.proyeccion_id=p.proyeccion_id
      JOIN versiones_proyecciones_federacion v
        ON v.proyeccion_id=a.proyeccion_id
       AND v.generacion_id=a.generacion_actual_id
       AND v.estado_publicacion='actual'
      WHERE ${where} AND ${excluirAlertas}`;
    const totalFilas = await this.clienteSql.consultar(
      `SELECT COUNT(*) AS total ${desde}`,
      parametros
    );
    const filas = await this.clienteSql.consultar(
      `SELECT p.proyeccion_id,p.installation_origen_id,p.familia,
              p.elemento_origen_id,p.scope_nivel,p.scope_tenant_id,
              p.scope_empresa_id,p.scope_sitio_id,a.generacion_actual_id,
              v.ultima_secuencia_evaluada,v.estado_materializacion,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible,v.estado_vigencia,v.estado_soporte,
              v.estado_autorizacion,v.publicada_en_utc,
              (SELECT r.nombre_remoto_declarado
                 FROM relaciones_federacion r
                WHERE r.installation_remota_id=p.installation_origen_id
                  AND r.scope_tenant_id<=>p.scope_tenant_id
                  AND r.scope_empresa_id<=>p.scope_empresa_id
                  AND r.scope_sitio_id<=>p.scope_sitio_id
                ORDER BY r.creada_en_utc DESC LIMIT 1
              ) AS nombre_instalacion_origen
         ${desde}
        ORDER BY p.familia,p.installation_origen_id,p.elemento_origen_id,
                 p.proyeccion_id
        LIMIT ? OFFSET ?`,
      [...parametros, tamanoPagina, (numeroPagina - 1) * tamanoPagina]
    );
    const elementos = await Promise.all(filas.map((fila) => this.#mapearConDetalle(fila)));
    const total = Number(totalFilas[0]?.total || 0);
    return Object.freeze({
      elementos: Object.freeze(elementos),
      paginacion: Object.freeze({
        pagina: numeroPagina,
        limite: tamanoPagina,
        total,
        paginas: Math.max(1, Math.ceil(total / tamanoPagina))
      })
    });
  }

  async #mapearConDetalle(fila) {
    const detalle = await obtenerDetalleSaneado(this.clienteSql, fila);
    return Object.freeze({
      proyeccionId: fila.proyeccion_id,
      installationOrigenId: fila.installation_origen_id,
      nombreInstalacionOrigen: fila.nombre_instalacion_origen ?? null,
      familia: fila.familia,
      elementoOrigenId: fila.elemento_origen_id,
      scopeRecepcion: Object.freeze({
        nivel: fila.scope_nivel,
        tenantId: opcional(fila.scope_tenant_id),
        empresaId: opcional(fila.scope_empresa_id),
        sitioId: opcional(fila.scope_sitio_id)
      }),
      dimensiones: Object.freeze({
        materializacion: fila.estado_materializacion,
        completitudRecepcion: Object.freeze({
          interpretable: fila.completitud_interpretable,
          observable: fila.completitud_observable,
          reconstruible: fila.completitud_reconstruible
        }),
        vigencia: fila.estado_vigencia,
        soporte: fila.estado_soporte,
        autorizacion: fila.estado_autorizacion
      }),
      publicadaEnUtc: fechaIso(fila.publicada_en_utc),
      detalle
    });
  }
}

async function obtenerDetalleSaneado(clienteSql, fila) {
  const configuracion = CONSULTAS_DETALLE[fila.familia];
  if (!configuracion || fila.ultima_secuencia_evaluada === null) return null;
  const registros = await clienteSql.consultar(
    `SELECT ${configuracion.columnas},r.secuencia_elemento
       FROM ${configuracion.tabla} r
      WHERE r.proyeccion_id=? AND r.generacion_id=?
        AND r.secuencia_elemento<=?
      ORDER BY r.secuencia_elemento DESC LIMIT 1`,
    [fila.proyeccion_id, fila.generacion_actual_id, fila.ultima_secuencia_evaluada]
  );
  const registro = registros[0];
  if (!registro || (fila.familia === 'monitores' && registro.tipo_registro === 'alerta')) {
    return null;
  }
  const referenciasRegistro = [
    registro.referencia_1,
    registro.referencia_2,
    registro.referencia_3
  ];
  if (fila.familia === 'estructuraOrganizativa') {
    const linaje = await clienteSql.consultar(
      `SELECT elemento_origen_id
         FROM linaje_versiones_nodos_organizativos_remotos
        WHERE proyeccion_id=? AND generacion_id=? AND secuencia_elemento=?
        ORDER BY ordinal`,
      [fila.proyeccion_id, fila.generacion_actual_id, registro.secuencia_elemento]
    );
    referenciasRegistro.push(...linaje.map((ancestro) => ancestro.elemento_origen_id));
  }
  const referencias = referenciasRegistro
    .filter(Boolean)
    .filter((valor, indice, todos) => todos.indexOf(valor) === indice)
    .map((elementoOrigenId) => Object.freeze({
      modo: 'opaca',
      elementoOrigenId: String(elementoOrigenId)
    }));
  return Object.freeze({
    tipoRegistro: registro.tipo_registro,
    estadoRegistro: registro.estado_registro,
    nombre: registro.nombre ?? null,
    estadoResumen: registro.estado_resumen ?? null,
    secuenciaElemento: String(registro.secuencia_elemento),
    tiempoDatoUtc: fechaIso(registro.tiempo_dato_utc),
    vigenteHastaUtc: fechaIso(registro.vigente_hasta_utc),
    materializadaEnUtc: fechaIso(registro.materializada_en_utc),
    causa: registro.causa_retirada ?? null,
    referencias: Object.freeze(referencias)
  });
}

function construirFiltros({ scope, familias, installationOrigenId, proyeccionId }) {
  if (!scope || !['portal', 'tenant', 'empresa', 'sitio'].includes(scope.nivel)) {
    throw errorAcceso('scope_invalido', 'El scope efectivo no permite explorar datos remotos.');
  }
  const clausulas = [`p.familia IN (${familias.map(() => '?').join(',')})`];
  const parametros = [...familias];
  if (scope.nivel !== 'portal') {
    exigirScope(scope.tenantId, 'tenantId');
    clausulas.push('p.scope_tenant_id=?');
    parametros.push(scope.tenantId);
  }
  if (['empresa', 'sitio'].includes(scope.nivel)) {
    exigirScope(scope.empresaId, 'empresaId');
    clausulas.push('p.scope_empresa_id=?');
    parametros.push(scope.empresaId);
  }
  if (scope.nivel === 'sitio') {
    exigirScope(scope.sitioId, 'sitioId');
    clausulas.push('p.scope_sitio_id=?');
    parametros.push(scope.sitioId);
  }
  if (installationOrigenId) {
    clausulas.push('p.installation_origen_id=?');
    parametros.push(String(crearIdentidadFederada({
      valor: installationOrigenId,
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION
    })));
  }
  if (proyeccionId) {
    clausulas.push('p.proyeccion_id=?');
    parametros.push(String(crearIdentidadFederada({
      valor: proyeccionId,
      tipo: TIPOS_IDENTIDAD_FEDERADA.PROYECCION
    })));
  }
  return { clausulas, parametros };
}

function validarFamilias(familias) {
  if (!Array.isArray(familias) || familias.length === 0) {
    throw errorAcceso('familias_no_autorizadas', 'No hay familias remotas visibles.');
  }
  return [...new Set(familias.map((familia) =>
    FAMILIAS_FEDERACION.exigir(familia, { campo: 'familias' })
  ))];
}

function exigirScope(valor, campo) {
  if (!Number.isSafeInteger(Number(valor)) || Number(valor) <= 0) {
    throw errorAcceso('scope_incompleto', `El ${campo} efectivo no es válido.`);
  }
}

function enteroAcotado(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`El filtro ${campo} no es válido.`);
  }
  return numero;
}

function opcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function fechaIso(valor) {
  if (valor === null || valor === undefined) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function errorAcceso(codigo, mensaje) {
  const error = new Error(mensaje);
  error.codigo = codigo;
  error.statusCode = 403;
  return error;
}
