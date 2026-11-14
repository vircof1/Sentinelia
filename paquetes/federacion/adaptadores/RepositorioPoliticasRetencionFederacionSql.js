import { FronteraTransaccionalLocal } from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';
import { calcularPoliticaRetencionEfectivaFederacion } from '../src/RetencionFederacion.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from '../src/IdentidadFederada.js';
import { FAMILIAS_FEDERACION } from '../src/CatalogosFederacion.js';

export class ErrorPoliticaRetencionFederacionSql extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorPoliticaRetencionFederacionSql';
    this.codigo = codigo;
  }
}

export class RepositorioPoliticasRetencionFederacionSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('Las políticas de retención federada requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
    this.frontera = new FronteraTransaccionalLocal(clienteSql);
  }

  async configurarFamilia({
    relacionId,
    familia,
    retencionRecepcionDias,
    retencionGlobalDias,
    versionConfiguracionPortal
  } = {}) {
    const entrada = normalizarEntrada({
      relacionId,
      familia,
      retencionRecepcionDias,
      retencionGlobalDias,
      versionConfiguracionPortal
    });
    return this.frontera.ejecutar(async (conexion) => {
      await exigirRelacionReceptora(conexion, entrada.relacionId);
      const actual = await obtenerPolitica(
        conexion,
        entrada.relacionId,
        entrada.familia,
        true
      );
      if (!actual && !await existeFlujoReceptor(conexion, entrada)) {
        fallar(
          'familia_recepcion_inexistente',
          'La relación no posee un flujo receptor de la familia indicada.'
        );
      }
      const especifica = entrada.retencionRecepcionDias;
      const efectiva = calcularPoliticaRetencionEfectivaFederacion({
        retencionGlobalDias: entrada.retencionGlobalDias,
        retencionRecepcionDias: especifica
      }).retencionEfectivaDias;
      if (actual && mismaPolitica(actual, {
        ...entrada,
        retencionEfectivaDias: efectiva
      })) {
        return Object.freeze({
          politica: proyectarPolitica(actual),
          cambiada: false,
          causa: null
        });
      }
      const ahora = await ahoraSql(conexion);
      const version = actual ? BigInt(actual.version_politica) + 1n : 1n;
      const causa = actual ? 'configuracionRecepcion' : 'materializacionInicial';
      if (actual) {
        await conexion.execute(
          `UPDATE politicas_retencion_recepciones_federacion
              SET retencion_recepcion_dias=?,retencion_global_dias=?,
                  retencion_efectiva_dias=?,version_configuracion_portal=?,
                  version_politica=?,actualizada_en_utc=?
            WHERE relacion_id=? AND familia=?`,
          [especifica,entrada.retencionGlobalDias,efectiva,
            entrada.versionConfiguracionPortal,version.toString(),ahora,
            entrada.relacionId,entrada.familia]
        );
      } else {
        await conexion.execute(
          `INSERT INTO politicas_retencion_recepciones_federacion (
             relacion_id,familia,retencion_recepcion_dias,
             retencion_global_dias,retencion_efectiva_dias,
             version_configuracion_portal,version_politica,
             creada_en_utc,actualizada_en_utc
           ) VALUES (?,?,?,?,?,?,1,?,?)`,
          [entrada.relacionId,entrada.familia,especifica,
            entrada.retencionGlobalDias,efectiva,
            entrada.versionConfiguracionPortal,ahora,ahora]
        );
      }
      await registrarHistorial(conexion, {
        ...entrada,
        retencionEfectivaDias: efectiva,
        versionPolitica: version.toString(),
        causa,
        efectivaDesdeUtc: ahora
      });
      return Object.freeze({
        politica: proyectarPolitica(await obtenerPolitica(
          conexion,
          entrada.relacionId,
          entrada.familia,
          false
        )),
        cambiada: true,
        causa
      });
    });
  }

  async reconciliarLimiteGlobal({
    retencionGlobalDias,
    versionConfiguracionPortal
  } = {}) {
    const global = duracion(retencionGlobalDias, 'retencionGlobalDias', false);
    const versionPortal = decimalPositivo(
      versionConfiguracionPortal,
      'versionConfiguracionPortal'
    );
    return this.frontera.ejecutar(async (conexion) => {
      const [objetivos] = await conexion.execute(
        `SELECT DISTINCT f.relacion_id,f.familia
           FROM flujos_federacion f
           JOIN relaciones_federacion r ON r.relacion_id=f.relacion_id
          WHERE f.direccion='recepcion' AND r.direccion='recepcion'
          UNION
         SELECT relacion_id,familia
           FROM politicas_retencion_recepciones_federacion
          ORDER BY relacion_id,familia`
      );
      const resultados = [];
      for (const objetivo of objetivos) {
        // Comparte el mismo cerrojo y orden relacion -> politica que
        // configurarFamilia. Una reconciliacion global y una configuracion
        // especifica concurrentes no pueden crear la revision inicial dos veces.
        await exigirRelacionReceptora(conexion, objetivo.relacion_id);
        const actual = await obtenerPolitica(
          conexion,
          objetivo.relacion_id,
          objetivo.familia,
          true
        );
        const especifica = actual?.retencion_recepcion_dias === null || !actual
          ? null
          : String(actual.retencion_recepcion_dias);
        const efectiva = calcularPoliticaRetencionEfectivaFederacion({
          retencionGlobalDias: global,
          retencionRecepcionDias: especifica
        }).retencionEfectivaDias;
        const entrada = {
          relacionId: objetivo.relacion_id,
          familia: objetivo.familia,
          retencionRecepcionDias: especifica,
          retencionGlobalDias: global,
          versionConfiguracionPortal: versionPortal,
          retencionEfectivaDias: efectiva
        };
        if (actual && mismaPolitica(actual, entrada)) {
          resultados.push(Object.freeze({
            politica: proyectarPolitica(actual),
            cambiada: false,
            causa: null
          }));
          continue;
        }
        const ahora = await ahoraSql(conexion);
        const version = actual ? BigInt(actual.version_politica) + 1n : 1n;
        const causa = actual ? 'limiteGlobalCambiado' : 'materializacionInicial';
        if (actual) {
          await conexion.execute(
            `UPDATE politicas_retencion_recepciones_federacion
                SET retencion_global_dias=?,retencion_efectiva_dias=?,
                    version_configuracion_portal=?,version_politica=?,
                    actualizada_en_utc=?
              WHERE relacion_id=? AND familia=?`,
            [global,efectiva,versionPortal,version.toString(),ahora,
              entrada.relacionId,entrada.familia]
          );
        } else {
          await conexion.execute(
            `INSERT INTO politicas_retencion_recepciones_federacion (
               relacion_id,familia,retencion_recepcion_dias,
               retencion_global_dias,retencion_efectiva_dias,
               version_configuracion_portal,version_politica,
               creada_en_utc,actualizada_en_utc
             ) VALUES (?,?,NULL,?,?,?,1,?,?)`,
            [entrada.relacionId,entrada.familia,global,efectiva,
              versionPortal,ahora,ahora]
          );
        }
        await registrarHistorial(conexion, {
          ...entrada,
          versionPolitica: version.toString(),
          causa,
          efectivaDesdeUtc: ahora
        });
        resultados.push(Object.freeze({
          politica: proyectarPolitica(await obtenerPolitica(
            conexion,
            entrada.relacionId,
            entrada.familia,
            false
          )),
          cambiada: true,
          causa
        }));
      }
      return Object.freeze({
        retencionGlobalDias: global,
        versionConfiguracionPortal: versionPortal,
        totalPoliticas: resultados.length,
        totalCambios: resultados.filter(({ cambiada }) => cambiada).length,
        resultados: Object.freeze(resultados)
      });
    });
  }

  async obtener({ relacionId, familia } = {}) {
    const relacion = identidadRelacion(relacionId);
    const nombreFamilia = FAMILIAS_FEDERACION.exigir(familia, { campo: 'familia' });
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      const politica = await obtenerPolitica(conexion, relacion, nombreFamilia, false);
      return politica ? proyectarPolitica(politica) : null;
    } finally {
      conexion.release();
    }
  }

  async listarHistorial({ relacionId, familia } = {}) {
    const relacion = identidadRelacion(relacionId);
    const nombreFamilia = FAMILIAS_FEDERACION.exigir(familia, { campo: 'familia' });
    const filas = await this.clienteSql.consultar(
      `SELECT * FROM historial_politicas_retencion_recepciones_federacion
        WHERE relacion_id=? AND familia=? ORDER BY version_politica`,
      [relacion,nombreFamilia]
    );
    return Object.freeze(filas.map(proyectarHistorial));
  }
}

