# Plugin-virtual-de-audio-para-la-plataforma-Volumio

Plugin de Volumio que aplica a una grabación el sonido del pedal **MXR Distortion+**, usando un modelo del circuito calculado en Python. Funciona en una Raspberry Pi 5 con la tarjeta Pisound y se controla desde la interfaz web de Volumio.

Trabajo Final de Grado · Grado en Ingeniería de Sistemas Audiovisuales
Autor: David Bueno Cleybergh · Director: José Antonio Soria Pérez
Memoria: _(añadir enlace)_

## Contenido

```
audiorecorder2/   plugin de Volumio
matlab/           scripts de medida y figuras del capítulo 4 de la memoria
```

### `audiorecorder2/`

Plugin base heredado de un trabajo previo. **Solo se han trabajado estos ficheros; el resto es código heredado sin modificar** (grabación, reproducción, etc.).

| Fichero | Qué se ha hecho |
|---|---|
| `UIConfig.json` | Sección de la interfaz del filtro MXR (parámetros y botones). |
| `index.js` | Solo los métodos del final: `saveMxrConfig` (guarda y valida los parámetros) y `applyMxrEffect` (lanza el procesado). |
| `dsp.py` | Modelo del circuito. Adaptado para ejecutarse en la Raspberry Pi sin bibliotecas externas. |
| `file_proc.py` | Lee el WAV, llama a `dsp.py` y escribe el resultado. Adaptado igual. |

### `matlab/`

Scripts usados para obtener las medidas y las figuras del capítulo 4.

| Script | Qué hace | Memoria |
|---|---|---|
| `Generar_tono.m` | Genera el tono de prueba `tono220.wav` (220 Hz, amplitud 0,4, 2 s, 48 kHz). | 3.8 y 4.4.1 |
| `caracterizacion_distorsion.m` | Calcula la distorsión armónica total (THD) de los ficheros procesados en cada posición del mando. | 4.4 |
| `Comparar_senal_tono220.m` | Compara el tono original y el procesado: pico, valor eficaz y factor de cresta. | 4.5.1 |
| `Comparar_senal_guitarra.m` | Lo mismo con la grabación de guitarra. | 4.5.2 |

## Requisitos

- Raspberry Pi 5 con Volumio 3.0 y tarjeta Pisound.
- Python 3.7.3, que ya trae Volumio. No hace falta instalar nada más.
- MATLAB, solo para los scripts de `matlab/`.

## Instalación

1. Copiar la carpeta `audiorecorder2/` a `/data/plugins/music_service/audiorecorder2/` en la Raspberry Pi.
2. Reiniciar el servicio: `sudo systemctl restart volumio`.

## Uso desde la interfaz de Volumio

1. En los ajustes del plugin, indicar en la primera sección la carpeta y el nombre del fichero WAV a procesar.
2. En la sección del filtro MXR, ajustar **Distortion**, **Nivel de salida** y **Ganancia de entrada**, y pulsar **Guardar parámetros**.
3. Pulsar **Aplicar MXR Distortion+**.
4. El resultado aparece en **Mis grabaciones** como `mxr_<nombre>.wav`, junto al original.

Hay que guardar los parámetros antes de procesar: el botón usa los últimos valores guardados.

| Parámetro | Rango | Por defecto |
|---|---|---|
| Distortion (`wipper_dis`) | 0 – 1 | 0,5 |
| Nivel de salida (`wipper_out`) | 0 – 1 | 1,0 |
| Ganancia de entrada (`in_gain`) | 0,01 – 1 | 0,1 |

## Uso desde la línea de órdenes

```bash
python3 file_proc.py <entrada.wav> <salida.wav> <wipper_dis> <wipper_out> [--in-gain G] [--mono] [--quiet]
```

La salida es un WAV PCM de 16 bits, estéreo con la señal procesada duplicada en los dos canales (`--mono` escribe un solo canal).

## Cómo se obtuvieron las medidas

1. Generar el tono con `Generar_tono.m`.
2. Copiarlo a la Raspberry Pi y procesarlo con cada posición del mando:
   ```bash
   for d in 0.0 0.25 0.5 0.75 1.0; do
     python3 file_proc.py /home/volumio/recordings/tono220.wav \
                          /home/volumio/recordings/tono_$d.wav $d 1.0 --quiet
   done
   ```
3. Copiar los ficheros procesados al ordenador y ejecutar los scripts de MATLAB. Si hace falta, ajustar las rutas al principio de cada script.

## Limitaciones

- Solo procesa ficheros ya grabados, no audio en tiempo real.
- Los parámetros guardados se pierden al reiniciar el servicio de Volumio.
