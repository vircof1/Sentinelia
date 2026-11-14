import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';
import {
  TIPOS_REGISTRO_TELEMETRIA_FEDERACION,
  validarPayloadTelemetriaFederacion
} from '../src/PayloadTelemetriaFederacion.js';

export class ErrorTelemetriaRemota extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorTelemetriaRemota';
    this.codigo = codigo;
  }
}

export class RepositorioTelemetriaRemotaSql {
  constructor(clienteSql, { permitirMomentoUtcRelativo = false } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('La telemetría remota requiere SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.permitirMomentoUtcRelativo = Boolean(permitirMomentoUtcRelativo);
  }

  async materializarEnTransaccion({ operacion, payload, contexto } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    await exigirTransaccionActiva(conexion);
    const trabajo = await obtenerTrabajoBloqueado(conexion, contexto);
    if (operacion !== trabajo.operacion) {
      fallar(
        'operacion_telemetria_no_corresponde',
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
        'retirada_telemetria_con_payload',
        'Una retirada de telemetría no puede transportar un payload de actualización.'
      );
    }
    const normalizado = operacion === 'actualizacion'
      ? validarPayloadTelemetriaFederacion(payload, {
        operacion,
        permitirMomentoUtcRelativo: this.permitirMomentoUtcRelativo
      })
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
          'registro_telemetria_divergente',
          'La secuencia de telemetría ya fue materializada con otro contenido.'
        );
      }
      return resultadoMaterializacion(trabajo, operacion, true);
    }
    const dimensiones = operacion === 'actualizacion'
      ? extraerDimensiones(normalizado, trabajo)
      : dimensionesVacias();
    const ahora = await ahoraSql(conexion);
    await conexion.execute(
      `INSERT INTO registros_telemetria_remotos (
         proyeccion_id,generacion_id,secuencia_elemento,
         trabajo_entrega_id,inbox_ocurrencia_id,ocurrencia_origen_id,
         tipo_registro,estado_registro,fuente_origen_id,senal_origen_id,
         referencia_origen_id,tiempo_dato_utc,vigente_hasta_origen_utc,
         causa_retirada,representacion_canonica,materializada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        trabajo.proyeccion_id,
        trabajo.generacion_id,
        String(trabajo.secuencia_elemento),
        trabajo.entrega_id,
        String(trabajo.inbox_ocurrencia_id),
        trabajo.ocurrencia_origen_id,
        dimensiones.tipoRegistro,
        estadoRegistro(operacion),
        dimensiones.fuenteOrigenId,
        dimensiones.senalOrigenId,
        dimensiones.referenciaOrigenId,
        dimensiones.tiempoDatoUtc,
        dimensiones.vigenteHastaOrigenUtc,
        operacion === 'retirada' ? 'retiradaOrigen' : null,
        canonico,
        ahora
      ]
    );
    return resultadoMaterializacion(trabajo, operacion, false);
  }

  async listarActuales(filtros = {}) {
    return this.#consultarPublicados(filtros);
  }

  async listarObservaciones({ desdeUtc = null, hastaUtc = null, limite = 200, ...filtros } = {}) {
    const condiciones = ['r.tipo_registro=\'observacion\''];
    const parametros = [];
    const desde = desdeUtc === null ? null : fechaConsulta(desdeUtc, 'desdeUtc');
    const hasta = hastaUtc === null ? null : fechaConsulta(hastaUtc, 'hastaUtc');
    if (desde !== null && hasta !== null && hasta <= desde) {
      fallar(
        'rango_consulta_telemetria_invalido',
        'El final de la consulta histórica debe ser posterior a su inicio.'
      );
    }
    if (desdeUtc !== null) {
      condiciones.push('r.tiempo_dato_utc>=?');
      parametros.push(desde);
    }
    if (hastaUtc !== null) {
      condiciones.push('r.tiempo_dato_utc<?');
      parametros.push(hasta);
    }
    return this.#consultarPublicados(filtros, {
      condicionesAdicionales: condiciones,
      parametrosAdicionales: parametros,
      limite: limiteConsulta(limite),
      orden: 'r.tiempo_dato_utc DESC,r.proyeccion_id'
    });
  }

  async listarEstadosSenalSeleccionables(filtros = {}) {
    return this.#consultarPublicados(
      { ...filtros, tipoRegistro: 'fotografiaSenal' },
      { orden: 'r.tiempo_dato_utc DESC,r.proyeccion_id' }
    );
  }

  async resolverFuenteMonitorizable({ proyeccionId } = {}) {
    const proyeccion = identidad(
      proyeccionId,
      TIPOS_IDENTIDAD_FEDERADA.PROYECCION,
      'proyeccionId'
    );
    const [retirada] = await this.clienteSql.consultar(
      `SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              r.ocurrencia_origen_id,r.secuencia_retirada,
              r.relacion_observadora_id,r.flujo_observador_id,
              r.generacion_observadora_id,r.creada_en_utc
         FROM proyecciones_federacion p
         JOIN retiradas_origen_proyecciones_federacion r
           ON r.proyeccion_id=p.proyeccion_id
        WHERE p.proyeccion_id=? AND p.familia='telemetria'`,
      [proyeccion]
    );
    if (retirada) {
      return Object.freeze({
        condicionFuente: 'fuente_retirada',
        proyeccionId: proyeccion,
        registro: null,
        retirada: Object.freeze({
          installationOrigenId: retirada.installation_origen_id,
          elementoOrigenId: retirada.elemento_origen_id,
          ocurrenciaOrigenId: retirada.ocurrencia_origen_id,
          secuenciaElemento: String(retirada.secuencia_retirada),
          relacionId: retirada.relacion_observadora_id,
          flujoId: retirada.flujo_observador_id,
          generacionId: retirada.generacion_observadora_id,
          retiradaEnUtc: serializarFecha(retirada.creada_en_utc)
        })
      });
    }
    const [registro] = await this.listarEstadosSenalSeleccionables({
      proyeccionId: proyeccion
    });
    return Object.freeze({
      condicionFuente: registro ? 'publicada' : 'sin_fotografia_publicada',
      proyeccionId: proyeccion,
      registro: registro || null,
      retirada: null
    });
  }

  async listarEstadosPolSeleccionables(filtros = {}) {
    return this.#consultarPublicados(
      { ...filtros, tipoRegistro: 'fotografiaPol' },
      { orden: 'r.tiempo_dato_utc DESC,r.proyeccion_id' }
    );
  }

  async listarRangosHistoricos(filtros = {}) {
    return this.#consultarPublicados(
      { ...filtros, tipoRegistro: 'rangoHistorico' },
      { orden: 'r.tiempo_dato_utc DESC,r.proyeccion_id' }
    );
  }

  async #consultarPublicados({
    installationOrigenId = null,
    proyeccionId = null,
    fuenteOrigenId = null,
    senalOrigenId = null,
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
      parametros.push(identidad(installationOrigenId, TIPOS_IDENTIDAD_FEDERADA.INSTALACION, 'installationOrigenId'));
    }
    if (proyeccionId !== null) {
      condiciones.push('p.proyeccion_id=?');
      parametros.push(identidad(proyeccionId, TIPOS_IDENTIDAD_FEDERADA.PROYECCION, 'proyeccionId'));
    }
    if (fuenteOrigenId !== null) {
      condiciones.push('r.fuente_origen_id=?');
      parametros.push(elemento(fuenteOrigenId, 'fuenteOrigenId'));
    }
    if (senalOrigenId !== null) {
      condiciones.push('r.senal_origen_id=?');
      parametros.push(elemento(senalOrigenId, 'senalOrigenId'));
    }
    if (tipoRegistro !== null) {
      if (!TIPOS_REGISTRO_TELEMETRIA_FEDERACION.includes(tipoRegistro)) {
        fallar('tipo_consulta_telemetria_invalido', 'El tipo de registro consultado no existe.');
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
                    FROM registros_telemetria_remotos r2
                   WHERE r2.proyeccion_id=p.proyeccion_id
                     AND r2.generacion_id=a.generacion_actual_id
                     AND r2.secuencia_elemento<=v.ultima_secuencia_evaluada
                     ${filtroTipoGobernante}
                ) AS secuencia_telemetria
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a
             ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id
            AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='telemetria'
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              a.generacion_actual_id,r.secuencia_elemento,r.ocurrencia_origen_id,
              r.inbox_ocurrencia_id,
              r.tipo_registro,r.fuente_origen_id,r.senal_origen_id,
              r.referencia_origen_id,r.tiempo_dato_utc,
              r.vigente_hasta_origen_utc,r.representacion_canonica,
              rf.estado_ciclo AS relacion_estado_ciclo,
              rf.estado_autoridad AS relacion_estado_autoridad,
              rf.estado_identidad AS relacion_estado_identidad,
              rf.estado_compatibilidad AS relacion_estado_compatibilidad,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible,v.estado_vigencia,v.estado_soporte,
              v.estado_autorizacion,UTC_TIMESTAMP(3) AS consultada_en_utc
         FROM registros_actuales a
         JOIN proyecciones_federacion p ON p.proyeccion_id=a.proyeccion_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=a.proyeccion_id
          AND v.generacion_id=a.generacion_actual_id
         JOIN registros_telemetria_remotos r
           ON r.proyeccion_id=a.proyeccion_id
          AND r.generacion_id=a.generacion_actual_id
          AND r.secuencia_elemento=a.secuencia_telemetria
          AND r.estado_registro='presente'
         JOIN trabajos_materializacion_federacion w
           ON w.entrega_id=r.trabajo_entrega_id
         JOIN relaciones_federacion rf ON rf.relacion_id=w.relacion_id
        WHERE 1=1 ${filtro}
        ORDER BY ${orden}${clausulaLimite}`,
      parametros
    );
    const rutas = await obtenerRutasRegistros(this.clienteSql, filas);
    return Object.freeze(filas.map((fila) => mapearRegistro(
      fila,
      rutas.get(claveRegistro(fila.proyeccion_id, fila.inbox_ocurrencia_id)) || []
    )));
  }
}