function normalizarEntrada(entrada) {
  return {
    relacionId: identidadRelacion(entrada.relacionId),
    familia: FAMILIAS_FEDERACION.exigir(entrada.familia, { campo: 'familia' }),
    retencionRecepcionDias: duracion(
      entrada.retencionRecepcionDias,
      'retencionRecepcionDias',
      true
    ),
    retencionGlobalDias: duracion(
      entrada.retencionGlobalDias,
      'retencionGlobalDias',
      false
    ),
    versionConfiguracionPortal: decimalPositivo(
      entrada.versionConfiguracionPortal,
      'versionConfiguracionPortal'
    )
  };
}

async function exigirRelacionReceptora(conexion, relacionId) {
  const [filas] = await conexion.execute(
    `SELECT relacion_id FROM relaciones_federacion
      WHERE relacion_id=? AND direccion='recepcion' FOR UPDATE`,
    [relacionId]
  );
  if (!filas[0]) {
    fallar('relacion_receptora_inexistente', 'La relación receptora no existe.');
  }
}

async function existeFlujoReceptor(conexion, entrada) {
  const [filas] = await conexion.execute(
    `SELECT 1 AS existe FROM flujos_federacion
      WHERE relacion_id=? AND direccion='recepcion' AND familia=? LIMIT 1`,
    [entrada.relacionId,entrada.familia]
  );
  return Boolean(filas[0]);
}

