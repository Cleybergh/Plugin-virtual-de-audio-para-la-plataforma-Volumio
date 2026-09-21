%% THD del modelo MXR a partir de los ficheros procesados por el plugin
clear; clc;

fs = 48000;   % frecuencia de muestreo
f0 = 220;     % fundamental del tono de prueba
N  = 16384;   % muestras analizadas
SKIP = 4000;  % muestras descartadas (transitorio)

pos = [0.0 0.25 0.5 0.75 1.0];
ficheros = {'tono220_dis0.00.wav','tono220_dis0.25.wav','tono220_dis0.50.wav', 'tono220_dis0.75.wav','tono220_dis1.00.wav'};

w  = 0.5 - 0.5*cos(2*pi*(0:N-1)'/(N-1));   % ventana de Hann
df = fs/N;                                  % resolución del espectro (Hz)

THD_todas = zeros(1,5);

fprintf('%8s %10s %10s\n','dis','THD(%)','THD(dB)');
for k = 1:5
    y = audioread(ficheros{k});
    y = y(:,1);                        % un canal
    y = y(SKIP+1 : SKIP+N);            % segmento de análisis

    Y = abs(fft(y.*w));
    Y = Y(1:N/2+1);

    V1 = max(Y(round(f0/df)+1 + (-2:2)));       % fundamental
    Vk = zeros(1,6);
    for n = 2:7
        Vk(n-1) = max(Y(round(n*f0/df)+1 + (-2:2)));   % armónicos 2º a 7º
    end

    THD = sqrt(sum(Vk.^2))/V1;
    fprintf('%8.2f %10.3f %10.1f\n', pos(k), 100*THD, 20*log10(THD));
    THD_todas(k) = THD;
end
%% Figura 1: espectros para tres posiciones del mando
idx = [1 3 5];   % 0.00, 0.50, 1.00

figure('Position',[100 100 700 750]);
for i = 1:3
    k = idx(i);
    y = audioread(ficheros{k});
    y = y(:,1);
    y = y(SKIP+1 : SKIP+N);

    Y = abs(fft(y.*w));  Y = Y(1:N/2+1);
    f = (0:N/2)'*df;
    V1 = max(Y(round(f0/df)+1 + (-2:2)));

    subplot(3,1,i);
    plot(f, 20*log10(max(Y/V1,1e-12)), 'LineWidth', 0.8);
    hold on;
    for n = 2:7
        plot([n*f0 n*f0], [-120 5], ':', 'Color', [0.75 0.75 0.75]);
    end
    xlim([0 2000]); ylim([-120 5]); grid on;
    xlabel('Frecuencia (Hz)'); ylabel('Nivel relativo (dB)');
    title(sprintf('Distortion = %.2f', pos(k)));
end

%% Figura 2: formas de onda, dos ciclos del fundamental
n2 = round(2*fs/f0);

figure('Position',[100 100 700 400]);
hold on;
for k = [1 3 5]
    y = audioread(ficheros{k});
    y = y(:,1);
    y = y(SKIP+1 : SKIP+n2);
    plot((0:n2-1)/fs*1000, y, 'LineWidth', 1.1);
end
grid on;
xlabel('Tiempo (ms)'); ylabel('Amplitud normalizada');
legend('dis = 0','dis = 0,5','dis = 1', 'Location','best');
title('Forma de onda: dos ciclos del fundamental');

%% Figura 3: THD frente a la posición del mando
figure('Position',[100 100 550 380]);
plot(pos, THD_todas*100, 'o-', 'LineWidth', 1.4, 'MarkerFaceColor','w');
grid on;
xlabel('Posición del mando de distorsión');
ylabel('THD (%)');
title('Distorsión armónica total frente a la posición del mando');