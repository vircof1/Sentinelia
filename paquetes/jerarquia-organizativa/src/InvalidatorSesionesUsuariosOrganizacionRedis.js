export class InvalidatorSesionesUsuariosOrganizacionRedis {
  constructor({
    clienteRedis,
    repositorioProyeccionesSesionesWeb,
    prefijoSesiones,
    prefijoSesionesWebDurables,
    prefijoVersionUsuario
  } = {}) {
    if (typeof clienteRedis?.scanIterator !== 'function' ||
        typeof clienteRedis?.get !== 'function' ||
        typeof clienteRedis?.del !== 'function' ||
        typeof repositorioProyeccionesSesionesWeb?.obtenerPorStoreId !== 'function' ||
        typeof repositorioProyeccionesSesionesWeb?.eliminarPorStoreId !== 'function') {
      throw new Error('La invalidación organizativa exige proyecciones Redis operativas.');
    }
    Object.assign(this, {
      clienteRedis,
      repositorioProyeccionesSesionesWeb,
      prefijoSesiones: prefijo(prefijoSesiones, 'prefijoSesiones'),
      prefijoSesionesWebDurables: prefijo(
        prefijoSesionesWebDurables,
        'prefijoSesionesWebDurables'
      ),
      prefijoVersionUsuario: prefijo(prefijoVersionUsuario, 'prefijoVersionUsuario')
    });
  }

  async invalidar(objetivo) {
    const raiz = normalizarRaiz(objetivo);
    const usuarios = new Set();
    const durables = await this.#retirarSesionesDurables(raiz, usuarios);
    const clavesLegacy = await this.#buscarSesionesLegacy(
      raiz,
      usuarios,
      durables.storeIds
    );
    const clavesVersion = [...usuarios].map((usuarioId) =>
      `${this.prefijoVersionUsuario}${usuarioId}:version_sesion`
    );
    const eliminadas = [...new Set([...clavesLegacy, ...clavesVersion])];
    if (eliminadas.length > 0) await this.clienteRedis.del(eliminadas);
    return Object.freeze({
      sesionesLegacyRetiradas: clavesLegacy.length,
      sesionesDurablesRetiradas: durables.cantidad,
      versionesUsuarioRetiradas: clavesVersion.length
    });
  }

  async #buscarSesionesLegacy(raiz, usuarios, storeIdsRetirados) {
    const claves = [];
    for await (const entrada of this.clienteRedis.scanIterator({
      MATCH: `${this.prefijoSesiones}*`,
      COUNT: 100
    })) {
      const clave = String(entrada);
      const contenido = await this.clienteRedis.get(clave);
      const sesion = json(contenido);
      const autenticado = sesion?.usuarioAutenticado;
      const storeId = String(sesion?.sesionWebAuditable?.storeId || '');
      if (!autenticado ||
          (!pertenece(scopeDe(autenticado), raiz) &&
           !storeIdsRetirados.has(storeId))) continue;
      claves.push(clave);
      incorporarUsuarios(usuarios, autenticado);
    }
    return claves;
  }

  async #retirarSesionesDurables(raiz, usuarios) {
    let retiradas = 0;
    const storeIds = new Set();
    const patron = `${this.prefijoSesionesWebDurables}store:*`;
    for await (const entrada of this.clienteRedis.scanIterator({
      MATCH: patron,
      COUNT: 100
    })) {
      const clave = String(entrada);
      const storeId = clave.slice(`${this.prefijoSesionesWebDurables}store:`.length);
      const proyeccion = await this.repositorioProyeccionesSesionesWeb
        .obtenerPorStoreId(storeId);
      if (!proyeccion ||
          ![
            proyeccion.scopeApertura,
            proyeccion.scopeEfectivoActual
          ].some((scope) => pertenece(scope, raiz))) continue;
      if (await this.repositorioProyeccionesSesionesWeb.eliminarPorStoreId(
        storeId,
        proyeccion.sesionAuditoriaId
      )) {
        retiradas += 1;
      }
      storeIds.add(storeId);
      usuarios.add(String(proyeccion.usuarioRealId));
      usuarios.add(String(proyeccion.usuarioEfectivoId));
    }
    return Object.freeze({ cantidad: retiradas, storeIds });
  }
}

function scopeDe(usuario) {
  const scope = usuario.scopeEfectivoActual || usuario.scope || usuario;
  return {
    tenantId: scope.tenantId ?? null,
    empresaId: scope.empresaId ?? null,
    sitioId: scope.sitioId ?? null
  };
}

function incorporarUsuarios(destino, usuario) {
  for (const valor of [usuario.idUsuarioReal, usuario.idUsuarioEfectivo, usuario.idUsuario]) {
    if (/^[1-9][0-9]*$/u.test(String(valor ?? ''))) destino.add(String(valor));
  }
}

function pertenece(scope = {}, raiz) {
  const campo = `${raiz.tipo}Id`;
  return String(scope[campo] ?? '') === raiz.id;
}

function normalizarRaiz(objetivo = {}) {
  const tipo = String(objetivo.tipo || '');
  const id = String(objetivo.id || '');
  if (!['tenant', 'empresa', 'sitio'].includes(tipo) || !/^[1-9][0-9]*$/u.test(id)) {
    throw new TypeError('La invalidación de sesiones exige una raíz válida.');
  }
  return Object.freeze({ tipo, id });
}

function json(valor) {
  if (!valor) return null;
  try { return JSON.parse(String(valor)); } catch { return null; }
}

function prefijo(valor, campo) {
  const normalizado = String(valor || '');
  if (!normalizado || normalizado.trim() !== normalizado) {
    throw new TypeError(`${campo} no es válido.`);
  }
  return normalizado;
}
