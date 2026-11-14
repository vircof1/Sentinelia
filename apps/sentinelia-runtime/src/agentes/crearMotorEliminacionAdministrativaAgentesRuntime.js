import { CoordinadorOperacionesDurables }
  from '../../../../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { EjecutorObligacionesPostcommitOperacionesAdministrativas }
  from '../../../../paquetes/coordinacion-durable/src/EjecutorObligacionesPostcommitOperacionesAdministrativas.js';
import { FinalizadorConvergenciaPostcommitOperacionesAdministrativas }
  from '../../../../paquetes/coordinacion-durable/src/FinalizadorConvergenciaPostcommitOperacionesAdministrativas.js';
import { CatalogoContratosNotificacionesOperacionesAdministrativas }
  from '../../../../paquetes/coordinacion-durable/src/CatalogoContratosNotificacionesOperacionesAdministrativas.js';
import { CanalInvalidacionesBuzonUsuariosRedis }
  from '../../../../paquetes/agentes/src/CanalInvalidacionesBuzonUsuariosRedis.js';
import { CatalogoEjecutoresOperacionesAdministrativas }
  from '../../../../paquetes/agentes/src/CatalogoEjecutoresOperacionesAdministrativas.js';
import { CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE }
  from '../../../../paquetes/agentes/src/ContratoOperacionAdministrativaEliminacionAgente.js';
import { CoordinadorEliminacionAgregadoAgenteEnTransaccion }
  from '../../../../paquetes/agentes/src/CoordinadorEliminacionAgregadoAgenteEnTransaccion.js';
import { CoordinadorPerfilServidorRedis }
  from '../../../../paquetes/agentes/src/CoordinadorPerfilServidorRedis.js';
import { EjecutorEliminacionAdministrativaAgente }
  from '../../../../paquetes/agentes/src/EjecutorEliminacionAdministrativaAgente.js';
import { EjecutorObligacionesPostcommitEliminacionAgentes }
  from '../../../../paquetes/agentes/src/EjecutorObligacionesPostcommitEliminacionAgentes.js';
import { FinalizadorConvergenciaPostcommitEliminacionAgentes }
  from '../../../../paquetes/agentes/src/FinalizadorConvergenciaPostcommitEliminacionAgentes.js';
import { FinalizadorResultadoEliminacionAgenteEnTransaccion }
  from '../../../../paquetes/agentes/src/FinalizadorResultadoEliminacionAgenteEnTransaccion.js';
import { AdaptadorPreparacionEliminacionDirectaAgenteEnTransaccion }
  from '../../../../paquetes/agentes/src/AdaptadorPreparacionEliminacionDirectaAgenteEnTransaccion.js';
import { ProcesadorObligacionesPostcommitOperacionesAdministrativas }
  from '../../../../paquetes/coordinacion-durable/src/ProcesadorObligacionesPostcommitOperacionesAdministrativas.js';
import { ProcesadorOperacionesAdministrativas }
  from '../../../../paquetes/agentes/src/ProcesadorOperacionesAdministrativas.js';
import { RegistradorAuditoriaEliminacionAgente }
  from '../../../../paquetes/agentes/src/RegistradorAuditoriaEliminacionAgente.js';
import { RepositorioEliminacionAdministrativaAgentesSql }
  from '../../../../paquetes/agentes/src/RepositorioEliminacionAdministrativaAgentesSql.js';
import { RepositorioNotificacionesUsuarioSql }
  from '../../../../paquetes/agentes/src/RepositorioNotificacionesUsuarioSql.js';
import { CONTRATO_PERSISTENCIA_NOTIFICACIONES_ELIMINACION_AGENTE }
  from '../../../../paquetes/agentes/src/ContratoPersistenciaNotificacionesEliminacionAgente.js';
import { RepositorioObligacionesPostcommitOperacionesAdministrativasSql }
  from '../../../../paquetes/coordinacion-durable/src/RepositorioObligacionesPostcommitOperacionesAdministrativasSql.js';
import { RepositorioOperacionesAdministrativasSql }
  from '../../../../paquetes/agentes/src/RepositorioOperacionesAdministrativasSql.js';
