const COLUMNAS_MUTABLES = Object.freeze([
  'tenant_id',
  'empresa_id',
  'sitio_id',
  'nombre',
  'tipo',
  'descripcion',
  'activo',
  'configuracion'
]);

export class ErrorConflictoRevisionTrigger extends Error {
  constructor({ idTrigger, revisionEsperada, revisionActual = null }) {
    super(
      revisionActual === null
        ? 'El trigger cambió o dejó de existir; recarga antes de continuar.'
        : `El trigger cambió desde la revisión ${revisionEsperada} a la ${revisionActual}; recarga antes de continuar.`
    );
    this.name = 'ErrorConflictoRevisionTrigger';
    this.codigo = 'trigger_revision_obsoleta';
    this.statusCode = 409;
    this.idTrigger = idTrigger;
    this.revisionEsperada = revisionEsperada;
    this.revisionActual = revisionActual;
  }
}

export class MutadorRevisionDeclaracionTriggerSql {
  async actualizar({
    ejecutor,
    idTrigger,
    revisionEsperada,
    cambios = {}
  } = {}) {
    exigirEjecutor(ejecutor);
    const id = enteroPositivo(idTrigger, 'idTrigger');
    const revision = enteroPositivo(revisionEsperada, 'revisionEsperada');
    const columnas = COLUMNAS_MUTABLES.filter((columna) =>
      Object.hasOwn(cambios, columna));
    const desconocidas = Object.keys(cambios).filter(
      (columna) => !COLUMNAS_MUTABLES.includes(columna)
    );
    if (desconocidas.length > 0) {
      throw new Error(
        `La mutación de trigger contiene columnas desconocidas: ${desconocidas.join(', ')}.`
      );
    }
    const asignaciones = [
      ...columnas.map((columna) => `${columna} = ?`),
      'revision_declaracion = revision_declaracion + 1'
    ];
    const [resultado] = await ejecutar(ejecutor, `
      UPDATE triggers
         SET ${asignaciones.join(', ')}
       WHERE id = ? AND revision_declaracion = ?
    `, [
      ...columnas.map((columna) => cambios[columna]),
      id,
      revision
    ]);
    if (Number(resultado.affectedRows || 0) !== 1) {
      await lanzarConflicto(ejecutor, id, revision);
    }
    return Object.freeze({
      idTrigger: id,
      revisionAnterior: revision,
      revisionNueva: revision + 1
    });
  }

  async eliminar({ ejecutor, idTrigger, revisionEsperada } = {}) {
    exigirEjecutor(ejecutor);
    const id = enteroPositivo(idTrigger, 'idTrigger');
    const revision = enteroPositivo(revisionEsperada, 'revisionEsperada');
    const [resultado] = await ejecutar(ejecutor, `
      DELETE FROM triggers
       WHERE id = ? AND revision_declaracion = ?
    `, [id, revision]);
    if (Number(resultado.affectedRows || 0) !== 1) {
      await lanzarConflicto(ejecutor, id, revision);
    }
    return true;
  }
}

async function lanzarConflicto(ejecutor, idTrigger, revisionEsperada) {
  const filas = await consultar(ejecutor, `
    SELECT revision_declaracion
      FROM triggers
     WHERE id = ?
     LIMIT 1
  `, [idTrigger]);
  throw new ErrorConflictoRevisionTrigger({
    idTrigger,
    revisionEsperada,
    revisionActual: filas[0]
      ? Number(filas[0].revision_declaracion)
      : null
  });
}

function enteroPositivo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw new Error(`${campo} debe ser un entero positivo seguro.`);
  }
  return numero;
}

function exigirEjecutor(ejecutor) {
  if (typeof ejecutor?.ejecutar !== 'function' &&
      typeof ejecutor?.execute !== 'function') {
    throw new Error('La mutación revisada de trigger requiere SQL operativo.');
  }
}

async function ejecutar(ejecutor, sql, parametros) {
  return typeof ejecutor.ejecutar === 'function'
    ? ejecutor.ejecutar(sql, parametros)
    : ejecutor.execute(sql, parametros);
}

async function consultar(ejecutor, sql, parametros) {
  if (typeof ejecutor.consultar === 'function') {
    return ejecutor.consultar(sql, parametros);
  }
  const [filas] = await ejecutor.execute(sql, parametros);
  return filas;
}
