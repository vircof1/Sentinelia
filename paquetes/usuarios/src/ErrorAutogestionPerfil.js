export class ErrorAutogestionPerfil extends Error {
  constructor({ codigo, mensaje, estadoHttp = 400, datos = null }) {
    super(mensaje);
    this.name = 'ErrorAutogestionPerfil';
    this.codigo = codigo;
    this.estadoHttp = estadoHttp;
    this.datos = datos;
  }
}
