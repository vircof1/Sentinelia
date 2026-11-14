import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { GeneradorProyeccionBindDns } from './GeneradorProyeccionBindDns.js';
import { ValidadorArtefactosBindDns } from './ValidadorArtefactosBindDns.js';

const execFileAsync = promisify(execFile);

async function ejecutarComandoShell(comando, opciones = {}) {
  return execFileAsync('sh', ['-lc', comando], opciones);
}

function esErrorPermisoSistema(error) {
  return error?.code === 'EACCES' || error?.code === 'EPERM';
}

function construirDetalleError(error) {
  if (!error) {
    return null;
  }

  return {
    codigo: error.code == null ? null : String(error.code),
    senal: error.signal == null ? null : String(error.signal),
    mensaje: String(error.message || 'Error desconocido al publicar configuración DNS.')
  };
}

export class PublicadorBindDns {
  constructor({
    validadorArtefactosBindDns = new ValidadorArtefactosBindDns(),
    repositorioZonasDns = null,
    versionadorDnsRedis = null,
    generadorProyeccionBindDns = new GeneradorProyeccionBindDns(),
    ejecutarComandoRecarga = ejecutarComandoShell
  } = {}) {
    this.validadorArtefactosBindDns = validadorArtefactosBindDns;
    this.repositorioZonasDns = repositorioZonasDns;
    this.versionadorDnsRedis = versionadorDnsRedis;
    this.generadorProyeccionBindDns = generadorProyeccionBindDns;
    this.ejecutarComandoRecarga = ejecutarComandoRecarga;
  }

  async publicar({
    configuracionDns = {},
    catalogoZonas = []
  }) {
    let respaldos = [];

    try {
      const validacionInicial = await this.validadorArtefactosBindDns.validar({
        configuracionDns,
        catalogoZonas
      });

      if (!validacionInicial.ok) {
        await this.registrarErrorValidacion(validacionInicial);

        return {
          ok: false,
          publicado: false,
          motivo: 'validacion_fallida',
          validacion: validacionInicial
        };
      }

      const planInicial = await this.construirPlanCambios(validacionInicial.proyeccion);
      const nombresZonasCambiadas = this.resolverNombresZonasCambiadas(planInicial);
      const catalogoFinal = this.incrementarSerialesCatalogo(
        catalogoZonas,
        nombresZonasCambiadas
      );
      const validacionFinal = await this.validadorArtefactosBindDns.validar({
        configuracionDns,
        catalogoZonas: catalogoFinal
      });

      if (!validacionFinal.ok) {
        await this.registrarErrorValidacion(validacionFinal);

        return {
          ok: false,
          publicado: false,
          motivo: 'validacion_fallida_despues_de_serial',
          validacion: validacionFinal
        };
      }

      const proyeccionPublicacion = this.generadorProyeccionBindDns.generar({
        configuracionDns,
        catalogoZonas: catalogoFinal
      });
      const planFinal = await this.construirPlanCambios(proyeccionPublicacion);

      if (planFinal.totalCambios === 0) {
        const versionDns = await this.registrarExitoPublicacion({
          proyeccion: proyeccionPublicacion,
          huboCambios: false
        });

        return {
          ok: true,
          publicado: false,
          recargado: false,
          versionDns,
          validacion: validacionFinal,
          plan: planFinal
        };
      }

      for (const cambio of planFinal.cambios) {
        respaldos.push(await this.escribirCambioAtomico(cambio));
      }

      const resultadoRecarga = await this.ejecutarRecarga(
        configuracionDns.comandoRecarga
      );
      const versionDns = await this.registrarExitoPublicacion({
        proyeccion: proyeccionPublicacion,
        huboCambios: true
      });

      return {
        ok: true,
        publicado: true,
        recargado: true,
        versionDns,
        validacion: validacionFinal,
        plan: planFinal,
        recarga: resultadoRecarga
      };
    } catch (error) {
      if (Array.isArray(respaldos) && respaldos.length > 0) {
        await this.restaurarRespaldos(respaldos);
      }
      await this.registrarErrorPublicacion(
        this.construirMensajeErrorPublicacion(error)
      );

      return {
        ok: false,
        publicado: false,
        recargado: false,
        motivo: 'publicacion_fallida',
        detalleError: construirDetalleError(error),
        plan: null,
        validacion: null
      };
    }
  }