import { RepositorioOperacionesSesionAgentes }
  from '../../../../paquetes/agentes/src/RepositorioOperacionesSesionAgentes.js';
import { RepositorioAudienciaTriggerCorreoSql }
  from '../../../../paquetes/correo/src/RepositorioAudienciaTriggerCorreoSql.js';
import { ServicioReconciliacionBajaUsuarioTriggerCorreo }
  from '../../../../paquetes/correo/src/ServicioReconciliacionBajaUsuarioTriggerCorreo.js';
import { NucleoPreparacionDependenciasAgenteEnTransaccion }
  from '../../../../paquetes/agentes/src/NucleoPreparacionDependenciasAgenteEnTransaccion.js';
import { RepositorioSesionesTecnicasCoordinadasRedis }
  from '../../../../paquetes/agentes/src/RepositorioSesionesTecnicasCoordinadasRedis.js';
import { ServicioRetiradaFederadaAgente }
  from '../../../../paquetes/agentes/src/ServicioRetiradaFederadaAgente.js';
import { CONTRATO_PERSISTENCIA_NOTIFICACIONES_ELIMINACION_ORGANIZACION }
  from '../../../../paquetes/jerarquia-organizativa/src/ContratoPersistenciaNotificacionesEliminacionOrganizacion.js';
import { CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_ORGANIZACION }
  from '../../../../paquetes/jerarquia-organizativa/src/ContratoOperacionAdministrativaEliminacionOrganizacion.js';
import { AutoridadReservasJerarquicasOperacionesAdministrativasSql }
  from '../../../../paquetes/jerarquia-organizativa/src/AutoridadReservasJerarquicasOperacionesAdministrativasSql.js';
import { RepositorioInventarioFinalEliminacionOrganizacionSql }
  from '../../../../paquetes/jerarquia-organizativa/src/RepositorioInventarioFinalEliminacionOrganizacionSql.js';
import { PreparadorInventarioFinalEliminacionOrganizacionEnTransaccion }
  from '../../../../paquetes/jerarquia-organizativa/src/PreparadorInventarioFinalEliminacionOrganizacionEnTransaccion.js';
import { PreparadorEfectosEliminacionOrganizacionEnTransaccion }
  from '../../../../paquetes/jerarquia-organizativa/src/PreparadorEfectosEliminacionOrganizacionEnTransaccion.js';
import { RepositorioObligacionesPostcommitOrganizacionSql }
  from '../../../../paquetes/jerarquia-organizativa/src/RepositorioObligacionesPostcommitOrganizacionSql.js';
import { RepositorioEliminacionesOrganizativas }
  from '../../../../paquetes/jerarquia-organizativa/src/RepositorioEliminacionesOrganizativas.js';
import { EjecutorBorradoRaizEliminacionOrganizacionEnTransaccion }
  from '../../../../paquetes/jerarquia-organizativa/src/EjecutorBorradoRaizEliminacionOrganizacionEnTransaccion.js';
import { RegistradorAuditoriaEliminacionOrganizacion }
  from '../../../../paquetes/jerarquia-organizativa/src/RegistradorAuditoriaEliminacionOrganizacion.js';
import { FinalizadorResultadoEliminacionOrganizacionEnTransaccion }
  from '../../../../paquetes/jerarquia-organizativa/src/FinalizadorResultadoEliminacionOrganizacionEnTransaccion.js';
import { CoordinadorEliminacionOrganizacionEnTransaccion }
  from '../../../../paquetes/jerarquia-organizativa/src/CoordinadorEliminacionOrganizacionEnTransaccion.js';
import { EjecutorEliminacionAdministrativaOrganizacion }
  from '../../../../paquetes/jerarquia-organizativa/src/EjecutorEliminacionAdministrativaOrganizacion.js';
import { EjecutorObligacionesPostcommitEliminacionOrganizacion }
  from '../../../../paquetes/jerarquia-organizativa/src/EjecutorObligacionesPostcommitEliminacionOrganizacion.js';
import { FinalizadorConvergenciaPostcommitEliminacionOrganizacion }
  from '../../../../paquetes/jerarquia-organizativa/src/FinalizadorConvergenciaPostcommitEliminacionOrganizacion.js';
