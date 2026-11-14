import { LectorCatalogoDnsSql } from './LectorCatalogoDnsSql.js';
import { RenderizadorCatalogoBindDnsV1 } from './RenderizadorCatalogoBindDnsV1.js';
import { fotografiarPublicacionZonasDns } from './FotografiaPublicacionZonasDns.js';

export class GeneracionDnsNoFotografiable extends Error {
  constructor({ esperada, observada }) {
    super(`La generación DNS ${esperada} ya no coincide con la cabecera ${observada}.`);
    this.name = 'GeneracionDnsNoFotografiable';
    this.esperada = esperada;
    this.observada = observada;
  }
}

export class RepositorioFotografiaCatalogoDns {
  constructor({
    clienteSql,
    lectorCatalogo = new LectorCatalogoDnsSql({ clienteSql }),
    renderizador = new RenderizadorCatalogoBindDnsV1(),
    materializador
  } = {}) {
    if (!clienteSql?.obtenerConexion || !lectorCatalogo?.leerEnContexto ||
        !renderizador?.renderizar || !materializador?.materializar) {
      throw new Error('La fotografía DNS requiere SQL, lector, renderizador y materializador.');
    }
    this.clienteSql = clienteSql;
    this.lectorCatalogo = lectorCatalogo;
    this.renderizador = renderizador;
    this.materializador = materializador;
  }

  async materializar({ generacionDns } = {}) {
    const generacion = decimalPositivo(generacionDns, 'generacionDns');
    const conexion = await this.clienteSql.obtenerConexion();
    let transaccionAbierta = false;
    try {
      await conexion.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conexion.query('START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT');
      transaccionAbierta = true;
      const [filas] = await conexion.execute(
        `SELECT CAST(ultima_generacion_dns AS CHAR) AS ultima_generacion_dns
           FROM cabecera_generacion_dns
          WHERE id = 1`
      );
      const observada = decimalPositivo(filas[0]?.ultima_generacion_dns, 'ultimaGeneracionDns');
      if (observada !== generacion) {
        throw new GeneracionDnsNoFotografiable({ esperada: generacion, observada });
      }

      const catalogo = await this.lectorCatalogo.leerEnContexto(conexion);
      const renderizada = this.renderizador.renderizarFotografia
        ? await this.renderizador.renderizarFotografia(catalogo, {
            generacionDns: generacion
          })
        : Object.freeze({
            artefactos: await this.renderizador.renderizar(catalogo, {
              generacionDns: generacion
            }),
            diagnostico: null
          });
      const proyeccion = await this.materializador.materializar(
        renderizada.artefactos,
        {
          contextoDestino: Object.freeze({ generacionDns: generacion }),
          diagnostico: renderizada.diagnostico
        }
      );
      await conexion.commit();
      transaccionAbierta = false;
      return Object.freeze({
        generacionLeida: generacion, catalogo, proyeccion,
        fotografiaZonas: renderizada.zonasPublicacion
          ? fotografiarPublicacionZonasDns(catalogo, renderizada) : null
      });
    } catch (error) {
      if (transaccionAbierta) {
        try { await conexion.rollback(); } catch {}
      }
      throw error;
    } finally {
      conexion.release();
    }
  }
}

function decimalPositivo(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) throw new Error(`${nombre} debe ser decimal positivo.`);
  return texto;
}