  async construirPlanCambios(proyeccion) {
    const artefactosObsoletos = await this.listarArtefactosZonaObsoletos(
      proyeccion.archivosZona
    );
    const artefactos = [
      {
        clave: 'namedConf',
        tipo: 'named_conf',
        nombre: 'sentinelia-named.conf',
        rutaArchivo: proyeccion.namedConf.rutaArchivo,
        contenido: proyeccion.namedConf.contenido,
        nombreZona: null
      },
      {
        clave: 'zonesConf',
        tipo: 'zones_conf',
        nombre: 'sentinelia-zones.conf',
        rutaArchivo: proyeccion.zonesConf.rutaArchivo,
        contenido: proyeccion.zonesConf.contenido,
        nombreZona: null
      },
      ...proyeccion.archivosZona.map((archivoZona) => ({
        clave: `zona:${archivoZona.nombreZona}`,
        tipo: 'zonefile',
        nombre: archivoZona.nombreArchivo,
        rutaArchivo: archivoZona.rutaArchivo,
        contenido: archivoZona.contenido,
        nombreZona: archivoZona.nombreZona
      })),
      ...artefactosObsoletos
    ];

    const cambios = [];
    const sinCambios = [];

    for (const artefacto of artefactos) {
      const existente = await this.leerArchivoSiExiste(artefacto.rutaArchivo);
      const hashObjetivo = this.calcularHash(artefacto.contenido);
      const hashExistente = existente == null ? null : this.calcularHash(existente);
      const cambio = {
        ...artefacto,
        hashObjetivo,
        hashExistente,
        contenidoExistente: existente,
        cambiado: artefacto.tipo === 'zonefile_delete'
          ? existente != null
          : existente !== artefacto.contenido
      };

      if (cambio.cambiado) {
        cambios.push(cambio);
      } else {
        sinCambios.push(cambio);
      }
    }

    return {
      cambios,
      sinCambios,
      totalCambios: cambios.length,
      totalArtefactos: artefactos.length
    };
  }

  resolverNombresZonasCambiadas(planCambios) {
    return new Set(
      planCambios.cambios
        .filter((cambio) => cambio.tipo === 'zonefile' && cambio.nombreZona)
        .map((cambio) => cambio.nombreZona)
    );
  }

  incrementarSerialesCatalogo(catalogoZonas = [], nombresZonasCambiadas = new Set()) {
    return (Array.isArray(catalogoZonas) ? catalogoZonas : []).map((item) => {
      const zona = item?.zona || {};
      const nombreZona = String(
        zona.nombre_zona ?? zona.nombreZona ?? ''
      ).trim().toLowerCase();

      if (!nombresZonasCambiadas.has(nombreZona)) {
        return item;
      }

      const serialActual = Number.parseInt(
        String(zona.soa_serial ?? zona.soaSerial ?? 1),
        10
      );
      const serialNuevo = Number.isInteger(serialActual) && serialActual > 0
        ? serialActual + 1
        : 1;

      return {
        ...item,
        zona: {
          ...zona,
          soa_serial: serialNuevo,
          soaSerial: serialNuevo
        }
      };
    });
  }

