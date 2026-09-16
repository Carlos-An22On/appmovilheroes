# Heroes Planeta Movil

App Android/Expo para registrar asistentes de sensibilizaciones aun cuando la conexion falle durante la jornada.

## Funcionalidad

- Inicio de sesion contra la web de Heroes del Planeta.
- Listado de sensibilizaciones asignadas al usuario sensibilizador.
- Inicio de jornada con nombre y cedula del sensibilizador.
- Captura de registros offline con nombre, tipo de asistente, direccion, datos opcionales y firma.
- Almacenamiento local de pendientes en el dispositivo.
- Sincronizacion posterior contra la web cuando vuelva internet.

## Requisitos

- Node.js instalado.
- App Expo Go en el telefono, o Android Studio si vas a usar emulador.
- Backend Django corriendo con los endpoints `api/mobile/*`.

## Ejecutar

```bash
cd C:\Users\cpcar\Proyectos\HeroesPlanetaMovil
npm install
npm start
```

Luego abre en Android con Expo Go o con `npm run android`.

## URL del servidor

En la pantalla de login puedes editar la URL del backend.

- Produccion: `https://heroesdelplaneta.co`
- Emulador Android: `http://10.0.2.2:8000`
- Celular fisico: `http://IP_DE_TU_PC:8000`, por ejemplo `http://192.168.1.50:8000`

Para celular fisico, el telefono y el computador deben estar en la misma red y Django debe aceptar conexiones externas, por ejemplo:

```bash
python manage.py runserver 0.0.0.0:8000
```

## Flujo de trabajo en campo

1. Iniciar sesion con internet.
2. Seleccionar la sensibilizacion.
3. Tocar `Aplicar a la sensibilizacion` e iniciar jornada.
4. Registrar asistentes; cada registro queda guardado localmente.
5. Al recuperar internet, tocar `Sincronizar ahora`.

Los registros enviados correctamente se eliminan de pendientes en el dispositivo.

## Generar instalador Android

La app esta preparada para generar un APK instalable con EAS Build:

```bash
npm install -g eas-cli
eas login
npm run build:android:apk
```

El perfil `preview` genera un archivo `.apk` para instalar directamente en Android. El perfil `production` genera `.aab` para Play Store.
