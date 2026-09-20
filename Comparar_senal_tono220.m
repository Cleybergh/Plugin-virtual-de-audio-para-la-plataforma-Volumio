%% Comparación señal original vs. procesada con MXR Distortion
clear; clc;

% --- Cargar ficheros ---
[x_orig, fs] = audioread('tono220.wav');
[x_mxr,  ~ ] = audioread('tono220_dis1.00.wav');

% --- Un solo canal ---
if size(x_orig,2) > 1, x_orig = x_orig(:,1); end
if size(x_mxr,2)  > 1, x_mxr  = x_mxr(:,1);  end

% --- Igualar duraciones ---
n = min(length(x_orig), length(x_mxr));
x_orig = x_orig(1:n);
x_mxr  = x_mxr(1:n);

% --- Segmento de análisis: mismo criterio que el apartado 4.4 ---
i1 = 4000;
i2 = 4000 + 16384;
x_orig = x_orig(i1:i2);
x_mxr  = x_mxr(i1:i2);

t = (0:length(x_orig)-1)'/fs;
%% Figura 1 — forma de onda completa, misma escala en ambas
figure('Name','Comparación de forma de onda');

subplot(2,1,1);
plot(t, x_orig, 'b');
ylim([-1 1]); grid on;
title('Señal original');
xlabel('Tiempo (s)'); ylabel('Amplitud');

subplot(2,1,2);
plot(t, x_mxr, 'r');
ylim([-1 1]); grid on;
title('Señal procesada (MXR Distortion)');
xlabel('Tiempo (s)'); ylabel('Amplitud');

%% Figura 2 — zoom sobre un fragmento con nivel
n2 = round(2*fs/220);              % dos ciclos del fundamental
figure;
plot((0:n2-1)/fs*1000, x_orig(1:n2), 'b', 'LineWidth', 1.2); hold on;
plot((0:n2-1)/fs*1000, x_mxr(1:n2),  'r', 'LineWidth', 1.2);
legend('Original','Procesada');
xlabel('Tiempo (ms)'); ylabel('Amplitud');
title('Tono de 220 Hz: original y procesado');
grid on;

%% Métricas: pico, RMS y factor de cresta (apartado 2.3.2)
pico_orig = max(abs(x_orig));
rms_orig  = sqrt(mean(x_orig.^2));
cf_orig   = pico_orig / rms_orig;

pico_mxr = max(abs(x_mxr));
rms_mxr  = sqrt(mean(x_mxr.^2));
cf_mxr   = pico_mxr / rms_mxr;

fprintf('\n%-12s %8s %8s %8s %9s\n','Señal','Pico','RMS','CF','CF (dB)');
fprintf('%-12s %8.4f %8.4f %8.3f %9.2f\n', ...
        'Original', pico_orig, rms_orig, cf_orig, 20*log10(cf_orig));
fprintf('%-12s %8.4f %8.4f %8.3f %9.2f\n', ...
        'Procesada', pico_mxr, rms_mxr, cf_mxr, 20*log10(cf_mxr));
fprintf('\nReducción del factor de cresta: %.3f -> %.3f (%.2f dB)\n', ...
        cf_orig, cf_mxr, 20*log10(cf_mxr/cf_orig));