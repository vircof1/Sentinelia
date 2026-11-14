import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';
import { FuenteEntropiaCriptograficaNode }
  from '../adaptadores/FuenteEntropiaCriptograficaNode.js';

const ESTADOS_GENERACION_NO_EMISOR = new Set(['cancelada', 'sustituida']);

export class ServicioCapturaIncrementalFamiliasFederacion {
  constructor({
    registroFamilias,
    adaptadorCaptura,
    generadorIdentidades = new GeneradorIdentidadesFederadas({
      fuenteEntropia: new FuenteEntropiaCriptograficaNode()
    })
  } = {}) {
    if (typeof registroFamilias?.obtenerProductivo !== 'function') {
      throw new Error('La captura incremental requiere el registro productivo de familias.');
    }
    if (typeof adaptadorCaptura?.capturarEnTransaccion !== 'function') {
      throw new Error('La captura incremental requiere el puerto durable de captura.');
    }
    if (typeof generadorIdentidades?.generar !== 'function') {
      throw new Error('La captura incremental requiere identidades de ocurrencia.');
    }
    this.registroFamilias = registroFamilias;
    this.adaptadorCaptura = adaptadorCaptura;
    this.generadorIdentidades = generadorIdentidades;
    Object.freeze(this);
  }

  async capturarEnTransaccion({ familia, prepararCapturas } = {}, {
    conexion
  } = {}) {
    exigirConexion(conexion);
    if (typeof prepararCapturas !== 'function') {
      throw new Error('La captura incremental requiere prepararCapturas().');
    }
    if (!await estaActivadaEnTransaccion(conexion)) {
      return resultadoVacio('federacionDesactivada');
    }
    const grupos = agruparDestinos(await cargarDestinos(conexion, familia));
    const posiciones = [];
    const ocurrencias = [];
    for (const grupo of grupos) {
      const adaptador = this.registroFamilias.obtenerProductivo({
        familia,
        versionFamilia: grupo.versionFamilia
      });
      const preparadas = await prepararCapturas({
        selector: grupo.selector,
        interfazCaptura: adaptador.interfaces.captura
      }, { conexion });
      const capturas = normalizarCapturas(preparadas);
      for (const captura of capturas) {
        validarCapturaFamilia(captura, familia);
        const destinos = grupo.destinos
          .filter((destino) => admiteScope(destino, captura.definicion.scopeOrigenDeclarado))
          .map((destino) => ({
            flujoId: destino.flujoId,
            generacionId: destino.generacionId,
            prioridad: captura.prioridad ?? 'reconstruccion',
            clasePosicion: 'cambioPosterior'
          }));
        const salidasScope = await registrarSalidasScopePrevias(this, conexion, {
          captura,
          destinosGrupo: grupo.destinos,
          destinosActuales: destinos
        });
        posiciones.push(...salidasScope);
        if (destinos.length === 0) continue;
        const resultado = await this.adaptadorCaptura.capturarEnTransaccion({
          definicion: captura.definicion,
          destinos
        }, { conexion });
        ocurrencias.push(resultado.ocurrencia);
        posiciones.push(...resultado.posiciones.filter(
          (posicion) => posicion.posicionFlujo !== null
        ));
      }
    }
    return Object.freeze({
      estado: posiciones.length ? 'capturada' : 'sinDestinos',
      ocurrencias: Object.freeze(ocurrencias),
      posiciones: Object.freeze(posiciones)
    });
  }

  async capturarPreparadasEnTransaccion({ familia, capturas } = {}, {
    conexion
  } = {}) {
    exigirConexion(conexion);
    const preparadas = normalizarCapturas(capturas);
    for (const captura of preparadas) validarCapturaFamilia(captura, familia);
    if (preparadas.length === 0) return resultadoVacio('sinCambiosFederables');
    if (!await estaActivadaEnTransaccion(conexion)) {
      return resultadoVacio('federacionDesactivada');
    }
    const grupos = agruparDestinos(await cargarDestinos(conexion, familia));
    const posiciones = [];
    const ocurrencias = [];
    for (const grupo of grupos) {
      for (const captura of preparadas) {
        if (Number(captura.definicion.familiaVersion) !== grupo.versionFamilia) {
          throw new Error(
            'Una retirada ya preparada no coincide con la versión del flujo de destino.'
          );
        }
        const destinos = grupo.destinos
          .filter((destino) => admiteScope(
            destino,
            captura.definicion.scopeOrigenDeclarado
          ))
          .map((destino) => ({
            flujoId: destino.flujoId,
            generacionId: destino.generacionId,
            prioridad: captura.prioridad ?? 'operativaActual',
            clasePosicion: 'cambioPosterior'
          }));
        if (destinos.length === 0) continue;
        const resultado = await this.adaptadorCaptura.capturarEnTransaccion({
          definicion: captura.definicion,
          destinos
        }, { conexion });
        ocurrencias.push(resultado.ocurrencia);
        posiciones.push(...resultado.posiciones.filter(
          (posicion) => posicion.posicionFlujo !== null
        ));
      }
    }
    return Object.freeze({
      estado: posiciones.length ? 'capturada' : 'sinDestinos',
      ocurrencias: Object.freeze(ocurrencias),
      posiciones: Object.freeze(posiciones)
    });
  }
}

