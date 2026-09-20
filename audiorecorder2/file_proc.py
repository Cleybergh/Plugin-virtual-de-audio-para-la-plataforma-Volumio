#!/usr/bin/env python3

 
import argparse
import array
import os
import sys
import time
import wave
 
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsp import mxr_process  # noqa: E402
 
 
# --------------------------------------------------------------------------
# Lectura de WAV con el modulo estandar 'wave'
# --------------------------------------------------------------------------
 
def leer_wav(ruta):

    w = wave.open(ruta, 'rb')
    try:
        n_canales = w.getnchannels()
        ancho     = w.getsampwidth()     # bytes por muestra: 1, 2, 3 o 4
        sr        = w.getframerate()
        n_frames  = w.getnframes()
        crudo     = w.readframes(n_frames)
    finally:
        w.close()
 
    if ancho == 2:
        # 16 bits con signo. El modulo 'array' lo convierte de golpe (rapido).
        datos = array.array('h')
        datos.frombytes(crudo)
        if sys.byteorder == 'big':
            datos.byteswap()             # el WAV siempre es little-endian
        escala = 1.0 / 32768.0
        muestras = [v * escala for v in datos]
 
    elif ancho == 1:
        # 8 bits SIN signo: el silencio esta en 128, no en 0.
        datos = array.array('B')
        datos.frombytes(crudo)
        muestras = [(v - 128) / 128.0 for v in datos]
 
    elif ancho == 4:
        # 32 bits con signo.
        datos = array.array('i')
        datos.frombytes(crudo)
        if sys.byteorder == 'big':
            datos.byteswap()
        escala = 1.0 / 2147483648.0
        muestras = [v * escala for v in datos]
 
    elif ancho == 3:
        # 24 bits: no hay tipo nativo, hay que montarlo byte a byte.
        muestras = []
        escala = 1.0 / 8388608.0
        for i in range(0, len(crudo), 3):
            b0 = crudo[i]
            b1 = crudo[i + 1]
            b2 = crudo[i + 2]
            v = b0 | (b1 << 8) | (b2 << 16)
            if v >= 8388608:             # conversion a complemento a dos
                v -= 16777216
            muestras.append(v * escala)
 
    else:
        raise ValueError('Ancho de muestra no soportado: %d bytes' % ancho)
 
    # Mezcla a mono: el modelo tiene un unico juego de variables de estado.
    if n_canales > 1:
        mono = []
        inv = 1.0 / n_canales
        for i in range(0, len(muestras), n_canales):
            mono.append(sum(muestras[i:i + n_canales]) * inv)
        muestras = mono
 
    return muestras, sr, n_canales
 
 
# --------------------------------------------------------------------------
# Escritura de WAV PCM 16 bits
# --------------------------------------------------------------------------
 
def escribir_wav(ruta, muestras, sr, n_canales=2):

    datos = array.array('h')
    for v in muestras:
        n = int(v * 32767.0)
        # Recorte duro de seguridad: fuera de rango, 'array' daria error
        if n > 32767:
            n = 32767
        elif n < -32768:
            n = -32768
        if n_canales == 2:
            datos.append(n)      # canal izquierdo
            datos.append(n)      # canal derecho (identico)
        else:
            datos.append(n)
 
    if sys.byteorder == 'big':
        datos.byteswap()
 
    w = wave.open(ruta, 'wb')
    try:
        w.setnchannels(n_canales)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(datos.tobytes())
    finally:
        w.close()
 
 
# --------------------------------------------------------------------------
# Programa principal
# --------------------------------------------------------------------------
 
