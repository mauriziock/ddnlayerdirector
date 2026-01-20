# Hangar Package Standard 1.0

Este es el estándar para crear paquetes de programas autoinstalables en **Hangar Mesh**.

## Estructura de Archivos
- `manifest.json`: Manifiesto del paquete (Obligatorio). Define capas y botones.
- `index.html`: Punto de entrada visual (opcional, pero recomendado para paquetes visuales).
- `assets/`: Carpeta para recursos locales.

## Cómo instalar un nuevo paquete
1. Crea una carpeta dentro de `public/packages/` con el nombre de tu paquete.
2. Agrega un `manifest.json` siguiendo el formato estandar.
3. El servidor lo detectará automáticamente y aparecerá en la "Package Library" listo para instalar.

## El Bridge (Comunicación)
Tu archivo HTML debe escuchar eventos `message` para reaccionar al Director:

```javascript
window.addEventListener('message', (event) => {
    const { type, key, value, payload } = event.data;
    // type: 'state' (persistente) o 'trigger' (momentáneo)
    // key: el ID definido en el manifest.json
    // value: true/false (solo para states)
    // payload: datos extra (ej: texto de una alerta)
});
```

## Referencia del manifest.json
El campo `url` en las capas puede empezar por `./` para referenciar archivos locales de la carpeta del paquete.
Example:
```json
{
  "id": "my_package",
  "name": "My Custom Package",
  "requirements": {
    "layers": [
      {
        "id": "main_view",
        "type": "web_source",
        "url": "./index.html"
      }
    ]
  }
}
```
