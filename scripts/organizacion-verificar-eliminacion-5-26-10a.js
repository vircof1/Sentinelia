import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  PERFIL_OBLIGACION_POSTCOMMIT_ELIMINACION_AGENTE,
  crearObligacionPostcommitEliminacionAgente
} from '../paquetes/agentes/src/ContratoEliminacionAdministrativaAgente.js';
import {
  ErrorEjecucionObligacionPostcommitEliminacionAgente
} from '../paquetes/agentes/src/EjecutorObligacionesPostcommitEliminacionAgentes.js';
import { ProcesadorObligacionesPostcommitEliminacionAgentes }
  from '../paquetes/agentes/src/ProcesadorObligacionesPostcommitEliminacionAgentes.js';
import {
  RepositorioObligacionesPostcommitEliminacionAgentesSql
} from '../paquetes/agentes/src/RepositorioObligacionesPostcommitEliminacionAgentesSql.js';
import { RepositorioObligacionesPostcommitOperacionesAdministrativasSql }
  from '../paquetes/coordinacion-durable/src/RepositorioObligacionesPostcommitOperacionesAdministrativasSql.js';
import { ProcesadorObligacionesPostcommitOperacionesAdministrativas }
  from '../paquetes/coordinacion-durable/src/ProcesadorObligacionesPostcommitOperacionesAdministrativas.js';

await verificarObjetivosTipadosAlReclamar();
await verificarDivergenciaTipadaCerrada();
await verificarProcesadorTransversal();
await verificarCompatibilidadAgente();
await verificarComposicionRuntime();

console.log(
  '[organizacion] OK 5.26.10a: cola=operaciones_administrativas ' +
  'repositorio=transversal lease=compartido objetivo=tipado_validado ' +
  'procesador=transversal agente=compatible runtime=renombrado efectos=nuevos_no'
);

async function verificarObjetivosTipadosAlReclamar() {
  for (const [tipo, objetivo, esperado] of [
    [
      'retirar_sesion_redis',
      { agenteId: '31', operacionSesionId: generarUuidV7Auditoria() },
      { tipo: 'agente', id: '31' }
    ],
    [
      'publicar_invalidacion_portal',
      { destinatarioUsuarioId: '5' },
      { tipo: 'usuario', id: '5' }
    ]
  ]) {
    const obligacion = crearObligacion(tipo, objetivo);
    const entorno = crearClienteRepositorio(obligacion, esperado);
    const repositorio =
      new RepositorioObligacionesPostcommitOperacionesAdministrativasSql(
        entorno.cliente
      );
    const reclamada = await repositorio.reclamarSiguiente({
      instanciaId: 'worker-10a',
      leaseToken: Buffer.alloc(32, 7),
      ttlSegundos: 30
    });
    assert.deepEqual(reclamada.operacion.objetivoTipado, esperado);
    assert.deepEqual(reclamada.operacion.objetivo, objetivo);
    assert.equal(reclamada.operacion.tipo, tipo);
    assert.equal(Object.isFrozen(reclamada.operacion.objetivoTipado), true);
    assert.deepEqual(entorno.traza, [
      'isolation', 'begin', 'cerrar_agotado', 'reclamar',
      'materializar_lease', 'rehidratar', 'commit', 'release'
    ]);
  }
}

async function verificarDivergenciaTipadaCerrada() {
  const obligacion = crearObligacion(
    'invalidar_catalogo_monitores',
    { agenteId: '31' }
  );
  const entorno = crearClienteRepositorio(
    obligacion,
    { tipo: 'agente', id: '999' }
  );
  const repositorio =
    new RepositorioObligacionesPostcommitOperacionesAdministrativasSql(
      entorno.cliente
    );
  await assert.rejects(
    repositorio.reclamarSiguiente({
      instanciaId: 'worker-10a',
      leaseToken: Buffer.alloc(32, 8),
      ttlSegundos: 30
    }),
    /objetivo tipado no coincide/u
  );
  assert.deepEqual(entorno.traza.slice(-2), ['rollback', 'release']);
}