import { InvalidatorSesionesUsuariosOrganizacionRedis }
  from '../../../../paquetes/jerarquia-organizativa/src/InvalidatorSesionesUsuariosOrganizacionRedis.js';
import { RetiradorEstructuraOrganizacionRedis }
  from '../../../../paquetes/jerarquia-organizativa/src/RetiradorEstructuraOrganizacionRedis.js';
import { RepositorioProyeccionesSesionesWebRedis }
  from '../../../../paquetes/sesiones/src/RepositorioProyeccionesSesionesWebRedis.js';
import { PreparadorEliminacionDdnsAgentesEnTransaccion }
  from '../../../../paquetes/dns/src/PreparadorEliminacionDdnsAgentesEnTransaccion.js';
import { DespachadorOperacionesAdministrativasRuntime }
  from './DespachadorOperacionesAdministrativasRuntime.js';

export function crearMotorEliminacionAdministrativaAgentesRuntime({
  clienteSql,
  clienteRedis,
  instanciaId,
  servicioAuditoria,
  capturadorFederacion,
  repositoriosFederacion,
  repositorioControlFederacion,
  repositorioSesionesWeb,
  versionadorCatalogoMonitoresRedis,
  prefijoPerfilServidorRedis = 'sentinelia:runtime:perfil-servidor:',
  prefijoSesiones = 'sentinelia:sesion:',
  prefijoSesionesWebDurables = 'sentinelia:sesiones:web:',
  prefijoVersionUsuario = 'sentinelia:usuario:',
  prefijoEstructuraOrganizacionRedis = 'sentinelia:organizacion:estructura:'
} = {}) {
  exigirDependencias({
    clienteSql,
    clienteRedis,
    servicioAuditoria,
    capturadorFederacion,
    repositoriosFederacion,
    repositorioControlFederacion,
    repositorioSesionesWeb,
    versionadorCatalogoMonitoresRedis
  });
  const contratos = [
    CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE,
    CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_ORGANIZACION
  ];
  const catalogoContratos = new CatalogoEjecutoresOperacionesAdministrativas({
    contratos
  });
  const repositorioOperaciones = new RepositorioOperacionesAdministrativasSql({
    clienteSql,
    catalogoEjecutores: catalogoContratos
  });
  const repositorioNotificaciones = new RepositorioNotificacionesUsuarioSql(clienteSql, {
    catalogoContratos: new CatalogoContratosNotificacionesOperacionesAdministrativas({
      contratos: [
        CONTRATO_PERSISTENCIA_NOTIFICACIONES_ELIMINACION_AGENTE,
        CONTRATO_PERSISTENCIA_NOTIFICACIONES_ELIMINACION_ORGANIZACION
      ]
    })
  });
  const finalizadorConvergencia =
    new FinalizadorConvergenciaPostcommitOperacionesAdministrativas({
      finalizadores: [
        {
          tipo: 'eliminar_agente',
          version: 1,
          finalizador: new FinalizadorConvergenciaPostcommitEliminacionAgentes({
            repositorioNotificaciones
          })
        },
        {
          tipo: 'eliminar_organizacion',
          version: 1,
          finalizador: new FinalizadorConvergenciaPostcommitEliminacionOrganizacion({
            repositorioNotificaciones
          })
        }
      ]
    });
  const repositorioObligaciones =
    new RepositorioObligacionesPostcommitOperacionesAdministrativasSql(clienteSql, {
      finalizadorConvergencia
    });
  const repositorioObligacionesOrganizacion =
    new RepositorioObligacionesPostcommitOrganizacionSql();
  const repositorioEliminacion =
    new RepositorioEliminacionAdministrativaAgentesSql(clienteSql);
  const publicadorInvalidacionesPortal =
    new CanalInvalidacionesBuzonUsuariosRedis({ clienteRedis });
  const servicioRetiradaFederada = new ServicioRetiradaFederadaAgente({
    capturadorFederacion,
    repositorioContextoAgentes:
      repositoriosFederacion.contextoOperativoAgentesSesiones.local,
    repositorioTelemetria: repositoriosFederacion.telemetria.local,
    repositorioMonitores: repositoriosFederacion.monitores.local
  });
  const repositorioOperacionesSesion =
    new RepositorioOperacionesSesionAgentes(clienteSql);
  const preparadorEliminacionDdns =
    new PreparadorEliminacionDdnsAgentesEnTransaccion({
      clienteSql,
      servicioAuditoria
    });
  const nucleoPreparacionDependencias =
    new NucleoPreparacionDependenciasAgenteEnTransaccion({
      repositorioDependencias: repositorioEliminacion,
      servicioRetiradaFederada,
      repositorioOperacionesSesion,
      repositorioObligacionesPostcommit: repositorioObligaciones
    });
  const adaptadorPreparacionDirecta =
    new AdaptadorPreparacionEliminacionDirectaAgenteEnTransaccion({
      repositorioEliminacion,
      servicioRetiradaFederada,
      repositorioOperacionesSesion,
      repositorioObligacionesPostcommit: repositorioObligaciones,
      nucleoPreparacionDependencias,
      preparadorEliminacionDdns
    });
  const finalizadorResultado =
    new FinalizadorResultadoEliminacionAgenteEnTransaccion({
      repositorioOperaciones,
      repositorioNotificaciones,
      repositorioObligaciones
    });
  const coordinadorEliminacion =
    new CoordinadorEliminacionAgregadoAgenteEnTransaccion({
      adaptadorPreparacion: adaptadorPreparacionDirecta,
      repositorioEliminacion,
      registradorAuditoria: new RegistradorAuditoriaEliminacionAgente({
        servicioAuditoria
      }),
      finalizadorResultado
    });
  const ejecutorEliminacion = new EjecutorEliminacionAdministrativaAgente({
    clienteSql,
    coordinadorEliminacion,
    repositorioNotificaciones,
    publicadorInvalidacionesPortal
  });
  const servicioReconciliacionBajaUsuarioTriggerCorreo =
    new ServicioReconciliacionBajaUsuarioTriggerCorreo({
      repositorioAudiencia: new RepositorioAudienciaTriggerCorreoSql(),
      servicioAuditoria
    });
  const coordinadorEliminacionOrganizacion =
    new CoordinadorEliminacionOrganizacionEnTransaccion({
      preparadorInventario:
        new PreparadorInventarioFinalEliminacionOrganizacionEnTransaccion({
          autoridadReservasJerarquicas:
            new AutoridadReservasJerarquicasOperacionesAdministrativasSql(clienteSql),
          repositorioInventario:
            new RepositorioInventarioFinalEliminacionOrganizacionSql(),
          servicioReconciliacionBajaUsuarioTriggerCorreo
        }),
      preparadorEfectos:
        new PreparadorEfectosEliminacionOrganizacionEnTransaccion({
          repositorioDependenciasAgentes: repositorioEliminacion,
          nucleoPreparacionDependenciasAgente: nucleoPreparacionDependencias,
          capturadorFederacion,
          repositorioControlFederacion,
          repositorioSesionesWeb,
          repositorioObligacionesOrganizacion,
          preparadorEliminacionDdns
        }),
      ejecutorBorrado:
        new EjecutorBorradoRaizEliminacionOrganizacionEnTransaccion({
          repositorioEliminaciones: new RepositorioEliminacionesOrganizativas(),
          servicioReconciliacionBajaUsuarioTriggerCorreo
        }),
      registradorAuditoria:
        new RegistradorAuditoriaEliminacionOrganizacion({ servicioAuditoria }),
      finalizadorResultado:
        new FinalizadorResultadoEliminacionOrganizacionEnTransaccion({
          repositorioOperaciones,
          repositorioNotificaciones,
          repositorioObligaciones: repositorioObligacionesOrganizacion
        })
    });
  const ejecutorEliminacionOrganizacion =
    new EjecutorEliminacionAdministrativaOrganizacion({
      clienteSql,
      coordinadorEliminacion: coordinadorEliminacionOrganizacion,
      repositorioNotificaciones,
      publicadorInvalidacionesPortal
    });
  const catalogoEjecutores = new CatalogoEjecutoresOperacionesAdministrativas({
    contratos,
    ejecutores: [ejecutorEliminacion, ejecutorEliminacionOrganizacion]
  });
  const procesadorOperaciones = new ProcesadorOperacionesAdministrativas({
    coordinador: new CoordinadorOperacionesDurables({
      repositorio: repositorioOperaciones,
      instanciaId: `${instanciaId}:operaciones-administrativas`,
      ttlSegundos: 30
    }),
    catalogoEjecutores
  });

  const repositorioSesionesRedis =
    new RepositorioSesionesTecnicasCoordinadasRedis({ clienteRedis });
  const coordinadorPerfilServidorRedis = new CoordinadorPerfilServidorRedis({
    clienteRedis,
    prefijoRedis: prefijoPerfilServidorRedis
  });
  const ejecutorPostcommitAgentes =
    new EjecutorObligacionesPostcommitEliminacionAgentes({
      repositorioSesionesRedis,
      coordinadorPerfilServidorRedis,
      versionadorCatalogoMonitoresRedis,
      repositorioNotificaciones,
      publicadorInvalidacionesPortal
    });
  const repositorioProyeccionesSesionesWeb =
    new RepositorioProyeccionesSesionesWebRedis({
      clienteRedis,
      prefijo: prefijoSesionesWebDurables
    });
  const ejecutorPostcommit =
    new EjecutorObligacionesPostcommitOperacionesAdministrativas({
      ejecutorAgentes: ejecutorPostcommitAgentes,
      ejecutorOrganizacion:
        new EjecutorObligacionesPostcommitEliminacionOrganizacion({
          invalidatorSesionesUsuariosRedis:
            new InvalidatorSesionesUsuariosOrganizacionRedis({
              clienteRedis,
              repositorioProyeccionesSesionesWeb,
              prefijoSesiones,
              prefijoSesionesWebDurables,
              prefijoVersionUsuario
            }),
          retiradorEstructuraOrganizacionRedis:
            new RetiradorEstructuraOrganizacionRedis({
              clienteRedis,
              claveVersion: `${prefijoEstructuraOrganizacionRedis}version`,
              canalInvalidaciones:
                `${prefijoEstructuraOrganizacionRedis}invalidaciones`
            }),
          versionadorCatalogoMonitoresRedis
        })
    });
  const procesadorPostcommit =
    new ProcesadorObligacionesPostcommitOperacionesAdministrativas({
      coordinador: new CoordinadorOperacionesDurables({
        repositorio: repositorioObligaciones,
        instanciaId: `${instanciaId}:postcommit-operaciones-administrativas`,
        ttlSegundos: 30
      }),
      ejecutor: ejecutorPostcommit
    });
  const despachador = new DespachadorOperacionesAdministrativasRuntime({
    procesadorOperaciones,
    procesadorPostcommit
  });
  return Object.freeze({
    despachador,
    catalogoEjecutores,
    repositorioOperaciones,
    repositorioObligaciones,
    repositorioNotificaciones
  });
}

function exigirDependencias(dependencias) {
  const validas =
    typeof dependencias.clienteSql?.obtenerConexion === 'function' &&
    typeof dependencias.clienteRedis?.publish === 'function' &&
    typeof dependencias.servicioAuditoria?.registrarEnTransaccion === 'function' &&
    typeof dependencias.capturadorFederacion
      ?.capturarPreparadasEnTransaccion === 'function' &&
    typeof dependencias.capturadorFederacion?.capturarEnTransaccion === 'function' &&
    dependencias.repositoriosFederacion?.contextoOperativoAgentesSesiones?.local &&
    dependencias.repositoriosFederacion?.telemetria?.local &&
    dependencias.repositoriosFederacion?.monitores?.local &&
    typeof dependencias.repositorioControlFederacion
      ?.cortarDependenciasEnTransaccion === 'function' &&
    typeof dependencias.repositorioSesionesWeb
      ?.invalidarVigentesPorUsuariosEnTransaccion === 'function' &&
    typeof dependencias.versionadorCatalogoMonitoresRedis
      ?.incrementarVersion === 'function';
  if (!validas) {
    throw new Error('El motor de eliminación no recibió sus puertos productivos.');
  }
}
