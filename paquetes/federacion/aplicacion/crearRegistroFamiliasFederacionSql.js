import { RepositorioAuditoriaRemotaSql } from '../adaptadores/RepositorioAuditoriaRemotaSql.js';
import { RepositorioAuditoriaFederadaLocalSql } from '../adaptadores/RepositorioAuditoriaFederadaLocalSql.js';
import { crearDefinicionAdaptadorAuditoriaFederacion } from '../adaptadores/AdaptadorAuditoriaFederacion.js';
import { RepositorioAvisosFederadosLocalSql } from '../adaptadores/RepositorioAvisosFederadosLocalSql.js';
import { RepositorioAvisosFederadosRemotoSql } from '../adaptadores/RepositorioAvisosFederadosRemotoSql.js';
import { crearDefinicionAdaptadorAvisosFederados } from '../adaptadores/AdaptadorAvisosFederados.js';
import { RepositorioContextoOperativoAgentesSesionesLocalSql } from '../adaptadores/RepositorioContextoOperativoAgentesSesionesLocalSql.js';
import { RepositorioContextoOperativoAgentesSesionesRemotoSql } from '../adaptadores/RepositorioContextoOperativoAgentesSesionesRemotoSql.js';
import { crearDefinicionAdaptadorContextoOperativoAgentesSesionesFederacion } from '../adaptadores/AdaptadorContextoOperativoAgentesSesionesFederacionSql.js';
import { RepositorioEstructuraOrganizativaLocalSql } from '../adaptadores/RepositorioEstructuraOrganizativaLocalSql.js';
import { RepositorioEstructuraOrganizativaRemotaSql } from '../adaptadores/RepositorioEstructuraOrganizativaRemotaSql.js';
import { crearDefinicionAdaptadorEstructuraOrganizativaFederacion } from '../adaptadores/AdaptadorEstructuraOrganizativaFederacionSql.js';
import { RepositorioMonitoresLocalSql } from '../adaptadores/RepositorioMonitoresLocalSql.js';
import { RepositorioMonitoresRemotoSql } from '../adaptadores/RepositorioMonitoresRemotoSql.js';
import { crearDefinicionAdaptadorMonitoresFederacion } from '../adaptadores/AdaptadorMonitoresFederacion.js';
import { RepositorioTelemetriaLocalSql } from '../adaptadores/RepositorioTelemetriaLocalSql.js';
import { RepositorioTelemetriaRemotaSql } from '../adaptadores/RepositorioTelemetriaRemotaSql.js';
import { crearDefinicionAdaptadorTelemetriaFederacion } from '../adaptadores/AdaptadorTelemetriaFederacion.js';
import { RepositorioTriggersInformativosLocalSql } from '../adaptadores/RepositorioTriggersInformativosLocalSql.js';
import { RepositorioTriggersInformativosRemotoSql } from '../adaptadores/RepositorioTriggersInformativosRemotoSql.js';
import { crearDefinicionAdaptadorTriggersInformativosFederacion } from '../adaptadores/AdaptadorTriggersInformativosFederacion.js';
import { RegistroAdaptadoresFamiliasFederacion } from '../src/AdaptadoresFamiliasFederacion.js';
import { GrafoDependenciasFamiliasFederacion } from '../src/GrafoDependenciasFamiliasFederacion.js';