async function registrarSalidasScopePrevias(instancia, conexion, {
  captura,
  destinosGrupo,
  destinosActuales
}) {
  if (captura.definicion.operacion !== 'actualizacion' || destinosGrupo.length === 0) {
    return [];
  }
  const clausulas = destinosGrupo.map(() => '(p.flujo_id=? AND p.generacion_id=?)')
    .join(' OR ');
  const parametros = destinosGrupo.flatMap((destino) => [
    destino.flujoId,
    destino.generacionId
  ]);
  const [filas] = await conexion.execute(
    `SELECT p.flujo_id,p.generacion_id,o.operacion,o.payload_canonico
       FROM posiciones_ocurrencias_flujos_federacion p
       JOIN ocurrencias_federacion o
         ON o.installation_origen_id=p.installation_origen_id
        AND o.familia=p.familia AND o.elemento_origen_id=p.elemento_origen_id
        AND o.ocurrencia_origen_id=p.ocurrencia_origen_id
      WHERE p.familia=? AND p.elemento_origen_id=?
        AND (${clausulas})
      ORDER BY p.flujo_id,p.generacion_id,p.posicion_flujo DESC FOR UPDATE`,
    [captura.definicion.familia, captura.definicion.elementoOrigenId, ...parametros]
  );
  const actuales = new Set(destinosActuales.map(
    (destino) => `${destino.flujoId}\u0000${destino.generacionId}`
  ));
  const anteriores = new Map();
  const vistos = new Set();
  for (const fila of filas) {
    const clave = `${fila.flujo_id}\u0000${fila.generacion_id}`;
    if (actuales.has(clave) || vistos.has(clave)) continue;
    vistos.add(clave);
    const payload = typeof fila.payload_canonico === 'string'
      ? JSON.parse(fila.payload_canonico)
      : fila.payload_canonico;
    if (['retirada', 'salidaProyeccion'].includes(fila.operacion)) continue;
    anteriores.set(clave, {
      flujoId: fila.flujo_id,
      generacionId: fila.generacion_id,
      scope: payload?.scopeOrigenDeclarado
    });
  }
  const porScope = new Map();
  for (const anterior of anteriores.values()) {
    if (!anterior.scope) continue;
    const clave = canonicalizarJsonFederacion(anterior.scope);
    const grupo = porScope.get(clave) || { scope: anterior.scope, destinos: [] };
    grupo.destinos.push({
      flujoId: anterior.flujoId,
      generacionId: anterior.generacionId,
      prioridad: 'operativaActual',
      clasePosicion: 'cambioPosterior'
    });
    porScope.set(clave, grupo);
  }
  if (porScope.size === 0) return [];
  const [[reloj]] = await conexion.query(
    "SELECT DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%fZ') AS ahora"
  );
  const posiciones = [];
  for (const grupo of porScope.values()) {
    const resultado = await instancia.adaptadorCaptura.capturarEnTransaccion({
      definicion: {
        familia: captura.definicion.familia,
        familiaVersion: captura.definicion.familiaVersion,
        installationOrigenId: captura.definicion.installationOrigenId,
        elementoOrigenId: captura.definicion.elementoOrigenId,
        ocurrenciaOrigenId: String(instancia.generadorIdentidades.generar(
          TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
        )),
        operacion: 'salidaProyeccion',
        tiempoOrigenUtc: reloj.ahora,
        scopeOrigenDeclarado: grupo.scope,
        vigenciaRestanteMs: null,
        campos: {},
        evidenciaIntegridad: []
      },
      destinos: grupo.destinos
    }, { conexion });
    posiciones.push(...resultado.posiciones.filter(
      (posicion) => posicion.posicionFlujo !== null
    ));
  }
  return posiciones;
}

async function estaActivadaEnTransaccion(conexion) {
  const [filas] = await conexion.execute(
    `SELECT valor FROM configuracion_portal
      WHERE clave='federacion.activacion' LIMIT 1 LOCK IN SHARE MODE`
  );
  return String(filas[0]?.valor || '').trim().toLowerCase() === 'true';
}

