import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import {
  derivarIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

const CAUSAS = new Set([
  'reduccionConcesion', 'sinAutoridad',
  'relacionDeshabilitada', 'relacionEliminada'
]);
const MAX_BIGINT_UNSIGNED = '18446744073709551615';

export class RepositorioConsecuenciasConcesionFederacionSql {
  constructor(clienteSql, { repositorioSoporteCampos } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('Las consecuencias de concesión requieren SQL operativo.');
    }
    for (const metodo of [
      'retirarContribucionEnTransaccion',
      'retirarCamposContribucionEnTransaccion'
    ]) {
      if (typeof repositorioSoporteCampos?.[metodo] !== 'function') {
        throw new Error(`Las consecuencias de concesión requieren ${metodo}().`);
      }
    }
    this.clienteSql = clienteSql;
    this.repositorioSoporteCampos = repositorioSoporteCampos;
  }

  async aplicar(entrada = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await this.aplicarEnTransaccion(entrada, { conexion });
      await conexion.commit();
      return resultado;
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
  }

  async aplicarEnTransaccion({
    relacionId,
    revisionAnteriorId = null,
    revisionSiguienteId = null,
    seleccionAnterior = null,
    seleccionSiguiente = null,
    causa,
    ahora = null
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    if (!CAUSAS.has(causa)) throw new Error('La causa del corte de datos no es contractual.');
    const [relaciones] = await conexion.execute(
      'SELECT relacion_id,direccion FROM relaciones_federacion WHERE relacion_id=? FOR UPDATE',
      [relacionId]
    );
    const relacion = relaciones[0];
    if (!relacion) throw new Error('La relación del corte de datos no existe.');
    const instante = ahora || await ahoraSql(conexion);
    const reduccion = calcularReduccion(seleccionAnterior, seleccionSiguiente, causa);
    const corteId = identidadCorte({
      relacionId, revisionAnteriorId, revisionSiguienteId, causa
    });
    const [existentes] = await conexion.execute(
      'SELECT corte_id FROM cortes_datos_concesion_federacion WHERE corte_id=? FOR UPDATE',
      [corteId]
    );
    if (existentes[0]) {
      return Object.freeze({ estado: 'yaAplicado', corteId, reduccion });
    }
    await conexion.execute(
      `INSERT INTO cortes_datos_concesion_federacion (
         corte_id,relacion_id,revision_anterior_id,revision_siguiente_id,
         direccion,causa,reduccion_canonica,aplicado_en_utc
       ) VALUES (?,?,?,?,?,?,?,?)`,
      [corteId, relacionId, revisionAnteriorId, revisionSiguienteId,
        relacion.direccion, causa, canonicalizarJsonFederacion(reduccion), instante]
    );
    const familias = Object.keys(reduccion.familias).sort();
    if (familias.length === 0) {
      return Object.freeze({ estado: 'sinReduccion', corteId, reduccion });
    }
    const flujos = await bloquearFlujos(conexion, relacionId, familias);
    let salidas = 0;
    let contribucionesRetiradas = 0;
    let camposRetirados = 0;
    for (const flujo of flujos) {
      const detalle = reduccion.familias[flujo.familia];
      await detenerTrabajoFlujo(conexion, flujo, causa, detalle.completa, instante);
      if (relacion.direccion === 'emision') {
        salidas += await registrarSalidasEmision(conexion, {
          corteId, flujo, detalle, instante
        });
      } else {
        const resultado = await aplicarSalidasRecepcion(this, conexion, {
          corteId, flujo, detalle, causa, instante
        });
        salidas += resultado.salidas;
        contribucionesRetiradas += resultado.contribucionesRetiradas;
        camposRetirados += resultado.camposRetirados;
      }
    }
    return Object.freeze({
      estado: 'aplicado', corteId, reduccion,
      flujosDetenidos: flujos.length, salidas,
      contribucionesRetiradas, camposRetirados
    });
  }
}

function calcularReduccion(anterior, siguiente, causa) {
  const a = normalizarSeleccion(anterior);
  const b = normalizarSeleccion(siguiente);
  const total = causa !== 'reduccionConcesion' || !b.activa || b.vacia;
  const nivelesRetirados = (a.nivelesScope || [])
    .filter((nivel) => !(b.nivelesScope || []).includes(nivel)).sort();
  const familias = {};
  for (const [familia, selectorAnterior] of Object.entries(a.familias || {})) {
    const selectorSiguiente = total ? null : b.familias?.[familia];
    const completa = !selectorSiguiente;
    const campos = completa
      ? [...(selectorAnterior.campos || [])].sort()
      : (selectorAnterior.campos || [])
        .filter((campo) => !(selectorSiguiente.campos || []).includes(campo)).sort();
    const sensibleRetirado = !completa && selectorAnterior.permiteContenidoSensible &&
      !selectorSiguiente.permiteContenidoSensible;
    const refederacionRetirada = !completa && selectorAnterior.permiteRefederacion &&
      !selectorSiguiente.permiteRefederacion;
    if (completa || campos.length || sensibleRetirado || refederacionRetirada ||
        nivelesRetirados.length) {
      familias[familia] = Object.freeze({
        completa, campos: Object.freeze(campos),
        sensibleRetirado, refederacionRetirada,
        nivelesScopeRetirados: Object.freeze(nivelesRetirados),
        soloRefederacion: !completa && campos.length === 0 && !sensibleRetirado &&
          refederacionRetirada && nivelesRetirados.length === 0
      });
    }
  }
  return Object.freeze({
    total,
    nivelesScopeRetirados: Object.freeze(nivelesRetirados),
    familias: Object.freeze(familias)
  });
}

function normalizarSeleccion(valor) {
  if (!valor) return { activa: false, vacia: true, nivelesScope: [], familias: {} };
  const datos = typeof valor === 'string' ? JSON.parse(valor) : valor;
  return typeof datos?.toJSON === 'function' ? datos.toJSON() : datos;
}

async function bloquearFlujos(conexion, relacionId, familias) {
  const [filas] = await conexion.execute(
    `SELECT * FROM flujos_federacion WHERE relacion_id=?
       AND familia IN (${familias.map(() => '?').join(',')})
       ORDER BY flujo_id FOR UPDATE`,
    [relacionId, ...familias]
  );
  return filas;
}

async function detenerTrabajoFlujo(conexion, flujo, causa, completa, ahora) {
  const causaTecnica = causa === 'reduccionConcesion' ? 'salida_concesion' : causa;
  await conexion.execute(
    `UPDATE outbox_federacion SET estado='bloqueada',
       ultimo_resultado='invalidada_control',ultimo_error_terminal=?,
       ultimo_error_temporal=NULL,ultimo_error_transporte=NULL,
       actualizada_en_utc=?,finalizada_en_utc=?
     WHERE flujo_id=? AND estado IN ('pendiente','procesando','reintentable')`,
    [causaTecnica, ahora, ahora, flujo.flujo_id]
  );
  await conexion.execute(
    `UPDATE propietarios_emision_flujos_federacion
        SET instancia_lease_id=NULL,lease_token=NULL,lease_expira_utc=NULL,
            generacion_trabajo_id=NULL
      WHERE flujo_id=? AND estado='vigente'`,
    [flujo.flujo_id]
  );
  await conexion.execute(
    `UPDATE flujos_federacion SET estado='detenido',
       version_estado=version_estado+IF(estado='detenido',0,1),
       version_registro=version_registro+1,actualizada_en_utc=?
     WHERE flujo_id=?`,
    [ahora, flujo.flujo_id]
  );
  if (!completa || !flujo.generacion_activa_id) return;
  await conexion.execute(
    `UPDATE generaciones_flujos_federacion
        SET estado='cancelada',rol_generacion='historica',
            version_estado=version_estado+1,version_registro=version_registro+1,
            actualizada_en_utc=?,finalizada_en_utc=?
      WHERE flujo_id=? AND generacion_id=? AND rol_generacion='activa'`,
    [ahora, ahora, flujo.flujo_id, flujo.generacion_activa_id]
  );
  await conexion.execute(
    `UPDATE propietarios_emision_flujos_federacion
        SET estado='liberado',finalizado_en_utc=?
      WHERE flujo_id=? AND estado='vigente'`,
    [ahora, flujo.flujo_id]
  );
  await conexion.execute(
    'UPDATE flujos_federacion SET generacion_activa_id=NULL WHERE flujo_id=?',
    [flujo.flujo_id]
  );
}

async function registrarSalidasEmision(conexion, { corteId, flujo, detalle, instante }) {
  if (detalle.soloRefederacion) return 0;
  const soloReduccionNivel = detalle.nivelesScopeRetirados.length &&
    !detalle.completa && detalle.campos.length === 0 && !detalle.sensibleRetirado;
  const filtroNivel = soloReduccionNivel
    ? ` AND JSON_UNQUOTE(JSON_EXTRACT(o.payload_canonico,
         '$.scopeOrigenDeclarado.nivel')) IN (
           ${detalle.nivelesScopeRetirados.map(() => '?').join(',')}
         )`
    : '';
  const [elementos] = await conexion.execute(
    `SELECT DISTINCT p.elemento_origen_id
       FROM posiciones_ocurrencias_flujos_federacion p
       JOIN ocurrencias_federacion o
         ON o.installation_origen_id=p.installation_origen_id
        AND o.familia=p.familia AND o.elemento_origen_id=p.elemento_origen_id
        AND o.ocurrencia_origen_id=p.ocurrencia_origen_id
      WHERE p.flujo_id=?${filtroNivel}
      ORDER BY p.elemento_origen_id FOR UPDATE`,
    [flujo.flujo_id, ...(soloReduccionNivel ? detalle.nivelesScopeRetirados : [])]
  );
  for (const elemento of elementos) {
    await insertarSalida(conexion, {
      corteId, flujo, detalle, instante,
      elementoOrigenId: elemento.elemento_origen_id,
      estado: 'pendienteEmision'
    });
  }
  return elementos.length;
}

async function aplicarSalidasRecepcion(instancia, conexion, {
  corteId, flujo, detalle, causa, instante
}) {
  const soloReduccionNivel = detalle.nivelesScopeRetirados.length &&
    !detalle.completa && detalle.campos.length === 0 && !detalle.sensibleRetirado &&
    !detalle.refederacionRetirada;
  const filtroNivel = soloReduccionNivel
    ? ` AND EXISTS (
          SELECT 1 FROM aportes_ocurrencias_contribuciones_federacion a
          JOIN inbox_ocurrencias_federacion i ON i.id=a.inbox_ocurrencia_id
         WHERE a.contribucion_id=c.contribucion_id
           AND JSON_UNQUOTE(JSON_EXTRACT(i.payload_canonico,
             '$.scopeOrigenDeclarado.nivel')) IN (
               ${detalle.nivelesScopeRetirados.map(() => '?').join(',')}
             )
        )`
    : '';
  const [contribuciones] = await conexion.execute(
    `SELECT c.contribucion_id,c.proyeccion_id,
            (
              SELECT JSON_UNQUOTE(JSON_EXTRACT(i.payload_canonico,
                '$.scopeOrigenDeclarado.nivel'))
                FROM aportes_ocurrencias_contribuciones_federacion a
                JOIN inbox_ocurrencias_federacion i ON i.id=a.inbox_ocurrencia_id
               WHERE a.contribucion_id=c.contribucion_id
               ORDER BY a.ultima_observacion_utc DESC,a.inbox_ocurrencia_id DESC
               LIMIT 1
            ) AS nivel_origen
       FROM contribuciones_proyecciones_federacion c
       JOIN proyecciones_federacion p ON p.proyeccion_id=c.proyeccion_id
      WHERE c.relacion_id=? AND p.familia=? AND c.estado_soporte='activa'
        ${filtroNivel}
      ORDER BY c.contribucion_id FOR UPDATE`,
    [flujo.relacion_id, flujo.familia,
      ...(soloReduccionNivel ? detalle.nivelesScopeRetirados : [])]
  );
  let contribucionesRetiradas = 0;
  let camposRetirados = 0;
  for (const contribucion of contribuciones) {
    if (detalle.soloRefederacion) {
      await insertarSalida(conexion, {
        corteId, flujo, detalle, instante,
        proyeccionId: contribucion.proyeccion_id,
        contribucionId: contribucion.contribucion_id,
        estado: 'pendienteRefederacion'
      });
      continue;
    }
    const salePorNivel = detalle.nivelesScopeRetirados.includes(
      contribucion.nivel_origen
    );
    if (detalle.completa || salePorNivel) {
      await instancia.repositorioSoporteCampos.retirarContribucionEnTransaccion({
        contribucionId: contribucion.contribucion_id,
        causa: causa === 'reduccionConcesion' ? 'salidaConcesion' : causa
      }, { conexion });
      contribucionesRetiradas += 1;
    } else if (detalle.campos.length || detalle.sensibleRetirado) {
      const campos = detalle.sensibleRetirado
        ? await listarCamposSensiblesActivos(conexion, contribucion.contribucion_id,
          detalle.campos)
        : detalle.campos;
      const resultado = await instancia.repositorioSoporteCampos
        .retirarCamposContribucionEnTransaccion({
          contribucionId: contribucion.contribucion_id,
          campos,
          causa: 'reduccionConcesion'
        }, { conexion });
      camposRetirados += resultado.camposRecalculados;
    }
    await insertarSalida(conexion, {
      corteId, flujo, detalle, instante,
      proyeccionId: contribucion.proyeccion_id,
      contribucionId: contribucion.contribucion_id,
      estado: 'aplicadaRecepcion'
    });
  }
  const supresion = causa === 'reduccionConcesion' ? 'salidaConcesion' : causa;
  if (!detalle.soloRefederacion) {
    const [fencingAgotado] = await conexion.execute(
      `SELECT entrega_id FROM trabajos_materializacion_federacion
        WHERE relacion_id=? AND familia=? AND estado='procesando'
          AND fencing_token=? LIMIT 1 FOR UPDATE`,
      [flujo.relacion_id, flujo.familia, MAX_BIGINT_UNSIGNED]
    );
    if (fencingAgotado[0]) {
      throw new Error('El corte no puede revocar un trabajo cuyo fencing se agotó.');
    }
    await conexion.execute(
    `UPDATE trabajos_materializacion_federacion SET
       fencing_token=IF(estado='procesando',fencing_token+1,fencing_token),
       estado='suprimida',causa_supresion=?,propietario_lease=NULL,
       lease_hasta_utc=NULL,ultimo_error_codigo=NULL,actualizado_en_utc=?
     WHERE relacion_id=? AND familia=?
       AND estado IN ('pendiente','procesando','fallida')`,
      [supresion, instante, flujo.relacion_id, flujo.familia]
    );
  }
  if (detalle.completa || detalle.nivelesScopeRetirados.length) {
    await retirarPublicacionesHuerfanas(conexion, flujo, instante);
  }
  await purgarDeclaracionesSensiblesSinSoporte(conexion);
  return { salidas: contribuciones.length, contribucionesRetiradas, camposRetirados };
}

async function listarCamposSensiblesActivos(conexion, contribucionId, adicionales) {
  const [filas] = await conexion.execute(
    `SELECT DISTINCT s.nombre_campo
       FROM soportes_campos_contribuciones_federacion s
       JOIN declaraciones_campos_inbox_federacion d ON d.id=s.declaracion_campo_id
      WHERE s.contribucion_id=? AND s.estado='activo' AND d.sensibilidad='sensible'`,
    [contribucionId]
  );
  return [...new Set([...adicionales, ...filas.map((fila) => fila.nombre_campo)])].sort();
}

async function retirarPublicacionesHuerfanas(conexion, flujo, ahora) {
  const [filas] = await conexion.execute(
    `SELECT e.proyeccion_id,e.generacion_actual_id
       FROM estados_actuales_proyecciones_federacion e
       JOIN proyecciones_federacion p ON p.proyeccion_id=e.proyeccion_id
      WHERE p.familia=? AND NOT EXISTS (
        SELECT 1 FROM contribuciones_proyecciones_federacion c
         WHERE c.proyeccion_id=e.proyeccion_id AND c.estado_soporte='activa'
      ) AND EXISTS (
        SELECT 1 FROM contribuciones_proyecciones_federacion c0
         WHERE c0.proyeccion_id=e.proyeccion_id AND c0.relacion_id=?
      ) FOR UPDATE`,
    [flujo.familia, flujo.relacion_id]
  );
  for (const fila of filas) {
    await conexion.execute(
      'DELETE FROM estados_actuales_proyecciones_federacion WHERE proyeccion_id=?',
      [fila.proyeccion_id]
    );
    await conexion.execute(
      `UPDATE versiones_proyecciones_federacion
          SET estado_publicacion='historica',estado_vigencia='retirada',
              estado_soporte='huerfana',estado_autorizacion='noAutorizada',
              version_estado=version_estado+1,actualizada_en_utc=?,finalizada_en_utc=?
        WHERE proyeccion_id=? AND generacion_id=? AND estado_publicacion='actual'`,
      [ahora, ahora, fila.proyeccion_id, fila.generacion_actual_id]
    );
  }
}

async function purgarDeclaracionesSensiblesSinSoporte(conexion) {
  await conexion.execute(
    `UPDATE declaraciones_campos_inbox_federacion d
        SET perfil_custodia=NULL,keyring_referencia=NULL,key_id=NULL,
            nonce=NULL,ciphertext=NULL,auth_tag=NULL,
            causa_purga=CASE
              WHEN EXISTS (
                SELECT 1 FROM eventos_soporte_campos_federacion e
                 WHERE e.declaracion_campo_id=d.id AND e.tipo='retiradoContribucion'
              ) THEN 'retiradaContribucion' ELSE 'retiradaCampo' END,
            purgada_en_utc=UTC_TIMESTAMP(3)
      WHERE d.sensibilidad='sensible' AND d.ciphertext IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM soportes_campos_contribuciones_federacion s
           WHERE s.declaracion_campo_id=d.id AND s.estado='activo'
        )`
  );
}

async function insertarSalida(conexion, entrada) {
  const salidaId = String(derivarIdentidadFederada({
    tipo: TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN,
    perfil: 'salida-concesion-v1',
    componentes: [entrada.corteId, entrada.flujo.flujo_id,
      entrada.proyeccionId || entrada.elementoOrigenId,
      entrada.contribucionId || 'emision']
  }));
  await conexion.execute(
    `INSERT INTO salidas_concesion_federacion (
       salida_id,corte_id,flujo_id,familia,proyeccion_id,contribucion_id,
       elemento_origen_id,campos_retirados_canonicos,estado,creada_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [salidaId, entrada.corteId, entrada.flujo.flujo_id, entrada.flujo.familia,
      entrada.proyeccionId || null, entrada.contribucionId || null,
      entrada.elementoOrigenId || null,
      canonicalizarJsonFederacion(entrada.detalle.campos),
      entrada.estado, entrada.instante]
  );
}

function identidadCorte({ relacionId, revisionAnteriorId, revisionSiguienteId, causa }) {
  return String(derivarIdentidadFederada({
    tipo: TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN,
    perfil: 'corte-datos-concesion-v1',
    componentes: [relacionId, revisionAnteriorId || 'sin-revision',
      revisionSiguienteId || 'sin-siguiente', causa]
  }));
}

function exigirConexion(conexion) {
  if (!conexion?.execute || !conexion?.query) {
    throw new Error('El corte de datos exige una conexión SQL prestada.');
  }
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}