export function crearRegistroFamiliasFederacionSql({
  clienteSql,
  installationLocalId,
  resolverVigenciaEstadoMonitores,
  prepararMomentoUtcRelativoLocal = false,
  permitirMomentoUtcRelativo = false
} = {}) {
  if (typeof clienteSql?.obtenerConexion !== 'function') {
    throw new Error('El registro productivo de familias requiere SQL operativo.');
  }
  if (typeof resolverVigenciaEstadoMonitores !== 'function') {
    throw new Error('El registro productivo necesita la política de vigencia de monitores.');
  }

  const repositorios = {
    estructuraOrganizativa: {
      local: new RepositorioEstructuraOrganizativaLocalSql(clienteSql, { installationLocalId }),
      remoto: new RepositorioEstructuraOrganizativaRemotaSql(clienteSql)
    },
    contextoOperativoAgentesSesiones: {
      local: new RepositorioContextoOperativoAgentesSesionesLocalSql(clienteSql, { installationLocalId }),
      remoto: new RepositorioContextoOperativoAgentesSesionesRemotoSql(clienteSql)
    },
    telemetria: {
      local: new RepositorioTelemetriaLocalSql(clienteSql, {
        installationLocalId,
        permitirMomentoUtcRelativo:
          prepararMomentoUtcRelativoLocal || permitirMomentoUtcRelativo
      }),
      remoto: new RepositorioTelemetriaRemotaSql(clienteSql, {
        permitirMomentoUtcRelativo
      })
    },
    monitores: {
      local: new RepositorioMonitoresLocalSql(clienteSql, {
        installationLocalId,
        resolverVigenciaEstado: resolverVigenciaEstadoMonitores
      }),
      remoto: new RepositorioMonitoresRemotoSql(clienteSql)
    },
    triggersInformativos: {
      local: new RepositorioTriggersInformativosLocalSql(clienteSql, { installationLocalId }),
      remoto: new RepositorioTriggersInformativosRemotoSql(clienteSql)
    },
    auditoria: {
      local: new RepositorioAuditoriaFederadaLocalSql(clienteSql, { installationLocalId }),
      remoto: new RepositorioAuditoriaRemotaSql(clienteSql)
    },
    avisosFederados: {
      local: new RepositorioAvisosFederadosLocalSql(clienteSql, { installationLocalId }),
      remoto: new RepositorioAvisosFederadosRemotoSql(clienteSql)
    }
  };

  const definiciones = [
    crearDefinicionAdaptadorEstructuraOrganizativaFederacion({
      repositorio: repositorios.estructuraOrganizativa.remoto,
      repositorioLocal: repositorios.estructuraOrganizativa.local
    }),
    crearDefinicionAdaptadorContextoOperativoAgentesSesionesFederacion({
      repositorio: repositorios.contextoOperativoAgentesSesiones.remoto,
      repositorioLocal: repositorios.contextoOperativoAgentesSesiones.local
    }),
    crearDefinicionAdaptadorTelemetriaFederacion({
      repositorioLocal: repositorios.telemetria.local,
      repositorioRemoto: repositorios.telemetria.remoto,
      permitirMomentoUtcRelativo
    }),
    crearDefinicionAdaptadorMonitoresFederacion({
      repositorioLocal: repositorios.monitores.local,
      repositorioRemoto: repositorios.monitores.remoto
    }),
    crearDefinicionAdaptadorTriggersInformativosFederacion({
      repositorioLocal: repositorios.triggersInformativos.local,
      repositorioRemoto: repositorios.triggersInformativos.remoto
    }),
    crearDefinicionAdaptadorAuditoriaFederacion({
      repositorioLocal: repositorios.auditoria.local,
      repositorioRemoto: repositorios.auditoria.remoto
    }),
    crearDefinicionAdaptadorAvisosFederados({
      repositorioLocal: repositorios.avisosFederados.local,
      repositorioRemoto: repositorios.avisosFederados.remoto
    })
  ];
  const grafoDependencias = crearGrafoDependenciasFamiliasProductivas();
  const registro = new RegistroAdaptadoresFamiliasFederacion({
    grafoDependencias,
    adaptadores: definiciones
  });
  return Object.freeze({
    registro,
    grafoDependencias,
    definiciones: Object.freeze(definiciones),
    repositorios: congelarContenedores(repositorios)
  });
}

export function crearGrafoDependenciasFamiliasProductivas() {
  return new GrafoDependenciasFamiliasFederacion({ declaraciones: [
    declaracion('estructuraOrganizativa', []),
    declaracion('contextoOperativoAgentesSesiones', [
      opcional('estructuraOrganizativa', ['interpretable'])
    ]),
    declaracion('telemetria', [
      opcional('estructuraOrganizativa', ['interpretable']),
      opcional('contextoOperativoAgentesSesiones', ['observable'])
    ]),
    declaracion('monitores', [
      opcional('estructuraOrganizativa', ['interpretable']),
      opcional('telemetria', ['observable']),
      opcional('triggersInformativos', ['reconstruible'])
    ]),
    declaracion('triggersInformativos', [
      opcional('monitores', ['interpretable'])
    ]),
    declaracion('auditoria', [
      opcional('estructuraOrganizativa', ['interpretable'])
    ]),
    declaracion('avisosFederados', [
      opcional('estructuraOrganizativa', ['interpretable']),
      opcional('auditoria', ['reconstruible'])
    ])
  ] });
}

function declaracion(familia, dependencias) { return { familia, dependencias }; }
function opcional(familia, capacidades) { return { familia, tipo: 'opcional', capacidades }; }
function congelarContenedores(repositorios) {
  return Object.freeze(Object.fromEntries(Object.entries(repositorios).map(
    ([familia, valor]) => [familia, Object.freeze(valor)]
  )));
}
