import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';
import {
  TIPOS_REGISTRO_MONITORES_FEDERACION,
  validarPayloadMonitoresFederacion
} from '../src/PayloadMonitoresFederacion.js';
import { CONFIGURACIONES_GLOBALES_FEDERACION } from '../src/ConfiguracionFederacion.js';

export class ErrorMonitoresRemotosFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorMonitoresRemotosFederacion';
    this.codigo = codigo;
  }
}

export class RepositorioMonitoresRemotoSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('Los monitores remotos requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async materializarEnTransaccion(
    { operacion, payload, contexto } = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const trabajo = await obtenerTrabajoBloqueado(conexion, contexto);
    if (operacion !== trabajo.operacion) {
      fallar(
        'operacion_monitor_remoto_no_corresponde',
        'La operación tipada no coincide con el trabajo federado reclamado.'
      );
    }
    if (operacion === 'salidaProyeccion') {
      return Object.freeze({
        estado: 'sinCambio',
        causa: 'salidaProyeccionGobernadaPorContribucion',
        proyeccionId: trabajo.proyeccion_id,
        secuenciaElemento: String(trabajo.secuencia_elemento)
      });
    }
    if (operacion === 'retirada' && payload !== null && payload !== undefined) {
      fallar(
        'retirada_monitor_remoto_con_payload',
        'Una retirada de monitor no puede transportar un payload de actualización.'
      );
    }
    const normalizado = operacion === 'actualizacion'
      ? validarPayloadMonitoresFederacion(payload, { operacion })
      : crearRepresentacionRetirada();
    const canonico = canonicalizarJsonFederacion(normalizado);
    const existente = await obtenerRegistro(conexion, trabajo, true);
    if (existente) {
      if (
        existente.trabajo_entrega_id !== trabajo.entrega_id ||
        existente.representacion_canonica !== canonico ||
        existente.estado_registro !== estadoRegistro(operacion)
      ) {
        fallar(
          'registro_monitor_remoto_divergente',
          'La secuencia de monitor ya fue materializada con otro contenido.'
        );
      }
      return resultadoMaterializacion(trabajo, operacion, true);
    }
    const dimensiones = operacion === 'actualizacion'
      ? extraerDimensiones(normalizado, trabajo)
      : dimensionesVacias();
    const ahora = await ahoraSql(conexion);
    await conexion.execute(
      `INSERT INTO registros_monitores_remotos (
         proyeccion_id,generacion_id,secuencia_elemento,
         trabajo_entrega_id,inbox_ocurrencia_id,ocurrencia_origen_id,
         tipo_registro,estado_registro,monitor_origen_id,referencia_origen_id,
         alerta_auditoria_id,estado_operativo,tiempo_dato_utc,
         vigente_hasta_origen_utc,causa_retirada,
         representacion_canonica,materializada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        trabajo.proyeccion_id,
        trabajo.generacion_id,
        String(trabajo.secuencia_elemento),
        trabajo.entrega_id,
        String(trabajo.inbox_ocurrencia_id),
        trabajo.ocurrencia_origen_id,
        dimensiones.tipoRegistro,
        estadoRegistro(operacion),
        dimensiones.monitorOrigenId,
        dimensiones.referenciaOrigenId,
        dimensiones.alertaAuditoriaId,
        dimensiones.estadoOperativo,
        dimensiones.tiempoDatoUtc,
        dimensiones.vigenteHastaOrigenUtc,
        operacion === 'retirada' ? 'retiradaOrigen' : null,
        canonico,
        ahora
      ]
    );
    if (normalizado.tipoRegistro === 'estadoActual') {
      await materializarFotografiaOperativa(conexion, {
        trabajo,
        ahora,
        limiteReceptorMs: await obtenerLimiteVigenciaReceptorMs(conexion)
      });
    }
    return resultadoMaterializacion(trabajo, operacion, false);
  }

  listarActuales(filtros = {}) {
    return this.#consultarPublicados(filtros);
  }

  listarDefiniciones(filtros = {}) {
    return this.#consultarPublicados(
      { ...filtros, tipoRegistro: 'definicion' },
      { orden: 'r.proyeccion_id' }
    );
  }

  listarEstadosActualesSeleccionables(filtros = {}) {
    return this.listarFotografiasOperativas(filtros);
  }

  async listarFotografiasOperativas({
    installationOrigenId = null,
    proyeccionId = null,
    monitorOrigenId = null
  } = {}) {
    const condiciones = [];
    const parametros = [];
    if (installationOrigenId !== null) {
      condiciones.push('p.installation_origen_id=?');
      parametros.push(identidad(
        installationOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
        'installationOrigenId'
      ));
    }
    if (proyeccionId !== null) {
      condiciones.push('p.proyeccion_id=?');
      parametros.push(identidad(
        proyeccionId,
        TIPOS_IDENTIDAD_FEDERADA.PROYECCION,
        'proyeccionId'
      ));
    }
    if (monitorOrigenId !== null) {
      condiciones.push('r.monitor_origen_id=?');
      parametros.push(elemento(monitorOrigenId, 'monitorOrigenId'));
    }
    const filtro = condiciones.length > 0 ? `AND ${condiciones.join(' AND ')}` : '';
    const filas = await this.clienteSql.consultar(
      `WITH fotografias_publicadas AS (
         SELECT p.proyeccion_id,a.generacion_actual_id AS generacion_id,
                (
                  SELECT MAX(r0.secuencia_elemento)
                    FROM registros_monitores_remotos r0
                   WHERE r0.proyeccion_id=p.proyeccion_id
                     AND r0.generacion_id=a.generacion_actual_id
                     AND r0.secuencia_elemento<=v.ultima_secuencia_evaluada
                     AND (
                       r0.tipo_registro='estadoActual'
                       OR r0.estado_registro='retirado'
                     )
                ) AS secuencia_estado
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='monitores'
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              f.generacion_id,r.secuencia_elemento,r.ocurrencia_origen_id,
              r.monitor_origen_id,r.estado_operativo,r.tiempo_dato_utc,
              r.vigente_hasta_origen_utc,r.representacion_canonica,
              r.inbox_ocurrencia_id,r.materializada_en_utc,
              f.vigente_hasta_receptor_utc,UTC_TIMESTAMP(3) AS consultada_en_utc,
              w.relacion_id,w.flujo_id,w.contribucion_id,
              rf.estado_ciclo AS relacion_estado_ciclo,
              rf.estado_autoridad AS relacion_estado_autoridad,
              rf.estado_identidad AS relacion_estado_identidad,
              rf.estado_compatibilidad AS relacion_estado_compatibilidad,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible,v.estado_vigencia,v.estado_soporte,
              v.estado_autorizacion
         FROM fotografias_publicadas x
         JOIN fotografias_operativas_monitores_remotos f
           ON f.proyeccion_id=x.proyeccion_id
          AND f.generacion_id=x.generacion_id
          AND f.secuencia_estado=x.secuencia_estado
         JOIN registros_monitores_remotos r
           ON r.proyeccion_id=f.proyeccion_id
          AND r.generacion_id=f.generacion_id
          AND r.secuencia_elemento=f.secuencia_estado
         JOIN trabajos_materializacion_federacion w
           ON w.entrega_id=r.trabajo_entrega_id
         JOIN relaciones_federacion rf ON rf.relacion_id=w.relacion_id
         JOIN proyecciones_federacion p ON p.proyeccion_id=f.proyeccion_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=f.proyeccion_id
          AND v.generacion_id=f.generacion_id
        WHERE r.estado_registro='presente' AND r.tipo_registro='estadoActual'
          ${filtro}
        ORDER BY r.tiempo_dato_utc DESC,r.proyeccion_id`,
      parametros
    );
    const rutas = await obtenerRutasFotografias(this.clienteSql, filas);
    return Object.freeze(filas.map((fila) => mapearFotografia(
      fila,
      rutas,
      new Date(fila.consultada_en_utc)
    )));
  }

  listarAlertasSeleccionables({ estadoAlerta = null, ...filtros } = {}) {
    const condiciones = [];
    const parametros = [];
    if (estadoAlerta !== null) {
      if (!['activa', 'cerrada'].includes(estadoAlerta)) {
        fallar('estado_alerta_remota_invalido', 'La alerta consultada debe estar activa o cerrada.');
      }
      condiciones.push('r.estado_operativo=?');
      parametros.push(estadoAlerta);
    }
    return this.#consultarPublicados(
      { ...filtros, tipoRegistro: 'alerta' },
      {
        condicionesAdicionales: condiciones,
        parametrosAdicionales: parametros,
        orden: 'r.tiempo_dato_utc DESC,r.proyeccion_id'
      }
    );
  }

  listarEventos({ desdeUtc = null, hastaUtc = null, limite = 200, ...filtros } = {}) {
    return this.#consultarHistorico({
      tipoRegistro: 'evento', desdeUtc, hastaUtc, limite, filtros
    });
  }

  listarTramosHistoricos({
    desdeUtc = null, hastaUtc = null, limite = 200, ...filtros
  } = {}) {
    return this.#consultarHistorico({
      tipoRegistro: 'tramoHistorico', desdeUtc, hastaUtc, limite, filtros
    });
  }

  listarRangosHistoricos(filtros = {}) {
    return this.#consultarPublicados(
      { ...filtros, tipoRegistro: 'rangoHistorico' },
      { orden: 'r.tiempo_dato_utc DESC,r.proyeccion_id' }
    );
  }

  listarReferenciasTriggers(filtros = {}) {
    return this.#consultarPublicados(
      { ...filtros, tipoRegistro: 'referenciaTrigger' },
      { orden: 'r.proyeccion_id' }
    );
  }

  #consultarHistorico({ tipoRegistro, desdeUtc, hastaUtc, limite, filtros }) {
    const condiciones = [];
    const parametros = [];
    const desde = desdeUtc === null ? null : fechaConsulta(desdeUtc, 'desdeUtc');
    const hasta = hastaUtc === null ? null : fechaConsulta(hastaUtc, 'hastaUtc');
    if (desde !== null && hasta !== null && hasta <= desde) {
      fallar(
        'rango_consulta_monitores_invalido',
        'El final de la consulta histórica debe ser posterior a su inicio.'
      );
    }
    if (desde !== null) {
      condiciones.push('r.tiempo_dato_utc>=?');
      parametros.push(desde);
    }
    if (hasta !== null) {
      condiciones.push('r.tiempo_dato_utc<?');
      parametros.push(hasta);
    }
    return this.#consultarPublicados(
      { ...filtros, tipoRegistro },
      {
        condicionesAdicionales: condiciones,
        parametrosAdicionales: parametros,
        limite: limiteConsulta(limite),
        orden: 'r.tiempo_dato_utc DESC,r.proyeccion_id'
      }
    );
  }

  async #consultarPublicados({
    installationOrigenId = null,
    proyeccionId = null,
    monitorOrigenId = null,
    referenciaOrigenId = null,
    alertaAuditoriaId = null,
    tipoRegistro = null
  } = {}, {
    condicionesAdicionales = [],
    parametrosAdicionales = [],
    limite = null,
    orden = 'r.proyeccion_id'
  } = {}) {
    const condiciones = [...condicionesAdicionales];
    const parametros = [...parametrosAdicionales];
    if (installationOrigenId !== null) {
      condiciones.push('p.installation_origen_id=?');
      parametros.push(identidad(
        installationOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
        'installationOrigenId'
      ));
    }
    if (proyeccionId !== null) {
      condiciones.push('p.proyeccion_id=?');
      parametros.push(identidad(
        proyeccionId,
        TIPOS_IDENTIDAD_FEDERADA.PROYECCION,
        'proyeccionId'
      ));
    }
    if (monitorOrigenId !== null) {
      condiciones.push('r.monitor_origen_id=?');
      parametros.push(elemento(monitorOrigenId, 'monitorOrigenId'));
    }
    if (referenciaOrigenId !== null) {
      condiciones.push('r.referencia_origen_id=?');
      parametros.push(elemento(referenciaOrigenId, 'referenciaOrigenId'));
    }
    if (alertaAuditoriaId !== null) {
      condiciones.push('r.alerta_auditoria_id=?');
      parametros.push(uuidV7(alertaAuditoriaId, 'alertaAuditoriaId'));
    }
    if (tipoRegistro !== null) {
      if (!TIPOS_REGISTRO_MONITORES_FEDERACION.includes(tipoRegistro)) {
        fallar('tipo_consulta_monitores_invalido', 'El tipo de registro consultado no existe.');
      }
      condiciones.push('r.tipo_registro=?');
      parametros.push(tipoRegistro);
    }
    const filtroTipoGobernante = tipoRegistro === null
      ? ''
      : `AND (r2.tipo_registro='${tipoRegistro}' OR r2.estado_registro='retirado')`;
    const filtro = condiciones.length > 0 ? `AND ${condiciones.join(' AND ')}` : '';
    const clausulaLimite = limite === null ? '' : ` LIMIT ${limite}`;
    const filas = await this.clienteSql.consultar(
      `WITH registros_actuales AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,v.ultima_secuencia_evaluada,
                (
                  SELECT MAX(r2.secuencia_elemento)
                    FROM registros_monitores_remotos r2
                   WHERE r2.proyeccion_id=p.proyeccion_id
                     AND r2.generacion_id=a.generacion_actual_id
                     AND r2.secuencia_elemento<=v.ultima_secuencia_evaluada
                     ${filtroTipoGobernante}
                ) AS secuencia_monitor
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='monitores'
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              a.generacion_actual_id,r.secuencia_elemento,r.ocurrencia_origen_id,
              r.tipo_registro,r.monitor_origen_id,r.referencia_origen_id,
              r.alerta_auditoria_id,r.estado_operativo,r.tiempo_dato_utc,
              r.vigente_hasta_origen_utc,r.representacion_canonica,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible,v.estado_vigencia,v.estado_soporte,
              v.estado_autorizacion
         FROM registros_actuales a
         JOIN proyecciones_federacion p ON p.proyeccion_id=a.proyeccion_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=a.proyeccion_id
          AND v.generacion_id=a.generacion_actual_id
         JOIN registros_monitores_remotos r
           ON r.proyeccion_id=a.proyeccion_id
          AND r.generacion_id=a.generacion_actual_id
          AND r.secuencia_elemento=a.secuencia_monitor
          AND r.estado_registro='presente'
        WHERE 1=1 ${filtro}
        ORDER BY ${orden}${clausulaLimite}`,
      parametros
    );
    return Object.freeze(filas.map(mapearRegistro));
  }
}

async function materializarFotografiaOperativa(conexion, {
  trabajo,
  ahora,
  limiteReceptorMs
}) {
  const vigenteHastaReceptor = new Date(
    new Date(ahora).getTime() + limiteReceptorMs
  );
  await conexion.execute(
    `INSERT INTO fotografias_operativas_monitores_remotos (
       proyeccion_id,generacion_id,secuencia_estado,
       vigente_hasta_receptor_utc,creada_en_utc,actualizada_en_utc
     ) VALUES (?,?,?,?,?,?)`,
    [
      trabajo.proyeccion_id,
      trabajo.generacion_id,
      String(trabajo.secuencia_elemento),
      vigenteHastaReceptor,
      ahora,
      ahora
    ]
  );
}

async function obtenerLimiteVigenciaReceptorMs(conexion) {
  const definicion = CONFIGURACIONES_GLOBALES_FEDERACION.ttlEstadoOperativoMs;
  const [filas] = await conexion.execute(
    `SELECT valor FROM configuracion_portal
      WHERE clave='federacion.ttl_estado_operativo_ms' LIMIT 1`
  );
  const valor = filas[0]?.valor ?? definicion.defecto;
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < definicion.minimo || numero > definicion.maximo) {
    fallar(
      'ttl_estado_operativo_receptor_invalido',
      'La vigencia máxima receptora del estado operativo no es válida.'
    );
  }
  return numero;
}

async function obtenerRutasFotografias(clienteSql, filas) {
  if (filas.length === 0) return new Map();
  const claves = [...new Map(filas.map((fila) => [
    claveFotografia(fila.proyeccion_id, fila.inbox_ocurrencia_id),
    [fila.proyeccion_id, String(fila.inbox_ocurrencia_id)]
  ])).values()];
  const condiciones = claves.map(() => '(c.proyeccion_id=? AND a.inbox_ocurrencia_id=?)');
  const parametros = claves.flat();
  const rutas = await clienteSql.consultar(
    `SELECT c.proyeccion_id,a.inbox_ocurrencia_id,a.generacion_id,
            a.vigencia_restante_recepcion_ms,
            a.primera_observacion_utc,a.primera_procedencia_canonica,
            c.contribucion_id,c.relacion_id,c.revision_concesion_id,
            c.installation_emisora_id,c.estado_soporte,
            c.estado_autoridad AS autoridad_observada,
            c.estado_identidad AS identidad_observada,
            c.estado_compatibilidad AS compatibilidad_observada,
            r.estado_ciclo,r.estado_autoridad,r.estado_identidad,
            r.estado_compatibilidad,v.estado AS estado_revision,
            (s.contribucion_id IS NOT NULL) AS retirada_contribucion,
            (f.generacion_activa_id=a.generacion_id) AS generacion_activa
       FROM aportes_ocurrencias_contribuciones_federacion a
       JOIN contribuciones_proyecciones_federacion c
         ON c.contribucion_id=a.contribucion_id
       JOIN relaciones_federacion r ON r.relacion_id=c.relacion_id
       JOIN revisiones_concesion_federacion v
         ON v.relacion_id=c.relacion_id
        AND v.revision_id=c.revision_concesion_id
       JOIN flujos_federacion f ON f.flujo_id=a.flujo_id
       LEFT JOIN salidas_contribuciones_federacion s
         ON s.contribucion_id=c.contribucion_id
      WHERE ${condiciones.join(' OR ')}`,
    parametros
  );
  const resultado = new Map();
  for (const fila of rutas) {
    const clave = claveFotografia(fila.proyeccion_id, fila.inbox_ocurrencia_id);
    const lista = resultado.get(clave) || [];
    const autorizada = fila.estado_soporte === 'activa' &&
      fila.autoridad_observada === 'autorizada' &&
      fila.identidad_observada === 'valida' &&
      fila.estado_ciclo === 'vinculada' &&
      fila.estado_autoridad === 'autorizada' &&
      fila.estado_identidad === 'valida' &&
      fila.estado_revision === 'vigente' &&
      !Boolean(fila.retirada_contribucion) &&
      Boolean(fila.generacion_activa);
    const compatible =
      ['compatible', 'compatibleParcial'].includes(fila.compatibilidad_observada) &&
      ['compatible', 'compatibleParcial'].includes(fila.estado_compatibilidad);
    const legitima = autorizada && compatible;
    lista.push(Object.freeze({
      contribucionId: fila.contribucion_id,
      relacionId: fila.relacion_id,
      revisionConcesionId: fila.revision_concesion_id,
      installationEmisoraId: fila.installation_emisora_id,
      autorizada,
      compatible,
      legitima,
      vigenciaRestanteRecepcionMs: decimalOpcional(
        fila.vigencia_restante_recepcion_ms
      ),
      observadaEnUtc: serializarFecha(fila.primera_observacion_utc),
      vigenteHastaRutaUtc: calcularVigenciaRuta(fila),
      procedencia: json(fila.primera_procedencia_canonica)
    }));
    resultado.set(clave, lista);
  }
  return resultado;
}

function mapearFotografia(fila, rutasPorFotografia, ahora) {
  const rutas = Object.freeze(rutasPorFotografia.get(claveFotografia(
    fila.proyeccion_id,
    fila.inbox_ocurrencia_id
  )) || []);
  const rutasLegitimas = rutas.filter((ruta) => ruta.legitima);
  const limiteRuta = limiteSostenidoPorRutas(rutasLegitimas);
  const vigenteHastaEfectiva = fechaMinima([
    fila.vigente_hasta_origen_utc,
    fila.vigente_hasta_receptor_utc,
    limiteRuta
  ]);
  const tieneEvidenciaRutas = rutas.length > 0;
  const sostenida = tieneEvidenciaRutas
    ? rutasLegitimas.length > 0
    : fila.estado_soporte === 'sostenida';
  const autorizada = tieneEvidenciaRutas
    ? rutas.some((ruta) => ruta.autorizada)
    : fila.estado_autorizacion === 'autorizada' &&
      fila.relacion_estado_ciclo === 'vinculada' &&
      fila.relacion_estado_autoridad === 'autorizada' &&
      fila.relacion_estado_identidad === 'valida';
  const compatible = tieneEvidenciaRutas
    ? rutas.some((ruta) => ruta.autorizada && ruta.compatible)
    : ['compatible', 'compatibleParcial'].includes(
        fila.relacion_estado_compatibilidad
      );
  const vigente = vigenteHastaEfectiva !== null && vigenteHastaEfectiva > ahora;
  const base = mapearRegistro({
    ...fila,
    generacion_actual_id: fila.generacion_id,
    tipo_registro: 'estadoActual'
  });
  return Object.freeze({
    ...base,
    fotografiaOperativa: Object.freeze({
      vigenteHastaReceptorUtc: serializarFecha(fila.vigente_hasta_receptor_utc),
      vigenteHastaEfectivaUtc: vigenteHastaEfectiva?.toISOString() ?? null,
      vigenciaTemporal: vigente ? 'vigente' : 'vencida',
      sostenida,
      autorizada,
      compatible,
      utilizableAhora: vigente && sostenida && autorizada && compatible,
      materializadaEnUtc: serializarFecha(fila.materializada_en_utc),
      procedenciaMaterializacion: Object.freeze({
        relacionId: fila.relacion_id,
        flujoId: fila.flujo_id,
        contribucionId: fila.contribucion_id
      }),
      rutas
    })
  });
}

function limiteSostenidoPorRutas(rutas) {
  if (rutas.length === 0 || rutas.some((ruta) => ruta.vigenteHastaRutaUtc === null)) {
    return null;
  }
  return new Date(Math.max(...rutas.map((ruta) => Date.parse(ruta.vigenteHastaRutaUtc))));
}

function calcularVigenciaRuta(fila) {
  if (fila.vigencia_restante_recepcion_ms === null) return null;
  return new Date(
    new Date(fila.primera_observacion_utc).getTime() +
      Number(fila.vigencia_restante_recepcion_ms)
  ).toISOString();
}

function fechaMinima(valores) {
  const fechas = valores.filter((valor) => valor !== null && valor !== undefined)
    .map((valor) => new Date(valor));
  return fechas.length === 0
    ? null
    : new Date(Math.min(...fechas.map((fecha) => fecha.getTime())));
}

function claveFotografia(proyeccionId, inboxId) {
  return `${proyeccionId}\u0000${inboxId}`;
}

function json(valor) {
  return typeof valor === 'string' ? JSON.parse(valor) : valor;
}

async function obtenerTrabajoBloqueado(conexion, contexto) {
  const entregaId = identidad(
    contexto?.entregaId,
    TIPOS_IDENTIDAD_FEDERADA.ENTREGA,
    'entregaId'
  );
  const propietario = textoAscii(contexto?.propietario, 128, 'propietario');
  const fencingToken = decimalPositivo(contexto?.fencingToken, 'fencingToken');
  const [filas] = await conexion.execute(
    `SELECT t.*,p.familia AS familia_proyeccion
       FROM trabajos_materializacion_federacion t
       JOIN proyecciones_federacion p ON p.proyeccion_id=t.proyeccion_id
      WHERE t.entrega_id=? AND t.estado='procesando'
        AND t.propietario_lease=? AND t.fencing_token=?
        AND t.lease_hasta_utc>UTC_TIMESTAMP(3)
      FOR UPDATE`,
    [entregaId, propietario, fencingToken]
  );
  const trabajo = filas[0];
  if (!trabajo) {
    fallar(
      'fencing_materializacion_monitor_obsoleto',
      'El materializador de monitores no gobierna el trabajo reclamado.'
    );
  }
  if (trabajo.familia !== 'monitores' || trabajo.familia_proyeccion !== 'monitores') {
    fallar(
      'familia_materializacion_monitor_incompatible',
      'El trabajo no pertenece a una proyección de monitores.'
    );
  }
  return trabajo;
}

async function obtenerRegistro(conexion, trabajo, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT * FROM registros_monitores_remotos
      WHERE proyeccion_id=? AND generacion_id=? AND secuencia_elemento=?${
  bloquear ? ' FOR UPDATE' : ''
}`,
    [trabajo.proyeccion_id, trabajo.generacion_id, String(trabajo.secuencia_elemento)]
  );
  return filas[0] || null;
}

function extraerDimensiones(payload, trabajo) {
  return {
    tipoRegistro: payload.tipoRegistro,
    monitorOrigenId: payload.tipoRegistro === 'definicion'
      ? trabajo.elemento_origen_id
      : payload.monitorOrigenId ?? null,
    referenciaOrigenId: extraerReferencia(payload),
    alertaAuditoriaId: payload.tipoRegistro === 'alerta'
      ? payload.alertaAuditoriaId
      : null,
    estadoOperativo: extraerEstado(payload),
    tiempoDatoUtc: fechaSqlOpcional(extraerTiempo(payload)),
    vigenteHastaOrigenUtc: fechaSqlOpcional(
      payload.vigenteHastaOrigenUtc ?? null
    )
  };
}

function extraerReferencia(payload) {
  if (payload.tipoRegistro === 'tramoHistorico') return payload.ultimoEventoOrigenId;
  if (payload.tipoRegistro === 'referenciaTrigger') return payload.triggerOrigenId;
  return null;
}

function extraerEstado(payload) {
  if (payload.tipoRegistro === 'estadoActual') return payload.estado;
  if (payload.tipoRegistro === 'alerta') return payload.estadoAlerta;
  return null;
}

function extraerTiempo(payload) {
  if (payload.tipoRegistro === 'estadoActual') {
    return payload.fechaUltimaEjecucionUtc ?? payload.fechaUltimoCambioUtc;
  }
  if (payload.tipoRegistro === 'evento') return payload.ejecutadoEnUtc;
  if (payload.tipoRegistro === 'tramoHistorico') return payload.validoDesdeUtc;
  if (payload.tipoRegistro === 'alerta') {
    return payload.cerradaEnUtc ?? payload.ultimaEjecucionUtc;
  }
  if (payload.tipoRegistro === 'rangoHistorico') return payload.desdeUtc;
  return null;
}

function mapearRegistro(fila) {
  const payload = JSON.parse(fila.representacion_canonica);
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    installationOrigenId: fila.installation_origen_id,
    elementoOrigenId: fila.elemento_origen_id,
    generacionId: fila.generacion_actual_id,
    secuenciaElemento: String(fila.secuencia_elemento),
    ocurrenciaOrigenId: fila.ocurrencia_origen_id,
    tipoRegistro: fila.tipo_registro,
    monitorOrigenId: fila.monitor_origen_id,
    referenciaOrigenId: fila.referencia_origen_id,
    alertaAuditoriaId: fila.alerta_auditoria_id,
    estadoOperativo: fila.estado_operativo,
    tiempoDatoUtc: serializarFecha(fila.tiempo_dato_utc),
    vigenteHastaOrigenUtc: serializarFecha(fila.vigente_hasta_origen_utc),
    scopeRecepcion: Object.freeze({
      nivel: fila.scope_nivel,
      tenantId: decimalOpcional(fila.scope_tenant_id),
      empresaId: decimalOpcional(fila.scope_empresa_id),
      sitioId: decimalOpcional(fila.scope_sitio_id)
    }),
    completitud: Object.freeze({
      interpretable: fila.completitud_interpretable,
      observable: fila.completitud_observable,
      reconstruible: fila.completitud_reconstruible
    }),
    estadoProyeccion: Object.freeze({
      vigencia: fila.estado_vigencia,
      soporte: fila.estado_soporte,
      autorizacion: fila.estado_autorizacion
    }),
    payload
  });
}

