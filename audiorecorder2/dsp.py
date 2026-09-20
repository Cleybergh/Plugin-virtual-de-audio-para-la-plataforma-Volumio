

import math

SAMPLE_RATE = 48000


R_DIS_MAX = 1e6      # ohmios con el mando a 0 (ganancia minima, ~x2)
R_DIS_MIN = 1e3      # ohmios con el mando a 1 (ganancia maxima, ~x176)


def dis_to_ohms(wipper_dis):

    d = max(0.0, min(1.0, float(wipper_dis)))
    return R_DIS_MAX * (R_DIS_MIN / R_DIS_MAX) ** d


# --------------------------------------------------------------------------
# Precalculo de constantes del circuito
# --------------------------------------------------------------------------

def compute_coefficients(Ts, wipper_dis):
    """Calcula todas las constantes del circuito una sola vez.

    Ts          : periodo de muestreo (s)
    wipper_dis  : posicion del mando de distorsion [0.0 = limpio, 1.0 = maxima]
    """
    # --- Etapa de salida (filtro + diodos) ---
    rv, r5, c4, c5 = 10e3, 10e3, 1e-6, 1e-9
    Rc4 = Ts / (2 * c4)
    Rc5 = Ts / (2 * c5)
    Rc5v = Rc5 * rv / (Rc5 + rv)
    K = Rc5v / (Rc5v + Rc4 + r5)

    # --- Etapa de ganancia (op-amp no inversor) ---
    c1, c2, c3, c6 = 1e-9, 10e-9, 47e-9, 1e-6
    r1, r2, r3, r4, r67 = 10e3, 1e6, 4.7e3, 1e6, 500e3

    rv_dis = dis_to_ohms(wipper_dis)   # potenciometro DISTORTION (1 Mohm log)
    rc2 = Ts / (2 * c2)
    rc3 = Ts / (2 * c3)
    rc6 = Ts / (2 * c6)
    req3 = rv_dis + r3
    req2 = r67 * rc6 / (r67 + rc6)

    k_n_inv = 1 + r4 / (rc3 + req3)
    k_inv = r4 / (rc3 + req3)
    k1 = 1 / (rc2 + r1 + r2 + req2)
    k2 = 1 / (rc3 + req3 + r4)

    # --- Constantes de la etapa Newton-Raphson ---
    n_diode, Vt, Is = 1.8, 22e-3, 1e-9
    K_Rc4 = K * Rc4
    K_Rc4_R5 = K * (Rc4 + r5)
    K_Rc4_R5_2Is = K_Rc4_R5 * 2 * Is
    df_factor = K_Rc4_R5_2Is / (n_diode * Vt)
    vt_inv = 1.0 / (n_diode * Vt)

    c_xc6_factor = (2 * k1 / rc6) * req2

    return {
        'K': K, 'Rc4': Rc4, 'r5': r5, 'Rc5': Rc5,
        'vt_inv': vt_inv, 'Is': Is,
        'K_Rc4': K_Rc4, 'K_Rc4_R5': K_Rc4_R5,
        'K_Rc4_R5_2Is': K_Rc4_R5_2Is, 'df_factor': df_factor,
        # Coeficientes simplificados del bucle principal
        'A_vo1_vi':  k_n_inv * k1 * (r2 + req2),
        'A_vo1_xc2': -k_n_inv * k1 * (r2 + req2) * rc2,
        'A_vo1_xc6': k_n_inv * k1 * (rc2 + r1) * req2,
        'A_vo1_xc3': k_inv * rc3,
        'A_xc2_vi':  2 * k1,
        'A_xc2_xc6': -2 * k1 * req2,
        'A_xc2_xc2': k1 * (r1 + r2 + req2 - rc2),
        'A_xc6_vi':  c_xc6_factor,
        'A_xc6_xc6': c_xc6_factor * (r1 + r2 + rc2) - 1,
        'A_xc6_xc2': -c_xc6_factor * rc2,
        'A_xc3_xc3': k2 * (req3 + r4 - rc3),
        'A_xc3_vo1': -2 * k2,
        'A_xc5_vc5': 2 / Rc5,
        'A_xc4_v':   2 / (Rc4 + r5),
        'A_xc4_xc4': (r5 - Rc4) / (Rc4 + r5),
    }


# --------------------------------------------------------------------------
# Etapa no lineal: clipping de diodos por Newton-Raphson
# --------------------------------------------------------------------------