async function verificarProcesadorTransversal() {
  const operacion = {
    obligacionId: generarUuidV7Auditoria(),
    eliminacionOperacionId: generarUuidV7Auditoria(),
    tipo: 'retirar_sesion_redis',
    objetivoTipado: { tipo: 'agente', id: '31' }
  };
  const traza = [];
  const procesador =
    new ProcesadorObligacionesPostcommitOperacionesAdministrativas({
      coordinador: {
        async reclamarSiguiente() {
          traza.push('reclamar');
          return {
            lease: { operacionId: operacion.obligacionId },
            intentos: 1,
            operacion
          };
        },
        async consolidar() {
          traza.push('consolidar');
          return {
            estado: 'completada',
            situacion: { convergida: true },
            convergencia: { notificacion: null }
          };
        },
        async registrarFallo() { throw new Error('no esperado'); }
      },
      ejecutor: {
        async ejecutar() {
          traza.push('efecto');
          return { aplicada: true };
        },
        async publicarInvalidacionDestinatario() {
          throw new Error('no esperado');
        }
      }
    });
  const resultado = await procesador.procesarSiguiente();
  assert.deepEqual(traza, ['reclamar', 'efecto', 'consolidar']);
  assert.deepEqual(resultado.objetivoTipado, { tipo: 'agente', id: '31' });
  assert.equal(resultado.estado, 'completada');

  const fallo = new ProcesadorObligacionesPostcommitOperacionesAdministrativas({
    coordinador: {
      async reclamarSiguiente() {
        return { lease: {}, intentos: 2, operacion };
      },
      async consolidar() { throw new Error('no esperado'); },
      async registrarFallo(_lease, diagnostico) {
        assert.equal(diagnostico.codigo, 'redis_no_disponible');
        assert.equal(diagnostico.permanente, false);
        assert.equal(diagnostico.demoraReintentoSegundos, 2);
        return { estado: 'reintentable' };
      }
    },
    ejecutor: {
      async ejecutar() {
        throw new ErrorEjecucionObligacionPostcommitEliminacionAgente(
          'redis_no_disponible',
          'Redis no respondió.'
        );
      },
      async publicarInvalidacionDestinatario() {}
    }
  });
  assert.equal((await fallo.procesarSiguiente()).estado, 'reintentable');
}

async function verificarCompatibilidadAgente() {
  const cliente = { obtenerConexion() {} };
  const legado = new RepositorioObligacionesPostcommitEliminacionAgentesSql(
    cliente
  );
  assert.equal(
    legado instanceof
      RepositorioObligacionesPostcommitOperacionesAdministrativasSql,
    true
  );
  const procesadorLegado = Object.create(
    ProcesadorObligacionesPostcommitEliminacionAgentes.prototype
  );
  assert.equal(
    procesadorLegado instanceof
      ProcesadorObligacionesPostcommitOperacionesAdministrativas,
    true
  );
}

async function verificarComposicionRuntime() {
  const fuente = await readFile(new URL(
    '../apps/sentinelia-runtime/src/agentes/' +
      'crearMotorEliminacionAdministrativaAgentesRuntime.js',
    import.meta.url
  ), 'utf8');
  assert.match(fuente,
    /new RepositorioObligacionesPostcommitOperacionesAdministrativasSql/u);
  assert.match(fuente,
    /new ProcesadorObligacionesPostcommitOperacionesAdministrativas/u);
  assert.match(fuente,
    /postcommit-operaciones-administrativas/u);
  assert.doesNotMatch(fuente, /postcommit-eliminacion-agentes/u);
}

function crearObligacion(tipo, objetivo) {
  return crearObligacionPostcommitEliminacionAgente({
    perfil: PERFIL_OBLIGACION_POSTCOMMIT_ELIMINACION_AGENTE,
    version: 1,
    obligacionId: generarUuidV7Auditoria(),
    operacionId: generarUuidV7Auditoria(),
    tipo,
    objetivo
  });
}

function crearClienteRepositorio(obligacion, objetivoPersistido) {
  const traza = [];
  const fila = {
    obligacion_id: uuidV7AuditoriaABytes(obligacion.obligacionId),
    operacion_id: uuidV7AuditoriaABytes(obligacion.operacionId),
    tipo: obligacion.tipo,
    version_contrato: obligacion.version,
    objetivo_tipo: objetivoPersistido.tipo,
    objetivo_id: objetivoPersistido.id,
    objetivo_canonico: JSON.stringify(obligacion.objetivo),
    estado: 'procesando',
    intentos: 1,
    max_intentos: 8,
    fencing_token: '4',
    ultimo_codigo_error: null,
    ultimo_mensaje_error: null,
    creada_en_utc: new Date('2026-08-30T10:00:00.000Z'),
    actualizada_en_utc: new Date('2026-08-30T10:01:00.000Z'),
    terminada_en_utc: null,
    retener_hasta_utc: new Date('2027-08-30T10:00:00.000Z')
  };
  const conexion = {
    async query(sql) {
      if (sql.startsWith('SET TRANSACTION')) traza.push('isolation');
      return [[{ activa: 1 }]];
    },
    async beginTransaction() { traza.push('begin'); },
    async commit() { traza.push('commit'); },
    async rollback() { traza.push('rollback'); },
    release() { traza.push('release'); },
    async execute(sql) {
      const normalizada = sql.replace(/\s+/gu, ' ').trim();
      if (normalizada.includes('intentos>=max_intentos')) {
        traza.push('cerrar_agotado');
        return [[]];
      }
      if (normalizada.includes('LIMIT 1 FOR UPDATE SKIP LOCKED')) {
        traza.push('reclamar');
        return [[fila]];
      }
      if (normalizada.startsWith('UPDATE obligaciones_postcommit')) {
        traza.push('materializar_lease');
        return [{ affectedRows: 1 }];
      }
      if (normalizada.includes('WHERE obligacion_id=?')) {
        traza.push('rehidratar');
        return [[fila]];
      }
      throw new Error(`SQL inesperado: ${normalizada}`);
    }
  };
  return {
    traza,
    cliente: { async obtenerConexion() { return conexion; } }
  };
}
