import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { GeneradorProyeccionBindDns } from './GeneradorProyeccionBindDns.js';

const execFileAsync = promisify(execFile);

function construirDetalleError(error) {
  if (!error) {
    return null;
  }

  return {
    codigo: error.code == null ? null : String(error.code),
    senal: error.signal == null ? null : String(error.signal),
    mensaje: String(error.message || 'Error desconocido al validar BIND.')
  };
}

async function ejecutarComandoSistema(comando, args, opciones = {}) {
  return execFileAsync(comando, args, opciones);
}

export class ValidadorArtefactosBindDns {
  constructor({
    generadorProyeccionBindDns = new GeneradorProyeccionBindDns(),
    ejecutarComando = ejecutarComandoSistema
  } = {}) {
    this.generadorProyeccionBindDns = generadorProyeccionBindDns;
    this.ejecutarComando = ejecutarComando;
  }

  async validar({
    configuracionDns = {},
    catalogoZonas = []
  }) {
    const directorioTemporal = await fs.mkdtemp(
      path.join(os.tmpdir(), 'sentinelia-bind-validacion-')
    );

    try {
      const configuracionTemporal =
        this.construirConfiguracionTemporal(configuracionDns, directorioTemporal);
      const proyeccion = this.generadorProyeccionBindDns.generar({
        configuracionDns: configuracionTemporal,
        catalogoZonas
      });

      await this.materializarProyeccionTemporal(proyeccion);

      const validacionesZona = await this.validarZonas({
        proyeccion,
        configuracionDns: configuracionTemporal
      });
      const validacionNamedConf = await this.validarNamedConf({
        proyeccion,
        configuracionDns: configuracionTemporal
      });
      const errores = [
        ...validacionesZona.filter((item) => !item.ok),
        ...(validacionNamedConf.ok ? [] : [validacionNamedConf])
      ];

      return {
        ok: errores.length === 0,
        proyeccion,
        resumen: {
          totalZonas: proyeccion.resumen.totalZonas,
          totalRegistrosPublicables: proyeccion.resumen.totalRegistrosPublicables,
          validacionesZonaOk: validacionesZona.filter((item) => item.ok).length,
          validacionesZonaError: validacionesZona.filter((item) => !item.ok).length
        },
        validaciones: {
          zonas: validacionesZona,
          namedConf: validacionNamedConf
        },
        errores
      };
    } finally {
      await fs.rm(directorioTemporal, {
        recursive: true,
        force: true
      });
    }
  }

  construirConfiguracionTemporal(configuracionDns, directorioTemporal) {
    return {
      ...configuracionDns,
      rutaIncludeGestionado: path.join(
        directorioTemporal,
        'sentinelia.named.conf'
      ),
      directorioZonas: path.join(directorioTemporal, 'zonas')
    };
  }

  async materializarProyeccionTemporal(proyeccion) {
    await this.escribirArchivo(
      proyeccion.namedConf.rutaArchivo,
      proyeccion.namedConf.contenido
    );
    await this.escribirArchivo(
      proyeccion.zonesConf.rutaArchivo,
      proyeccion.zonesConf.contenido
    );

    for (const archivoZona of proyeccion.archivosZona) {
      await this.escribirArchivo(archivoZona.rutaArchivo, archivoZona.contenido);
    }
  }

  async escribirArchivo(rutaArchivo, contenido) {
    await fs.mkdir(path.dirname(rutaArchivo), { recursive: true });
    await fs.writeFile(rutaArchivo, String(contenido ?? ''), 'utf8');
  }

  async validarZonas({ proyeccion, configuracionDns }) {
    const comando = String(
      configuracionDns.comandoCheckzone || 'named-checkzone'
    ).trim();

    return Promise.all(
      proyeccion.archivosZona.map(async (archivoZona) => {
        try {
          const { stdout, stderr } = await this.ejecutarComando(
            comando,
            [archivoZona.nombreZona, archivoZona.rutaArchivo],
            this.construirOpcionesEjecucionComando()
          );

          return {
            ok: true,
            zona: archivoZona.nombreZona,
            comando,
            rutaArchivo: archivoZona.rutaArchivo,
            stdout: String(stdout || ''),
            stderr: String(stderr || '')
          };
        } catch (error) {
          return {
            ok: false,
            zona: archivoZona.nombreZona,
            comando,
            rutaArchivo: archivoZona.rutaArchivo,
            stdout: String(error.stdout || ''),
            stderr: String(error.stderr || ''),
            detalleError: construirDetalleError(error)
          };
        }
      })
    );
  }

  async validarNamedConf({ proyeccion, configuracionDns }) {
    const comando = String(
      configuracionDns.comandoCheckconf || 'named-checkconf'
    ).trim();

    try {
      const { stdout, stderr } = await this.ejecutarComando(
        comando,
        [proyeccion.namedConf.rutaArchivo],
        this.construirOpcionesEjecucionComando()
      );

      return {
        ok: true,
        comando,
        rutaArchivo: proyeccion.namedConf.rutaArchivo,
        stdout: String(stdout || ''),
        stderr: String(stderr || '')
      };
    } catch (error) {
      return {
        ok: false,
        comando,
        rutaArchivo: proyeccion.namedConf.rutaArchivo,
        stdout: String(error.stdout || ''),
        stderr: String(error.stderr || ''),
        detalleError: construirDetalleError(error)
      };
    }
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