def _output_stage(vo1, c, xc4, xc5, vc5_init, tolerance=1e-7, max_iter=5000):

    vc5 = vc5_init
    K = c['K']p.add_argument('--mono', action='store_true'
    K_Rc4 = c['K_Rc4']
    K_Rc4_R5 = c['K_Rc4_R5']
    K_Rc4_R5_2Is = c['K_Rc4_R5_2Is']
    df_factor = c['df_factor']
    vt_inv = c['vt_inv']

    base = -K * vo1 + K_Rc4 * xc4 - K_Rc4_R5 * xc5

    for _ in range(max_iter):
        arg = vc5 * vt_inv
        # Limite anti-overflow del sinh/cosh (equivale a saturacion del diodo)
        if arg > 50.0:
            arg = 50.0
        elif arg < -50.0:
            arg = -50.0

        sinh_term = math.sinh(arg)
        cosh_term = math.cosh(arg)

        f = vc5 + base + K_Rc4_R5_2Is * sinh_term
        df = 1.0 + df_factor * cosh_term

        step = f / df
        vc5 -= step

        if abs(step) < tolerance:
            break

    return vc5


# --------------------------------------------------------------------------
# API principal
# --------------------------------------------------------------------------

def new_state():

    c = coeffs
    A_vo1_vi, A_vo1_xc2 = c['A_vo1_vi'], c['A_vo1_xc2']
    A_vo1_xc6, A_vo1_xc3 = c['A_vo1_xc6'], c['A_vo1_xc3']
    A_xc2_vi, A_xc2_xc6, A_xc2_xc2 = c['A_xc2_vi'], c['A_xc2_xc6'], c['A_xc2_xc2']
    A_xc6_vi, A_xc6_xc6, A_xc6_xc2 = c['A_xc6_vi'], c['A_xc6_xc6'], c['A_xc6_xc2']
    A_xc3_xc3, A_xc3_vo1 = c['A_xc3_xc3'], c['A_xc3_vo1']
    A_xc5_vc5 = c['A_xc5_vc5']
    A_xc4_v, A_xc4_xc4 = c['A_xc4_v'], c['A_xc4_xc4']

    xc2 = state['xc2']; xc3 = state['xc3']; xc4 = state['xc4']
    xc5 = state['xc5']; xc6 = state['xc6']; vc5_ant = state['vc5']

    out = []
    append = out.append

    for vin in block:
        vin = float(vin)

        # --- Etapa de ganancia ---
        vo1 = (A_vo1_vi * vin + A_vo1_xc2 * xc2 +
               A_vo1_xc6 * xc6 + A_vo1_xc3 * xc3)

        # Actualizacion SIMULTANEA de xc2/xc6 (ambas con valores del paso n-1)
        xc2_prev = xc2
        xc6_prev = xc6
        xc2 = A_xc2_vi * vin + A_xc2_xc6 * xc6_prev + A_xc2_xc2 * xc2_prev
        xc6 = A_xc6_vi * vin + A_xc6_xc6 * xc6_prev + A_xc6_xc2 * xc2_prev

        xc3 = A_xc3_xc3 * xc3 + A_xc3_vo1 * vo1

        # --- Etapa de salida no lineal ---
        vc5 = _output_stage(vo1, c, xc4, xc5, vc5_ant)
        append(wipper_out * vc5)
        vc5_ant = vc5

        xc5 = A_xc5_vc5 * vc5 - xc5
        xc4 = A_xc4_v * (vin - vc5) + A_xc4_xc4 * xc4

    state['xc2'] = xc2; state['xc3'] = xc3; state['xc4'] = xc4
    state['xc5'] = xc5; state['xc6'] = xc6; state['vc5'] = vc5_ant

    return out


def mxr_process(x, sr, wipper_dis=0.5, wipper_out=1.0, progress_cb=None,
                block_size=4096):
    """Procesa una senal mono completa (iterable de floats).

    x           : senal de entrada (mono, float, rango ~[-1, 1])
    sr          : frecuencia de muestreo (Hz)
    wipper_dis  : potenciometro DISTORTION [0.0 - 1.0]
    wipper_out  : potenciometro OUTPUT     [0.0 - 1.0]
    progress_cb : funcion opcional cb(muestras_procesadas, total)
    """
    Ts = 1.0 / sr
    coeffs = compute_coefficients(Ts, wipper_dis)
    state = new_state()

    total = len(x)
    out = []
    for i in range(0, total, block_size):
        out.extend(mxr_block(x[i:i + block_size], Ts, wipper_out, coeffs, state))
        if progress_cb is not None:
            progress_cb(min(i + block_size, total), total)

    return out
