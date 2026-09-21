%% Comparación señal original vs. procesada con MXR Distortion
clear; clc;

% --- Cargar ficheros ---
[x_orig, fs] = audioread('guitarra.wav');
[x_mxr,  ~ ] = audioread('mxr_guitarra.wav');

% --- Elegir el canal con más señal en el original ---
pico_L = max(abs(x_orig(:,1)));
pico_R = max(abs(x_orig(:,2)));
if pico_L >= pico_R
    x_orig = x_orig(:,1);
    fprintf('Original: canal izquierdo (pico %.4f vs %.4f)\n', pico_L, pico_R);
else
    x_orig = x_orig(:,2);
    fprintf('Original: canal derecho (pico %.4f vs %.4f)\n', pico_R, pico_L);
end
x_mxr = x_mxr(:,1);   % los dos canales son idénticos

% --- Igualar duraciones ---
n = min(length(x_orig), length(x_mxr));
x_orig = x_orig(1:n);
x_mxr  = x_mxr(1:n);
t = (0:n-1)' / fs;

% --- Cortar la parte con silencio del señal real
i1 = round(2.3*fs);
i2 = round(5.3*fs);
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
t_inicio =  1.87;    % ajusta a un pasaje donde haya señal
t_dur    =  0.02;   % 20 ms
idx = t >= t_inicio & t < (t_inicio + t_dur);

figure('Name','Detalle de la forma de onda');
plot(t(idx), x_orig(idx), 'b', 'LineWidth', 1.2); hold on;
plot(t(idx), x_mxr(idx),  'r', 'LineWidth', 1.2);
legend('Original','Procesada');
xlabel('Tiempo (s)'); ylabel('Amplitud');
title('Detalle: recorte de la señal');
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