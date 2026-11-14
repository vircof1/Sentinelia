import fs from 'node:fs/promises';
import path from 'node:path';
import { MigracionSql } from './MigracionSql.js';
import { VerificadorPostcondicionesMigraciones } from './VerificadorPostcondicionesMigraciones.js';

export class EjecutorMigraciones {
  constructor({
    clienteSql,
    repositorioMigraciones,
    rutaMigraciones,
    verificadorPostcondiciones = new VerificadorPostcondicionesMigraciones()
  }) {
    this.clienteSql = clienteSql;
    this.repositorioMigraciones = repositorioMigraciones;
    this.rutaMigraciones = rutaMigraciones;
    this.verificadorPostcondiciones = verificadorPostcondiciones;
  }

  async cargarMigracionesDisponibles() {
    const entradas = await fs.readdir(this.rutaMigraciones, {
      withFileTypes: true
    });

    const rutas = entradas
      .filter((entrada) => entrada.isFile() && entrada.name.endsWith('.sql'))
      .map((entrada) => path.join(this.rutaMigraciones, entrada.name))
      .sort((a, b) => a.localeCompare(b));

    return Promise.all(
      rutas.map((rutaAbsoluta) => MigracionSql.cargarDesdeArchivo(rutaAbsoluta))
    );
  }

  async ejecutarPendientes() {
    await this.repositorioMigraciones.asegurarTablaControl();

    const migraciones = await this.cargarMigracionesDisponibles();
    const aplicadas = await this.repositorioMigraciones.listarAplicadas();
    const auditoriaIntegridad = this.auditarIntegridadMigraciones({
      migracionesDisponibles: migraciones,
      migracionesAplicadas: aplicadas
    });

    if (!auditoriaIntegridad.ok) {
      throw new Error(this.construirMensajeErrorIntegridad(auditoriaIntegridad));
    }

    await this.verificarPostcondicionesAplicadas({ migraciones, aplicadas });

    const pendientes = migraciones.filter(
      (migracion) => !aplicadas.has(migracion.nombreArchivo)
    );

    for (const migracion of pendientes) {
      await this.ejecutarMigracion(migracion);
    }

    return {
      ejecutado: true,
      pendientesAplicadas: pendientes.length,
      integridad: auditoriaIntegridad,
      mensaje:
        `${pendientes.length > 0
          ? `Migraciones aplicadas: ${pendientes.length}.`
          : 'No habia migraciones pendientes.'} ${this.construirMensajeIntegridadOk(auditoriaIntegridad)}`
    };
  }

  async auditarIntegridadAplicadas() {
    await this.repositorioMigraciones.asegurarTablaControl();

    const [migracionesDisponibles, migracionesAplicadas] = await Promise.all([
      this.cargarMigracionesDisponibles(),
      this.repositorioMigraciones.listarAplicadas()
    ]);

    const auditoria = this.auditarIntegridadMigraciones({
      migracionesDisponibles,
      migracionesAplicadas
    });

    if (!auditoria.ok) {
      throw new Error(this.construirMensajeErrorIntegridad(auditoria));
    }

    await this.verificarPostcondicionesAplicadas({
      migraciones: migracionesDisponibles,
      aplicadas: migracionesAplicadas
    });

    return auditoria;
  }

  async ejecutarMigracion(migracion) {
    const conexion = await this.clienteSql.obtenerConexion();

    try {
      await conexion.beginTransaction();
      await conexion.query(migracion.contenido);
      await this.verificadorPostcondiciones.verificar(migracion, conexion);
      await this.repositorioMigraciones.registrarAplicada(
        {
          nombreArchivo: migracion.nombreArchivo,
          checksum: migracion.obtenerChecksum()
        },
        conexion
      );
      await conexion.commit();
    } catch (error) {
      await conexion.rollback();
      throw new Error(
        `No se pudo aplicar la migracion ${migracion.nombreArchivo}: ${error.message}`
      );
    } finally {
      conexion.release();
    }
  }

  async verificarPostcondicionesAplicadas({ migraciones, aplicadas }) {
    const verificables = migraciones.filter(
      (migracion) =>
        aplicadas.has(migracion.nombreArchivo) &&
        this.verificadorPostcondiciones.tienePostcondicion(migracion.nombreArchivo)
    );
    if (verificables.length === 0) return;
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      for (const migracion of verificables) {
        await this.verificadorPostcondiciones.verificar(migracion, conexion);
      }
    } finally {
      conexion.release();
    }
  }

  auditarIntegridadMigraciones({
    migracionesDisponibles = [],
    migracionesAplicadas = new Map()
  } = {}) {
    const disponiblesPorNombre = new Map(
      migracionesDisponibles.map((migracion) => [migracion.nombreArchivo, migracion])
    );
    const inconsistencias = [];

    for (const [nombreArchivo, aplicada] of migracionesAplicadas.entries()) {
      const migracionActual = disponiblesPorNombre.get(nombreArchivo);

      if (!migracionActual) {
        inconsistencias.push({
          tipo: 'migracion_ausente_en_repo',
          nombreArchivo,
          checksumAplicado: aplicada.checksum,
          fechaAplicacion: aplicada.fechaAplicacion
        });
        continue;
      }

      const checksumActual = migracionActual.obtenerChecksum();

      if (aplicada.checksum === checksumActual) {
        continue;
      }

      inconsistencias.push({
        tipo: 'checksum_distinto',
        nombreArchivo,
        checksumAplicado: aplicada.checksum,
        checksumActual,
        fechaAplicacion: aplicada.fechaAplicacion
      });
    }

    return {
      ok: inconsistencias.length === 0,
      totalAplicadas: migracionesAplicadas.size,
      totalDisponibles: migracionesDisponibles.length,
      totalInconsistencias: inconsistencias.length,
      inconsistencias
    };
  }

  construirMensajeIntegridadOk(auditoria = {}) {
    return 'Integridad de migraciones verificada.';
  }

  construirMensajeErrorIntegridad(auditoria = {}) {
    const muestras = (auditoria.inconsistencias || [])
      .slice(0, 3)
      .map((entrada) => {
        if (entrada.tipo === 'migracion_ausente_en_repo') {
          return `${entrada.nombreArchivo} (aplicada pero ausente en el repositorio actual)`;
        }

        return `${entrada.nombreArchivo} (checksum aplicado ${entrada.checksumAplicado}, actual ${entrada.checksumActual})`;
      })
      .join('; ');

    return `La integridad de migraciones no es valida. Se detectaron ${Number(auditoria.totalInconsistencias || 0)} inconsistencias: ${muestras}.`;
  }
}
