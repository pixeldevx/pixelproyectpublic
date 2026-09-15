# Pixel 24/7 en reTerminal E1001

Este firmware convierte la reTerminal E1001 en una pantalla permanente de Pixel. El dispositivo se conecta a una red Wi-Fi de 2,4 GHz, consulta Pixel periódicamente y actualiza la pantalla únicamente cuando cambia la versión del dashboard.

Si Internet falla, Vercel no responde o la imagen está incompleta, la pantalla conserva la última imagen válida.

## Lo que necesitas

- reTerminal E1001 y cable USB-C.
- Arduino IDE 2.x.
- La red Wi-Fi debe ser de **2,4 GHz**.
- `EPAPER_ADMIN_TOKEN` ya configurado en Vercel.

## 1. Preparar Arduino IDE

1. Instala el soporte **esp32 by Espressif Systems** desde el gestor de tarjetas.
2. Instala estas bibliotecas desde el gestor de bibliotecas:
   - **PNGdec** de Larry Bank.
   - **Seeed GFX**. Si no aparece en el gestor, descárgala desde el repositorio oficial y usa `Programa > Incluir librería > Añadir biblioteca .ZIP`.
3. Abre `reterminal-e1001-pixel.ino` en Arduino IDE.
4. Selecciona:
   - Tarjeta: `XIAO_ESP32S3`
   - PSRAM: `OPI PSRAM`
   - Flash Size: `8 MB`
   - Partition Scheme: `Default 8 MB`

## 2. Guardar la conexión privada

1. Duplica `config.example.h` en la misma carpeta.
2. Nombra la copia `config.h`.
3. Completa:
   - `WIFI_SSID`: nombre exacto de la Wi-Fi 2,4 GHz.
   - `WIFI_PASSWORD`: contraseña de la Wi-Fi.
   - `PIXEL_BASE_URL`: `https://www.pixelprojects.com.co` o el dominio de producción usado en Vercel.
   - `PIXEL_DEVICE_TOKEN`: el mismo valor de `EPAPER_ADMIN_TOKEN` en Vercel.

`config.h` está excluido de Git y no debe compartirse ni subirse a GitHub.

## 3. Instalarlo en la reTerminal

1. Conecta la reTerminal por USB-C al computador.
2. En Arduino IDE selecciona el puerto que aparezca para la E1001.
3. Pulsa **Subir**.
4. Al finalizar, reinicia el dispositivo una vez.

La primera conexión descarga la imagen. A partir de ahí consulta Pixel con el intervalo indicado por `EPAPER_REFRESH_SECONDS` en Vercel (10 minutos de forma predeterminada), pero la tinta electrónica solo se refresca si el contenido cambió.

## Diagnóstico

Abre el monitor serie a `115200` baudios. Los mensajes indican por separado conexión Wi-Fi, consulta de versión, descarga, validación del PNG y actualización de pantalla.

- Si no conecta: confirma que la red sea 2,4 GHz y revisa nombre/contraseña.
- Si devuelve HTTP 401: `PIXEL_DEVICE_TOKEN` no coincide con `EPAPER_ADMIN_TOKEN`.
- Si no refresca: el mensaje `No change; e-paper refresh skipped` significa que funciona, pero Pixel no detectó cambios desde la imagen anterior.

## Seguridad

La comunicación usa HTTPS y el token se envía como `Authorization: Bearer`. Para facilitar la compatibilidad con certificados renovables de Vercel, esta primera versión no fija localmente una autoridad certificadora. Debe usarse solo con el dominio HTTPS controlado por Pixel y nunca con una URL recibida de terceros.

## Referencias oficiales

- [Inicio con reTerminal E1001](https://wiki.seeedstudio.com/getting_started_with_reterminal_e1001/)
- [Configuración Arduino para reTerminal E10xx](https://wiki.seeedstudio.com/reterminal_e10xx_with_arduino/)
- [Biblioteca Seeed GFX](https://github.com/Seeed-Studio/Seeed_GFX)