  async escribirCambioAtomico(cambio) {
    await fs.mkdir(path.dirname(cambio.rutaArchivo), { recursive: true });
    const contenidoAnterior = await this.leerArchivoSiExiste(cambio.rutaArchivo);

    if (cambio.tipo === 'zonefile_delete') {
      await fs.rm(cambio.rutaArchivo, { force: true });

      return {
        rutaArchivo: cambio.rutaArchivo,
        contenidoAnterior
      };
    }

    const rutaTemporal = `${cambio.rutaArchivo}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fs.writeFile(rutaTemporal, cambio.contenido, 'utf8');
      await fs.rename(rutaTemporal, cambio.rutaArchivo);
    } catch (error) {
      if (!(esErrorPermisoSistema(error) && contenidoAnterior != null)) {
        throw error;
      }

      // En algunos despliegues el include gestionado ya existe y es editable,
      // pero el directorio padre no permite crear temporales para el rename atómico.
      await fs.writeFile(cambio.rutaArchivo, cambio.contenido, 'utf8');
    }

    return {
      rutaArchivo: cambio.rutaArchivo,
      contenidoAnterior
    };
  }

  async restaurarRespaldos(respaldos = []) {
    for (const respaldo of [...respaldos].reverse()) {
      await fs.mkdir(path.dirname(respaldo.rutaArchivo), { recursive: true });

      if (respaldo.contenidoAnterior == null) {
        await fs.rm(respaldo.rutaArchivo, { force: true });
        continue;
      }

      const rutaTemporal = `${respaldo.rutaArchivo}.rollback-${process.pid}-${Date.now()}`;
      await fs.writeFile(rutaTemporal, respaldo.contenidoAnterior, 'utf8');
      await fs.rename(rutaTemporal, respaldo.rutaArchivo);
    }
  }

  async ejecutarRecarga(comandoRecarga) {
    const comando = String(comandoRecarga || 'rndc reload').trim();
    const { stdout, stderr } = await this.ejecutarComandoRecarga(
      comando,
      this.construirOpcionesEjecucionComando()
    );

    return {
      comando,
      stdout: String(stdout || ''),
      stderr: String(stderr || '')
    };
  }

  async registrarExitoPublicacion({ proyeccion, huboCambios }) {
    if (this.repositorioZonasDns) {
      const publicaciones = proyeccion.archivosZona.map((archivoZona) => ({
        nombreZona: archivoZona.nombreZona,
        hashPublicacionVigente: this.calcularHash(archivoZona.contenido),
        soaSerialPublicado: this.extraerSerialDesdeContenido(archivoZona.contenido)
      }));

      await this.repositorioZonasDns.registrarPublicacionExitosa(publicaciones);
    }

    if (huboCambios && this.versionadorDnsRedis) {
      await this.versionadorDnsRedis.asegurarVersionInicial();
      return this.versionadorDnsRedis.incrementarVersion();
    }

    if (this.versionadorDnsRedis) {
      return this.versionadorDnsRedis.asegurarVersionInicial();
    }

    return null;
  }

  async listarArtefactosZonaObsoletos(archivosZona = []) {
    const archivosEsperados = new Set(
      (Array.isArray(archivosZona) ? archivosZona : [])
        .map((archivoZona) => String(archivoZona?.rutaArchivo || '').trim())
        .filter(Boolean)
    );
    const directorios = [
      ...new Set(
        (Array.isArray(archivosZona) ? archivosZona : [])
          .map((archivoZona) => path.dirname(String(archivoZona?.rutaArchivo || '').trim()))
          .filter((directorio) => directorio && directorio !== '.')
      )
    ];
    const artefactos = [];

    for (const directorio of directorios) {
      let entradas = [];

      try {
        entradas = await fs.readdir(directorio, { withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') {
          continue;
        }

        throw error;
      }

      for (const entrada of entradas) {
        if (!entrada.isFile() || !/^db\..+\.zone$/i.test(entrada.name)) {
          continue;
        }

        const rutaArchivo = path.join(directorio, entrada.name);

        if (archivosEsperados.has(rutaArchivo)) {
          continue;
        }

        artefactos.push({
          clave: `zona-obsoleta:${entrada.name}`,
          tipo: 'zonefile_delete',
          nombre: entrada.name,
          rutaArchivo,
          contenido: null,
          nombreZona: null
        });
      }
    }

    return artefactos;
  }

  async registrarErrorValidacion(validacion) {
    if (!this.repositorioZonasDns) {
      return;
    }

    const erroresPorZona = new Map();

    for (const errorZona of validacion.validaciones?.zonas || []) {
      if (errorZona.ok) {
        continue;
      }

      erroresPorZona.set(
        errorZona.zona,
        `named-checkzone fallo para ${errorZona.zona}: ${String(errorZona.stderr || errorZona.stdout || errorZona.detalleError?.mensaje || 'sin detalle')}`.trim()
      );
    }

    const errorGlobal = validacion.validaciones?.namedConf;

    if (errorGlobal && !errorGlobal.ok) {
      const detalleGlobal =
        `named-checkconf fallo: ${String(errorGlobal.stderr || errorGlobal.stdout || errorGlobal.detalleError?.mensaje || 'sin detalle')}`.trim();

      await this.repositorioZonasDns.registrarPublicacionFallidaGlobal({
        detalleError: detalleGlobal
      });
      return;
    }

    if (erroresPorZona.size > 0) {
      await this.repositorioZonasDns.registrarPublicacionFallidaPorNombre(
        Array.from(erroresPorZona.entries()).map(([nombreZona, detalleError]) => ({
          nombreZona,
          detalleError
        }))
      );
    }
  }

  async registrarErrorPublicacion(detalleError) {
    if (!this.repositorioZonasDns) {
      return;
    }

    await this.repositorioZonasDns.registrarPublicacionFallidaGlobal({
      detalleError
    });
  }

  async leerArchivoSiExiste(rutaArchivo) {
    try {
      return await fs.readFile(rutaArchivo, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  calcularHash(texto) {
    return createHash('sha256').update(String(texto ?? ''), 'utf8').digest('hex');
  }

  extraerSerialDesdeContenido(contenido) {
    const coincidencia = String(contenido || '').match(/\n\s*(\d+)\s*;\s*serial/i);

    if (!coincidencia) {
      return null;
    }

    const serial = Number.parseInt(coincidencia[1], 10);
    return Number.isInteger(serial) && serial > 0 ? serial : null;
  }

  construirMensajeErrorPublicacion(error) {
    return `La recarga BIND falló y se restauró la versión previa: ${String(error?.stderr || error?.stdout || error?.message || 'sin detalle')}`.trim();
  }

  construirOpcionesEjecucionComando() {
    return {
      env: {
        ...process.env,
        LC_ALL: 'C'
      }
    };
  }
}