async function obtenerPolitica(conexion, relacionId, familia, bloquear) {
  const [filas] = await conexion.execute(
    `SELECT * FROM politicas_retencion_recepciones_federacion
      WHERE relacion_id=? AND familia=?${bloquear ? ' FOR UPDATE' : ''}`,
    [relacionId,familia]
  );
  return filas[0] || null;
}

async function registrarHistorial(conexion, entrada) {
  await conexion.execute(
    `INSERT INTO historial_politicas_retencion_recepciones_federacion (
       relacion_id,familia,version_politica,retencion_recepcion_dias,
       retencion_global_dias,retencion_efectiva_dias,
       version_configuracion_portal,causa,efectiva_desde_utc
     ) VALUES (?,?,?,?,?,?,?,?,?)`,
    [entrada.relacionId,entrada.familia,entrada.versionPolitica,
      entrada.retencionRecepcionDias,entrada.retencionGlobalDias,
      entrada.retencionEfectivaDias,entrada.versionConfiguracionPortal,
      entrada.causa,entrada.efectivaDesdeUtc]
  );
}

function mismaPolitica(fila, entrada) {
  return opcional(fila.retencion_recepcion_dias) === entrada.retencionRecepcionDias &&
    String(fila.retencion_global_dias) === entrada.retencionGlobalDias &&
    String(fila.retencion_efectiva_dias) === entrada.retencionEfectivaDias;
}

function proyectarPolitica(fila) {
  return Object.freeze({
    relacionId: fila.relacion_id,
    familia: fila.familia,
    retencionRecepcionDias: opcional(fila.retencion_recepcion_dias),
    retencionGlobalDias: String(fila.retencion_global_dias),
    retencionEfectivaDias: String(fila.retencion_efectiva_dias),
    versionConfiguracionPortal: String(fila.version_configuracion_portal),
    version: String(fila.version_politica),
    creadaEnUtc: fechaIso(fila.creada_en_utc),
    actualizadaEnUtc: fechaIso(fila.actualizada_en_utc)
  });
}

function proyectarHistorial(fila) {
  return Object.freeze({
    relacionId: fila.relacion_id,
    familia: fila.familia,
    version: String(fila.version_politica),
    retencionRecepcionDias: opcional(fila.retencion_recepcion_dias),
    retencionGlobalDias: String(fila.retencion_global_dias),
    retencionEfectivaDias: String(fila.retencion_efectiva_dias),
    versionConfiguracionPortal: String(fila.version_configuracion_portal),
    causa: fila.causa,
    efectivaDesdeUtc: fechaIso(fila.efectiva_desde_utc)
  });
}

function identidadRelacion(valor) {
  try {
    return String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.RELACION,
      valor: String(valor || '')
    }));
  } catch {
    throw new ErrorPoliticaRetencionFederacionSql(
      'relacion_invalida',
      'relacionId no es una identidad federada válida.'
    );
  }
}

function duracion(valor, campo, admiteNull) {
  if (valor === null && admiteNull) return null;
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]{0,3}$/u.test(texto)) {
    fallar('retencion_invalida', `${campo} debe usar días enteros canónicos.`);
  }
  const numero = Number(texto);
  if (numero < 1 || numero > 3650) {
    fallar('retencion_fuera_rango', `${campo} debe estar entre 1 y 3650 días.`);
  }
  return texto;
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    fallar('version_invalida', `${campo} debe ser un decimal positivo.`);
  }
  return texto;
}

function opcional(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function fechaIso(valor) {
  return new Date(valor).toISOString();
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function fallar(codigo, mensaje) {
  throw new ErrorPoliticaRetencionFederacionSql(codigo, mensaje);
}