async function obtenerTrabajoBloqueado(conexion, contexto) {
  const entregaId = identidad(contexto?.entregaId, TIPOS_IDENTIDAD_FEDERADA.ENTREGA, 'entregaId');
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
    fallar('fencing_materializacion_telemetria_obsoleto', 'El materializador de telemetría no gobierna el trabajo reclamado.');
  }
  if (trabajo.familia !== 'telemetria' || trabajo.familia_proyeccion !== 'telemetria') {
    fallar('familia_materializacion_telemetria_incompatible', 'El trabajo no pertenece a una proyección de telemetría.');
  }
  return trabajo;
}

async function obtenerRegistro(conexion, trabajo, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT * FROM registros_telemetria_remotos
      WHERE proyeccion_id=? AND generacion_id=? AND secuencia_elemento=?${bloquear ? ' FOR UPDATE' : ''}`,
    [trabajo.proyeccion_id, trabajo.generacion_id, String(trabajo.secuencia_elemento)]
  );
  return filas[0] || null;
}

function extraerDimensiones(payload, trabajo) {
  const observacion = payload.tipoRegistro === 'fotografiaSenal' ? payload.observacion : payload;
  const fuenteOrigenId = payload.tipoRegistro === 'fuente'
    ? trabajo.elemento_origen_id
    : payload.fuenteOrigenId ?? observacion.fuenteOrigenId ?? null;
  const senalOrigenId = payload.tipoRegistro === 'senal'
    ? trabajo.elemento_origen_id
    : payload.senalOrigenId ?? observacion.senalOrigenId ?? null;
  return {
    tipoRegistro: payload.tipoRegistro,
    fuenteOrigenId,
    senalOrigenId,
    referenciaOrigenId: extraerReferencia(payload),
    tiempoDatoUtc: fechaSqlOpcional(extraerTiempo(payload)),
    vigenteHastaOrigenUtc: fechaSqlOpcional(observacion.vigenteHastaUtc ?? null)
  };
}

function extraerReferencia(payload) {
  if (payload.tipoRegistro === 'fotografiaSenal') return payload.observacionOrigenId;
  if (payload.tipoRegistro === 'fotografiaPol') return payload.periodoPolOrigenId;
  if (payload.tipoRegistro === 'reglaDerivacion') {
    return payload.estadoActual?.revisionOrigenId ?? payload.revisionVigenteOrigenId;
  }
  if (payload.tipoRegistro === 'eventoDerivado') return payload.reglaOrigenId;
  return null;
}

function extraerTiempo(payload) {
  if (payload.tipoRegistro === 'senal') return payload.ultimaDeclaracionUtc ?? payload.consolidadaEnUtc;
  if (payload.tipoRegistro === 'observacion') return payload.observadoEnUtc;
  if (payload.tipoRegistro === 'fotografiaSenal') return payload.observacion.observadoEnUtc;
  if (payload.tipoRegistro === 'fotografiaPol') {
    return payload.ultimoHeartbeatUtc ?? payload.finUtc ?? payload.inicioUtc;
  }
  if (payload.tipoRegistro === 'reglaDerivacion') {
    return payload.estadoActual?.evaluadoEnUtc ?? payload.revisiones.at(-1).vigenteDesdeUtc;
  }
  if (payload.tipoRegistro === 'eventoDerivado') return payload.observadoEnUtc;
  if (payload.tipoRegistro === 'rangoHistorico') return payload.desdeUtc;
  return null;
}

function mapearRegistro(fila, rutas = []) {
  const payload = JSON.parse(fila.representacion_canonica);
  const rutasLegitimas = rutas.filter((ruta) => ruta.legitima);
  const tieneRutas = rutas.length > 0;
  const sostenida = tieneRutas
    ? rutasLegitimas.length > 0
    : fila.estado_soporte === 'sostenida' &&
      fila.relacion_estado_ciclo === 'vinculada' &&
      fila.relacion_estado_autoridad === 'autorizada' &&
      fila.relacion_estado_identidad === 'valida';
  const autorizada = tieneRutas
    ? rutas.some((ruta) => ruta.autorizada)
    : fila.estado_autorizacion === 'autorizada' &&
      fila.relacion_estado_ciclo === 'vinculada' &&
      fila.relacion_estado_autoridad === 'autorizada' &&
      fila.relacion_estado_identidad === 'valida';
  const compatible = tieneRutas
    ? rutas.some((ruta) => ruta.autorizada && ruta.compatible)
    : ['compatible', 'compatibleParcial'].includes(
        fila.relacion_estado_compatibilidad
      );
  const vigenteHastaEfectiva = fechaMinima([
    fila.vigente_hasta_origen_utc,
    limiteSostenidoPorRutas(rutasLegitimas)
  ]);
  const vigente = fila.estado_vigencia === 'vigente' && (
    vigenteHastaEfectiva === null ||
    vigenteHastaEfectiva > new Date(fila.consultada_en_utc)
  );
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    installationOrigenId: fila.installation_origen_id,
    elementoOrigenId: fila.elemento_origen_id,
    generacionId: fila.generacion_actual_id,
    secuenciaElemento: String(fila.secuencia_elemento),
    ocurrenciaOrigenId: fila.ocurrencia_origen_id,
    tipoRegistro: fila.tipo_registro,
    fuenteOrigenId: fila.fuente_origen_id,
    senalOrigenId: fila.senal_origen_id,
    referenciaOrigenId: fila.referencia_origen_id,
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
      vigencia: vigente ? 'vigente' : 'vencida',
      soporte: sostenida ? 'sostenida' : 'huerfana',
      autorizacion: autorizada ? 'autorizada' : 'noAutorizada',
      compatibilidad: compatible ? 'compatible' : 'incompatible'
    }),
    fotografiaOperativa: Object.freeze({
      vigenteHastaEfectivaUtc: vigenteHastaEfectiva?.toISOString() ?? null,
      utilizableAhora: vigente && sostenida && autorizada && compatible,
      rutas: Object.freeze(rutas)
    }),
    payload
  });
}

async function obtenerRutasRegistros(clienteSql, filas) {
  if (filas.length === 0) return new Map();
  const claves = [...new Map(filas.map((fila) => [
    claveRegistro(fila.proyeccion_id, fila.inbox_ocurrencia_id),
    [fila.proyeccion_id, String(fila.inbox_ocurrencia_id)]
  ])).values()];
  const condiciones = claves.map(() => '(c.proyeccion_id=? AND a.inbox_ocurrencia_id=?)');
  const rutas = await clienteSql.consultar(
    `SELECT c.proyeccion_id,a.inbox_ocurrencia_id,
            a.vigencia_restante_recepcion_ms,a.primera_observacion_utc,
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
    claves.flat()
  );
  const resultado = new Map();
  for (const fila of rutas) {
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
    const ruta = Object.freeze({
      contribucionId: fila.contribucion_id,
      relacionId: fila.relacion_id,
      revisionConcesionId: fila.revision_concesion_id,
      installationEmisoraId: fila.installation_emisora_id,
      autorizada,
      compatible,
      legitima: autorizada && compatible,
      vigenteHastaRutaUtc: calcularVigenciaRuta(fila)
    });
    const clave = claveRegistro(fila.proyeccion_id, fila.inbox_ocurrencia_id);
    resultado.set(clave, [...(resultado.get(clave) || []), ruta]);
  }
  return resultado;
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