async function cargarDestinos(conexion, familia) {
  const [filas] = await conexion.execute(
    `SELECT f.flujo_id,f.generacion_activa_id,f.scope_nivel,
            f.scope_tenant_id,f.scope_empresa_id,f.scope_sitio_id,
            f.version_familia,g.estado AS estado_generacion,
            s.niveles_scope,s.campos,s.permite_contenido_sensible,
            s.permite_refederacion
       FROM flujos_federacion f
       JOIN generaciones_flujos_federacion g
         ON g.flujo_id=f.flujo_id AND g.generacion_id=f.generacion_activa_id
       JOIN relaciones_federacion r ON r.relacion_id=f.relacion_id
       JOIN estado_concesion_relaciones_federacion ec
         ON ec.relacion_id=r.relacion_id
       JOIN revisiones_concesion_federacion rc
         ON rc.revision_id=ec.revision_efectiva_actual_id
       JOIN selectores_revision_concesion_federacion s
         ON s.revision_id=rc.revision_id AND s.familia=f.familia
      WHERE f.direccion='emision' AND f.familia=? AND f.estado<>'detenido'
        AND g.rol_generacion='activa'
        AND r.estado_ciclo='vinculada' AND r.estado_autoridad='autorizada'
        AND r.estado_identidad='valida'
        AND r.estado_compatibilidad IN ('compatible','compatibleParcial')
        AND rc.papel='efectiva' AND rc.estado='vigente'
        AND rc.finalizada_en_utc IS NULL
      ORDER BY f.flujo_id FOR UPDATE`,
    [familia]
  );
  return filas.filter((fila) => !ESTADOS_GENERACION_NO_EMISOR.has(fila.estado_generacion))
    .map((fila) => ({
      flujoId: fila.flujo_id,
      generacionId: fila.generacion_activa_id,
      versionFamilia: Number(fila.version_familia),
      scope: {
        nivel: fila.scope_nivel,
        tenantId: textoNullable(fila.scope_tenant_id),
        empresaId: textoNullable(fila.scope_empresa_id),
        sitioId: textoNullable(fila.scope_sitio_id)
      },
      selector: Object.freeze({
        campos: parsearLista(fila.campos),
        nivelesScope: parsearLista(fila.niveles_scope),
        permiteContenidoSensible: Boolean(fila.permite_contenido_sensible),
        permiteRefederacion: Boolean(fila.permite_refederacion)
      })
    }));
}

function agruparDestinos(destinos) {
  const grupos = new Map();
  for (const destino of destinos) {
    const clave = `${destino.versionFamilia}\u0000${canonicalizarJsonFederacion({
      campos: destino.selector.campos,
      permiteContenidoSensible: destino.selector.permiteContenidoSensible
    })}`;
    const grupo = grupos.get(clave) || {
      versionFamilia: destino.versionFamilia,
      selector: destino.selector,
      destinos: []
    };
    grupo.destinos.push(destino);
    grupos.set(clave, grupo);
  }
  return [...grupos.values()];
}

function admiteScope(destino, scope) {
  if (!scope || !destino.selector.nivelesScope.includes(scope.nivel)) return false;
  if (destino.scope.nivel === 'portal') return true;
  if (destino.scope.tenantId !== textoNullable(scope.tenantId)) return false;
  if (destino.scope.nivel === 'tenant') return true;
  if (destino.scope.empresaId !== textoNullable(scope.empresaId)) return false;
  if (destino.scope.nivel === 'empresa') return true;
  return destino.scope.sitioId === textoNullable(scope.sitioId);
}

function normalizarCapturas(valor) {
  const capturas = Array.isArray(valor) ? valor : valor ? [valor] : [];
  if (capturas.some((captura) => !captura?.definicion)) {
    throw new Error('El productor local devolvió una captura federada inválida.');
  }
  return capturas;
}

function validarCapturaFamilia(captura, familia) {
  if (captura.definicion.familia !== familia) {
    throw new Error('El productor local devolvió una familia distinta de la solicitada.');
  }
}

function resultadoVacio(estado) {
  return Object.freeze({
    estado,
    ocurrencias: Object.freeze([]),
    posiciones: Object.freeze([])
  });
}

function parsearLista(valor) {
  const lista = typeof valor === 'string' ? JSON.parse(valor) : valor;
  return Array.isArray(lista) ? lista.map(String) : [];
}

function textoNullable(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function' || typeof conexion?.query !== 'function') {
    throw new Error('La captura incremental exige una conexión SQL prestada.');
  }
}