function crearRepresentacionRetirada() {
  return {
    perfil: 'sentinelia-federacion-monitores-retirada-v1',
    version: 1,
    causa: 'retiradaOrigen'
  };
}

function dimensionesVacias() {
  return {
    tipoRegistro: null,
    monitorOrigenId: null,
    referenciaOrigenId: null,
    alertaAuditoriaId: null,
    estadoOperativo: null,
    tiempoDatoUtc: null,
    vigenteHastaOrigenUtc: null
  };
}

function resultadoMaterializacion(trabajo, operacion, yaMaterializada) {
  return Object.freeze({
    estado: operacion === 'retirada' ? 'retirada' : 'materializada',
    yaMaterializada,
    proyeccionId: trabajo.proyeccion_id,
    generacionId: trabajo.generacion_id,
    secuenciaElemento: String(trabajo.secuencia_elemento)
  });
}

function estadoRegistro(operacion) {
  return operacion === 'retirada' ? 'retirado' : 'presente';
}

function elemento(valor, campo) {
  return identidad(valor, TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN, campo);
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch {
    fallar('identidad_monitor_remoto_invalida', `${campo} no es una identidad federada válida.`);
  }
}

function uuidV7(valor, campo) {
  const texto = String(valor || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(texto)) {
    fallar('uuidv7_monitor_remoto_invalido', `${campo} debe ser un UUIDv7.`);
  }
  return texto;
}

