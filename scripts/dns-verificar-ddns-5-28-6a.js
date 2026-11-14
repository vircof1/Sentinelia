import assert from 'node:assert/strict';
import { ProyeccionBindDeterministaDns }
  from '../paquetes/dns/src/ProyeccionBindDeterministaDns.js';
import { RegistroDns } from '../paquetes/dns/src/RegistroDns.js';
import { RenderizadorCatalogoBindDnsV1 }
  from '../paquetes/dns/src/RenderizadorCatalogoBindDnsV1.js';
import { ZonaDns } from '../paquetes/dns/src/ZonaDns.js';

await verificarManifiestoDiagnostico();
console.log('[dns-ddns] OK 5.28.6a: manifiesto=zona-linea-registro concesion=version hash=misma_fotografia bind=sin_metadatos_tecnicos determinismo=verificado');

async function verificarManifiestoDiagnostico() {
  const zona = zonaFixture();
  const registros = [
    registroFixture({ id: 900000001, host_relativo: 'api', valor_principal: '192.0.2.10' }),
    registroFixture({ id: 900000002, host_relativo: 'www', valor_principal: '192.0.2.11' })
  ];
  const concesionId = '018f8f70-7b5c-7a55-b32a-111111111111';
  const renderizador = new RenderizadorCatalogoBindDnsV1();
  const materializador = new ProyeccionBindDeterministaDns({
    validarDestino: async () => true
  });
  const crear = async (entradaRegistros, versionDdns = '7') => {
    const renderizada = renderizador.renderizarFotografia({
      zonas: [zona],
      registros: entradaRegistros,
      concesionesDdns: [{
        registroDnsId: '900000001', concesionId, versionDdns
      }]
    });
    const proyeccion = await materializador.materializar(renderizada.artefactos, {
      diagnostico: renderizada.diagnostico
    });
    return { renderizada, proyeccion };
  };

  const primera = await crear(registros);
  const segunda = await crear([...registros].reverse());
  assert.equal(primera.proyeccion.manifiestoCanonico, segunda.proyeccion.manifiestoCanonico);
  assert.deepEqual(primera.proyeccion.manifiesto.diagnostico.entradas, [
    {
      zonaDnsId: '800000001',
      rutaZona: 'zonas/db.example.test.zone',
      linea: 14,
      registroDnsId: '900000001',
      concesionId,
      versionDdns: '7'
    },
    {
      zonaDnsId: '800000001',
      rutaZona: 'zonas/db.example.test.zone',
      linea: 15,
      registroDnsId: '900000002',
      concesionId: null,
      versionDdns: null
    }
  ]);

  const zonaBytes = primera.renderizada.artefactos
    .find(({ ruta }) => ruta === 'zonas/db.example.test.zone').contenido;
  const textoBind = zonaBytes.toString('utf8');
  assert.equal(textoBind.split('\n')[13], 'api 300 IN A 192.0.2.10');
  assert.equal(textoBind.split('\n')[14], 'www 300 IN A 192.0.2.11');
  assert.doesNotMatch(textoBind, /90000000|018f8f70|concesion|version_ddns/iu);

  const versionPosterior = await crear(registros, '8');
  assert.equal(
    Buffer.compare(zonaBytes, versionPosterior.renderizada.artefactos
      .find(({ ruta }) => ruta === 'zonas/db.example.test.zone').contenido),
    0
  );
  assert.notEqual(
    primera.proyeccion.hashProyeccion.toString('hex'),
    versionPosterior.proyeccion.hashProyeccion.toString('hex')
  );
}

function zonaFixture() {
  return new ZonaDns({
    id: 800000001,
    nombre_zona: 'example.test',
    tipo_zona: 'master',
    categoria_origen: 'normal',
    publicar_en_bind: 1,
    ttl_defecto_segundos: 3600,
    soa_mname: 'ns1.example.test',
    soa_rname: 'hostmaster.example.test',
    soa_serial: 1,
    soa_refresh_segundos: 3600,
    soa_retry_segundos: 600,
    soa_expire_segundos: 1209600,
    soa_minimum_segundos: 300,
    activo: 1
  });
}

function registroFixture(cambios) {
  return new RegistroDns({
    zona_id: 800000001,
    nombre_zona: 'example.test',
    tipo_registro: 'A',
    ttl_segundos: 300,
    categoria_origen: 'ddns',
    publicar_en_bind: 1,
    activo: 1,
    ...cambios
  });
}
