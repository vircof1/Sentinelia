import { FuenteEntropiaCriptograficaNode } from '../adaptadores/FuenteEntropiaCriptograficaNode.js';
import { KeyringFederacionDespliegue } from '../adaptadores/KeyringFederacionDespliegue.js';
import { AuditorKeyringFederacionSql } from '../adaptadores/AuditorKeyringFederacionSql.js';
import { PublicadorArranqueFederacionRedis } from '../adaptadores/PublicadorArranqueFederacionRedis.js';
import { ProtectorSecretoPersistenteFederacion } from '../adaptadores/ProtectorSecretoPersistenteFederacion.js';
import { VerificadorSecretoPersistenteFederacion } from '../adaptadores/ProtectorSecretoPersistenteFederacion.js';
import { ProtectorContenidoSensibleFederacion } from '../adaptadores/ProtectorContenidoSensibleFederacion.js';
import {
  PersistidorVerificadorCanjeFederacion,
  RepositorioCredencialesPersistentesFederacionSql
} from '../adaptadores/RepositorioCredencialesPersistentesFederacionSql.js';
import {
  ProvisionadorCanjePendienteFederacion,
  RepositorioIdentidadesCandidatasFederacionSql
} from '../adaptadores/RepositorioIdentidadesCandidatasFederacionSql.js';
import { RepositorioSesionesFederacionRedis } from '../adaptadores/RepositorioSesionesFederacionRedis.js';
import { RepositorioSesionesFederacionSql } from '../adaptadores/RepositorioSesionesFederacionSql.js';
import { RepositorioHeartbeatFederacionSql } from '../adaptadores/RepositorioHeartbeatFederacionSql.js';
import { RepositorioPresenciaFederacionRedis } from '../adaptadores/RepositorioPresenciaFederacionRedis.js';
import { RepositorioContinuidadFederacionSql } from '../adaptadores/RepositorioContinuidadFederacionSql.js';
import { RepositorioConflictosIdentidadFederacionSql } from '../adaptadores/RepositorioConflictosIdentidadFederacionSql.js';
import { GeneradorRecuperacionFederacion } from '../adaptadores/GeneradorRecuperacionFederacion.js';
import { GeneradorSecretoPersistenteFederacion } from '../adaptadores/GeneradorSecretoPersistenteFederacion.js';
import { RepositorioIdentidadFederacionSql } from '../adaptadores/RepositorioIdentidadFederacionSql.js';
import { GeneradorIdentidadesFederadas } from '../src/IdentidadFederada.js';
import { FronteraTransaccionalLocal } from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';
import { CoordinadorArranqueLogicoFederacion } from './CoordinadorArranqueLogicoFederacion.js';
import { ResolutorConfiguracionFederacionPortal } from './ResolutorConfiguracionFederacionPortal.js';
import { SupervisorArranqueLogicoFederacion } from './SupervisorArranqueLogicoFederacion.js';
import { ServicioCustodiaSecretoEmisionFederacion } from './ServicioCustodiaSecretoEmisionFederacion.js';
import { ServicioConfirmacionIdentidadFederacion } from './ServicioConfirmacionIdentidadFederacion.js';
import { ServicioSesionesFederacion } from './ServicioSesionesFederacion.js';
import { ServicioHeartbeatFederacion } from './ServicioHeartbeatFederacion.js';
import { ServicioContinuidadFederacion } from './ServicioContinuidadFederacion.js';
import { ServicioConflictosIdentidadFederacion } from './ServicioConflictosIdentidadFederacion.js';
import { GuardiaActivacionFederacion } from './GuardiaActivacionFederacion.js';
import { GuardiaEmisionFederacion } from './GuardiaEmisionFederacion.js';
import { GuardiaRecepcionFederacion } from './GuardiaRecepcionFederacion.js';

