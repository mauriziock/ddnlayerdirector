# HANGAR MESH - Operator Manual

## Sistema de Orquestación de Medios en Tiempo Real

Este sistema integra **Node.js**, **Go2RTC** y **MediaMTX** para manejar flujos de video SRT/WebRTC de baja latencia. Todo está dockerizado para facilitar el despliegue.

---

## 1. Requisitos Previos

- **Docker** y **Docker Compose** instalados en el sistema host (Linux recomendado).
- Puertos libres en el host:
  - `3000` (Panel de Control)
  - `1984` (Api Go2RTC)
  - `8554` (RTSP Go2RTC)
  - `8555` (WebRTC Go2RTC)
  - `9997` (Api MediaMTX)
  - `8544` (RTSP MediaMTX - personalizado para evitar conflicto)
  - `8890` (SRT Ingest)

---

## 2. Instalación y Despliegue

### Paso 1: Preparación
Asegúrate de tener los archivos de configuración en la raíz:
- `go2rtc.yaml`
- `mediamtx.yml`
- `.env` (Opcional, si deseas configurar secretos)

### Paso 2: Ejecución
Para levantar todo el sistema, ejecuta el script de automatización (o usa docker-compose directamente):

```bash
docker-compose up -d --build
```

Esto iniciará 3 contenedores:
1. **hangar_mesh_app**: Tu panel de control y lógica.
2. **hangar_mesh_go2rtc**: Motor de WebRTC.
3. **hangar_mesh_mediamtx**: Servidor de ingesta SRT.

---

## 3. Acceso y Seguridad

### Panel de Control
Accede a: `http://localhost:3000` (o la IP de tu servidor).

### Login
- El sistema cuenta con autenticación obligatoria.
- **Usuario por defecto**: Si es la primera vez que lo corres, se creará automáticamente:
  - **Usuario**: `admin`
  - **Contraseña**: La primera vez, revisa los logs o usa una predefinida si así se configuró (por defecto en este código es hash de `admin`). 
  - **NOTA**: Se recomienda cambiar esto editando `data/users.json` y reiniciando, o mediante una futura interfaz de gestión.

### Restaurar Contraseña / Usuario
Si olvidas la contraseña o "rompes" el acceso:
1. Entra a la carpeta del proyecto.
2. Borra el archivo de usuarios: `rm data/users.json`.
3. Reinicia el contenedor: `docker-compose restart app`.
4. El sistema detectará que no hay usuarios y regenerará el usuario `admin`.

---

## 4. Troubleshooting (Solución de Problemas)

### "No veo las cámaras"
- Verifica que Go2RTC esté corriendo: `http://localhost:1984`.
- Verifica que MediaMTX esté recibiendo flujo SRT.

### "Error de conflicto de puertos"
- Si Docker falla al iniciar, es probable que ya tengas `go2rtc` o `mediamtx` corriendo fuera de Docker.
- Detén los procesos locales: `killall go2rtc mediamtx` antes de levantar Docker.

### "La dockerización falló"
- Asegúrate de que `docker-compose` está usando la red `host`. En Windows/Mac esto puede comportarse diferente. En Linux es nativo.

---

## 5. Estructura de Datos
Todos los datos persistentes se guardan en la carpeta `./data` del host:
- `data/scenes.json`: Tus configuraciones de escenas.
- `data/users.json`: Tu base de datos de usuarios.

¡Esto asegura que aunque actualices los contenedores, no pierdas tu configuración!