function decimalPositivo(valor, campo) {
  let numero;
  try { numero = BigInt(valor); } catch { numero = 0n; }
  if (numero < 1n || numero > 18_446_744_073_709_551_615n) {
    fallar('decimal_monitor_remoto_invalido', `${campo} debe ser un decimal positivo.`);
  }
  return numero.toString();
}

function decimalOpcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function fechaConsulta(valor, campo) {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    fallar('fecha_consulta_monitores_invalida', `${campo} no es una fecha válida.`);
  }
  return fecha;
}

function fechaSqlOpcional(valor) {
  return valor === null || valor === undefined ? null : new Date(valor);
}

function limiteConsulta(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > 1000) {
    fallar('limite_consulta_monitores_invalido', 'El límite debe estar entre 1 y 1000.');
  }
  return numero;
}

function textoAscii(valor, maximo, campo) {
  const texto = String(valor || '');
  if (!texto || texto.length > maximo || !/^[\x20-\x7e]+$/u.test(texto)) {
    fallar('texto_monitor_remoto_invalido', `${campo} debe ser ASCII válido.`);
  }
  return texto;
}

function serializarFecha(valor) {
  return valor === null || valor === undefined ? null : new Date(valor).toISOString();
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    fallar('conexion_monitor_remoto_ausente', 'La materialización exige conexión compartida.');
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    fallar('transaccion_monitor_remoto_ausente', 'La materialización exige transacción activa.');
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function fallar(codigo, mensaje) {
  throw new ErrorMonitoresRemotosFederacion(codigo, mensaje);
}