export async function crearPlanoControlFederacionLocal({
  clienteSql,
  clienteRedis,
  servicioConfiguracionPortal,
  adaptadorAuditoriaControl = null,
  adaptadorAuditoriaSesiones = null,
  adaptadorAuditoriaHeartbeat = null,
  adaptadorAuditoriaSeguridad = null,
  servicioAvisosPlataforma = null,
  entorno = process.env,
  prefijoRedis = 'sentinelia:federacion',
  ttlArranqueSegundos = 120,
  ttlSesionSegundos = 300,
  graciaRefreshSegundos = 30,
  ttlPresenciaSegundos = 90,
  alFallarRenovacion = registrarFalloRenovacion
} = {}) {
  if (!clienteSql?.obtenerConexion || !clienteRedis?.eval) {
    throw new Error('El plano de control federado requiere SQL y Redis operativos.');
  }
  const keyring = crearKeyringOpcional(entorno);
  const auditorKeyring = new AuditorKeyringFederacionSql(clienteSql);
  const fotografia = await new ResolutorConfiguracionFederacionPortal({
    servicioConfiguracionPortal,
    clienteSql,
    keyring,
    auditorKeyring
  }).cargarActual();
  const guardiaActivacion = new GuardiaActivacionFederacion({
    servicioConfiguracionPortal
  });
  const guardiaEmision = new GuardiaEmisionFederacion({
    servicioConfiguracionPortal
  });
  const guardiaRecepcion = new GuardiaRecepcionFederacion({
    servicioConfiguracionPortal
  });
  const repositorioIdentidad = new RepositorioIdentidadFederacionSql(clienteSql);
  const coordinador = new CoordinadorArranqueLogicoFederacion({
    fronteraTransaccional: new FronteraTransaccionalLocal(clienteSql),
    repositorioIdentidad,
    generadorIdentidades: new GeneradorIdentidadesFederadas({
      fuenteEntropia: new FuenteEntropiaCriptograficaNode()
    }),
    publicadorArranque: new PublicadorArranqueFederacionRedis({
      clienteRedis,
      prefijo: prefijoRedis,
      ttlSegundos: ttlArranqueSegundos
    })
  });
  const intervaloRenovacionMs = Math.max(
    250,
    Math.floor(ttlArranqueSegundos * 1000 / 3)
  );
  const supervisor = new SupervisorArranqueLogicoFederacion({
    coordinador,
    intervaloRenovacionMs,
    alFallarRenovacion
  });
  const identidad = await supervisor.arrancar();
  const protectorSecretoPersistente = keyring
    ? new ProtectorSecretoPersistenteFederacion({ keyring })
    : null;
  const protectorContenidoSensible = keyring
    ? new ProtectorContenidoSensibleFederacion({ keyring })
    : null;
  const repositorioCredenciales =
    new RepositorioCredencialesPersistentesFederacionSql(clienteSql);
  const custodiaSecretoEmision = protectorSecretoPersistente
    ? new ServicioCustodiaSecretoEmisionFederacion({
        repositorioCredenciales,
        protectorSecretoPersistente
      })
    : null;
  const persistidorVerificadorCanje = new PersistidorVerificadorCanjeFederacion({
    repositorioCredenciales,
    verificadorSecretos: new VerificadorSecretoPersistenteFederacion()
  });
  const repositorioCandidaturas =
    new RepositorioIdentidadesCandidatasFederacionSql(clienteSql, {
      adaptadorAuditoria: adaptadorAuditoriaControl
    });
  const provisionadorCanjePendiente = new ProvisionadorCanjePendienteFederacion({
    persistidorVerificador: persistidorVerificadorCanje,
    repositorioCandidaturas
  });
  const servicioConfirmacionIdentidad = adaptadorAuditoriaControl
    ? new ServicioConfirmacionIdentidadFederacion({ repositorioCandidaturas })
    : null;
  const repositorioSesionesRedis = new RepositorioSesionesFederacionRedis({
    clienteRedis,
    prefijo: prefijoRedis,
    ttlSegundos: ttlSesionSegundos,
    graciaRefreshSegundos
  });
  const servicioSesiones = adaptadorAuditoriaSesiones
    ? new ServicioSesionesFederacion({
        repositorioSql: new RepositorioSesionesFederacionSql(clienteSql, {
          repositorioCredenciales,
          verificadorSecretos: new VerificadorSecretoPersistenteFederacion(),
          adaptadorAuditoria: adaptadorAuditoriaSesiones
        }),
        repositorioRedis: repositorioSesionesRedis,
        installationLocalId: String(identidad.installationId),
        guardiaActivacion
      })
    : null;
  const servicioConflictos = adaptadorAuditoriaSeguridad && servicioAvisosPlataforma
    ? new ServicioConflictosIdentidadFederacion({
        repositorio: new RepositorioConflictosIdentidadFederacionSql(clienteSql, {
          adaptadorAuditoria: adaptadorAuditoriaSeguridad,
          servicioAvisos: servicioAvisosPlataforma
        }),
        repositorioSesionesRedis
      })
    : null;
  const servicioContinuidad = servicioSesiones && adaptadorAuditoriaSeguridad
    ? new ServicioContinuidadFederacion({
        repositorio: new RepositorioContinuidadFederacionSql(clienteSql, {
          repositorioCredenciales,
          verificadorSecretos: new VerificadorSecretoPersistenteFederacion(),
          adaptadorAuditoria: adaptadorAuditoriaSeguridad
        }),
        servicioSesiones,
        repositorioSesionesRedis,
        generadorRecuperacion: new GeneradorRecuperacionFederacion(),
        generadorSecretoPersistente: new GeneradorSecretoPersistenteFederacion(),
        installationLocalId: String(identidad.installationId),
        resolverOrigenPublico: () => servicioConfiguracionPortal
          .obtenerConfiguracionActual().obtenerConfiguracionFederacion().origenPublico,
        guardiaActivacion,
        guardiaRecepcion
      })
    : null;
  const servicioHeartbeat = servicioSesiones && adaptadorAuditoriaHeartbeat
    ? new ServicioHeartbeatFederacion({
        servicioSesiones,
        repositorioSql: new RepositorioHeartbeatFederacionSql(clienteSql, {
          adaptadorAuditoria: adaptadorAuditoriaHeartbeat
        }),
        repositorioPresencia: new RepositorioPresenciaFederacionRedis({
          clienteRedis,
          prefijo: prefijoRedis,
          ttlSegundos: ttlPresenciaSegundos
        }),
        resolverConfiguracion: async () => {
          await servicioConfiguracionPortal.asegurarActualizada();
          return servicioConfiguracionPortal.obtenerConfiguracionActual()
            .obtenerConfiguracionFederacion();
        },
        servicioAvisos: servicioAvisosPlataforma,
        guardiaActivacion,
        servicioConflictos
      })
    : null;
  return Object.freeze({
    fotografia,
    guardiaActivacion,
    guardiaEmision,
    guardiaRecepcion,
    identidad,
    supervisor,
    protectorContenidoSensible,
    protectorSecretoPersistente,
    custodiaSecretoEmision,
    persistidorVerificadorCanje,
    provisionadorCanjePendiente,
    servicioConfirmacionIdentidad,
    servicioSesiones,
    servicioHeartbeat,
    servicioContinuidad,
    servicioConflictos
  });
}

function crearKeyringOpcional(entorno) {
  const material = String(entorno?.FEDERACION_KEYRING || '').trim();
  const keyIdActiva = String(entorno?.FEDERACION_KEY_ID_ACTIVA || '').trim();
  if (!material && !keyIdActiva) return null;
  return new KeyringFederacionDespliegue({
    referencia: entorno.FEDERACION_KEYRING_REFERENCIA || 'sentinelia/federacion/v1',
    keyring: material,
    keyIdActiva
  });
}

function registrarFalloRenovacion(error) {
  console.error('[federacion] No se pudo renovar el arranque lógico compartido.');
  const codigo = String(error?.codigo || error?.code || 'renovacion_fallida')
    .replace(/[^A-Za-z0-9_.-]/gu, '_')
    .slice(0, 96);
  console.error(`[federacion] codigo=${codigo}`);
}
