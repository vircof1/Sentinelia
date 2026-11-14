import assert from 'node:assert/strict';
import { ServicioAdministracionDnsPortal } from '../apps/sentinelia-web/src/servicios/ServicioAdministracionDnsPortal.js';

const contextoUsuarioActual = {
  idUsuario: 7,
  permisos: {
    editarDns: true,
    administrarDnsAvanzado: true,
    publicarDns: true
  }
};

const zona = {
  id: 1,
  categoriaOrigen: 'normal',
  publicarEnBind: true,
  serializarResumen: () => ({ id: 1, nombreZona: 'ejemplo.test' })
};

const registro = {
  id: 12,
  zonaId: 1,
  categoriaOrigen: 'ddns',
  publicarEnBind: true,
  serializarResumen: () => ({
    id: 12,
    zonaId: 1,
    categoriaOrigen: 'ddns',
    publicarEnBind: true
  })
};

const concesionesEsperadas = [{ concesionId: 'concesion-1', estado: 'vigente' }];
let consultasConcesiones = 0;

const servicio = new ServicioAdministracionDnsPortal({
  repositorioZonasDns: {
    buscarVisiblePorId: async () => zona
  },
  repositorioRegistrosDns: {
    buscarPorId: async () => registro
  },
  repositorioTenants: null,
  repositorioEmpresas: null,
  repositorioSitios: null,
  resolutorScopeUsuario: null,
  servicioLecturaDnsPortal: {
    construirVistaDetalle: async () => ({
      zona: zona.serializarResumen(),
      registros: [registro.serializarResumen()]
    })
  },
  servicioLecturaAdministrativaDdnsAgentes: {
    listarPorRegistro: async ({ contextoUsuarioActual: contexto, registroDnsId }) => {
      consultasConcesiones += 1;
      assert.equal(contexto, contextoUsuarioActual);
      assert.equal(registroDnsId, registro.id);
      return concesionesEsperadas;
    }
  }
});

servicio.verificarOperacionRegistrosEnZonaPermitida = () => {};
servicio.verificarEdicionRegistroAvanzadaPermitida = () => {};
servicio.construirFormularioRegistroDesdeRegistro = () => ({
  categoriaOrigen: 'ddns',
  publicarEnBind: true
});
servicio.construirAlcanceActual = () => ({ nivel: 'portal' });

const detalle = await servicio.construirVistaDetalle(
  contextoUsuarioActual,
  zona.id,
  { page: 1 }
);
assert.equal(detalle.registros.length, 1);
assert.equal(
  consultasConcesiones,
  0,
  'El detalle de zona no debe consultar concesiones de un registro inexistente.'
);

const formularioEdicion = await servicio.construirVistaFormularioRegistro(
  contextoUsuarioActual,
  zona.id,
  { idRegistro: registro.id }
);
assert.deepEqual(formularioEdicion.concesionesDdns, concesionesEsperadas);
assert.equal(consultasConcesiones, 1);

const formularioCreacion = await servicio.construirVistaFormularioRegistro(
  contextoUsuarioActual,
  zona.id
);
assert.deepEqual(formularioCreacion.concesionesDdns, []);
assert.equal(
  consultasConcesiones,
  1,
  'Crear un registro todavía inexistente no debe consultar concesiones DDNS.'
);

console.log(
  '[dns] OK regresión vistas DDNS: detalle de zona y formularios de registro coherentes.'
);