def parse_args():
    p = argparse.ArgumentParser(description='MXR Distortion offline processor')
    p.add_argument('input', help='Fichero WAV de entrada')
    p.add_argument('output', help='Fichero WAV de salida')
    p.add_argument('wipper_dis', type=float, help='Mando DISTORTION 0.0-1.0')
    p.add_argument('wipper_out', type=float, help='Mando OUTPUT 0.0-1.0')
    p.add_argument('--in-gain', type=float, default=0.1,
                   help='Ganancia de entrada (def. 0.1, nivel de pastilla)')
    p.add_argument('--mono', action='store_true',
                   help='Escribir la salida en mono (por defecto: estereo '
                        'duplicado, requerido por la cadena ALSA de Volumio)')
    p.add_argument('--quiet', action='store_true')
    return p.parse_args()
 
 
def clamp(v, lo, hi):
    return max(lo, min(hi, v))
 
 
def main():
    args = parse_args()
 
    wipper_dis = clamp(args.wipper_dis, 0.0, 1.0)
    wipper_out = clamp(args.wipper_out, 0.0, 1.0)
    in_gain    = clamp(args.in_gain, 0.001, 10.0)
 
    if not os.path.isfile(args.input):
        sys.stderr.write('No existe el fichero de entrada: %s\n' % args.input)
        sys.exit(2)
 
    # ---------------- Lectura ----------------
    try:
        muestras, sr, n_canales = leer_wav(args.input)
    except wave.Error as e:
        sys.stderr.write('El fichero no es un WAV PCM valido: %s\n' % e)
        sys.exit(2)
    except Exception as e:
        sys.stderr.write('Error leyendo el WAV: %s\n' % e)
        sys.exit(2)
 
    total = len(muestras)
    if total == 0:
        sys.stderr.write('El fichero de entrada no contiene muestras.\n')
        sys.exit(2)
 
    # Escalado al nivel de trabajo real del circuito
    muestras = [v * in_gain for v in muestras]
 
    print('Entrada : %s (%d muestras, %d Hz, %d canal/es)'
          % (os.path.basename(args.input), total, sr, n_canales))
    print('Parametros: dis=%.3f out=%.3f in_gain=%.3f'
          % (wipper_dis, wipper_out, in_gain))
    sys.stdout.flush()
 
    # ---------------- Procesado ----------------
    t0 = time.time()
    ultimo_pct = [-1]
 
    def progreso(hechas, tot):
        if args.quiet:
            return
        pct = int(hechas * 100 / tot)
        if pct != ultimo_pct[0] and pct % 10 == 0:
            ultimo_pct[0] = pct
            print('Progreso: %d%%' % pct)
            sys.stdout.flush()
 
    try:
        y = mxr_process(muestras, sr,
                        wipper_dis=wipper_dis,
                        wipper_out=wipper_out,
                        progress_cb=progreso)
    except Exception as e:
        sys.stderr.write('Error durante el procesado DSP: %s\n' % e)
        sys.exit(3)
 
    transcurrido = time.time() - t0
 
    # ---------------- Normalizacion de seguridad ----------------
    pico = 0.0
    for v in y:
        a = v if v >= 0 else -v
        if a > pico:
            pico = a
 
    if pico > 1.0:
        factor = 0.98 / pico
        y = [v * factor for v in y]
        print('Pico %.3f -> normalizado a 0.98' % pico)
    elif pico < 1e-9:
        sys.stderr.write('La salida es silencio absoluto. Revisa --in-gain '
                         'o el fichero de entrada.\n')
 
    # ---------------- Escritura ----------------
    try:
        carpeta = os.path.dirname(os.path.abspath(args.output))
        if carpeta and not os.path.isdir(carpeta):
            os.makedirs(carpeta)
        canales_salida = 1 if args.mono else 2
        escribir_wav(args.output, y, sr, canales_salida)
    except Exception as e:
        sys.stderr.write('Error escribiendo el WAV de salida: %s\n' % e)
        sys.exit(4)
 
    dur = total / float(sr)
    print('OK: %s (%s)' % (args.output, 'mono' if args.mono else 'estereo'))
    print('Duracion audio: %.2f s | Tiempo CPU: %.2f s | x%.2f tiempo real'
          % (dur, transcurrido, transcurrido / dur if dur else 0.0))
    sys.exit(0)
 
 
if __name__ == '__main__':
    main()