function claveRegistro(proyeccionId, inboxId) {
  return `${proyeccionId}\u0000${inboxId}`;
}

function crearRepresentacionRetirada() {
  return { perfil: 'sentinelia-federacion-telemetria-retirada-v1', version: 1, causa: 'retiradaOrigen' };
}

function dimensionesVacias() {
  return { tipoRegistro: null, fuenteOrigenId: null, senalOrigenId: null, referenciaOrigenId: null, tiempoDatoUtc: null, vigenteHastaOrigenUtc: null };
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
    fallar('identidad_telemetria_invalida', `${campo} no es una identidad federada válida.`);
  }
}

function decimalPositivo(valor, campo) {
  let numero;
  try { numero = BigInt(valor); } catch { numero = 0n; }
  if (numero < 1n || numero > 18_446_744_073_709_551_615n) {
    fallar('decimal_telemetria_invalido', `${campo} debe ser un decimal positivo.`);
  }
  return numero.toString();
}

function decimalOpcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function fechaConsulta(valor, campo) {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) fallar('fecha_consulta_telemetria_invalida', `${campo} no es una fecha válida.`);
  return fecha;
}

function fechaSqlOpcional(valor) {
  return valor === null || valor === undefined ? null : new Date(valor);
}

function limiteConsulta(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > 1000) {
    fallar('limite_consulta_telemetria_invalido', 'El límite debe estar entre 1 y 1000.');
  }
  return numero;
}

function textoAscii(valor, maximo, campo) {
  const texto = String(valor || '');
  if (!texto || texto.length > maximo || !/^[\x20-\x7e]+$/u.test(texto)) {
    fallar('texto_telemetria_invalido', `${campo} debe ser ASCII válido.`);
  }
  return texto;
}

function serializarFecha(valor) {
  return valor === null || valor === undefined ? null : new Date(valor).toISOString();
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    fallar('conexion_telemetria_ausente', 'La materialización exige conexión compartida.');
  }
}

async function exigirTransaccionActiva(conexion) {
  const [filas] = await conexion.query('SELECT @@session.in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    fallar('transaccion_telemetria_ausente', 'La materialización exige transacción activa.');
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function fallar(codigo, mensaje) {
  throw new ErrorTelemetriaRemota(codigo, mensaje);
}
